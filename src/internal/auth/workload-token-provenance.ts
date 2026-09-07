import type { WorkloadHeaderSnapshots } from '../headers';

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
  invalidated?: boolean;
}

const headerCredentials = new WeakMap<object, HeaderCredential | null>();
const headerCredentialMarker = Symbol('workload.headerCredential');
const markedHeaderCredentials = new WeakMap<object, HeaderCredential | null>();
const observedHeaders = new WeakSet<Headers>();
const requestCredentialCarrier = Symbol('workload.requestCredentialCarrier');

/** Reads the credential capability attached to an SDK-produced header layer. */
export function workloadHeaderCredential(headers: object): HeaderCredential | null | undefined {
  const credential = headerCredentials.get(headers);
  if (credential !== undefined) {
    return credential;
  }
  try {
    const marker = Object.getOwnPropertyDescriptor(headers, headerCredentialMarker);
    return marker && typeof marker.value === 'object' && marker.value !== null
      ? markedHeaderCredentials.get(marker.value)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Gives a parsed copy independent mutation state while retaining its credential owner and bytes. */
export function copyWorkloadHeaderCredential(credential: HeaderCredential | null): HeaderCredential | null {
  return credential && { ...credential };
}

/** Carries the capability belonging to the last layer that supplied Authorization. */
export function rememberWorkloadHeaderCredential(headers: object, credential: HeaderCredential | null): void {
  headerCredentials.set(headers, credential);
  try {
    const marker = {};
    markedHeaderCredentials.set(marker, credential);
    Object.defineProperty(headers, headerCredentialMarker, {
      configurable: true,
      enumerable: true,
      value: marker,
    });
  } catch {
    // WeakMap ownership remains sufficient for non-extensible SDK-local objects.
  }
  if (credential && headers instanceof Headers && !observedHeaders.has(headers)) {
    observedHeaders.add(headers);
    for (const method of ['set', 'append', 'delete'] as const) {
      const mutate = Headers.prototype[method];
      Object.defineProperty(headers, method, {
        configurable: true,
        writable: true,
        value(this: Headers, ...args: [string, string?]) {
          const previous = Headers.prototype.get.call(this, 'Authorization');
          const result = Reflect.apply(mutate, this, args);
          if (typeof args[0] !== 'string' || args[0].toLowerCase() === 'authorization') {
            const current = Headers.prototype.get.call(this, 'Authorization');
            // A scheme-casing-only rewrite retains the credential; an explicit overwrite does not.
            if (method !== 'set' || previous === current || bearerToken(previous) !== bearerToken(current)) {
              const previousCredential = headerCredentials.get(this);
              if (previousCredential) {
                previousCredential.invalidated = true;
              }
              headerCredentials.set(this, null);
            }
          }
          return result;
        },
      });
    }
  }
}

interface TokenScope {
  context: object;
  headers: WorkloadHeaderSnapshots | undefined;
  captureHeaders: (headers: WorkloadHeaderSnapshots) => void;
  record: (token: string) => void;
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
    { credential: HeaderCredential | null; headers?: WorkloadHeaderSnapshots }
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
  issue(headers: { values: Headers }, token: string): void {
    const credential = { owner: this, token };
    rememberWorkloadHeaderCredential(headers, credential);
    rememberWorkloadHeaderCredential(headers.values, credential);
  }

  /** Recovers an unmarked rebuilt result only from its own active authentication invocation. */
  recover(headers: { values: Headers } | undefined, options: object, context: object | undefined): void {
    if (!headers) {
      return;
    }
    const credential = workloadHeaderCredential(headers.values);
    if (credential !== undefined) {
      rememberWorkloadHeaderCredential(headers, credential);
      return;
    }
    if (workloadHeaderCredential(headers) !== undefined) {
      return;
    }
    const authorization = headers.values.get('authorization');
    const token = bearerToken(authorization);
    if (
      token !== undefined &&
      authorization !== null &&
      this.scopeFor(options, context)?.matches(authorization)
    ) {
      this.issue(headers, token);
    }
  }

  /** Binds provenance to a completed SDK request result independently of caller options. */
  bindResult<T extends { req: { headers: Headers } }>(result: T, headers?: WorkloadHeaderSnapshots): T {
    const credential = workloadHeaderCredential(result.req.headers);
    const carrier = {};
    // An opaque, secret-free carrier survives ordinary object spread of SDK-owned requests.
    Object.defineProperty(result.req, requestCredentialCarrier, { value: carrier, enumerable: true });
    this.results.set(carrier, {
      credential: credential?.owner === this ? credential : null,
      ...(headers ? { headers } : undefined),
    });
    return result;
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
      credential !== null &&
      !credential.invalidated &&
      credential.owner === this &&
      bearerToken(authorization) === credential.token
    );
  }

  /** Checks result-owned provenance before using explicit-context recovery for rebuilt results. */
  matchesResult(
    result: { req: { headers: Headers } },
    authorization: string,
    scope: TokenScope | undefined,
  ): boolean {
    const headerMatch = this.matchesHeaderCredential(result.req.headers, authorization);
    if (headerMatch !== undefined) {
      return headerMatch;
    }
    const carrier = Object.getOwnPropertyDescriptor(result.req, requestCredentialCarrier)?.value;
    if (typeof carrier === 'object' && carrier !== null) {
      const credential = this.results.get(carrier)?.credential;
      return !!credential && !credential.invalidated && bearerToken(authorization) === credential.token;
    }
    return scope?.matches(authorization) ?? false;
  }

  /** Starts an attempt with an opaque context that remains stable across delegating hook copies. */
  begin(options: object, context: object = {}, headers?: WorkloadHeaderSnapshots): TokenScope {
    const tokens = new Set<string>();
    const scopes = this.options.get(options) ?? new Set<TokenScope>();
    const consumedSources = new Set<object>();
    let disposed = false;
    const scope: TokenScope = {
      context,
      headers,
      captureHeaders: (captured) => {
        if (disposed) {
          return;
        }
        scope.headers = captured;
        for (const snapshot of [captured.defaultHeaders, captured.requestHeaders]) {
          if (!snapshot.initialized || !snapshot.source || snapshot.replayable) {
            continue;
          }
          consumedSources.add(snapshot.source);
          const owners = this.consumedHeaders.get(snapshot.source) ?? new Set<TokenScope>();
          owners.add(scope);
          this.consumedHeaders.set(snapshot.source, owners);
        }
      },
      record: (token) => {
        if (!disposed) {
          tokens.add(token);
        }
      },
      matches: (authorization) => {
        const token = bearerToken(authorization);
        return token !== undefined && tokens.has(token);
      },
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        tokens.clear();
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
