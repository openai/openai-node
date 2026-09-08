import { getHeadersPrototype, getPlatformHeader, hasNativeHeadersBrand } from '../platform-headers';
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
const observedHeaderMutations = new WeakSet<object>();
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

const mutateHeaders = (headers: Headers, mutation: (...args: string[]) => void, args: unknown[]): void => {
  let name: string | undefined;
  if (args.length > 0) {
    const [input] = args;
    if (typeof input === 'string') {
      name = input;
    } else {
      // Let the platform retain receiver validation, coercion order, and ByteString validation.
      args[0] = {
        [Symbol.toPrimitive]() {
          name = `${input}`;
          return name;
        },
      };
    }
  }
  Reflect.apply(mutation, headers, args);
  if (name?.toLowerCase() === 'authorization') {
    const credential = headerCredentials.get(headers);
    if (credential) {
      credential.revoked = true;
    }
  }
};

const observeHeaderMutations = (headers: Headers, credential: HeaderCredential): void => {
  if (observedHeaderMutations.has(headers)) {
    return;
  }
  let platform: object | undefined;
  try {
    Headers.prototype.has.call(headers, 'authorization');
    platform = Headers.prototype;
  } catch {
    try {
      platform = getHeadersPrototype(headers);
    } catch {
      credential.revoked = true;
    }
  }
  if (!platform) {
    credential.revoked = true;
    return;
  }
  try {
    const names = ['set', 'append', 'delete'] as const;
    const mutations = new Map<string, (...args: string[]) => void>();
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
        credential.revoked = true;
        return;
      }
      mutations.set(name, native);
    }
    if (
      !Object.isExtensible(headers) ||
      names.some((name) => Object.getOwnPropertyDescriptor(headers, name)?.configurable === false)
    ) {
      credential.revoked = true;
      return;
    }
    for (const [name, mutation] of mutations) {
      const observedMutation = function observedMutation(this: Headers, ...args: string[]) {
        mutateHeaders(this, mutation, args);
      };
      Object.defineProperties(observedMutation, {
        name: { value: name },
        length: { value: name === 'delete' ? 1 : 2 },
      });
      Object.defineProperty(headers, name, {
        configurable: true,
        writable: true,
        value: observedMutation,
      });
    }
    observedHeaderMutations.add(headers);
  } catch {
    credential.revoked = true;
  }
};

/** Reads the credential capability attached to an SDK-produced header layer. */
export function workloadHeaderCredential(headers: object): HeaderCredential | null | undefined {
  const source = headerValueSources.get(headers);
  let credential = headerCredentials.get(headers);
  if (source) {
    let values: unknown;
    try {
      values = Object.getOwnPropertyDescriptor(headers, 'values')?.value;
    } catch {
      return undefined;
    }
    if (typeof values !== 'object' || values === null) {
      return undefined;
    }
    const selected = headerCredentials.get(values);
    if (selected !== undefined || values !== source) {
      credential = selected;
    }
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

/** Native header values additionally own observable Authorization mutations. */
export function rememberWorkloadHeaderValues(headers: Headers, credential: HeaderCredential | null): void {
  headerCredentials.set(headers, credential);
  if (credential) {
    observeHeaderMutations(headers, credential);
  }
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
  credential: (authorization: string) => HeaderCredential | undefined;
  revoke: () => void;
  matches: (authorization: string) => boolean;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
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

  /** Reads only this client's opaque SDK request carrier, without evaluating caller accessors. */
  requestCarrier(request: object): object | undefined {
    const carrier = Object.getOwnPropertyDescriptor(request, requestCredentialCarrier)?.value;
    return typeof carrier === 'object' && carrier !== null && this.results.has(carrier) ? carrier : undefined;
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

  /** Recovers an unmarked rebuilt result only from its own active authentication invocation. */
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
    const credential = valueCredential === undefined ? outerCredential : valueCredential;
    if (credential === null) {
      this.scopeFor(options, context)?.revoke();
      return headers;
    }
    if (credential !== undefined) {
      rememberWorkloadHeaderCredential(headers, credential, values);
      this.scopeFor(options, context)?.select(credential);
      return headers;
    }
    const platformHeader = hasNativeHeadersBrand(values)
      ? getPlatformHeader(values, 'authorization')
      : undefined;
    // Recovery and the final header merge must consume the same serialized values.
    const recovered = platformHeader === undefined ? { ...headers, values: new Headers(values) } : headers;
    const authorization =
      platformHeader === undefined
        ? Headers.prototype.get.call(recovered.values, 'authorization')
        : platformHeader.value;
    const token = bearerToken(authorization);
    if (
      token !== undefined &&
      authorization !== null &&
      this.scopeFor(options, context)?.matches(authorization)
    ) {
      const usage = this.issue(headers, token, this.scopeFor(options, context)?.credential(authorization));
      if (recovered !== headers) {
        // Retain mutation eligibility from the original collection before adopting its serialized copy.
        usage.adopt(recovered.values);
        rememberWorkloadHeaderCredential(
          recovered,
          workloadHeaderCredential(recovered.values) ?? null,
          recovered.values,
        );
      }
    }
    return recovered;
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
    const carrier = Object.getOwnPropertyDescriptor(result.req, requestCredentialCarrier)?.value;
    if (typeof carrier !== 'object' || carrier === null) {
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

  /** Checks result-owned provenance before using explicit-context recovery for rebuilt results. */
  matchesResult(
    result: { req: { headers: Headers } },
    authorization: string,
    scope: TokenScope | undefined,
  ): boolean {
    return this.retainResultCredential(result, authorization, scope).isCurrent();
  }

  /** Keeps revocation effective after native copies lose their per-object metadata. */
  retainResultCredential(
    result: { req: { headers: Headers } },
    authorization: string,
    scope: TokenScope | undefined,
  ): WorkloadCredentialUsage {
    const headerMatch = this.matchesHeaderCredential(result.req.headers, authorization);
    let credential: HeaderCredential | null | undefined;
    if (headerMatch === undefined) {
      const carrier = Object.getOwnPropertyDescriptor(result.req, requestCredentialCarrier)?.value;
      credential =
        typeof carrier === 'object' && carrier !== null
          ? this.results.get(carrier)?.credential
          : scope?.credential(authorization);
    } else {
      credential = headerMatch ? workloadHeaderCredential(result.req.headers) : null;
    }
    if (credential && headerMatch === undefined) {
      rememberWorkloadHeaderValues(result.req.headers, credential);
    }
    return {
      isCurrent: () =>
        credential !== undefined &&
        credential !== null &&
        !credential.revoked &&
        credential.owner === this &&
        bearerToken(authorization) === credential.token,
      revoke: () => {
        if (credential) {
          credential.revoked = true;
        }
      },
      adopt: (headers) => {
        if (credential) {
          credential = { ...credential };
          rememberWorkloadHeaderValues(headers, credential);
        }
      },
    };
  }

  /** Starts an attempt with an opaque context that remains stable across delegating hook copies. */
  begin(options: object, context: object = {}, headers?: WorkloadHeaderSnapshots): TokenScope {
    const tokens = new Map<string, HeaderCredential>();
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
          tokens.set(token, credential);
        }
        return credential;
      },
      select: (credential) => {
        if (!disposed && credential.owner === this) {
          tokens.set(credential.token, credential);
        }
      },
      credential: (authorization) => {
        const token = bearerToken(authorization);
        const credential = token === undefined ? undefined : tokens.get(token);
        return credential?.revoked ? undefined : credential;
      },
      revoke: () => {
        for (const credential of tokens.values()) {
          credential.revoked = true;
        }
      },
      matches: (authorization) => scope.credential(authorization) !== undefined,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        tokens.clear();
        for (const release of sourceSubscriptions.values()) {
          release();
        }
        sourceSubscriptions.clear();
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
