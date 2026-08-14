import * as Errors from '../error';
import type { ApiKeySetter } from '../client';
import type { FinalizedRequestInit } from './types';
import type { ProviderRequestContext } from './provider';
import { readEnv } from './utils';

/** Identifies legacy Bedrock clients without importing the client class into WebSocket modules. */
export const brand_privateBedrockClient = Symbol.for('openai.privateBedrockClient');

/** Endpoint and region settings shared by the Bedrock provider variants. */
export interface BedrockEndpointOptions {
  /**
   * AWS region used to derive the default Mantle endpoint and sign AWS requests.
   * Defaults to `AWS_REGION`, then `AWS_DEFAULT_REGION`.
   */
  region?: string | undefined;

  /**
   * Bedrock API root. Defaults to `AWS_BEDROCK_BASE_URL`, then the regional
   * Mantle endpoint. Set to `null` to bypass the environment override.
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

/**
 * Resolves the Bedrock region and canonical API root from options and environment.
 *
 * Region precedence is `region`, `AWS_REGION`, then `AWS_DEFAULT_REGION`.
 * Endpoint precedence is `baseURL`, `AWS_BEDROCK_BASE_URL`, then the regional
 * Mantle endpoint; an explicit `null` base URL skips the environment override.
 * Existing `/responses` suffixes and trailing slashes are removed.
 *
 * @throws {Errors.OpenAIError} If an explicit option is empty or no endpoint can
 * be derived because the AWS region is missing.
 */
export function resolveBedrockEndpoint(options: BedrockEndpointOptions): {
  /** Resolved AWS region, when explicitly configured or available in the environment. */
  region: string | undefined;

  /** Canonical Bedrock API root with no trailing slash or `/responses` suffix. */
  baseURL: string;
} {
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
  const configuredBaseURL =
    options.baseURL === undefined
      ? normalizeOptionalString(readEnv('AWS_BEDROCK_BASE_URL'))
      : normalizeOptionalString(options.baseURL);

  if (configuredBaseURL) {
    return { region, baseURL: normalizeBaseURL(configuredBaseURL) };
  }
  if (!region) {
    throw new Errors.OpenAIError(
      'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
    );
  }
  return { region, baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1` };
}

/**
 * Ensures Bedrock credentials are only attached to the configured endpoint origin.
 *
 * @throws {Errors.OpenAIError} If either URL is not HTTP(S) or the request targets a different origin.
 */
export function assertBedrockRequestOrigin(baseURL: string, requestURL: string): void {
  const expectedURL = new URL(baseURL);
  const request = new URL(requestURL);
  const expectedOrigin = expectedURL.origin;
  const requestOrigin = request.origin;
  if (
    (expectedURL.protocol !== 'http:' && expectedURL.protocol !== 'https:') ||
    (request.protocol !== 'http:' && request.protocol !== 'https:') ||
    requestOrigin !== expectedOrigin
  ) {
    throw new Errors.OpenAIError(
      `Bedrock request origin \`${requestOrigin}\` does not match the configured base URL origin \`${expectedOrigin}\`.`,
    );
  }
}

/** Validates a final WebSocket URL before a legacy Bedrock client resolves or attaches credentials. */
export function assertBedrockWebSocketOrigin(client: unknown, requestURL: URL): void {
  if (typeof client !== 'object' || client === null || !(brand_privateBedrockClient in client)) {
    return;
  }

  const normalizedRequestURL = new URL(requestURL);
  if (normalizedRequestURL.protocol === 'wss:') {
    normalizedRequestURL.protocol = 'https:';
  } else if (normalizedRequestURL.protocol === 'ws:') {
    normalizedRequestURL.protocol = 'http:';
  }

  assertBedrockRequestOrigin(
    (client as unknown as { baseURL: string }).baseURL,
    normalizedRequestURL.toString(),
  );
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
