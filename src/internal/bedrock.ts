import * as Errors from '../error';
import type { ApiKeySetter } from '../client';
import type { FinalizedRequestInit } from './types';
import type { ProviderRequestContext } from './provider';
import { readEnv } from './utils';

/** Selects the regional Amazon Bedrock endpoint and its matching SigV4 service. */
export type BedrockEndpoint = 'mantle' | 'runtime';

/** Endpoint and region settings shared by the Bedrock provider variants. */
export interface BedrockEndpointOptions {
  /**
   * Amazon Bedrock endpoint family. Defaults to `mantle` for compatibility;
   * select `runtime` to use its regional hostname and AWS signing service.
   */
  endpoint?: BedrockEndpoint | undefined;

  /**
   * AWS region used to derive the selected endpoint and sign AWS requests.
   * Defaults to `AWS_REGION`, then `AWS_DEFAULT_REGION`.
   */
  region?: string | undefined;

  /**
   * Bedrock API root. Defaults to `AWS_BEDROCK_BASE_URL`, then the regional
   * selected endpoint. Set to `null` to bypass the environment override.
   */
  baseURL?: string | null | undefined;
}

/** Mutually exclusive sources for a Bedrock bearer credential. */
export interface BedrockBearerOptions {
  /**
   * Explicit Bedrock bearer credential. Set to `null` to disable the
   * `AWS_BEARER_TOKEN_BEDROCK` fallback.
   */
  apiKey?: string | null | undefined;

  /** Resolves a fresh bearer credential before every request attempt and retry. */
  tokenProvider?: ApiKeySetter | undefined;
}

/** Per-client authentication handler invoked before each Bedrock request. */
export interface BedrockRequestAuth {
  /** Adds provider-owned authentication headers or rejects invalid credentials. */
  prepareRequest(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}

/** Creates an authentication handler with independent per-client state. */
export type BedrockAuthFactory = () => BedrockRequestAuth;

/** Wraps a provider failure in an SDK error while preserving its original cause. */
export function errorWithCause(message: string, cause: unknown): Errors.OpenAIError {
  const error = new Errors.OpenAIError(message) as Errors.OpenAIError & { cause?: unknown };
  error.cause = cause;
  return error;
}

/** Trims a configuration string, treating missing and whitespace-only values as absent. */
export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : undefined;
  return normalized || undefined;
}

function normalizeBaseURL(baseURL: string): string {
  const url = new URL(baseURL);
  const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
  if (responsesMatch?.index !== undefined) {
    url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
  }
  return url.toString().replace(/\/$/, '');
}

function resolveRuntimeDnsSuffix(region: string): string {
  if (region.startsWith('cn-')) {
    return 'amazonaws.com.cn';
  }
  if (region.startsWith('eusc-')) {
    return 'amazonaws.eu';
  }
  if (region.startsWith('us-iso-')) {
    return 'c2s.ic.gov';
  }
  if (region.startsWith('us-isob-')) {
    return 'sc2s.sgov.gov';
  }
  if (region.startsWith('eu-isoe-')) {
    return 'cloud.adc-e.uk';
  }
  if (region.startsWith('us-isof-')) {
    return 'csp.hci.ic.gov';
  }
  return 'amazonaws.com';
}

/** Identifies a canonical Amazon Bedrock hostname and its embedded AWS region. */
export function parseBedrockEndpointHostname(hostname: string):
  | {
      /** Endpoint family identified by the canonical AWS hostname. */
      endpoint: BedrockEndpoint;

      /** AWS region embedded in the canonical endpoint hostname. */
      region: string;
    }
  | undefined {
  const canonicalHostname = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  // oxlint-disable-next-line prefer-named-capture-group -- Published SDK source must compile for ES2015.
  const mantleRegion = /^bedrock-mantle\.([a-z0-9-]+)\.api\.aws$/i.exec(canonicalHostname)?.[1];
  if (mantleRegion) {
    return { endpoint: 'mantle', region: mantleRegion };
  }

  const runtimeMatch =
    // oxlint-disable-next-line prefer-named-capture-group -- Published SDK source must compile for ES2015.
    /^bedrock-runtime\.([a-z0-9-]+)\.(amazonaws\.com(?:\.cn)?|amazonaws\.eu|c2s\.ic\.gov|sc2s\.sgov\.gov|cloud\.adc-e\.uk|csp\.hci\.ic\.gov)$/i.exec(
      canonicalHostname,
    );
  const runtimeRegion = runtimeMatch?.[1];
  if (runtimeRegion && runtimeMatch[2]?.toLowerCase() === resolveRuntimeDnsSuffix(runtimeRegion)) {
    return { endpoint: 'runtime', region: runtimeRegion };
  }

  return undefined;
}

/** Rejects insecure or mismatched canonical Amazon Bedrock endpoint overrides. */
function validateCanonicalBedrockEndpoint(
  baseURL: string,
  endpoint: BedrockEndpoint,
  region: string | undefined,
): void {
  const parsedBaseURL = new URL(baseURL);
  const canonicalEndpoint = parseBedrockEndpointHostname(parsedBaseURL.hostname);
  if (canonicalEndpoint && parsedBaseURL.protocol !== 'https:') {
    throw new Errors.OpenAIError('Canonical Amazon Bedrock endpoints require HTTPS.');
  }
  if (canonicalEndpoint && canonicalEndpoint.endpoint !== endpoint) {
    throw new Errors.OpenAIError(
      `The Bedrock ${canonicalEndpoint.endpoint} hostname does not match the selected \`${endpoint}\` endpoint. Set \`endpoint: '${canonicalEndpoint.endpoint}'\` to use this hostname.`,
    );
  }
  if (canonicalEndpoint && region && canonicalEndpoint.region !== region) {
    throw new Errors.OpenAIError(
      `The Bedrock endpoint region \`${canonicalEndpoint.region}\` does not match the configured AWS region \`${region}\`.`,
    );
  }
}

/**
 * Resolves the Bedrock endpoint family, region, and API root from configuration.
 *
 * Region precedence is `region`, `AWS_REGION`, then `AWS_DEFAULT_REGION`.
 * Endpoint precedence is `baseURL`, `AWS_BEDROCK_BASE_URL`, then the regional
 * selected endpoint; an explicit `null` base URL skips the environment override.
 * Existing `/responses` suffixes and trailing slashes are removed. Canonical
 * AWS hostnames must match the selected endpoint family.
 *
 * @throws {Errors.OpenAIError} If an option is invalid, a canonical hostname
 * conflicts with the endpoint family, or the default endpoint needs a region.
 */
export function resolveBedrockEndpoint(options: BedrockEndpointOptions): {
  /** Resolved endpoint family, defaulting to Mantle for backwards compatibility. */
  endpoint: BedrockEndpoint;

  /** Resolved AWS region, when explicitly configured or available in the environment. */
  region: string | undefined;

  /** Canonical Bedrock API root with no trailing slash or `/responses` suffix. */
  baseURL: string;
} {
  const endpoint = options.endpoint === undefined ? 'mantle' : options.endpoint;
  if (endpoint !== 'mantle' && endpoint !== 'runtime') {
    throw new Errors.OpenAIError('The Bedrock `endpoint` must be either `mantle` or `runtime`.');
  }
  if (options.region !== undefined && !normalizeOptionalString(options.region)) {
    throw new Errors.OpenAIError('The Bedrock AWS `region` must not be empty.');
  }
  if (
    options.baseURL !== undefined &&
    options.baseURL !== null &&
    !normalizeOptionalString(options.baseURL)
  ) {
    throw new Errors.OpenAIError('The Bedrock `baseURL` must not be empty.');
  }

  const region =
    normalizeOptionalString(options.region) ??
    normalizeOptionalString(readEnv('AWS_REGION')) ??
    normalizeOptionalString(readEnv('AWS_DEFAULT_REGION'));
  if (region && !/^[a-z]{2,8}(?:-[a-z0-9]+)+-\d+$/.test(region)) {
    throw new Errors.OpenAIError(
      'The Bedrock AWS `region` is invalid. Use a standard AWS region such as `us-east-1`.',
    );
  }
  const configuredBaseURL =
    options.baseURL === undefined
      ? normalizeOptionalString(readEnv('AWS_BEDROCK_BASE_URL'))
      : normalizeOptionalString(options.baseURL);

  if (configuredBaseURL) {
    const baseURL = normalizeBaseURL(configuredBaseURL);
    validateCanonicalBedrockEndpoint(baseURL, endpoint, region);
    return { endpoint, region, baseURL };
  }
  if (!region) {
    throw new Errors.OpenAIError(
      'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
    );
  }

  const hostname =
    endpoint === 'runtime'
      ? `bedrock-runtime.${region}.${resolveRuntimeDnsSuffix(region)}`
      : `bedrock-mantle.${region}.api.aws`;
  return { endpoint, region, baseURL: `https://${hostname}/openai/v1` };
}

/**
 * Rejects caller-provided authorization headers that conflict with provider authentication.
 *
 * @throws {Errors.OpenAIError} If an `Authorization` header is already present.
 */
export function assertProviderOwnsAuthorization(headers: Headers): void {
  if (headers.has('authorization')) {
    throw new Errors.OpenAIError(
      'Bedrock provider authentication cannot be combined with a custom `Authorization` header.',
    );
  }
}

/**
 * Prevents Bedrock credentials from being attached to an unexpected origin.
 *
 * @throws {Errors.OpenAIError} If the request origin differs from the configured
 * Bedrock API root, including when an absolute SDK request path is supplied.
 */
export function assertBedrockRequestOrigin(baseURL: string, requestURL: string): void {
  const expectedOrigin = new URL(baseURL).origin;
  const requestOrigin = new URL(requestURL).origin;
  if (requestOrigin !== expectedOrigin) {
    throw new Errors.OpenAIError(
      `The Bedrock request origin \`${requestOrigin}\` does not match the configured endpoint origin \`${expectedOrigin}\`.`,
    );
  }
}

class BedrockBearerAuth implements BedrockRequestAuth {
  private readonly tokenProvider: ApiKeySetter;

  constructor(tokenProvider: ApiKeySetter) {
    this.tokenProvider = tokenProvider;
  }

  async prepareRequest(request: FinalizedRequestInit, _context: ProviderRequestContext): Promise<void> {
    const headers = new Headers(request.headers);
    assertProviderOwnsAuthorization(headers);

    let token: unknown;
    try {
      token = await this.tokenProvider();
    } catch (cause) {
      throw errorWithCause('Failed to resolve a bearer credential for Bedrock.', cause);
    }
    if (typeof token !== 'string' || !token.trim()) {
      throw new Errors.OpenAIError('The Bedrock bearer credential provider must return a non-empty string.');
    }
    headers.set('authorization', `Bearer ${token}`);
    request.headers = headers;
  }
}

/**
 * Resolves a bearer-authentication factory without calling token providers eagerly.
 *
 * Explicit `tokenProvider` and `apiKey` options are mutually exclusive. When
 * neither is set, `AWS_BEARER_TOKEN_BEDROCK` is used unless environment
 * credentials are disabled or `apiKey` is explicitly `null`.
 *
 * @throws {Errors.OpenAIError} If an explicit key is empty or multiple bearer
 * credential sources are configured.
 */
export function resolveBedrockBearerAuth(
  options: BedrockBearerOptions,
  {
    allowEnvironment = true,
  }: {
    /** Whether `AWS_BEARER_TOKEN_BEDROCK` may provide a fallback credential. */
    allowEnvironment?: boolean;
  } = {},
): {
  /** Creates a request authenticator, or is absent when no bearer source is configured. */
  factory: BedrockAuthFactory | undefined;

  /** Whether authentication came from an explicit option rather than the environment. */
  explicit: boolean;
} {
  if (
    options.apiKey !== undefined &&
    options.apiKey !== null &&
    (typeof options.apiKey !== 'string' || !options.apiKey.trim())
  ) {
    throw new Errors.OpenAIError('The Bedrock bearer credential must not be empty.');
  }
  if (options.apiKey != null && options.tokenProvider) {
    throw new Errors.OpenAIError(
      'The `apiKey` and `tokenProvider` options are mutually exclusive. Configure only one.',
    );
  }

  if (options.tokenProvider) {
    const tokenProvider = options.tokenProvider;
    return { factory: () => new BedrockBearerAuth(tokenProvider), explicit: true };
  }
  if (options.apiKey != null) {
    const apiKey = options.apiKey;
    return { factory: () => new BedrockBearerAuth(async () => apiKey), explicit: true };
  }
  if (allowEnvironment && options.apiKey !== null && readEnv('AWS_BEARER_TOKEN_BEDROCK')) {
    return {
      explicit: false,
      factory: () =>
        new BedrockBearerAuth(async () => {
          const token = readEnv('AWS_BEARER_TOKEN_BEDROCK');
          if (!token) {
            throw new Errors.OpenAIError(
              'Could not find credentials for Bedrock. Set `AWS_BEARER_TOKEN_BEDROCK` or configure AWS credential authentication.',
            );
          }
          return token;
        }),
    };
  }

  return { factory: undefined, explicit: false };
}
