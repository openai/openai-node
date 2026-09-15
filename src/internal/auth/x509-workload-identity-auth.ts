import { APIConnectionTimeoutError, APIUserAbortError, OAuthError, OpenAIError } from '../../core/error';
import type { WorkloadIdentity, X509WorkloadIdentity } from '../../auth/types';
import type { Fetch } from '../builtin-types';
import { buildHeaders } from '../headers';
import type { HeadersLike, NullableHeaders } from '../headers';
import type { FinalRequestOptions } from '../request-options';
import { CancelReadableStream } from '../shims';
import type { MergedRequestInit } from '../types';
import { isSensitiveHeader } from '../utils/log';
import { hasOwn } from '../utils/values';
import { assertX509APIOrigin } from './x509-api-origin';
import { resolveX509Transport } from './x509-transport-registry';
import {
  isApprovedX509Client,
  findX509OAuthError,
  isRetryableX509IssuerError,
  isTransientX509ConnectionError,
} from '#x509-transport-state';
import type {
  RegisteredX509Transport,
  X509ExchangedToken,
  X509RequestScope,
  X509Transport,
} from './x509-transport-registry';

const FORBIDDEN_TRANSPORT_OPTIONS = ['dispatcher', 'agent', 'client', 'tls', 'proxy'];
const headerValue = (headers: Headers, name: string): string | null =>
  Headers.prototype.get.call(headers, name);
const DEFAULT_REFRESH_BUFFER_MS = 20 * 60 * 1000;
const FAILED_REFRESH_COOLDOWN_MS = 1000;
const userAbortError = (signal: AbortSignal): APIUserAbortError => {
  const error = new APIUserAbortError();
  Object.defineProperty(error, 'cause', { value: signal.reason, writable: true, configurable: true });
  return error;
};

function assertSafeHeaders(headers: Headers): void {
  for (const name of Headers.prototype.keys.call(headers)) {
    const canonical = name.toLowerCase().split('_').join('-');
    if ((canonical !== 'authorization' && isSensitiveHeader(canonical)) || canonical === 'host') {
      throw new OpenAIError('X.509 workload identity cannot send conflicting authentication credentials.');
    }
  }
}

function exchangeDeadline(
  timeout: number | undefined,
  callerSignal: AbortSignal | null | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const deadline = new AbortController();
  const timer =
    timeout === undefined
      ? undefined
      : setTimeout(() => deadline.abort(new APIConnectionTimeoutError()), timeout);
  const timerHandle: unknown = timer;
  if (
    typeof timerHandle === 'object' &&
    timerHandle !== null &&
    'unref' in timerHandle &&
    typeof timerHandle.unref === 'function'
  ) {
    timerHandle.unref();
  }
  const cancel = () => deadline.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', cancel, { once: true });
  if (callerSignal?.aborted) {
    cancel();
  }
  return {
    signal: deadline.signal,
    dispose: () => {
      callerSignal?.removeEventListener('abort', cancel);
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

interface CachedX509Token {
  accessToken: string;
  generation: number;
  expiresAt: number;
  refreshAt: number;
  wallExpiresAt: number;
  wallRefreshAt: number;
}

interface X509RefreshAttempt {
  controller: AbortController;
  generation: number;
  promise: Promise<X509ExchangedToken>;
  waiters: number;
}

interface X509TokenRequestContext {
  apiURL: string;
  defaultHeaders: HeadersLike | undefined;
  requestHeaders: HeadersLike;
  signal: AbortSignal | null | undefined;
  organization: string | null;
  project: string | null;
  timeout: number;
  fetchOptions: MergedRequestInit;
}

function waitForRefresh(
  attempt: X509RefreshAttempt,
  signal: AbortSignal,
): { result: Promise<X509ExchangedToken>; dispose: () => void } {
  let abort: (() => void) | undefined;
  // AbortSignal remains callback-only on supported TypeScript/runtime combinations.
  // oxlint-disable-next-line promise/avoid-new -- A callback-only AbortSignal must race a shared refresh.
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });
  return {
    result: Promise.race([attempt.promise, canceled]),
    dispose: () => {
      if (abort) {
        signal.removeEventListener('abort', abort);
      }
    },
  };
}

/** Distinguishes true certificate identities from extensible legacy subject-token identities. */
export function isX509WorkloadIdentity(
  identity: WorkloadIdentity | X509WorkloadIdentity | undefined,
): identity is X509WorkloadIdentity {
  if (!identity || typeof identity !== 'object') {
    return false;
  }

  let providerOwner: object | null = identity;
  while (providerOwner !== null && providerOwner !== Object.prototype) {
    const provider = Object.getOwnPropertyDescriptor(providerOwner, 'provider');
    if (provider) {
      if (!('value' in provider) || provider.value !== undefined) {
        return false;
      }
      break;
    }
    providerOwner = Object.getPrototypeOf(providerOwner) as object | null;
  }

  let current: object | null = identity;
  while (current !== null && current !== Object.prototype) {
    const discriminator = Object.getOwnPropertyDescriptor(current, 'type');
    if (discriminator) {
      if (!('value' in discriminator)) {
        throw new OpenAIError('X.509 workload identity type must be a plain data property.');
      }
      return discriminator.value === 'x509';
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

/** Rejects unsupported WebSocket authentication before any connection or credential side effect. */
export function assertX509WebSocketSupported(client: unknown): void {
  if (!client || typeof client !== 'object') {
    return;
  }

  if (isApprovedX509Client(client)) {
    throw new OpenAIError('X.509 workload identity does not support WebSocket connections.');
  }
}

/** Prevents caller options from replacing the immutable transport selected at construction. */
export function assertX509FetchOptions(options: MergedRequestInit | RequestInit | undefined): void {
  if (!options) {
    return;
  }

  for (const name of FORBIDDEN_TRANSPORT_OPTIONS) {
    if (hasOwn(options, name)) {
      throw new OpenAIError('X.509 workload identity cannot override its approved transport capability.');
    }
  }
  const redirect: unknown = Object.getOwnPropertyDescriptor(options, 'redirect')?.value;
  if (redirect !== undefined && redirect !== 'manual') {
    throw new OpenAIError('X.509 workload identity requests require manual redirects.');
  }
}

/** Rejects caller overrides while allowing the SDK-owned fields on the final RequestInit. */
export function assertX509RequestOptions(options: MergedRequestInit | RequestInit | undefined): void {
  assertX509FetchOptions(options);
  if (options && ['body', 'headers', 'method', 'signal'].some((name) => hasOwn(options, name))) {
    throw new OpenAIError(
      'X.509 workload identity cannot override its request body, headers, method, or signal through fetch options.',
    );
  }
}

/** Validates and snapshots the exact caller options that will reach authenticated dispatch. */
export function snapshotX509RequestOptions(options: MergedRequestInit | undefined): MergedRequestInit {
  assertX509RequestOptions(options);
  const snapshot = { ...options };
  assertX509RequestOptions(snapshot);
  return snapshot;
}

/** Bridges certificate authentication into existing OpenAI auth and fetch hooks without optional peers. */
export class X509WorkloadIdentityAuth {
  readonly #identityProviderId: string;
  readonly #serviceAccountId: string;
  readonly #configuredRefreshBufferMs: number | undefined;
  readonly #configuredRefreshBufferSeconds: number | undefined;
  readonly #organization: string | null;
  readonly #project: string | null;
  readonly #transport: RegisteredX509Transport;
  readonly #refreshBufferMs: number;
  #cachedToken: CachedX509Token | undefined;
  #refresh: X509RefreshAttempt | undefined;
  #tokenGeneration = 0;

  /** Captures one registered, immutable certificate identity and its enrolled selectors. */
  constructor(
    identity: X509WorkloadIdentity,
    transport: X509Transport | undefined,
    organization: string | null,
    project: string | null,
  ) {
    this.#transport = resolveX509Transport(transport);
    this.#identityProviderId = identity.identityProviderId;
    this.#serviceAccountId = identity.serviceAccountId;
    this.#configuredRefreshBufferMs = identity.refreshBufferMs;
    this.#configuredRefreshBufferSeconds = identity.refreshBufferSeconds;
    this.#organization = organization;
    this.#project = project;
    if (this.#configuredRefreshBufferMs !== undefined && this.#configuredRefreshBufferSeconds !== undefined) {
      throw new OpenAIError(
        'X.509 workload identity cannot combine refreshBufferSeconds and refreshBufferMs.',
      );
    }
    if (
      this.#configuredRefreshBufferMs !== undefined &&
      (!Number.isSafeInteger(this.#configuredRefreshBufferMs) || this.#configuredRefreshBufferMs < 0)
    ) {
      throw new OpenAIError('X.509 workload identity requires a nonnegative integer refreshBufferMs.');
    }
    if (
      this.#configuredRefreshBufferSeconds !== undefined &&
      (!Number.isSafeInteger(this.#configuredRefreshBufferSeconds) ||
        this.#configuredRefreshBufferSeconds < 0 ||
        !Number.isSafeInteger(this.#configuredRefreshBufferSeconds * 1000))
    ) {
      throw new OpenAIError('X.509 workload identity requires a nonnegative integer refreshBufferSeconds.');
    }
    this.#refreshBufferMs =
      this.#configuredRefreshBufferSeconds === undefined
        ? (this.#configuredRefreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS)
        : this.#configuredRefreshBufferSeconds * 1000;
  }

  /** Reconstructs the immutable selectors captured before caller-owned identity mutation. */
  identitySnapshot(): X509WorkloadIdentity {
    return {
      type: 'x509',
      identityProviderId: this.#identityProviderId,
      serviceAccountId: this.#serviceAccountId,
      ...(this.#configuredRefreshBufferMs === undefined
        ? {}
        : { refreshBufferMs: this.#configuredRefreshBufferMs }),
      ...(this.#configuredRefreshBufferSeconds === undefined
        ? {}
        : { refreshBufferSeconds: this.#configuredRefreshBufferSeconds }),
    };
  }

  /** Preserves explicitly headerless requests without presenting a certificate to the issuer. */
  static shouldAuthenticate(
    options: FinalRequestOptions,
    defaultHeaders: HeadersLike | undefined,
    requestHeaders: HeadersLike = options.headers,
  ): boolean {
    return !buildHeaders([defaultHeaders, requestHeaders]).nulls.has('authorization');
  }

  /** Snapshots each caller-owned header layer once while preserving nulls and precedence. */
  snapshotHeaders(
    defaultHeaders: HeadersLike,
    requestHeaders: HeadersLike,
  ): { defaultHeaders: NullableHeaders; requestHeaders: NullableHeaders } {
    const scope = this.#scope();
    scope.defaultHeaders ??= buildHeaders([defaultHeaders]);
    scope.requestHeaders ??= buildHeaders([requestHeaders]);
    return this.headerSnapshots();
  }

  /** Returns the already rendered caller headers without touching mutable inputs again. */
  headerSnapshots(): { defaultHeaders: NullableHeaders; requestHeaders: NullableHeaders } {
    const { defaultHeaders, requestHeaders } = this.#scope();
    if (!defaultHeaders || !requestHeaders) {
      throw new OpenAIError('X.509 workload identity requires snapshotted request headers.');
    }
    return { defaultHeaders, requestHeaders };
  }

  /** Captures enrolled public tenant selectors once before certificate presentation. */
  snapshotTenant(
    organization: string | null,
    project: string | null,
  ): { organization: string | null; project: string | null } {
    if (organization !== this.#organization || project !== this.#project) {
      throw new OpenAIError('X.509 workload identity cannot override its enrolled organization or project.');
    }
    const scope = this.#scope();
    scope.tenant = { organization, project };
    return scope.tenant;
  }

  /** Returns the tenant selectors already approved for this logical request. */
  tenantSnapshot(): { organization: string | null; project: string | null } {
    const { tenant } = this.#scope();
    if (!tenant) {
      throw new OpenAIError('X.509 workload identity requires snapshotted tenant selectors.');
    }
    return tenant;
  }

  /** Validates and retains the exact destination that authenticated dispatch will use. */
  snapshotAPIURL(value: string): void {
    assertX509APIOrigin(value);
    this.#scope().apiURL = value;
  }

  /** Reads the already-approved destination without rerendering caller-owned request options. */
  requestAPIURL(): string {
    const { apiURL } = this.#scope();
    if (apiURL === undefined) {
      throw new OpenAIError('X.509 workload identity requires a snapshotted API destination.');
    }
    return apiURL;
  }

  /** Captures the exact caller settings approved for authenticated dispatch. */
  snapshotRequest(
    signal: AbortSignal | null | undefined,
    timeout: number,
    fetchOptions: MergedRequestInit,
  ): void {
    this.#scope().request ??= { signal, timeout, fetchOptions };
  }

  /** Returns immutable request settings without invoking caller-owned accessors again. */
  requestSnapshot(): {
    signal: AbortSignal | null | undefined;
    timeout: number;
    fetchOptions: MergedRequestInit;
  } {
    const { request } = this.#scope();
    if (!request) {
      throw new OpenAIError('X.509 workload identity requires snapshotted request settings.');
    }
    return request;
  }

  /** Suspends an already-running network budget during retry-local asynchronous preparation. */
  beginRequestPreparation(): void {
    const scope = this.#scope();
    if (scope.deadlineArmed && scope.preparationStartedAt === undefined) {
      scope.preparationStartedAt = performance.now();
      scope.preparationWallStartedAt = Date.now();
    }
  }

  /** Begins local request construction without charging protected hook latency to the network. */
  beginRequestPlanning(): void {
    this.#scope().phase = 'planning';
  }

  /** Arms one absolute network deadline only after all local request preparation completes. */
  beginRequestNetwork(): void {
    const scope = this.#scope();
    if (!scope.deadlineArmed) {
      scope.wallStartedAt = Date.now();
      scope.monotonicStartedAt = performance.now();
      scope.deadlineArmed = true;
    } else if (scope.preparationStartedAt !== undefined) {
      scope.monotonicStartedAt += performance.now() - scope.preparationStartedAt;
      scope.wallStartedAt += Date.now() - (scope.preparationWallStartedAt ?? Date.now());
      delete scope.preparationStartedAt;
      delete scope.preparationWallStartedAt;
    }
  }

  /** Keeps certificate authentication outside overridable request construction. */
  isPlanningRequest(): boolean {
    return this.#scope().phase === 'planning';
  }

  /** Approves the final overridden destination and transport before minting a bearer. */
  authorizePlannedRequest(url: string, request: RequestInit, timeout: number, allowHookSignal = false): void {
    const scope = this.#scope();
    const headers = Object.getOwnPropertyDescriptor(request, 'headers');
    const body = Object.getOwnPropertyDescriptor(request, 'body');
    const signal = Object.getOwnPropertyDescriptor(request, 'signal');
    const redirect = Object.getOwnPropertyDescriptor(request, 'redirect');
    if (
      scope.phase !== 'planning' ||
      !headers ||
      !(headers.value instanceof Headers) ||
      (!body && 'body' in request) ||
      [body, signal, redirect].some((descriptor) => descriptor && !('value' in descriptor))
    ) {
      throw new OpenAIError('X.509 workload identity requires an approved final request.');
    }
    this.snapshotAPIURL(url);
    assertX509FetchOptions(request);
    try {
      assertSafeHeaders(headers.value);
    } catch {
      throw new OpenAIError('X.509 workload identity cannot use caller-supplied authentication credentials.');
    }
    if (headerValue(headers.value, 'Authorization') !== null) {
      throw new OpenAIError('X.509 workload identity cannot use caller-supplied authorization credentials.');
    }
    this.#assertTenantHeaders(headers.value);
    if (!allowHookSignal && (signal?.value ?? undefined) !== (this.requestSnapshot().signal ?? undefined)) {
      throw new OpenAIError('X.509 workload identity must preserve its approved request signal.');
    }
    const approved = this.requestSnapshot();
    scope.request = { ...approved, timeout: Math.min(approved.timeout, timeout) };
    scope.phase = 'authorizing';
  }

  /** Owns only SDK-created iterator adapters until authenticated dispatch takes responsibility. */
  ownRequestBody(body: unknown, source: unknown): void {
    if (body instanceof ReadableStream && body !== source) {
      this.#scope().materializedBody = body;
    }
  }

  /** Recognizes every one-shot upload before issuer authentication or request replay. */
  static isStreamingRequestBody(body: unknown): boolean {
    return (
      (globalThis.ReadableStream !== undefined && body instanceof globalThis.ReadableStream) ||
      (typeof body === 'object' &&
        body !== null &&
        (Symbol.asyncIterator in body ||
          (Symbol.iterator in body && 'next' in body && typeof body.next === 'function')))
    );
  }

  /** Retires abandoned upload adapters without masking or blocking their authentication failure. */
  retireRequestBody(): void {
    const scope = this.#scope();
    const body = scope.materializedBody;
    delete scope.materializedBody;
    if (body) {
      void X509WorkloadIdentityAuth.#cancelRequestBody(body);
    }
  }

  static async #cancelRequestBody(body: ReadableStream): Promise<void> {
    try {
      await CancelReadableStream(body);
    } catch {
      // Upload retirement must never replace the original authentication failure.
    }
  }

  /** Transfers the dispatched upload while retiring any SDK-owned body replaced by a hook. */
  releaseRequestBody(body: unknown): void {
    const scope = this.#scope();
    if (scope.materializedBody === body) {
      delete scope.materializedBody;
    } else {
      this.retireRequestBody();
    }
  }

  /** Retains caller-only cancellation separately from SDK-created deadline controllers. */
  setEffectiveSignal(signal: AbortSignal | undefined): void {
    if (signal) {
      this.#scope().effectiveSignal = signal;
    } else {
      delete this.#scope().effectiveSignal;
    }
  }

  /** Uses protected-hook cancellation when an authenticated attempt enters retry backoff. */
  effectiveSignal(): AbortSignal | null | undefined {
    const scope = this.#scope();
    return scope.effectiveSignal ?? scope.request?.signal;
  }

  /** Establishes an independent scope even when concurrent requests share caller options. */
  runRequest<T>(operation: () => Promise<T>, requestOwner: object): Promise<T> {
    return this.#transport.run(async () => {
      const scope = this.#transport.current();
      if (!scope) {
        throw new OpenAIError('X.509 workload identity requires an active certificate request scope.');
      }
      scope.owner = this;
      scope.requestOwner = requestOwner;
      try {
        return await operation();
      } finally {
        this.retireRequestBody();
        this.releaseRequestCredentials();
        delete scope.requestOwner;
        delete scope.owner;
      }
    });
  }

  /** Reports whether a public request-building call already belongs to an active logical operation. */
  inRequest(requestOwner: object): boolean {
    const scope = this.#transport.current();
    return scope?.owner === this && scope.requestOwner === requestOwner && scope.phase !== 'authorizing';
  }

  /** Shares a cache only when the complete, privately snapshotted credential identity matches. */
  matches(other: X509WorkloadIdentityAuth): boolean {
    return (
      this.#transport === other.#transport &&
      this.#identityProviderId === other.#identityProviderId &&
      this.#serviceAccountId === other.#serviceAccountId &&
      this.#organization === other.#organization &&
      this.#project === other.#project &&
      this.#refreshBufferMs === other.#refreshBufferMs
    );
  }

  /** Binds deferred response parsing to the original logical request and its unchanged deadline. */
  continuation(): <T>(operation: () => Promise<T>) => Promise<T> {
    const { wallStartedAt, monotonicStartedAt, deadlineArmed, request, requestOwner, effectiveSignal } =
      this.#scope();
    const scope: X509RequestScope = {
      wallStartedAt,
      monotonicStartedAt,
      owner: this,
      ...(deadlineArmed ? { deadlineArmed } : {}),
      ...(request ? { request } : {}),
      ...(effectiveSignal ? { effectiveSignal } : {}),
      ...(requestOwner ? { requestOwner } : {}),
    };
    return (operation) =>
      this.#transport.resume(scope, async () => {
        try {
          return await operation();
        } finally {
          this.releaseRequestCredentials();
          delete scope.requestOwner;
          delete scope.owner;
        }
      });
  }

  /** Removes dispatched bearer material before settled request promises can retain their scope. */
  releaseRequestCredentials(): void {
    const scope = this.#scope();
    delete scope.request;
    delete scope.phase;
    delete scope.deadlineArmed;
    delete scope.preparationStartedAt;
    delete scope.preparationWallStartedAt;
    delete scope.effectiveSignal;
    delete scope.materializedBody;
    delete scope.apiURL;
    delete scope.tenant;
    delete scope.token;
    delete scope.defaultHeaders;
    delete scope.requestHeaders;
    delete scope.tokenGeneration;
    delete scope.headers;
    delete scope.authorization;
  }

  /** Returns the original authentication start so response consumption shares its request deadline. */
  requestStartedAt(_options: FinalRequestOptions): number | undefined {
    return this.#transport.current()?.wallStartedAt;
  }

  /** Distinguishes issued workload credentials from independent admin or headerless requests. */
  usedWorkloadToken(_options: FinalRequestOptions): boolean {
    return this.#transport.current()?.token !== undefined;
  }

  /** Returns the budget left after certificate authentication without starting another timeout. */
  remainingTimeout(_options: FinalRequestOptions, timeout: number): number {
    const scope = this.#transport.current();
    if (scope === undefined) {
      return timeout;
    }
    const remaining = timeout - (performance.now() - scope.monotonicStartedAt);
    if (remaining <= 0) {
      throw new APIConnectionTimeoutError();
    }
    return remaining;
  }

  /** Cancels active retry timers promptly without changing public caller-abort semantics. */
  async waitForRetry(duration: number, signal?: AbortSignal | null): Promise<void> {
    try {
      await this.#transport.sleep(duration, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw userAbortError(signal);
      }
      throw error;
    }
  }

  /** Trusts only issuer or connection failures privately branded by the approved transport. */
  static isRetryableFailure(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (isTransientX509ConnectionError(error) || isRetryableX509IssuerError(error))
    );
  }

  /** Reads safe retry hints only from a privately branded, sanitized issuer response. */
  static retryHeaders(error: unknown): Headers | undefined {
    if (!error || typeof error !== 'object' || !isRetryableX509IssuerError(error)) {
      return undefined;
    }
    const headers: unknown = Object.getOwnPropertyDescriptor(error, 'headers')?.value;
    return headers instanceof Headers ? headers : undefined;
  }

  /** Exchanges the exact certificate capability selected for the matching API dispatch. */
  async getToken(options?: FinalRequestOptions, context?: X509TokenRequestContext): Promise<string> {
    const callerSignal = context ? context.signal : options?.signal;
    if (callerSignal?.aborted) {
      throw userAbortError(callerSignal);
    }
    if (options) {
      assertX509RequestOptions(context ? context.fetchOptions : options.fetchOptions);
    }
    this.#preflight(context);

    const scope = options ? this.#scope() : undefined;
    const cached = this.#cachedToken;
    if (cached && performance.now() < cached.refreshAt && Date.now() < cached.wallRefreshAt) {
      return X509WorkloadIdentityAuth.#assignToken(scope, cached);
    }

    const remaining = context && options ? this.remainingTimeout(options, context.timeout) : context?.timeout;
    const { signal, dispose } = exchangeDeadline(remaining, callerSignal);
    if (callerSignal?.aborted) {
      dispose();
      throw userAbortError(callerSignal);
    }
    const attempt = this.#refresh ?? this.#beginRefresh();
    attempt.waiters += 1;
    const waiter = waitForRefresh(attempt, signal);

    try {
      const exchanged = await waiter.result;
      const refreshed = this.#cachedToken;
      if (!refreshed || refreshed.accessToken !== exchanged.accessToken) {
        throw new APIUserAbortError();
      }
      return X509WorkloadIdentityAuth.#assignToken(scope, refreshed);
    } catch (error) {
      return await this.#recoverRefreshFailure(error, attempt, cached, scope, options, context);
    } finally {
      waiter.dispose();
      dispose();
      attempt.waiters -= 1;
      this.#retireRefresh(attempt);
    }
  }

  static #assignToken(scope: X509RequestScope | undefined, token: CachedX509Token): string {
    if (scope) {
      scope.token = token.accessToken;
      scope.tokenGeneration = token.generation;
    }
    return token.accessToken;
  }

  async #recoverRefreshFailure(
    error: unknown,
    attempt: X509RefreshAttempt,
    cached: CachedX509Token | undefined,
    scope: X509RequestScope | undefined,
    options: FinalRequestOptions | undefined,
    context: X509TokenRequestContext | undefined,
  ): Promise<string> {
    const callerSignal = context ? context.signal : options?.signal;
    if (callerSignal?.aborted) {
      throw userAbortError(callerSignal);
    }
    if (attempt.controller.signal.aborted && attempt.generation !== this.#tokenGeneration) {
      return await this.getToken(options, context);
    }
    const fallback = this.#fallbackToken(error, cached, scope);
    if (fallback !== undefined) {
      return fallback;
    }
    if (error && typeof error === 'object' && !(error instanceof OAuthError)) {
      const oauth:
        | { status: 400 | 401 | 403; error: { error: string } | undefined; headers: Headers }
        | undefined = findX509OAuthError(error);
      if (oauth) {
        throw new OAuthError(oauth.status, oauth.error, oauth.headers);
      }
    }
    throw error;
  }

  #fallbackToken(
    error: unknown,
    cached: CachedX509Token | undefined,
    scope: X509RequestScope | undefined,
  ): string | undefined {
    if (
      !cached ||
      cached !== this.#cachedToken ||
      performance.now() >= cached.expiresAt ||
      Date.now() >= cached.wallExpiresAt ||
      !X509WorkloadIdentityAuth.isRetryableFailure(error)
    ) {
      return undefined;
    }
    const headers = X509WorkloadIdentityAuth.retryHeaders(error);
    const milliseconds = headers?.get('retry-after-ms');
    let requested = milliseconds ? Number(milliseconds) : undefined;
    const retryAfter = headers?.get('retry-after');
    if (retryAfter && (requested === undefined || Number.isNaN(requested))) {
      const seconds = Number(retryAfter);
      requested = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
    }
    const cooldown =
      requested !== undefined && Number.isFinite(requested) && requested >= 0 && requested <= 60_000
        ? Math.max(FAILED_REFRESH_COOLDOWN_MS, requested)
        : FAILED_REFRESH_COOLDOWN_MS;
    cached.refreshAt = Math.min(cached.expiresAt, performance.now() + cooldown);
    cached.wallRefreshAt = Math.min(cached.wallExpiresAt, Date.now() + cooldown);
    return X509WorkloadIdentityAuth.#assignToken(scope, cached);
  }

  #retireRefresh(attempt: X509RefreshAttempt): void {
    if (attempt.waiters !== 0 || this.#refresh !== attempt) {
      return;
    }
    queueMicrotask(() => {
      if (attempt.waiters === 0 && this.#refresh === attempt) {
        this.#refresh = undefined;
        this.#tokenGeneration += 1;
        attempt.controller.abort(new APIUserAbortError());
      }
    });
  }

  #beginRefresh(): X509RefreshAttempt {
    const controller = new AbortController();
    const generation = this.#tokenGeneration;
    const attempt: X509RefreshAttempt = {
      controller,
      generation,
      waiters: 0,
      promise: this.#refreshToken(controller, generation),
    };
    this.#refresh = attempt;
    return attempt;
  }

  async #refreshToken(controller: AbortController, generation: number): Promise<X509ExchangedToken> {
    const startedAt = performance.now();
    const wallStartedAt = Date.now();
    try {
      const token = await this.#transport.exchange(
        this.#identityProviderId,
        this.#serviceAccountId,
        controller.signal,
      );
      const lifetime = token.expiresIn * 1000;
      const expiresAt = startedAt + lifetime;
      const wallExpiresAt = wallStartedAt + lifetime;
      if (performance.now() >= expiresAt || Date.now() >= wallExpiresAt) {
        throw new OpenAIError('X.509 workload identity token expired before its exchange completed.');
      }
      if (
        this.#tokenGeneration !== generation ||
        controller.signal.aborted ||
        this.#refresh?.controller !== controller
      ) {
        throw new APIUserAbortError();
      }
      this.#tokenGeneration += 1;
      this.#cachedToken = {
        accessToken: token.accessToken,
        generation: this.#tokenGeneration,
        expiresAt,
        refreshAt: expiresAt - Math.min(this.#refreshBufferMs, lifetime / 2),
        wallExpiresAt,
        wallRefreshAt: wallExpiresAt - Math.min(this.#refreshBufferMs, lifetime / 2),
      };
      return token;
    } finally {
      if (this.#refresh?.controller === controller) {
        this.#refresh = undefined;
      }
    }
  }

  #preflight(context: X509TokenRequestContext | undefined): void {
    if (!context) {
      return;
    }
    if (context.organization !== this.#organization || context.project !== this.#project) {
      throw new OpenAIError('X.509 workload identity cannot override its enrolled organization or project.');
    }
    assertX509APIOrigin(context.apiURL);
    const supplied = buildHeaders([context.defaultHeaders, context.requestHeaders]);
    if (
      (this.#organization !== null && supplied.nulls.has('openai-organization')) ||
      (this.#project !== null && supplied.nulls.has('openai-project'))
    ) {
      throw new OpenAIError('X.509 workload identity cannot omit its enrolled organization or project.');
    }
    for (const name of supplied.values.keys()) {
      const canonical = name.toLowerCase().split('_').join('-');
      if (
        (canonical === 'openai-organization' || canonical === 'openai-project') &&
        (name !== canonical ||
          headerValue(supplied.values, name) !==
            (canonical === 'openai-organization' ? context.organization : context.project))
      ) {
        throw new OpenAIError(
          'X.509 workload identity cannot override its enrolled organization or project.',
        );
      }
      if (isSensitiveHeader(canonical) || canonical === 'host') {
        throw new OpenAIError(
          'X.509 workload identity cannot use caller-supplied authentication credentials.',
        );
      }
    }
  }

  /** Invalidates only the workload-token generation actually rejected by the current request. */
  invalidateToken(): void {
    const rejected = this.#transport.current();
    if (
      !rejected?.token ||
      this.#cachedToken?.accessToken !== rejected.token ||
      this.#cachedToken.generation !== rejected.tokenGeneration
    ) {
      return;
    }
    this.#tokenGeneration += 1;
    this.#cachedToken = undefined;
    const refresh = this.#refresh;
    this.#refresh = undefined;
    refresh?.controller.abort(new APIUserAbortError());
  }

  #scope(): X509RequestScope {
    const scope = this.#transport.current();
    if (!scope || scope.owner !== this) {
      throw new OpenAIError('X.509 workload identity requires an active certificate request scope.');
    }
    return scope;
  }

  /** Binds the minted credential to the original headers before protected request hooks run. */
  bindRequest(options: FinalRequestOptions, request: RequestInit, adminAPIKey: string | null): void {
    if (!(request.headers instanceof Headers)) {
      throw new OpenAIError('X.509 workload identity requires the original workload authorization headers.');
    }
    const scope = this.#scope();
    const { token } = scope;
    const security = options.__security ?? { bearerAuth: true };
    let approvedAuthorization = token ? `Bearer ${token}` : null;
    if (
      !token &&
      security.adminAPIKeyAuth &&
      adminAPIKey !== null &&
      headerValue(request.headers, 'Authorization') !== null
    ) {
      approvedAuthorization = new Headers({ Authorization: `Bearer ${adminAPIKey}` }).get('Authorization');
    }
    scope.headers = request.headers;
    scope.authorization = approvedAuthorization;
    this.assertRequest(request);
  }

  /** Rebinds an equivalent protected-hook container without relaxing final dispatch identity checks. */
  adoptRequestHeaders(request: RequestInit): void {
    const scope = this.#scope();
    const original = scope.headers;
    if (!(original instanceof Headers) || !(request.headers instanceof Headers)) {
      throw new OpenAIError('X.509 workload identity must preserve its issued workload authorization.');
    }
    scope.headers = request.headers;
    try {
      this.assertRequest(request);
    } catch (error) {
      scope.headers = original;
      throw error;
    }
  }

  /** Rejects request hooks that replace the selected bearer or its approved header identity. */
  assertRequest(request: RequestInit): void {
    const { headers } = request;
    if (!(headers instanceof Headers)) {
      throw new OpenAIError('X.509 workload identity must preserve its issued workload authorization.');
    }
    const scope = this.#transport.current();
    if (
      !scope ||
      scope.headers !== headers ||
      scope.authorization === undefined ||
      headerValue(headers, 'Authorization') !== scope.authorization
    ) {
      throw new OpenAIError('X.509 workload identity must preserve its issued workload authorization.');
    }
    this.#assertTenantHeaders(headers);
    assertSafeHeaders(headers);
  }

  /** Enforces the same enrolled selectors before certificate issuance and final dispatch. */
  #assertTenantHeaders(headers: Headers): void {
    if (
      headerValue(headers, 'OpenAI-Organization') !== this.#organization ||
      headerValue(headers, 'OpenAI-Project') !== this.#project
    ) {
      throw new OpenAIError('X.509 workload identity cannot override its enrolled organization or project.');
    }
    for (const name of Headers.prototype.keys.call(headers)) {
      const canonical = name.toLowerCase().split('_').join('-');
      if ((canonical === 'openai-organization' || canonical === 'openai-project') && name !== canonical) {
        throw new OpenAIError(
          'X.509 workload identity cannot override its enrolled organization or project.',
        );
      }
    }
  }

  /** Returns a guarded final dispatcher while preserving all existing request hook object identities. */
  fetch(): Fetch {
    return async (input, init = {}) => {
      const target = assertX509APIOrigin(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      assertX509FetchOptions(init);
      this.assertRequest(init);

      const approved = init.headers;
      if (!(approved instanceof Headers)) {
        throw new OpenAIError('X.509 workload identity must preserve its issued workload authorization.');
      }
      const headers = new Headers([...Headers.prototype.entries.call(approved)]);
      assertSafeHeaders(headers);

      init.headers = headers;
      init.redirect = 'manual';
      return await this.#transport.dispatch(target, init);
    };
  }
}
