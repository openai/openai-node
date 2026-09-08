import {
  getHeadersPrototype,
  getPlatformHeader,
  getVerifiedPlatformHeader,
  hasNativeHeadersBrand,
} from '../platform-headers';
import type { HeadersLike, NullableHeaders, WorkloadHeaderSnapshots } from '../headers';

/** Extracts a bearer credential while preserving the token's case-sensitive bytes. */
export function bearerToken(authorization: string | null): string | undefined {
  if (authorization?.slice(0, 7).toLowerCase() !== 'bearer ') {
    return undefined;
  }
  let tokenStart = 7;
  while (authorization[tokenStart] === ' ') {
    tokenStart += 1;
  }
  return tokenStart === authorization.length ? undefined : authorization.slice(tokenStart);
}

const matchesAuthorization = (actual: string | null, expected: string, exact: boolean): boolean =>
  exact ? actual === expected : bearerToken(actual) === bearerToken(expected);

const hasAuthorizationMismatch = (
  observed: { value: string | null } | undefined,
  expected: string,
  exact: boolean,
): observed is { value: string | null } =>
  observed !== undefined && !matchesAuthorization(observed.value, expected, exact);

interface HeaderCredential {
  owner: object;
  token: string;
  revoked: boolean;
}

export interface WorkloadCredentialUsage {
  isCurrent: () => boolean;
  revoke: () => void;
  adopt: (headers: Headers) => void;
}

const headerCredentials = new WeakMap<object, HeaderCredential | null>();
const headerValueSources = new WeakMap<object, Headers>();
const nativeHeaderValues = new WeakSet<object>();
const requestCredentialCarrier = Symbol('workload.requestCredentialCarrier');
const headerConsumptionListeners = new WeakMap<object, Set<() => void>>();

/** Active requests observe consumption, never another request's serialized header values. */
export function observesWorkloadHeaderConsumption(source: object): boolean {
  return headerConsumptionListeners.has(source);
}

/** Records a canonical parse of a source that cannot safely be consumed again. */
export function notifyWorkloadHeaderConsumption(source: object): void {
  for (const listener of headerConsumptionListeners.get(source) ?? []) {
    listener();
  }
}

/** Validates ownership without shadowing caller-visible platform methods. */
const hasUnmodifiedHeaderMutators = (headers: object): boolean => {
  let platform: object | undefined;
  try {
    Headers.prototype.has.call(headers, 'authorization');
    platform = Headers.prototype;
  } catch {
    try {
      platform = getHeadersPrototype(headers);
    } catch {
      return false;
    }
  }
  if (!platform) {
    return false;
  }
  try {
    const names = ['set', 'append', 'delete'] as const;
    for (const name of names) {
      let descriptor: PropertyDescriptor | undefined;
      const seen = new Set<object>();
      for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
        if (seen.has(prototype)) {
          break;
        }
        seen.add(prototype);
        descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (descriptor) {
          break;
        }
      }
      const native = Object.getOwnPropertyDescriptor(platform, name)?.value;
      if (!descriptor || descriptor.value !== native || typeof native !== 'function') {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

/** Reads current-realm native bytes without consulting caller-shadowed readers or iterators. */
const getNativeAuthorization = (headers: object): string | null | undefined => {
  if (!hasNativeHeadersBrand(headers)) {
    return undefined;
  }
  try {
    return Reflect.apply(Headers.prototype.get, headers, ['authorization']);
  } catch {
    // The brand probe normally guarantees this read; remain conservative if host intrinsics change.
    return undefined;
  }
};

/** Revokes an issued authentication result whose current native bytes changed or disappeared. */
const validateIssuedCredential = (
  headers: object,
  credential: HeaderCredential | null | undefined,
): HeaderCredential | null | undefined => {
  if (!credential || !nativeHeaderValues.has(headers)) {
    return credential;
  }
  const authorization = getNativeAuthorization(headers);
  if (authorization === undefined || authorization === `Bearer ${credential.token}`) {
    return credential;
  }
  credential.revoked = true;
  return null;
};

/** Reads the credential capability attached to an SDK-produced header layer. */
export function workloadHeaderCredential(headers: object): HeaderCredential | null | undefined {
  const source = headerValueSources.get(headers);
  let credential = headerCredentials.get(headers);
  let values = headers;
  if (source) {
    let selectedValues: unknown;
    try {
      selectedValues = Object.getOwnPropertyDescriptor(headers, 'values')?.value;
    } catch {
      return undefined;
    }
    if (typeof selectedValues !== 'object' || selectedValues === null) {
      return undefined;
    }
    values = selectedValues;
    const selected = headerCredentials.get(selectedValues);
    if (selected !== undefined || selectedValues !== source) {
      credential = selected;
    }
  }
  if (credential && nativeHeaderValues.has(values) && !hasUnmodifiedHeaderMutators(values)) {
    credential.revoked = true;
  }
  return credential?.revoked ? null : credential;
}

/** Parsed copies own their mutations independently of the source snapshot. */
export function copyWorkloadHeaderCredential(credential: HeaderCredential | null): HeaderCredential | null {
  return credential && { ...credential };
}

/** Carries the capability belonging to the last layer that supplied Authorization. */
export function rememberWorkloadHeaderCredential(
  headers: object,
  credential: HeaderCredential | null,
  values: Headers,
): void {
  headerCredentials.set(headers, credential);
  headerValueSources.set(headers, values);
}

/** Marks native header values for passive shape validation when ownership is consulted. */
export function rememberWorkloadHeaderValues(headers: object, credential: HeaderCredential | null): void {
  headerCredentials.set(headers, credential);
  nativeHeaderValues.add(headers);
}

interface TokenScope {
  context: object;
  resultOwner: object;
  headers: WorkloadHeaderSnapshots | undefined;
  captureHeaders: (headers: WorkloadHeaderSnapshots) => void;
  captureHeaderRead: (source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void;
  recordHeaderConsumption: (source: object) => void;
  hasConsumedHeaders: (source: object | null | undefined) => boolean;
  record: (token: string) => HeaderCredential;
  select: (credential: HeaderCredential) => void;
  recoverCopy: (authorization: string | null) => HeaderCredential | undefined;
  revoke: () => void;
  authenticationRevoked: () => boolean;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
  private readonly parseHeaders: (values: HeadersLike) => NullableHeaders;
  private readonly canPreserveHeaders: (values: HeadersLike) => boolean;
  private readonly structuralHeader: (
    values: HeadersLike,
    name: string,
  ) => { value: string | null; restorationDefinitive?: boolean } | undefined;

  /** Uses the canonical header parser while keeping its dependency on provenance acyclic. */
  constructor(
    parseHeaders: (values: HeadersLike) => NullableHeaders,
    canPreserveHeaders: (values: HeadersLike) => boolean,
    structuralHeader: (
      values: HeadersLike,
      name: string,
    ) => { value: string | null; restorationDefinitive?: boolean } | undefined,
  ) {
    this.parseHeaders = parseHeaders;
    this.canPreserveHeaders = canPreserveHeaders;
    this.structuralHeader = structuralHeader;
  }

  private readonly pendingHeaders = new WeakMap<WorkloadCredentialUsage, object>();
  private readonly structuralMismatches = new WeakMap<
    WorkloadCredentialUsage,
    { source: object; value: string | null; restorationDefinitive: boolean; exact: boolean }
  >();
  private readonly contexts = new WeakMap<object, TokenScope>();
  private readonly options = new WeakMap<object, Set<TokenScope>>();
  private readonly consumedHeaders = new WeakMap<object, Set<TokenScope>>();
  private readonly results = new WeakMap<
    object,
    { credential: HeaderCredential | null; owner?: object; headers?: WorkloadHeaderSnapshots }
  >();
  private invocation: TokenScope | undefined;

  /** Owns synchronous hook entry only; the scope is never left ambient across an await. */
  invoke<T>(options: object, context: object | undefined, operation: () => T): T {
    const previous = this.invocation;
    this.invocation = this.scopeFor(options, context);
    try {
      if (this.invocation?.headers) {
        this.invocation.captureHeaders(this.invocation.headers);
      }
      return operation();
    } finally {
      this.invocation = previous;
    }
  }

  /** Captures synchronous delegation ownership only at authentication hook entry. */
  authenticationScope(options: object, context: object | undefined): TokenScope | undefined {
    if (context !== undefined) {
      return this.contexts.get(context);
    }
    return this.invocation ?? this.scopeFor(options);
  }

  /** Detects consumed inputs without borrowing another request's serialized credentials. */
  hasConsumedHeaders(...sources: (object | null | undefined)[]): boolean {
    return sources.some(
      (source) => source !== null && source !== undefined && this.consumedHeaders.has(source),
    );
  }

  /** The private carrier is for SDK hooks, not the configured transport's RequestInit contract. */
  static forDispatch<T extends object>(request: T): T {
    Reflect.deleteProperty(request, requestCredentialCarrier);
    return request;
  }

  /** Observes data-valued request headers without invoking caller-owned accessors. */
  static requestHeaderData(request: object): object | undefined {
    return WorkloadTokenProvenance.requestHeaderDataState(request)?.value;
  }

  /** Distinguishes a definite missing header input from an unreadable accessor. */
  static requestHeaderDataState(request: object): { value: object | undefined } | undefined {
    try {
      const seen = new Set<object>();
      for (let source: object | null = request; source; source = Object.getPrototypeOf(source)) {
        if (seen.has(source)) {
          break;
        }
        seen.add(source);
        const descriptor = Object.getOwnPropertyDescriptor(source, 'headers');
        if (!descriptor) {
          continue;
        }
        if (!('value' in descriptor)) {
          return undefined;
        }
        const value: unknown = descriptor.value;
        return { value: typeof value === 'object' && value !== null ? value : undefined };
      }
      return { value: undefined };
    } catch {
      // Opaque request representations retain their normal reads at dispatch.
    }
    return undefined;
  }

  /** Reads only this client's opaque SDK request carrier, without evaluating caller accessors. */
  requestCarrier(request: object): object | undefined {
    try {
      const carrier = Object.getOwnPropertyDescriptor(request, requestCredentialCarrier)?.value;
      return typeof carrier === 'object' && carrier !== null && this.results.has(carrier)
        ? carrier
        : undefined;
    } catch {
      // A caller membrane may expose public request fields without exposing private SDK metadata.
      return undefined;
    }
  }

  /** Marks the concrete authentication result issued by this client. */
  issue(headers: { values: Headers }, token: string, credential?: HeaderCredential): WorkloadCredentialUsage {
    let issued = credential ?? { owner: this, token, revoked: false };
    rememberWorkloadHeaderCredential(headers, issued, headers.values);
    rememberWorkloadHeaderValues(headers.values, issued);
    return {
      isCurrent: () => !issued.revoked,
      revoke: () => {
        issued.revoked = true;
      },
      adopt: (values) => {
        issued = { ...issued };
        rememberWorkloadHeaderValues(values, issued);
      },
    };
  }

  /** Preserves marked results and immediate native copies within their own authentication scope. */
  recover(
    headers: NullableHeaders | undefined,
    options: object,
    context: object | undefined,
  ): NullableHeaders | undefined {
    if (!headers) {
      return headers;
    }
    const { values } = headers;
    const outerCredential = workloadHeaderCredential(headers);
    const valueCredential = workloadHeaderCredential(values);
    let credential = valueCredential === undefined ? outerCredential : valueCredential;
    const platformHeader = hasNativeHeadersBrand(values)
      ? getPlatformHeader(values, 'authorization')
      : undefined;
    // Authentication-hook results are still under SDK ownership here. Detect changed or deleted
    // bytes without wrapping their native mutators; later dispatch-hook copies remain caller-owned.
    credential = validateIssuedCredential(values, credential);
    let selected = headers;
    if (!platformHeader) {
      // Unknown iterators can be one-shot. The later merge must use the exact values read here.
      const snapshot = this.parseHeaders(values);
      selected = {
        ...headers,
        values: snapshot.values,
        nulls: new Set([...headers.nulls, ...snapshot.nulls]),
      };
      if (credential !== undefined) {
        credential = copyWorkloadHeaderCredential(credential);
        rememberWorkloadHeaderValues(selected.values, credential);
      }
    }
    if (credential === null) {
      rememberWorkloadHeaderCredential(selected, null, selected.values);
      this.scopeFor(options, context)?.revoke();
      return selected;
    }
    if (credential !== undefined) {
      rememberWorkloadHeaderCredential(selected, credential, selected.values);
      this.scopeFor(options, context)?.select(credential);
      return selected;
    }
    const scope = this.scopeFor(options, context);
    const recovered = scope?.recoverCopy(
      platformHeader ? platformHeader.value : selected.values.get('authorization'),
    );
    if (recovered) {
      // Native copies are ambiguous by contract. Recover only the last identity selected by this
      // request's hook; an earlier same-byte issuance must not revive a revoked selected result.
      this.issue(headers, recovered.token, recovered);
      if (selected !== headers) {
        const copied = copyWorkloadHeaderCredential(workloadHeaderCredential(values) ?? null);
        rememberWorkloadHeaderCredential(selected, copied, selected.values);
        rememberWorkloadHeaderValues(selected.values, copied);
        if (copied) {
          scope?.select(copied);
        }
      }
    }
    return selected;
  }

  /** Binds provenance to a completed SDK request result independently of caller options. */
  bindResult<T extends { req: { headers: Headers } }>(
    result: T,
    headers?: WorkloadHeaderSnapshots,
    context?: object,
  ): T {
    const credential = workloadHeaderCredential(result.req.headers);
    const carrier = {};
    const owner = context ? this.contexts.get(context)?.resultOwner : undefined;
    // An opaque, secret-free carrier survives ordinary object spread of SDK-owned requests.
    Object.defineProperty(result.req, requestCredentialCarrier, { value: carrier, enumerable: true });
    this.results.set(carrier, {
      credential: credential?.owner === this ? credential : null,
      ...(owner ? { owner } : {}),
      ...(headers ? { headers } : undefined),
    });
    return result;
  }

  ownsResult(result: { req: object }, context: object): boolean {
    const carrier = this.requestCarrier(result.req);
    const owner = this.contexts.get(context)?.resultOwner;
    return owner !== undefined && carrier !== undefined && this.results.get(carrier)?.owner === owner;
  }

  /** Transfers snapshots to retry bookkeeping without retaining them on a held request result. */
  takeHeaders(result: { req: object }): WorkloadHeaderSnapshots | undefined {
    const carrier = this.requestCarrier(result.req);
    if (carrier === undefined) {
      return undefined;
    }
    const state = this.results.get(carrier);
    const headers = state?.headers;
    if (state) {
      delete state.headers;
      delete state.owner;
    }
    return headers;
  }

  /** An explicitly replaced header capability is authoritative, including at dispatch. */
  matchesHeaderCredential(headers: object | undefined, authorization: string): boolean | undefined {
    const credential = headers && workloadHeaderCredential(headers);
    if (credential === undefined) {
      return undefined;
    }
    return (
      credential !== null && credential.owner === this && bearerToken(authorization) === credential.token
    );
  }

  private isStructuralRestoration(
    exactAuthorization: boolean,
    credential: WorkloadCredentialUsage,
    headers: object,
    observed: { value: string | null } | undefined,
  ): boolean {
    const mismatch = this.structuralMismatches.get(credential);
    return (
      exactAuthorization &&
      observed !== undefined &&
      mismatch?.source === headers &&
      mismatch.restorationDefinitive
    );
  }

  /** Keeps opaque sources unconsumed through hooks and defers their attribution to dispatch. */
  observeRequest(
    credential: WorkloadCredentialUsage | undefined,
    request: object,
    authorization: string | undefined,
    fallbackHeaders?: object,
    exactAuthorization = true,
  ): void {
    if (!credential || authorization === undefined) {
      return;
    }
    const state = WorkloadTokenProvenance.requestHeaderDataState(request);
    if (!state) {
      // Defer accessor reads without erasing an already observed source's ownership.
      return;
    }
    const headers = state.value ?? fallbackHeaders;
    if (!headers) {
      credential.revoke();
      return;
    }
    const priorStructuralMismatch = this.structuralMismatches.get(credential);
    if (priorStructuralMismatch?.restorationDefinitive && priorStructuralMismatch.source !== headers) {
      credential.revoke();
    }
    if (!this.matchesPreparedSource(credential, headers, authorization)) {
      credential.revoke();
    } else if (credential.isCurrent()) {
      const platform = getVerifiedPlatformHeader(headers, 'Authorization');
      if (platform) {
        if (matchesAuthorization(platform.value, authorization, exactAuthorization)) {
          this.adoptPreparedSource(credential, headers as Headers);
        } else {
          credential.revoke();
        }
      } else {
        // Structural records and arrays may expose ordinary-looking descriptors while still
        // performing stateful reads. Inspect only Authorization data descriptors here, then
        // attribute the complete source from the final dispatch snapshot.
        const observed = this.structuralHeader(headers as HeadersLike, 'Authorization');
        if (hasAuthorizationMismatch(observed, authorization, exactAuthorization)) {
          // A proxy can report an ordinary data descriptor while producing different bytes when
          // materialized. Keep this mismatch tentative until a later structural observation proves
          // restoration, or the final canonical snapshot confirms the independent value.
          this.structuralMismatches.set(credential, {
            source: headers,
            value: observed.value,
            restorationDefinitive: observed.restorationDefinitive !== false,
            exact: exactAuthorization,
          });
        } else if (this.isStructuralRestoration(exactAuthorization, credential, headers, observed)) {
          // Returning to the workload bytes after a definite structural mismatch must not restore
          // retry ownership for this attempt.
          credential.revoke();
        }
        this.pendingHeaders.set(credential, headers);
      }
    }
  }

  /** Copies of ordinary data inputs remain compatible; opaque copies require an owned capability. */
  matchesPreparedSource(
    credential: WorkloadCredentialUsage | undefined,
    headers: object | undefined,
    authorization: string,
    dispatchedAuthorization?: string | null,
  ): boolean {
    if (!credential) {
      return false;
    }
    const marked = this.matchesHeaderCredential(headers, authorization);
    if (marked === false) {
      return false;
    }
    const pending = this.pendingHeaders.get(credential);
    const structuralMismatch = this.structuralMismatches.get(credential);
    if (
      pending === headers &&
      structuralMismatch?.source === headers &&
      structuralMismatch?.restorationDefinitive
    ) {
      const current = this.structuralHeader(headers as HeadersLike, 'Authorization');
      if (
        (current && matchesAuthorization(current.value, authorization, structuralMismatch.exact)) ||
        (structuralMismatch.exact &&
          dispatchedAuthorization !== undefined &&
          dispatchedAuthorization !== authorization)
      ) {
        // A later materialized copy must not regain ownership after this terminal observation.
        credential.revoke();
        return false;
      }
    }
    if (pending === undefined || pending === headers || marked === true) {
      return true;
    }
    return (
      getVerifiedPlatformHeader(headers, 'Authorization') !== undefined &&
      this.matchesPreparedData(pending, authorization)
    );
  }

  private matchesPreparedData(source: object, authorization: string): boolean {
    if (!this.canPreserveHeaders(source as HeadersLike)) {
      return false;
    }
    try {
      const copies = new WeakMap<object, object>();
      const copyData = (value: object): object => {
        const previous = copies.get(value);
        if (previous) {
          return previous;
        }
        const copy: object = Array.isArray(value) ? [] : Object.create(null);
        copies.set(value, copy);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key of Reflect.ownKeys(descriptors)) {
          const descriptor: PropertyDescriptor = Reflect.get(descriptors, key);
          if (!('value' in descriptor) || typeof descriptor.value === 'function') {
            throw new TypeError('A prepared data copy cannot contain executable properties');
          }
          if (Array.isArray(descriptor.value)) {
            descriptor.value = copyData(descriptor.value);
          } else if (descriptor.value !== null && typeof descriptor.value === 'object') {
            throw new TypeError('A prepared data copy cannot contain opaque objects');
          }
        }
        return Object.defineProperties(copy, descriptors);
      };
      // Parse only captured data descriptors; caller getters and iterators remain hook-owned.
      return (
        bearerToken(this.parseHeaders(copyData(source) as HeadersLike).values.get('Authorization')) ===
        bearerToken(authorization)
      );
    } catch {
      return false;
    }
  }

  /** A concrete dispatch snapshot replaces its pending source for this attempt only. */
  adoptPreparedSource(credential: WorkloadCredentialUsage, headers: Headers): void {
    this.pendingHeaders.delete(credential);
    this.structuralMismatches.delete(credential);
    credential.adopt(headers);
  }

  /** Retains ownership without consuming hook-visible header getters or opaque iterables. */
  retainRequestCredential(
    request: object,
  ): { authorization: string; credential: WorkloadCredentialUsage } | undefined {
    const headers = WorkloadTokenProvenance.requestHeaderData(request);
    const headerCredential = headers && workloadHeaderCredential(headers);
    const carrier = this.requestCarrier(request);
    const selected =
      headerCredential === undefined ? carrier && this.results.get(carrier)?.credential : headerCredential;
    if (!selected || selected.revoked || selected.owner !== this) {
      return undefined;
    }
    let credential = selected;
    const platformHeader = getVerifiedPlatformHeader(headers, 'Authorization');
    if (platformHeader && bearerToken(platformHeader.value) !== credential.token) {
      return undefined;
    }
    if (platformHeader && headerCredential === undefined && headers) {
      rememberWorkloadHeaderValues(headers, credential);
    }
    if (credential.revoked) {
      return undefined;
    }
    return {
      authorization: `Bearer ${credential.token}`,
      credential: {
        isCurrent: () => !credential.revoked,
        revoke: () => {
          credential.revoked = true;
        },
        adopt: (values) => {
          credential = { ...credential };
          rememberWorkloadHeaderValues(values, credential);
        },
      },
    };
  }

  /** Starts an attempt with an opaque context that remains stable across delegating hook copies. */
  begin(options: object, context: object = {}, headers?: WorkloadHeaderSnapshots): TokenScope {
    const credentials = new Set<HeaderCredential>();
    const scopes = this.options.get(options) ?? new Set<TokenScope>();
    const consumedSources = new Set<object>();
    const sourceSubscriptions = new Map<object, () => void>();
    const recordConsumption = (source: object, owner: TokenScope) => {
      consumedSources.add(source);
      const owners = this.consumedHeaders.get(source) ?? new Set<TokenScope>();
      owners.add(owner);
      this.consumedHeaders.set(source, owners);
    };
    const observeSource = (source: HeadersLike, owner: TokenScope) => {
      if (!source || sourceSubscriptions.has(source)) {
        return;
      }
      const listeners = headerConsumptionListeners.get(source) ?? new Set<() => void>();
      const listener = () => recordConsumption(source, owner);
      listeners.add(listener);
      headerConsumptionListeners.set(source, listeners);
      sourceSubscriptions.set(source, () => {
        listeners.delete(listener);
        if (!listeners.size) {
          headerConsumptionListeners.delete(source);
        }
      });
    };
    let disposed = false;
    let authenticationRevoked = false;
    let selectedCredential: HeaderCredential | undefined;
    const scope: TokenScope = {
      context,
      resultOwner: {},
      headers,
      captureHeaders: (captured) => {
        if (disposed) {
          return;
        }
        scope.headers = captured;
        for (const snapshot of [captured.defaultHeaders, captured.requestHeaders]) {
          observeSource(snapshot.source, scope);
          if (!snapshot.initialized || !snapshot.source || snapshot.replayable) {
            continue;
          }
          recordConsumption(snapshot.source, scope);
        }
      },
      captureHeaderRead: (source, snapshot) => {
        if (disposed || !scope.headers) {
          return;
        }
        // Each canonical layer belongs to this synchronous hook invocation, never another source's merge.
        scope.headers.defaultHeaders.seed(source, snapshot);
        scope.headers.requestHeaders.seed(source, snapshot);
        scope.captureHeaders(scope.headers);
      },
      recordHeaderConsumption: (source) => {
        if (!disposed) {
          recordConsumption(source, scope);
        }
      },
      hasConsumedHeaders: (source) => source !== null && source !== undefined && consumedSources.has(source),
      record: (token) => {
        const credential = { owner: this, token, revoked: false };
        if (!disposed) {
          credentials.add(credential);
          selectedCredential = credential;
        }
        return credential;
      },
      select: (credential) => {
        if (!disposed && credential.owner === this) {
          credentials.add(credential);
          selectedCredential = credential;
        }
      },
      recoverCopy: (authorization) =>
        !selectedCredential?.revoked && selectedCredential?.token === bearerToken(authorization)
          ? selectedCredential
          : undefined,
      revoke: () => {
        authenticationRevoked = true;
        for (const credential of credentials) {
          credential.revoked = true;
        }
      },
      authenticationRevoked: () =>
        authenticationRevoked || [...credentials].some((credential) => credential.revoked),
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        credentials.clear();
        for (const release of sourceSubscriptions.values()) {
          release();
        }
        sourceSubscriptions.clear();
        selectedCredential = undefined;
        for (const source of consumedSources) {
          const owners = this.consumedHeaders.get(source);
          owners?.delete(scope);
          if (owners?.size === 0) {
            this.consumedHeaders.delete(source);
          }
        }
        consumedSources.clear();
        scope.headers = undefined;
        this.contexts.delete(scope.context);
        scopes.delete(scope);
        if (scopes.size === 0) {
          this.options.delete(options);
        }
      },
    };
    scopes.add(scope);
    this.options.set(options, scopes);
    this.contexts.set(scope.context, scope);
    if (headers) {
      scope.captureHeaders(headers);
    }
    return scope;
  }

  /** Resolves explicit ownership or the unambiguous original-options path used by legacy hooks. */
  scopeFor(options: object, context?: object): TokenScope | undefined {
    if (context !== undefined) {
      return this.contexts.get(context);
    }
    const scopes = this.options.get(options);
    return scopes?.size === 1 ? scopes.values().next().value : undefined;
  }
}
