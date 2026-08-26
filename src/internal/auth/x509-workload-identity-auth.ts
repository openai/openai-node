import { APIConnectionTimeoutError, APIUserAbortError, OAuthError, OpenAIError } from '../../core/error';
import type { WorkloadIdentity, X509WorkloadIdentity } from '../../auth/types';
import type { Fetch } from '../builtin-types';
import { buildHeaders } from '../headers';
import type { HeadersLike, NullableHeaders } from '../headers';
import type { FinalRequestOptions } from '../request-options';
import type { MergedRequestInit } from '../types';
import { hasOwn } from '../utils/values';
import { resolveX509Transport } from './x509-transport-registry';
import {
  isApprovedX509Client,
  findX509OAuthError,
  isRetryableX509IssuerError,
  isTransientX509ConnectionError,
} from '#x509-transport-state';
import type { RegisteredX509Transport, X509RequestScope, X509Transport } from './x509-transport-registry';

/** Sole API authority approved for OpenAI X.509 workload-identity federation. */
export const X509_API_BASE_URL = 'https://mtls.api.openai.com/v1';

const X509_API_ORIGIN = 'https://mtls.api.openai.com';
const FORBIDDEN_TRANSPORT_OPTIONS = ['dispatcher', 'agent', 'client', 'tls', 'proxy'];
const headerValue = (headers: Headers, name: string): string | null =>
  Headers.prototype.get.call(headers, name);
const invalidateUncachedToken = (): undefined => undefined;
const userAbortError = (signal: AbortSignal): APIUserAbortError => {
  const error = new APIUserAbortError();
  Object.defineProperty(error, 'cause', { value: signal.reason, writable: true, configurable: true });
  return error;
};

function assertSafeHeaders(headers: Headers): void {
  for (const name of Headers.prototype.keys.call(headers)) {
    const canonical = name.toLowerCase().split('_').join('-');
    if (
      canonical === 'api-key' ||
      canonical === 'x-api-key' ||
      canonical === 'proxy-authorization' ||
      canonical === 'host'
    ) {
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

/** Rejects every destination outside the sole enrolled, global X.509 API authority. */
export function assertX509APIOrigin(value: string | URL): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new OpenAIError('X.509 workload identity requires the approved global mTLS API origin.');
  }

  if (target.origin !== X509_API_ORIGIN || target.username || target.password) {
    throw new OpenAIError('X.509 workload identity requires the approved global mTLS API origin.');
  }
  return target;
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

/** Rejects caller body replacement while allowing the SDK's legitimate final RequestInit body. */
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
  readonly #transport: RegisteredX509Transport;

  /** Captures one registered, immutable certificate identity and its enrolled selectors. */
  constructor(identity: X509WorkloadIdentity, transport: X509Transport | undefined) {
    this.#transport = resolveX509Transport(transport);
    this.#identityProviderId = identity.identityProviderId;
    this.#serviceAccountId = identity.serviceAccountId;
  }

  /** Reconstructs the immutable selectors captured before caller-owned identity mutation. */
  identitySnapshot(): X509WorkloadIdentity {
    return {
      type: 'x509',
      identityProviderId: this.#identityProviderId,
      serviceAccountId: this.#serviceAccountId,
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

  /** Arms one logical network deadline only after protected option preparation completes. */
  beginRequestPlanning(): void {
    const scope = this.#scope();
    if (!scope.request) {
      scope.wallStartedAt = Date.now();
      scope.monotonicStartedAt = performance.now();
    }
    scope.phase = 'planning';
    delete scope.effectiveSignal;
  }

  /** Keeps certificate authentication outside overridable request construction. */
  isPlanningRequest(): boolean {
    return this.#scope().phase === 'planning';
  }

  /** Approves the final overridden destination and transport before minting a bearer. */
  authorizePlannedRequest(url: string, request: RequestInit): void {
    const scope = this.#scope();
    const headers = Object.getOwnPropertyDescriptor(request, 'headers');
    const signal = Object.getOwnPropertyDescriptor(request, 'signal');
    const redirect = Object.getOwnPropertyDescriptor(request, 'redirect');
    if (
      scope.phase !== 'planning' ||
      !headers ||
      !('value' in headers) ||
      !(headers.value instanceof Headers) ||
      (signal && !('value' in signal)) ||
      (redirect && !('value' in redirect))
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
    if ((signal?.value ?? undefined) !== (this.requestSnapshot().signal ?? undefined)) {
      throw new OpenAIError('X.509 workload identity must preserve its approved request signal.');
    }
    scope.phase = 'authorizing';
  }

  /** Retains caller-only cancellation separately from SDK-created deadline controllers. */
  setEffectiveSignal(signal: AbortSignal | undefined): void {
    if (signal) {
      this.#scope().effectiveSignal = signal;
    }
  }

  /** Uses protected-hook cancellation when an authenticated attempt enters retry backoff. */
  effectiveSignal(): AbortSignal | null | undefined {
    const scope = this.#scope();
    return scope.effectiveSignal ?? scope.request?.signal;
  }

  /** Establishes an independent scope even when concurrent requests share caller options. */
  runRequest<T>(operation: () => Promise<T>): Promise<T> {
    return this.#transport.run(async () => {
      try {
        return await operation();
      } finally {
        this.releaseRequestCredentials();
      }
    });
  }

  /** Reports whether a public request-building call already belongs to an active logical operation. */
  inRequest(): boolean {
    return this.#transport.current() !== undefined;
  }

  /** Binds deferred response parsing to the original logical request and its unchanged deadline. */
  continuation(): <T>(operation: () => Promise<T>) => Promise<T> {
    const { wallStartedAt, monotonicStartedAt, request, effectiveSignal } = this.#scope();
    const scope: X509RequestScope = {
      wallStartedAt,
      monotonicStartedAt,
      ...(request ? { request } : {}),
      ...(effectiveSignal ? { effectiveSignal } : {}),
    };
    return (operation) =>
      this.#transport.resume(scope, async () => {
        try {
          return await operation();
        } finally {
          this.releaseRequestCredentials();
        }
      });
  }

  /** Removes dispatched bearer material before settled request promises can retain their scope. */
  releaseRequestCredentials(): void {
    const scope = this.#scope();
    delete scope.request;
    delete scope.phase;
    delete scope.effectiveSignal;
    delete scope.apiURL;
    delete scope.token;
    delete scope.defaultHeaders;
    delete scope.requestHeaders;
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
  async getToken(
    options?: FinalRequestOptions,
    context?: {
      apiURL: string;
      defaultHeaders: HeadersLike | undefined;
      requestHeaders: HeadersLike;
      signal: AbortSignal | null | undefined;
      timeout: number;
      fetchOptions: MergedRequestInit;
    },
  ): Promise<string> {
    const callerSignal = context ? context.signal : options?.signal;
    if (callerSignal?.aborted) {
      throw userAbortError(callerSignal);
    }
    X509WorkloadIdentityAuth.#preflight(options, context);

    const scope = options ? this.#scope() : undefined;
    const remaining = context && options ? this.remainingTimeout(options, context.timeout) : context?.timeout;
    const { signal, dispose } = exchangeDeadline(remaining, callerSignal);

    try {
      if (callerSignal?.aborted) {
        throw userAbortError(callerSignal);
      }
      const exchanged = await this.#transport.exchange(
        this.#identityProviderId,
        this.#serviceAccountId,
        signal,
      );
      if (scope) {
        scope.token = exchanged.accessToken;
      }
      return exchanged.accessToken;
    } catch (error) {
      if (callerSignal?.aborted) {
        throw userAbortError(callerSignal);
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
    } finally {
      dispose();
    }
  }

  static #preflight(
    options: FinalRequestOptions | undefined,
    context:
      | {
          apiURL: string;
          defaultHeaders: HeadersLike | undefined;
          requestHeaders: HeadersLike;
          timeout: number;
          fetchOptions: MergedRequestInit;
        }
      | undefined,
  ): void {
    if (options) {
      assertX509RequestOptions(context ? context.fetchOptions : options.fetchOptions);
    }
    if (!context) {
      return;
    }
    assertX509APIOrigin(context.apiURL);
    const supplied = buildHeaders([context.defaultHeaders, context.requestHeaders]);
    for (const name of supplied.values.keys()) {
      const canonical = name.toLowerCase().split('_').join('-');
      if (
        canonical === 'authorization' ||
        canonical === 'api-key' ||
        canonical === 'x-api-key' ||
        canonical === 'proxy-authorization' ||
        canonical === 'host'
      ) {
        throw new OpenAIError(
          'X.509 workload identity cannot use caller-supplied authentication credentials.',
        );
      }
    }
  }

  /** Token caching is added separately; every current exchange already produces a fresh credential. */
  readonly invalidateToken = invalidateUncachedToken;

  #scope(): X509RequestScope {
    const scope = this.#transport.current();
    if (!scope) {
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
    assertSafeHeaders(headers);
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
