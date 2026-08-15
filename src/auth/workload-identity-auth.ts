import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  OAuthError,
  OpenAIError,
} from '../core/error';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import type { MergedRequestInit } from '../internal/types';
import { sleep } from '../internal/utils/sleep';
import { hasOwn } from '../internal/utils/values';
import type { SubjectTokenWorkloadIdentity, WorkloadIdentity, X509WorkloadIdentity } from './types';
import { exchangeX509Token, X509TokenExchangeRetryableError } from './x509-token-exchange';

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshAt: number;
}

interface WorkloadIdentityAuthOptions {
  fetchOptions?: MergedRequestInit | undefined;
  maxRetries?: number | undefined;
}

interface RefreshContext {
  generation: number;
  options: WorkloadIdentityAuthOptions;
}

interface CredentialSource {
  exchange: (options: WorkloadIdentityAuthOptions, retryCount: number) => Promise<unknown>;
  isExpirationSafe: (expiresAt: number) => boolean;
  maxRetries?: (options: WorkloadIdentityAuthOptions) => number;
  now: () => number;
  refreshBufferMs: (durationMs: number) => number;
  resolveFetchOptions?: (options: WorkloadIdentityAuthOptions) => MergedRequestInit | undefined;
  resolveExpiration: (configured: unknown) => unknown;
  waiterTimeoutMs?: (timeoutMs: number | undefined) => number | undefined;
}

const SUBJECT_TOKEN_TYPES: Record<SubjectTokenWorkloadIdentity['provider']['tokenType'], string> = {
  jwt: 'urn:ietf:params:oauth:token-type:jwt',
  id: 'urn:ietf:params:oauth:token-type:id_token',
};

const SUBJECT_TOKEN_EXCHANGE_URL = 'https://auth.openai.com/oauth/token';
const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const DEFAULT_REFRESH_BUFFER_MS = 1_200_000;

function isX509WorkloadIdentity(config: WorkloadIdentity): config is X509WorkloadIdentity {
  return config.type === 'x509';
}

function validateX509Config(config: X509WorkloadIdentity): void {
  if (hasOwn(config, 'provider') || hasOwn(config, 'clientId') || hasOwn(config, 'refreshBufferSeconds')) {
    throw new OpenAIError(
      'X.509 workload identity does not accept `provider`, `clientId`, or `refreshBufferSeconds`.',
    );
  }
  if (
    config.refreshBufferMs !== undefined &&
    (!Number.isFinite(config.refreshBufferMs) || config.refreshBufferMs < 0)
  ) {
    throw new OpenAIError('X.509 workload identity `refreshBufferMs` must be a non-negative number.');
  }
}

function validateMaxRetries(maxRetries: number): number {
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new OpenAIError('X.509 workload identity requires `maxRetries` to be a non-negative integer.');
  }
  return maxRetries;
}

function monotonicNow(): number {
  const now = globalThis.performance?.now();
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new OpenAIError('X.509 workload identity requires a runtime with a monotonic clock.');
  }
  return now;
}

function abortError(signal: AbortSignal): APIUserAbortError {
  const error = new APIUserAbortError();
  Object.defineProperty(error, 'cause', { value: signal.reason, writable: true, configurable: true });
  return error;
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

async function waitForPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): Promise<T> {
  if (!signal && timeoutMs === undefined) {
    return await promise;
  }
  throwIfAborted(signal);

  // oxlint-disable-next-line promise/avoid-new -- AbortSignal only exposes callback-based cancellation.
  return await new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (abortListener: () => void) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', abortListener);
    };
    const onAbort = () => {
      if (!signal) {
        return;
      }
      cleanup(onAbort);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup(onAbort);
        reject(new APIConnectionTimeoutError());
      }, timeoutMs);
    }
    void promise.then(
      (value) => {
        cleanup(onAbort);
        resolve(value);
      },
      (error: unknown) => {
        cleanup(onAbort);
        reject(error);
      },
    );
  });
}

async function exchangeSubjectToken(config: SubjectTokenWorkloadIdentity, fetch: Fetch): Promise<unknown> {
  const subjectToken = await config.provider.getToken();
  const body: Record<string, string> = {
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: SUBJECT_TOKEN_TYPES[config.provider.tokenType],
    identity_provider_id: config.identityProviderId,
    service_account_id: config.serviceAccountId,
  };

  if (config.clientId) {
    body['client_id'] = config.clientId;
  }

  const response = await fetch(SUBJECT_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });

  if (!response.ok) {
    const errorText = await response.text();
    let body: any = undefined;

    try {
      body = JSON.parse(errorText);
    } catch {
      // Ignore non-JSON error bodies.
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new OAuthError(response.status, body, response.headers);
    }
    throw APIError.generate(
      response.status,
      body,
      `Token exchange failed with status ${response.status}`,
      response.headers,
    );
  }

  return await response.json();
}

function createCredentialSource(
  config: WorkloadIdentity,
  fetch: Fetch,
  options: WorkloadIdentityAuthOptions,
): CredentialSource {
  if (isX509WorkloadIdentity(config)) {
    validateX509Config(config);
    const defaultMaxRetries = validateMaxRetries(options.maxRetries ?? 2);
    const fetchOptions = (requestOptions: WorkloadIdentityAuthOptions) =>
      hasOwn(requestOptions, 'fetchOptions') ? requestOptions.fetchOptions : options.fetchOptions;
    return {
      exchange: async (requestOptions, retryCount) =>
        await exchangeX509Token({
          config,
          fetch,
          fetchOptions: fetchOptions(requestOptions),
          retryCount,
        }),
      isExpirationSafe: (expiresAt) => Number.isFinite(expiresAt) && expiresAt <= Number.MAX_SAFE_INTEGER,
      maxRetries: (requestOptions) => validateMaxRetries(requestOptions.maxRetries ?? defaultMaxRetries),
      now: monotonicNow,
      refreshBufferMs: (durationMs) =>
        Math.min(config.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS, durationMs / 2),
      resolveFetchOptions: fetchOptions,
      resolveExpiration: (configured) => configured,
      waiterTimeoutMs: (timeoutMs) => timeoutMs,
    };
  }

  return {
    exchange: async () => await exchangeSubjectToken(config, fetch),
    isExpirationSafe: Number.isSafeInteger,
    now: () => Date.now(),
    refreshBufferMs: () => (config.refreshBufferSeconds ?? 1200) * 1000,
    resolveExpiration: (configured) => configured ?? 3600,
  };
}

/**
 * Exchanges external workload identities for cached OpenAI access tokens.
 *
 * Concurrent token exchanges are shared. Valid cached tokens are returned while
 * a proactive refresh runs in the background; expired or missing tokens wait
 * for a successful exchange before they are returned.
 */
export class WorkloadIdentityAuth {
  private cachedToken: CachedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private currentFetchOptions: MergedRequestInit | undefined;
  private hasCurrentFetchOptions = false;
  private tokenGeneration = 0;
  private readonly source: CredentialSource;

  /**
   * Creates a workload-identity token cache and OAuth token-exchange client.
   *
   * @param config External identity provider, OpenAI service account, and refresh settings.
   * @param fetch Optional fetch implementation for calls to the OpenAI token endpoint.
   * @param options Internal effective transport and retry settings for X.509 exchanges.
   */
  constructor(config: WorkloadIdentity, fetch?: Fetch, options: WorkloadIdentityAuthOptions = {}) {
    this.source = createCredentialSource(config, fetch ?? Shims.getDefaultFetch(), options);
  }

  /**
   * Returns a valid OpenAI access token, exchanging or refreshing credentials as needed.
   *
   * Cached tokens nearing expiration are returned immediately while a background
   * refresh runs. Concurrent callers share the same in-flight token exchange.
   * Canceling one waiter does not cancel or invalidate that shared exchange.
   *
   * @param signal Optional caller cancellation signal for this waiter.
   * @param timeoutMs Optional X.509 waiter timeout; it does not abort a shared exchange.
   * @param options Optional effective transport and retry settings for an X.509 exchange.
   * @throws {OAuthError} When the token endpoint rejects the workload identity.
   * @throws {APIError} When another unsuccessful HTTP response prevents token exchange.
   * @throws {OpenAIError} When a successful exchange has an invalid access token or expiration.
   */
  async getToken(
    signal?: AbortSignal | null,
    timeoutMs?: number,
    options: WorkloadIdentityAuthOptions = {},
  ): Promise<string> {
    throwIfAborted(signal);
    if (this.source.resolveFetchOptions) {
      const fetchOptions = this.source.resolveFetchOptions(options);
      if (this.hasCurrentFetchOptions && this.currentFetchOptions !== fetchOptions) {
        this.invalidateToken();
      }
      this.currentFetchOptions = fetchOptions;
      this.hasCurrentFetchOptions = true;
    }
    const context: RefreshContext = { generation: this.tokenGeneration, options };
    const maxRetries = this.source.maxRetries?.(options) ?? 0;
    const waiterTimeoutMs = this.source.waiterTimeoutMs?.(timeoutMs);
    const deadline = waiterTimeoutMs === undefined ? undefined : this.source.now() + waiterTimeoutMs;

    if (!this.cachedToken || this.isTokenExpired(this.cachedToken)) {
      return await this.refreshWithRetries(context, maxRetries, signal, deadline);
    }

    if (this.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      void this.refreshWithRetries(context, maxRetries).catch(() => null);
    }

    return this.cachedToken.token;
  }

  private async refreshWithRetries(
    context: RefreshContext,
    maxRetries: number,
    signal?: AbortSignal | null,
    deadline?: number,
  ): Promise<string> {
    const cachedAtStart = this.cachedToken;

    for (let retryCount = 0; ; retryCount += 1) {
      throwIfAborted(signal);
      if (this.cachedToken && this.cachedToken !== cachedAtStart && !this.isTokenExpired(this.cachedToken)) {
        return this.cachedToken.token;
      }

      try {
        // oxlint-disable-next-line no-await-in-loop -- Token refresh attempts are intentionally sequential.
        return await waitForPromise(
          this.refreshPromise ?? this.startRefresh(context, retryCount),
          signal,
          this.remainingTimeout(deadline),
        );
      } catch (error) {
        if (!(error instanceof X509TokenExchangeRetryableError)) {
          throw error;
        }
        if (retryCount >= maxRetries || this.tokenGeneration !== context.generation) {
          throw error.error;
        }
        // oxlint-disable-next-line no-await-in-loop -- Retry-After must elapse before the next attempt.
        await waitForPromise(sleep(error.retryDelayMs), signal, this.remainingTimeout(deadline));
        if (this.tokenGeneration !== context.generation) {
          throw error.error;
        }
      }
    }
  }

  private remainingTimeout(deadline: number | undefined): number | undefined {
    return deadline === undefined ? undefined : Math.max(0, deadline - this.source.now());
  }

  private startRefresh(context: RefreshContext, retryCount: number): Promise<string> {
    const refreshPromise = this.refreshToken(context, retryCount);
    this.refreshPromise = refreshPromise;
    void refreshPromise.then(
      () => this.clearRefresh(refreshPromise),
      () => this.clearRefresh(refreshPromise),
    );
    return refreshPromise;
  }

  private clearRefresh(refreshPromise: Promise<string>): void {
    if (this.refreshPromise === refreshPromise) {
      this.refreshPromise = null;
    }
  }

  private async refreshToken(context: RefreshContext, retryCount: number): Promise<string> {
    const tokenResponse = await this.source.exchange(context.options, retryCount);
    if (
      typeof tokenResponse !== 'object' ||
      tokenResponse === null ||
      !('access_token' in tokenResponse) ||
      typeof tokenResponse.access_token !== 'string' ||
      tokenResponse.access_token.trim().length === 0
    ) {
      throw new OpenAIError("Token exchange response missing 'access_token' field");
    }

    const accessToken = tokenResponse.access_token;
    const configuredExpiration = 'expires_in' in tokenResponse ? tokenResponse.expires_in : undefined;
    const expiresIn = this.source.resolveExpiration(configuredExpiration);
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    const now = this.source.now();
    const durationMs = expiresIn * 1000;
    const expiresAt = now + durationMs;
    if (!this.source.isExpirationSafe(expiresAt) || expiresAt <= now) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    if (this.tokenGeneration === context.generation) {
      this.cachedToken = {
        token: accessToken,
        expiresAt,
        refreshAt: expiresAt - this.source.refreshBufferMs(durationMs),
      };
    }

    return accessToken;
  }

  private isTokenExpired(cachedToken: CachedToken): boolean {
    return this.source.now() >= cachedToken.expiresAt;
  }

  private needsRefresh(cachedToken: CachedToken): boolean {
    return this.source.now() >= cachedToken.refreshAt;
  }

  /** Discards a rejected cached access token so the next request performs a fresh exchange. */
  invalidateToken(rejectedToken?: string): void {
    if (rejectedToken !== undefined && this.cachedToken?.token !== rejectedToken) {
      return;
    }
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.refreshPromise = null;
  }
}
