import * as Errors from '../error';
import type { ApiKeySetter } from '../client';
import type { FinalizedRequestInit } from './types';
import type { ProviderRequestContext } from './provider';
import { readEnv } from './utils';

export interface BedrockEndpointOptions {
  /** AWS region used to derive the default Mantle endpoint. */
  region?: string | undefined;

  /** Bedrock API root. Defaults to AWS_BEDROCK_BASE_URL or the regional Mantle endpoint. */
  baseURL?: string | null | undefined;
}

export interface BedrockBearerOptions {
  /** Explicit Bedrock bearer credential. Set to null to skip the environment bearer fallback. */
  apiKey?: string | null | undefined;

  /** A function that resolves a Bedrock bearer credential before every request attempt. */
  tokenProvider?: ApiKeySetter | undefined;
}

export interface BedrockRequestAuth {
  prepareRequest(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}

export type BedrockAuthFactory = () => BedrockRequestAuth;

export function errorWithCause(message: string, cause: unknown): Errors.OpenAIError {
  const error = new Errors.OpenAIError(message) as Errors.OpenAIError & { cause?: unknown };
  error.cause = cause;
  return error;
}

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : undefined;
  return normalized ? normalized : undefined;
}

function normalizeBaseURL(baseURL: string): string {
  const url = new URL(baseURL);
  const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
  if (responsesMatch?.index !== undefined) {
    url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
  }
  return url.toString().replace(/\/$/, '');
}

export function resolveBedrockEndpoint(options: BedrockEndpointOptions): {
  region: string | undefined;
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
    options.baseURL === undefined ? normalizeOptionalString(readEnv('AWS_BEDROCK_BASE_URL'))
    : options.baseURL === null ? undefined
    : normalizeOptionalString(options.baseURL);

  if (configuredBaseURL) return { region, baseURL: normalizeBaseURL(configuredBaseURL) };
  if (!region) {
    throw new Errors.OpenAIError(
      'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
    );
  }
  return { region, baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1` };
}

export function assertProviderOwnsAuthorization(headers: Headers): void {
  if (headers.has('authorization')) {
    throw new Errors.OpenAIError(
      'Bedrock provider authentication cannot be combined with a custom `Authorization` header.',
    );
  }
}

class BedrockBearerAuth implements BedrockRequestAuth {
  constructor(private readonly tokenProvider: ApiKeySetter) {}

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

export function resolveBedrockBearerAuth(
  options: BedrockBearerOptions,
  { allowEnvironment = true }: { allowEnvironment?: boolean } = {},
): { factory: BedrockAuthFactory | undefined; explicit: boolean } {
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
