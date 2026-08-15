import { APIConnectionTimeoutError, APIUserAbortError, OpenAIError } from '../../core/error';
import type { X509WorkloadIdentity } from '../../auth/types';
import type { Fetch, RequestInit } from '../builtin-types';
import * as Shims from '../shims';
import type { MergedRequestInit } from '../types';
import { hasOwn } from '../utils/values';
import { exchangeX509Token, X509TokenExchangeRetryableError } from './x509-token-exchange';

interface CachedToken {
  token: string;
  expiresAt: LifetimeDeadline;
  refreshAt: LifetimeDeadline;
}

interface LifetimeDeadline {
  monotonic: number;
  wall: number;
}

interface RefreshWaiter {
  reject: (error: unknown) => void;
  resolve: (token: string) => void;
}

interface RefreshAttempt {
  controller: AbortController;
  orphanTimer: ReturnType<typeof setTimeout> | undefined;
  retryCount: number;
  waiters: Set<RefreshWaiter>;
}

interface RetrySequence {
  lastError: X509TokenExchangeRetryableError | null;
  nextRetryCount: number;
  participantAttemptCeilings: Map<symbol, number>;
}

interface RefreshState {
  cachedToken: CachedToken | null;
  proactiveRetryNotBefore: number;
  refreshAttempt: RefreshAttempt | null;
  retrySequence: RetrySequence | null;
  retryNotBefore: number;
  tokenGeneration: number;
}

export interface X509WorkloadIdentityAuthOptions {
  fetchOptions?: MergedRequestInit | undefined;
  maxRetries?: number | undefined;
  transportKey?: object | undefined;
}

interface RefreshContext {
  fetchOptions: MergedRequestInit | undefined;
  generation: number;
  state: RefreshState;
}

const DEFAULT_REFRESH_BUFFER_MS = 1_200_000;
const DEFAULT_PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 30_000;
const DEFAULT_PROACTIVE_REFRESH_TIMEOUT_MS = 600_000;
const TRANSPORT_OPTION_KEYS = ['dispatcher', 'agent', 'client', 'tls', 'proxy'] as const;
const X509_HOOK_PROTECTED_OPTION_KEYS = [...TRANSPORT_OPTION_KEYS, 'redirect'] as const;

function createRefreshState(): RefreshState {
  return {
    cachedToken: null,
    proactiveRetryNotBefore: 0,
    refreshAttempt: null,
    retrySequence: null,
    retryNotBefore: 0,
    tokenGeneration: 0,
  };
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

function lifetimeDeadline(durationMs: number): LifetimeDeadline {
  const wall = Date.now() + durationMs;
  const monotonic = monotonicNow() + durationMs;
  if (!Number.isSafeInteger(wall) || !Number.isFinite(monotonic) || monotonic > Number.MAX_SAFE_INTEGER) {
    throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
  }
  return { monotonic, wall };
}

function hasReached(deadline: LifetimeDeadline): boolean {
  // Either clock may advance farther: monotonic time prevents backward wall-clock
  // adjustments from extending a token, while wall time covers host suspension.
  return monotonicNow() >= deadline.monotonic || Date.now() >= deadline.wall;
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

function assertRetrySequence(context: RefreshContext, retrySequence: RetrySequence): void {
  if (context.state.tokenGeneration !== context.generation || context.state.retrySequence !== retrySequence) {
    throw REFRESH_INVALIDATED;
  }
}

function leaveRetrySequence(state: RefreshState, retrySequence: RetrySequence, participant: symbol): void {
  retrySequence.participantAttemptCeilings.delete(participant);
  if (
    retrySequence.participantAttemptCeilings.size === 0 &&
    state.retrySequence === retrySequence &&
    !state.refreshAttempt
  ) {
    state.retrySequence = null;
  }
}

function takeRefreshWaiters(state: RefreshState, refreshAttempt: RefreshAttempt): RefreshWaiter[] {
  if (state.refreshAttempt === refreshAttempt) {
    state.refreshAttempt = null;
  }
  if (refreshAttempt.orphanTimer !== undefined) {
    clearTimeout(refreshAttempt.orphanTimer);
    refreshAttempt.orphanTimer = undefined;
  }
  const waiters = [...refreshAttempt.waiters];
  refreshAttempt.waiters.clear();
  return waiters;
}

function scheduleOrphanRetirement(
  state: RefreshState,
  refreshAttempt: RefreshAttempt,
  delayMs: number,
): void {
  if (refreshAttempt.orphanTimer !== undefined) {
    clearTimeout(refreshAttempt.orphanTimer);
  }
  refreshAttempt.orphanTimer = setTimeout(() => {
    refreshAttempt.orphanTimer = undefined;
    if (refreshAttempt.waiters.size === 0 && state.refreshAttempt === refreshAttempt) {
      state.refreshAttempt = null;
      state.retrySequence = null;
      state.tokenGeneration += 1;
      refreshAttempt.controller.abort();
    }
  }, delayMs);
  (refreshAttempt.orphanTimer as unknown as { unref?: () => void }).unref?.();
}

function resolveRefresh(state: RefreshState, refreshAttempt: RefreshAttempt, token: string): void {
  for (const waiter of takeRefreshWaiters(state, refreshAttempt)) {
    waiter.resolve(token);
  }
}

function rejectRefresh(state: RefreshState, refreshAttempt: RefreshAttempt, error: unknown): void {
  for (const waiter of takeRefreshWaiters(state, refreshAttempt)) {
    waiter.reject(error);
  }
}

function recordProactiveRefreshFailure(
  context: RefreshContext,
  refreshAttempt: RefreshAttempt,
  error: unknown,
): void {
  const { state } = context;
  if (
    error === REFRESH_INVALIDATED ||
    error instanceof X509TokenExchangeRetryableError ||
    state.tokenGeneration !== context.generation ||
    state.refreshAttempt !== refreshAttempt ||
    !state.cachedToken
  ) {
    return;
  }
  state.proactiveRetryNotBefore = Math.max(
    state.proactiveRetryNotBefore,
    Math.min(
      state.cachedToken.expiresAt.monotonic,
      monotonicNow() + DEFAULT_PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS,
    ),
  );
}

async function waitForRefresh(
  state: RefreshState,
  refreshAttempt: RefreshAttempt,
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): Promise<string> {
  throwIfAborted(signal);

  // oxlint-disable-next-line promise/avoid-new -- AbortSignal only exposes callback-based cancellation.
  return await new Promise<string>((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // oxlint-disable-next-line prefer-const -- Cleanup must close over the handler before it is initialized.
    let onAbort: () => void;
    // oxlint-disable-next-line prefer-const -- Cleanup must close over the subscriber before it is initialized.
    let waiter: RefreshWaiter;
    const cleanup = () => {
      const removed = refreshAttempt.waiters.delete(waiter);
      if (removed && refreshAttempt.waiters.size === 0 && state.refreshAttempt === refreshAttempt) {
        // Let requests already queued in this turn join before an orphaned attempt is retired.
        scheduleOrphanRetirement(state, refreshAttempt, 0);
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (): boolean => {
      if (finished) {
        return false;
      }
      finished = true;
      cleanup();
      return true;
    };
    onAbort = () => {
      if (signal && finish()) {
        reject(abortError(signal));
      }
    };
    waiter = {
      reject: (error) => {
        if (finish()) {
          reject(error);
        }
      },
      resolve: (token) => {
        if (finish()) {
          resolve(token);
        }
      },
    };
    refreshAttempt.waiters.add(waiter);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (finish()) {
          reject(new APIConnectionTimeoutError());
        }
      }, timeoutMs);
    }
  });
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (timeoutMs !== undefined && timeoutMs <= 0) {
    throw new APIConnectionTimeoutError();
  }
  // oxlint-disable-next-line promise/avoid-new -- Timers only expose callback-based completion.
  return await new Promise<void>((resolve, reject) => {
    let finished = false;
    // oxlint-disable-next-line prefer-const -- Cleanup must close over the timer before it is initialized.
    let timer: ReturnType<typeof setTimeout>;
    // oxlint-disable-next-line prefer-const -- Cleanup must close over the handler before it is initialized.
    let onAbort: () => void;
    const timeoutWins = timeoutMs !== undefined && timeoutMs <= delayMs;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (): boolean => {
      if (finished) {
        return false;
      }
      finished = true;
      cleanup();
      return true;
    };
    onAbort = () => {
      if (signal && finish()) {
        reject(abortError(signal));
      }
    };
    timer = setTimeout(
      () => {
        if (finish()) {
          if (timeoutWins) {
            reject(new APIConnectionTimeoutError());
          } else {
            resolve();
          }
        }
      },
      timeoutWins ? timeoutMs : delayMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exchanges X.509 workload identities for transport-scoped OpenAI access tokens.
 *
 * Concurrent token exchanges are shared. Valid cached tokens are returned while
 * a proactive refresh runs in the background; expired or missing tokens wait
 * for a successful exchange before they are returned.
 */
export class X509WorkloadIdentityAuth {
  private readonly defaultState = createRefreshState();
  private readonly config: X509WorkloadIdentity;
  private readonly fetch: Fetch;
  private readonly defaultFetchOptions: MergedRequestInit | undefined;
  private readonly defaultMaxRetries: number;
  // Weak keys partition transport-scoped state without extending caller-owned dispatcher lifetimes.
  private readonly transportStates = new WeakMap<object, RefreshState>();

  /**
   * Creates a workload-identity token cache and OAuth token-exchange client.
   *
   * @param config External identity provider, OpenAI service account, and refresh settings.
   * @param fetch Optional fetch implementation for calls to the OpenAI token endpoint.
   * @param options Internal effective transport and retry settings for X.509 exchanges.
   */
  constructor(config: X509WorkloadIdentity, fetch?: Fetch, options: X509WorkloadIdentityAuthOptions = {}) {
    validateX509Config(config);
    this.config = config;
    this.fetch = fetch ?? Shims.getDefaultFetch();
    this.defaultFetchOptions = options.fetchOptions;
    this.defaultMaxRetries = validateMaxRetries(options.maxRetries ?? 2);
  }

  /**
   * Returns a valid OpenAI access token, exchanging or refreshing credentials as needed.
   *
   * Cached tokens nearing expiration are returned immediately while a background
   * refresh runs. Concurrent callers share the same in-flight token exchange.
   * Canceling one waiter does not affect other waiters; an attempt with no
   * remaining waiters is retired so future callers can start a new exchange.
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
    options: X509WorkloadIdentityAuthOptions = {},
  ): Promise<string> {
    throwIfAborted(signal);
    const maxRetries = validateMaxRetries(options.maxRetries ?? this.defaultMaxRetries);
    const deadline = timeoutMs === undefined ? undefined : monotonicNow() + timeoutMs;

    while (true) {
      const fetchOptions = this.resolveFetchOptions(options);
      const state = this.getRefreshState(X509WorkloadIdentityAuth.resolveTransportKey(options, fetchOptions));
      const context: RefreshContext = {
        fetchOptions,
        generation: state.tokenGeneration,
        state,
      };

      try {
        if (!state.cachedToken || X509WorkloadIdentityAuth.isTokenExpired(state.cachedToken)) {
          // oxlint-disable-next-line no-await-in-loop -- Invalidation restarts within the original deadline.
          return await this.refreshWithRetries(context, maxRetries, signal, deadline);
        }
        if (X509WorkloadIdentityAuth.needsRefresh(state.cachedToken)) {
          this.refreshInBackground(context, timeoutMs);
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

  private resolveFetchOptions(options: X509WorkloadIdentityAuthOptions): MergedRequestInit | undefined {
    return hasOwn(options, 'fetchOptions') ? options.fetchOptions : this.defaultFetchOptions;
  }

  private static resolveTransportKey(
    options: X509WorkloadIdentityAuthOptions,
    fetchOptions: MergedRequestInit | undefined,
  ): object | undefined {
    return hasOwn(options, 'transportKey') ? options.transportKey : x509TransportKey(fetchOptions);
  }

  private refreshInBackground(context: RefreshContext, timeoutMs: number | undefined): void {
    const { state } = context;
    const now = monotonicNow();
    if (state.refreshAttempt || state.retryNotBefore > now || state.proactiveRetryNotBefore > now) {
      return;
    }
    // A proactive refresh has no waiting caller, so bound its transport lifetime
    // independently. A foreground waiter that joins takes ownership instead.
    const refreshAttempt = this.startRefresh(context, 0);
    scheduleOrphanRetirement(state, refreshAttempt, timeoutMs ?? DEFAULT_PROACTIVE_REFRESH_TIMEOUT_MS);
  }

  private async refreshWithRetries(
    context: RefreshContext,
    maxRetries: number,
    signal?: AbortSignal | null,
    deadline?: number,
  ): Promise<string> {
    const { state } = context;
    const cachedAtStart = state.cachedToken;
    const retrySequence = state.retrySequence ?? {
      lastError: null,
      nextRetryCount: 0,
      participantAttemptCeilings: new Map(),
    };
    const participant = Symbol('X.509 refresh participant');
    state.retrySequence = retrySequence;
    const firstAttempt = state.refreshAttempt?.retryCount ?? retrySequence.nextRetryCount;
    const participantAttemptCeiling = Math.min(Number.MAX_SAFE_INTEGER, firstAttempt + maxRetries);
    retrySequence.participantAttemptCeilings.set(participant, participantAttemptCeiling);

    try {
      while (true) {
        throwIfAborted(signal);
        X509WorkloadIdentityAuth.throwIfDeadlineExceeded(deadline);
        assertRetrySequence(context, retrySequence);
        if (state.retryNotBefore > monotonicNow()) {
          // oxlint-disable-next-line no-await-in-loop -- Each attempt must honor the latest shared backoff.
          await X509WorkloadIdentityAuth.waitForRetryWindow(context, retrySequence, signal, deadline);
        }
        if (
          state.cachedToken &&
          state.cachedToken !== cachedAtStart &&
          !X509WorkloadIdentityAuth.isTokenExpired(state.cachedToken)
        ) {
          return state.cachedToken.token;
        }

        const refreshAttempt =
          state.refreshAttempt ?? this.startRetrySequenceAttempt(context, retrySequence, deadline);

        try {
          // oxlint-disable-next-line no-await-in-loop -- Token refresh attempts are intentionally sequential.
          const token = await waitForRefresh(
            state,
            refreshAttempt,
            signal,
            X509WorkloadIdentityAuth.remainingTimeout(deadline),
          );
          return token;
        } catch (error) {
          if (!(error instanceof X509TokenExchangeRetryableError)) {
            throw error;
          }
          assertRetrySequence(context, retrySequence);
          if (refreshAttempt.retryCount >= participantAttemptCeiling) {
            throw error.error;
          }
        }
      }
    } finally {
      leaveRetrySequence(state, retrySequence, participant);
    }
  }

  private static async waitForRetryWindow(
    context: RefreshContext,
    retrySequence: RetrySequence,
    signal?: AbortSignal | null,
    deadline?: number,
  ): Promise<void> {
    let retryDelayMs = context.state.retryNotBefore - monotonicNow();
    while (retryDelayMs > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Each wake must recheck a shared backoff another attempt may extend.
      await waitForDelay(retryDelayMs, signal, X509WorkloadIdentityAuth.remainingTimeout(deadline));
      assertRetrySequence(context, retrySequence);
      X509WorkloadIdentityAuth.throwIfDeadlineExceeded(deadline);
      retryDelayMs = context.state.retryNotBefore - monotonicNow();
    }
  }

  private startRetrySequenceAttempt(
    context: RefreshContext,
    retrySequence: RetrySequence,
    deadline: number | undefined,
  ): RefreshAttempt {
    let sharedRetryBudget = -1;
    for (const attemptCeiling of retrySequence.participantAttemptCeilings.values()) {
      sharedRetryBudget = Math.max(sharedRetryBudget, attemptCeiling);
    }
    if (retrySequence.nextRetryCount > sharedRetryBudget) {
      if (!retrySequence.lastError) {
        throw new OpenAIError('X.509 workload identity retry sequence is missing its failure.');
      }
      throw retrySequence.lastError.error;
    }
    X509WorkloadIdentityAuth.throwIfDeadlineExceeded(deadline);
    return this.startRefresh(context, retrySequence.nextRetryCount);
  }

  private static remainingTimeout(deadline: number | undefined): number | undefined {
    return deadline === undefined ? undefined : Math.max(0, deadline - monotonicNow());
  }

  private static throwIfDeadlineExceeded(deadline: number | undefined): void {
    if (deadline !== undefined && monotonicNow() >= deadline) {
      throw new APIConnectionTimeoutError();
    }
  }

  private startRefresh(context: RefreshContext, retryCount: number): RefreshAttempt {
    const refreshAttempt: RefreshAttempt = {
      controller: new AbortController(),
      orphanTimer: undefined,
      retryCount,
      waiters: new Set(),
    };
    context.state.refreshAttempt = refreshAttempt;
    // oxlint-disable promise/prefer-await-to-then promise/prefer-await-to-callbacks -- One shared reaction fans settlement out to removable waiters.
    void this.refreshToken(context, retryCount, refreshAttempt.controller.signal).then(
      (token) => resolveRefresh(context.state, refreshAttempt, token),
      (error: unknown) => {
        recordProactiveRefreshFailure(context, refreshAttempt, error);
        rejectRefresh(context.state, refreshAttempt, error);
      },
    );
    // oxlint-enable promise/prefer-await-to-callbacks
    return refreshAttempt;
  }

  private async refreshToken(
    context: RefreshContext,
    retryCount: number,
    signal: AbortSignal,
  ): Promise<string> {
    let tokenResponse: unknown;
    try {
      tokenResponse = await exchangeX509Token({
        config: this.config,
        fetch: this.fetch,
        fetchOptions: context.fetchOptions,
        retryCount,
        signal,
      });
    } catch (error) {
      if (
        error instanceof X509TokenExchangeRetryableError &&
        context.state.tokenGeneration === context.generation
      ) {
        context.state.retryNotBefore = Math.max(
          context.state.retryNotBefore,
          monotonicNow() + error.retryDelayMs,
        );
        const { retrySequence } = context.state;
        if (retrySequence) {
          retrySequence.lastError = error;
          retrySequence.nextRetryCount = Math.max(retrySequence.nextRetryCount, retryCount + 1);
        }
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
    const expiresIn = 'expires_in' in tokenResponse ? tokenResponse.expires_in : undefined;
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    const durationMs = expiresIn * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }
    const expiresAt = lifetimeDeadline(durationMs);
    const refreshBufferMs = Math.min(
      this.config.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS,
      durationMs / 2,
    );

    if (context.state.tokenGeneration === context.generation) {
      context.state.retryNotBefore = 0;
      context.state.proactiveRetryNotBefore = 0;
      context.state.cachedToken = {
        token: accessToken,
        expiresAt,
        refreshAt: {
          monotonic: expiresAt.monotonic - refreshBufferMs,
          wall: expiresAt.wall - refreshBufferMs,
        },
      };
    }

    return accessToken;
  }

  private static isTokenExpired(cachedToken: CachedToken): boolean {
    return hasReached(cachedToken.expiresAt);
  }

  private static needsRefresh(cachedToken: CachedToken): boolean {
    return hasReached(cachedToken.refreshAt);
  }

  /** Discards a rejected cached access token so the next request performs a fresh exchange. */
  invalidateToken(rejectedToken?: string, options: X509WorkloadIdentityAuthOptions = {}): void {
    const fetchOptions = this.resolveFetchOptions(options);
    const state = this.getRefreshState(X509WorkloadIdentityAuth.resolveTransportKey(options, fetchOptions));
    if (rejectedToken !== undefined && state.cachedToken?.token !== rejectedToken) {
      return;
    }
    state.tokenGeneration += 1;
    state.cachedToken = null;
    state.proactiveRetryNotBefore = 0;
    state.retryNotBefore = 0;
    state.retrySequence = null;
    const { refreshAttempt } = state;
    if (refreshAttempt) {
      rejectRefresh(state, refreshAttempt, REFRESH_INVALIDATED);
      refreshAttempt.controller.abort();
    }
  }
}
