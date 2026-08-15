import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  OAuthError,
  OpenAIError,
} from '../core/error';
import type { Fetch, RequestInit } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import type { MergedRequestInit } from '../internal/types';
import { hasOwn } from '../internal/utils/values';
import type { SubjectTokenWorkloadIdentity, WorkloadIdentity, X509WorkloadIdentity } from './types';
import { exchangeX509Token, X509TokenExchangeRetryableError } from './x509-token-exchange';

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshAt: number;
}

interface RefreshState {
  cachedToken: CachedToken | null;
  refreshPromise: Promise<string> | null;
  retryNotBefore: number;
  tokenGeneration: number;
}

interface WorkloadIdentityAuthOptions {
  fetchOptions?: MergedRequestInit | undefined;
  maxRetries?: number | undefined;
  transportKey?: object | undefined;
}

interface RefreshContext {
  fetchOptions: MergedRequestInit | undefined;
  generation: number;
  state: RefreshState;
}

interface CredentialSource {
  exchange: (retryCount: number, fetchOptions: MergedRequestInit | undefined) => Promise<unknown>;
  /** Includes host suspension so token TTLs cannot outlive real elapsed time. */
  expirationNow: () => number;
  isExpirationSafe: (expiresAt: number) => boolean;
  maxRetries?: (options: WorkloadIdentityAuthOptions) => number;
  /** Clock for waiter deadlines and retry windows; monotonic for X.509 exchanges. */
  monotonicNow: () => number;
  refreshBufferMs: (durationMs: number) => number;
  resolveFetchOptions?: (options: WorkloadIdentityAuthOptions) => MergedRequestInit | undefined;
  resolveTransportKey?: (options: WorkloadIdentityAuthOptions) => object | undefined;
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
const TRANSPORT_OPTION_KEYS = ['dispatcher', 'agent', 'client', 'tls', 'proxy'] as const;
const X509_HOOK_PROTECTED_OPTION_KEYS = [...TRANSPORT_OPTION_KEYS, 'redirect'] as const;

function createRefreshState(): RefreshState {
  return {
    cachedToken: null,
    refreshPromise: null,
    retryNotBefore: 0,
    tokenGeneration: 0,
  };
}

function isX509WorkloadIdentity(config: WorkloadIdentity): config is X509WorkloadIdentity {
  return config.type === 'x509';
}

/** Returns the opaque runtime transport identity used to scope X.509 refresh state. */
export function x509TransportKey(fetchOptions: MergedRequestInit | undefined): object | undefined {
  if (!fetchOptions) {
    return undefined;
  }
  for (const key of TRANSPORT_OPTION_KEYS) {
    const value = (fetchOptions as Record<string, unknown>)[key];
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      return value as object;
    }
  }
  return fetchOptions;
}

/** Checks that request hooks preserved every runtime transport option used by X.509 mode. */
export function hasSameX509Transport(expected: MergedRequestInit | undefined, actual: RequestInit): boolean {
  return TRANSPORT_OPTION_KEYS.every(
    (key) =>
      (expected as Record<string, unknown> | undefined)?.[key] === (actual as Record<string, unknown>)[key],
  );
}

/** Hides X.509 transport and redirect policy from request hooks, then restores them unchanged. */
export function protectX509RequestOptions(request: RequestInit): () => boolean {
  const requestOptions = request as Record<string, unknown>;
  const protectedOptions: { key: (typeof X509_HOOK_PROTECTED_OPTION_KEYS)[number]; value: unknown }[] = [];

  for (const key of X509_HOOK_PROTECTED_OPTION_KEYS) {
    if (hasOwn(requestOptions, key)) {
      protectedOptions.push({ key, value: requestOptions[key] });
      Reflect.deleteProperty(requestOptions, key);
    }
  }

  return () => {
    const changed = X509_HOOK_PROTECTED_OPTION_KEYS.some((key) => hasOwn(requestOptions, key));
    for (const key of X509_HOOK_PROTECTED_OPTION_KEYS) {
      Reflect.deleteProperty(requestOptions, key);
    }
    for (const option of protectedOptions) {
      requestOptions[option.key] = option.value;
    }
    return changed;
  };
}

function validateX509Config(config: X509WorkloadIdentity): void {
  if (
    config.provider !== undefined ||
    config.clientId !== undefined ||
    config.refreshBufferSeconds !== undefined
  ) {
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

const REFRESH_INVALIDATED = Symbol('workload identity refresh invalidated');

function clearRefresh(state: RefreshState, refreshPromise: Promise<string>): void {
  if (state.refreshPromise === refreshPromise) {
    state.refreshPromise = null;
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

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): Promise<void> {
  throwIfAborted(signal);
  let cancel: (() => void) | undefined;
  // oxlint-disable-next-line promise/avoid-new -- Timers only expose callback-based completion.
  const delay = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    cancel = () => clearTimeout(timer);
  });
  try {
    await waitForPromise(delay, signal, timeoutMs);
  } finally {
    cancel?.();
  }
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
    const resolveFetchOptions = (requestOptions: WorkloadIdentityAuthOptions) =>
      hasOwn(requestOptions, 'fetchOptions') ? requestOptions.fetchOptions : options.fetchOptions;
    return {
      exchange: (retryCount, effectiveFetchOptions) =>
        exchangeX509Token({
          config,
          fetch,
          fetchOptions: effectiveFetchOptions,
          retryCount,
        }),
      isExpirationSafe: (expiresAt) => Number.isFinite(expiresAt) && expiresAt <= Number.MAX_SAFE_INTEGER,
      maxRetries: (requestOptions) => validateMaxRetries(requestOptions.maxRetries ?? defaultMaxRetries),
      expirationNow: () => Date.now(),
      monotonicNow,
      refreshBufferMs: (durationMs) =>
        Math.min(config.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS, durationMs / 2),
      resolveFetchOptions,
      resolveTransportKey: (requestOptions) =>
        hasOwn(requestOptions, 'transportKey')
          ? requestOptions.transportKey
          : x509TransportKey(resolveFetchOptions(requestOptions)),
      resolveExpiration: (configured) => configured,
      waiterTimeoutMs: (timeoutMs) => timeoutMs,
    };
  }

  return {
    exchange: () => exchangeSubjectToken(config, fetch),
    expirationNow: () => Date.now(),
    isExpirationSafe: Number.isSafeInteger,
    monotonicNow: () => Date.now(),
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
  private readonly defaultState = createRefreshState();
  private readonly source: CredentialSource;
  // Weak keys partition transport-scoped state without extending caller-owned dispatcher lifetimes.
  private readonly transportStates = new WeakMap<object, RefreshState>();

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
    const maxRetries = this.source.maxRetries?.(options) ?? 0;
    const waiterTimeoutMs = this.source.waiterTimeoutMs?.(timeoutMs);
    const deadline = waiterTimeoutMs === undefined ? undefined : this.source.monotonicNow() + waiterTimeoutMs;

    while (true) {
      const fetchOptions = this.source.resolveFetchOptions?.(options);
      const state = this.getRefreshState(this.source.resolveTransportKey?.(options));
      const context: RefreshContext = {
        fetchOptions,
        generation: state.tokenGeneration,
        state,
      };

      try {
        if (!state.cachedToken || this.isTokenExpired(state.cachedToken)) {
          // oxlint-disable-next-line no-await-in-loop -- Invalidation restarts within the original deadline.
          return await this.refreshWithRetries(context, maxRetries, signal, deadline);
        }
        if (this.needsRefresh(state.cachedToken)) {
          this.refreshInBackground(context);
        }
        return state.cachedToken.token;
      } catch (error) {
        if (error === REFRESH_INVALIDATED) {
          continue;
        }
        throw error;
      }
    }
  }

  private getRefreshState(transportKey: object | undefined): RefreshState {
    if (transportKey === undefined) {
      return this.defaultState;
    }
    let state = this.transportStates.get(transportKey);
    if (!state) {
      state = createRefreshState();
      this.transportStates.set(transportKey, state);
    }
    return state;
  }

  private refreshInBackground(context: RefreshContext): void {
    const { state } = context;
    if (state.refreshPromise || state.retryNotBefore > this.source.monotonicNow()) {
      return;
    }
    // A proactive refresh has no waiting caller to own retry delays. Record any
    // server backoff in shared state and let a later request start the next attempt.
    void this.refreshWithRetries(context, 0).catch(() => null);
  }

  private async refreshWithRetries(
    context: RefreshContext,
    maxRetries: number,
    signal?: AbortSignal | null,
    deadline?: number,
  ): Promise<string> {
    const { state } = context;
    const cachedAtStart = state.cachedToken;

    for (let retryCount = 0; ; retryCount += 1) {
      throwIfAborted(signal);
      if (state.tokenGeneration !== context.generation) {
        throw REFRESH_INVALIDATED;
      }
      let retryDelayMs = state.retryNotBefore - this.source.monotonicNow();
      while (retryDelayMs > 0) {
        // oxlint-disable-next-line no-await-in-loop -- Each wake must recheck a shared backoff another attempt may extend.
        await waitForDelay(retryDelayMs, signal, this.remainingTimeout(deadline));
        if (state.tokenGeneration !== context.generation) {
          throw REFRESH_INVALIDATED;
        }
        retryDelayMs = state.retryNotBefore - this.source.monotonicNow();
      }
      if (
        state.cachedToken &&
        state.cachedToken !== cachedAtStart &&
        !this.isTokenExpired(state.cachedToken)
      ) {
        return state.cachedToken.token;
      }

      try {
        // oxlint-disable-next-line no-await-in-loop -- Token refresh attempts are intentionally sequential.
        const token = await waitForPromise(
          state.refreshPromise ?? this.startRefresh(context, retryCount),
          signal,
          this.remainingTimeout(deadline),
        );
        return token;
      } catch (error) {
        if (!(error instanceof X509TokenExchangeRetryableError)) {
          throw error;
        }
        if (state.tokenGeneration !== context.generation) {
          throw REFRESH_INVALIDATED;
        }
        if (retryCount >= maxRetries) {
          throw error.error;
        }
      }
    }
  }

  private remainingTimeout(deadline: number | undefined): number | undefined {
    return deadline === undefined ? undefined : Math.max(0, deadline - this.source.monotonicNow());
  }

  private startRefresh(context: RefreshContext, retryCount: number): Promise<string> {
    const refreshPromise = this.refreshToken(context, retryCount);
    context.state.refreshPromise = refreshPromise;
    void refreshPromise.then(
      () => clearRefresh(context.state, refreshPromise),
      () => clearRefresh(context.state, refreshPromise),
    );
    return refreshPromise;
  }

  private async refreshToken(context: RefreshContext, retryCount: number): Promise<string> {
    let tokenResponse: unknown;
    try {
      tokenResponse = await this.source.exchange(retryCount, context.fetchOptions);
    } catch (error) {
      if (
        error instanceof X509TokenExchangeRetryableError &&
        context.state.tokenGeneration === context.generation
      ) {
        context.state.retryNotBefore = Math.max(
          context.state.retryNotBefore,
          this.source.monotonicNow() + error.retryDelayMs,
        );
      }
      throw error;
    }
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

    const now = this.source.expirationNow();
    const durationMs = expiresIn * 1000;
    const expiresAt = now + durationMs;
    if (!this.source.isExpirationSafe(expiresAt) || expiresAt <= now) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    if (context.state.tokenGeneration === context.generation) {
      context.state.retryNotBefore = 0;
      context.state.cachedToken = {
        token: accessToken,
        expiresAt,
        refreshAt: expiresAt - this.source.refreshBufferMs(durationMs),
      };
    }

    return accessToken;
  }

  private isTokenExpired(cachedToken: CachedToken): boolean {
    return this.source.expirationNow() >= cachedToken.expiresAt;
  }

  private needsRefresh(cachedToken: CachedToken): boolean {
    return this.source.expirationNow() >= cachedToken.refreshAt;
  }

  /** Discards a rejected cached access token so the next request performs a fresh exchange. */
  invalidateToken(rejectedToken?: string, options: WorkloadIdentityAuthOptions = {}): void {
    const state = this.getRefreshState(this.source.resolveTransportKey?.(options));
    if (rejectedToken !== undefined && state.cachedToken?.token !== rejectedToken) {
      return;
    }
    state.tokenGeneration += 1;
    state.cachedToken = null;
    state.refreshPromise = null;
  }
}
