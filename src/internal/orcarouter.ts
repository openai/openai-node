import * as Errors from '../error';
import type { ApiKeySetter } from '../client';
import type { FinalizedRequestInit } from './types';
import type { ProviderRequestContext } from './provider';
import { readEnv } from './utils';

/** The default OrcaRouter API root used when no base URL is configured. */
export const ORCAROUTER_DEFAULT_BASE_URL = 'https://api.orcarouter.ai/v1';

/** The OrcaRouter environment variable that supplies the gateway credential. */
export const ORCAROUTER_API_KEY_ENV = 'ORCAROUTER_API_KEY';

/** Creates an authentication handler with independent per-client state. */
export type OrcaRouterAuthFactory = () => OrcaRouterRequestAuth;

/** Per-client authentication handler invoked before each OrcaRouter request. */
export interface OrcaRouterRequestAuth {
  /** Adds the gateway credential or rejects invalid credentials. */
  prepareRequest: (request: FinalizedRequestInit, context: ProviderRequestContext) => void | Promise<void>;
}

/** Settings for the OrcaRouter provider. */
export interface OrcaRouterOptions {
  /**
   * Explicit OrcaRouter gateway credential. Set to `null` to disable the
   * `ORCAROUTER_API_KEY` fallback.
   */
  apiKey?: string | null | undefined;

  /**
   * Resolves a fresh gateway credential before every request attempt and retry.
   * Mutually exclusive with `apiKey`.
   */
  tokenProvider?: ApiKeySetter | undefined;

  /**
   * OrcaRouter API root. Defaults to `https://api.orcarouter.ai/v1`, then the
   * `ORCAROUTER_BASE_URL` environment variable.
   */
  baseURL?: string | null | undefined;
}

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

/** Normalizes an OrcaRouter API root, removing `/responses` suffixes and trailing slashes. */
function normalizeBaseURL(baseURL: string): string {
  const url = new URL(baseURL);
  const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/u);
  if (responsesMatch?.index !== undefined) {
    url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
  }
  return url.toString().replace(/\/$/u, '');
}

/**
 * Resolves the OrcaRouter API root from configuration.
 *
 * Precedence is `baseURL`, `ORCAROUTER_BASE_URL`, then the default
 * `https://api.orcarouter.ai/v1` endpoint. An explicit `null` base URL skips
 * the environment override. Existing `/responses` suffixes and trailing
 * slashes are removed.
 *
 * @throws {Errors.OpenAIError} If an explicitly configured base URL is empty.
 */
export function resolveOrcaRouterBaseURL(options: OrcaRouterOptions): string {
  if (
    options.baseURL !== undefined &&
    options.baseURL !== null &&
    !normalizeOptionalString(options.baseURL)
  ) {
    throw new Errors.OpenAIError('The OrcaRouter `baseURL` must not be empty.');
  }
  const configuredBaseURL =
    options.baseURL === undefined ? normalizeOptionalString(readEnv('ORCAROUTER_BASE_URL')) : options.baseURL;
  return normalizeBaseURL(configuredBaseURL ?? ORCAROUTER_DEFAULT_BASE_URL);
}

/**
 * Ensures OrcaRouter credentials are only attached to the configured endpoint origin.
 *
 * @throws {Errors.OpenAIError} If either URL is not HTTP(S) or the request targets a different origin.
 */
export function assertOrcaRouterRequestOrigin(baseURL: string, requestURL: string): void {
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
      `OrcaRouter request origin \`${requestOrigin}\` does not match the configured base URL origin \`${expectedOrigin}\`.`,
    );
  }
}

/** Rejects non-HTTP field bytes without retaining or exposing a gateway credential. */
export function assertValidOrcaRouterApiKey(credential: string): void {
  if (/^[\t ]|[\t ]$/u.test(credential)) {
    throw new TypeError('OrcaRouter API key contains an invalid HTTP header value.');
  }

  for (const character of credential) {
    const value = character.codePointAt(0) ?? 0;
    if ((value < 0x20 && value !== 0x09) || value === 0x7f || value > 0xff) {
      throw new TypeError('OrcaRouter API key contains an invalid HTTP header value.');
    }
  }
}

class OrcaRouterAuth implements OrcaRouterRequestAuth {
  private readonly tokenProvider: ApiKeySetter;

  constructor(tokenProvider: ApiKeySetter) {
    this.tokenProvider = tokenProvider;
  }

  async prepareRequest(request: FinalizedRequestInit): Promise<void> {
    const headers = new Headers(request.headers);
    if (headers.has('authorization')) {
      throw new Errors.OpenAIError(
        'OrcaRouter provider authentication cannot be combined with a custom `Authorization` header.',
      );
    }

    let token: unknown;
    try {
      token = await this.tokenProvider();
    } catch (error) {
      throw errorWithCause('Failed to resolve an OrcaRouter API key.', error);
    }
    if (typeof token !== 'string' || !token.trim()) {
      throw new Errors.OpenAIError('The OrcaRouter API key provider must return a non-empty string.');
    }
    assertValidOrcaRouterApiKey(token);
    try {
      headers.set('authorization', `Bearer ${token}`);
    } catch (error) {
      if (error instanceof TypeError) {
        // oxlint-disable-next-line eslint/preserve-caught-error -- The original error contains the gateway credential.
        throw new TypeError('OrcaRouter API key contains an invalid HTTP header value.');
      }
      throw error;
    }
    request.redirect = 'manual';
    request.headers = headers;
  }
}

/**
 * Resolves an OrcaRouter authentication factory without calling token providers eagerly.
 *
 * Explicit `tokenProvider` and `apiKey` options are mutually exclusive. When
 * neither is set, `ORCAROUTER_API_KEY` is used unless `apiKey` is explicitly
 * `null`.
 *
 * @throws {Errors.OpenAIError} If an explicit key is empty or multiple credential
 * sources are configured.
 */
export function resolveOrcaRouterAuth(
  options: OrcaRouterOptions,
  {
    allowEnvironment = true,
  }: {
    /** Whether `ORCAROUTER_API_KEY` may provide a fallback credential. */
    allowEnvironment?: boolean;
  } = {},
): {
  /** Creates a request authenticator, or is absent when no credential source is configured. */
  factory: OrcaRouterAuthFactory | undefined;

  /** Whether authentication came from an explicit option rather than the environment. */
  explicit: boolean;
} {
  if (
    options.apiKey !== undefined &&
    options.apiKey !== null &&
    (typeof options.apiKey !== 'string' || !options.apiKey.trim())
  ) {
    throw new Errors.OpenAIError('The OrcaRouter API key must not be empty.');
  }
  if (options.apiKey !== null && options.apiKey !== undefined && options.tokenProvider) {
    throw new Errors.OpenAIError(
      'The `apiKey` and `tokenProvider` options are mutually exclusive. Configure only one.',
    );
  }

  if (options.tokenProvider) {
    const { tokenProvider } = options;
    return { factory: () => new OrcaRouterAuth(tokenProvider), explicit: true };
  }
  if (options.apiKey !== null && options.apiKey !== undefined) {
    const { apiKey } = options;
    return { factory: () => new OrcaRouterAuth(() => Promise.resolve(apiKey)), explicit: true };
  }
  if (allowEnvironment && options.apiKey !== null && readEnv(ORCAROUTER_API_KEY_ENV)) {
    return {
      explicit: false,
      factory: () =>
        new OrcaRouterAuth(() => {
          const apiKey = readEnv(ORCAROUTER_API_KEY_ENV);
          if (!apiKey) {
            throw new Errors.OpenAIError(
              'Could not find credentials for OrcaRouter. Set `ORCAROUTER_API_KEY` or pass `apiKey` to `orcarouter(...)`.',
            );
          }
          return Promise.resolve(apiKey);
        }),
    };
  }

  return { factory: undefined, explicit: false };
}
