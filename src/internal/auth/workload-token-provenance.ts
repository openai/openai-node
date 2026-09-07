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
}

const headerCredentials = new WeakMap<object, HeaderCredential | null>();
const requestCredentialCarrier = Symbol('workload.requestCredentialCarrier');
const headerConsumptionListeners = new WeakMap<object, Set<() => void>>();

/** Active requests observe consumption, never another request's serialized header values. */
export function observesWorkloadHeaderConsumption(source: object): boolean {
  return headerConsumptionListeners.has(source);
}

/** Records a completed canonical parse of a source that cannot safely be consumed again. */
export function notifyWorkloadHeaderConsumption(source: object): void {
  for (const listener of headerConsumptionListeners.get(source) ?? []) {
    listener();
  }
}

/** Reads the credential capability attached to an SDK-produced header layer. */
export function workloadHeaderCredential(headers: object): HeaderCredential | null | undefined {
  return headerCredentials.get(headers);
}

/** Carries the capability belonging to the last layer that supplied Authorization. */
export function rememberWorkloadHeaderCredential(headers: object, credential: HeaderCredential | null): void {
  headerCredentials.set(headers, credential);
}

interface TokenScope {
  context: object;
  headers: WorkloadHeaderSnapshots | undefined;
  captureHeaders: (headers: WorkloadHeaderSnapshots) => void;
  captureHeaderRead: (source: HeadersLike, snapshot: NullableHeaders) => void;
  recordHeaderConsumption: (source: object) => void;
  hasConsumedHeaders: (source: object | null | undefined) => boolean;
  record: (token: string) => void;
  matches: (authorization: string) => boolean;
  snapshot: () => Pick<TokenScope, 'matches'>;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
  private readonly contexts = new WeakMap<object, TokenScope>();
  private readonly options = new WeakMap<object, Set<TokenScope>>();
  private readonly consumedHeaders = new WeakMap<object, Set<TokenScope>>();
  private readonly results = new WeakMap<
    object,
    { token: string | null; headers?: WorkloadHeaderSnapshots }
  >();
  private invocation: TokenScope | undefined;

  /** Owns synchronous hook entry only; the scope is never left ambient across an await. */
  invoke<T>(options: object, context: object | undefined, operation: () => T): T {
    const previous = this.invocation;
    this.invocation = this.scopeFor(options, context);
    try {
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
    if (!headers || workloadHeaderCredential(headers) !== undefined) {
      return;
    }
    const credential = workloadHeaderCredential(headers.values);
    if (credential !== undefined) {
      rememberWorkloadHeaderCredential(headers, credential);
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
      token: credential?.owner === this ? credential.token : null,
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
      credential !== null && credential.owner === this && bearerToken(authorization) === credential.token
    );
  }

  /** Checks result-owned provenance before using explicit-context recovery for rebuilt results. */
  matchesResult(
    result: { req: { headers: Headers } },
    authorization: string,
    scope: Pick<TokenScope, 'matches'> | undefined,
  ): boolean {
    const headerMatch = this.matchesHeaderCredential(result.req.headers, authorization);
    if (headerMatch !== undefined) {
      return headerMatch;
    }
    const carrier = Object.getOwnPropertyDescriptor(result.req, requestCredentialCarrier)?.value;
    if (typeof carrier === 'object' && carrier !== null) {
      const token = this.results.get(carrier)?.token;
      return token !== undefined && token !== null && bearerToken(authorization) === token;
    }
    return scope?.matches(authorization) ?? false;
  }

  /** Starts an attempt with an opaque context that remains stable across delegating hook copies. */
  begin(options: object, context: object = {}, headers?: WorkloadHeaderSnapshots): TokenScope {
    const tokens = new Set<string>();
    const scopes = this.options.get(options) ?? new Set<TokenScope>();
    const consumedSources = new Set<object>();
    const releaseSnapshots = new Set<() => void>();
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
    const detachSnapshots = () => {
      for (const release of releaseSnapshots) {
        release();
      }
      releaseSnapshots.clear();
    };
    let disposed = false;
    const scope: TokenScope = {
      context,
      headers,
      captureHeaders: (captured) => {
        if (disposed) {
          return;
        }
        detachSnapshots();
        scope.headers = captured;
        for (const snapshot of [captured.defaultHeaders, captured.requestHeaders]) {
          observeSource(snapshot.source, scope);
          releaseSnapshots.add(
            snapshot.onMaterialize(() => {
              observeSource(snapshot.source, scope);
              if (!snapshot.source || snapshot.replayable) {
                return;
              }
              recordConsumption(snapshot.source, scope);
            }),
          );
        }
      },
      captureHeaderRead: (source, snapshot) => {
        if (disposed) {
          return;
        }
        // Canonical hook reads must establish ownership before a synchronous nested build can start.
        scope.headers?.defaultHeaders.seed(source, snapshot);
        scope.headers?.requestHeaders.seed(source, snapshot);
      },
      recordHeaderConsumption: (source) => {
        if (!disposed) {
          recordConsumption(source, scope);
        }
      },
      hasConsumedHeaders: (source) => source !== null && source !== undefined && consumedSources.has(source),
      record: (token) => {
        if (!disposed) {
          tokens.add(token);
        }
      },
      matches: (authorization) => {
        const token = bearerToken(authorization);
        return token !== undefined && tokens.has(token);
      },
      snapshot: () => {
        // Retain completed-build evidence without extending active hook or header-source ownership.
        const issued = new Set(tokens);
        return {
          matches: (authorization) => {
            const token = bearerToken(authorization);
            return token !== undefined && issued.has(token);
          },
        };
      },
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        tokens.clear();
        detachSnapshots();
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
