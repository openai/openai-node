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
}

const headerCredentials = new WeakMap<object, HeaderCredential | null>();
const requestCredentialCarrier = Symbol('workload.requestCredentialCarrier');

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
  record: (token: string) => void;
  matches: (authorization: string) => boolean;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
  private readonly contexts = new WeakMap<object, TokenScope>();
  private readonly options = new WeakMap<object, Set<TokenScope>>();
  private readonly consumedHeaders = new WeakMap<object, Set<TokenScope>>();
  private readonly headerSources = new WeakMap<object, Set<TokenScope>>();
  private readonly results = new WeakMap<object, string | null>();
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
  bindResult<T extends { req: { headers: Headers } }>(result: T): T {
    const credential = workloadHeaderCredential(result.req.headers);
    const carrier = {};
    // An opaque, secret-free carrier survives ordinary object spread of SDK-owned requests.
    Object.defineProperty(result.req, requestCredentialCarrier, { value: carrier, enumerable: true });
    this.results.set(carrier, credential?.owner === this ? credential.token : null);
    return result;
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
    const headerMatch = this.matchesHeaderCredential(result.req.headers, authorization);
    if (headerMatch !== undefined) {
      return headerMatch;
    }
    const carrier = Object.getOwnPropertyDescriptor(result.req, requestCredentialCarrier)?.value;
    if (typeof carrier === 'object' && carrier !== null) {
      const token = this.results.get(carrier);
      return token !== undefined && token !== null && bearerToken(authorization) === token;
    }
    return scope?.matches(authorization) ?? false;
  }

  /** Starts an attempt with an opaque context that remains stable across delegating hook copies. */
  begin(options: object, context: object = {}, headers?: WorkloadHeaderSnapshots): TokenScope {
    const tokens = new Set<string>();
    const scopes = this.options.get(options) ?? new Set<TokenScope>();
    const consumedSources = new Set<object>();
    const headerSourceScopes: { source: object; scopes: Set<TokenScope> }[] = [];
    let disposed = false;
    const scope: TokenScope = {
      context,
      headers,
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
        for (const entry of headerSourceScopes) {
          entry.scopes.delete(scope);
          if (entry.scopes.size === 0) {
            this.headerSources.delete(entry.source);
          }
        }
      },
    };
    scopes.add(scope);
    this.options.set(options, scopes);
    this.contexts.set(scope.context, scope);
    for (const snapshot of [headers?.defaultHeaders, headers?.requestHeaders]) {
      if (!snapshot?.source || snapshot.replayable) {
        continue;
      }
      consumedSources.add(snapshot.source);
      const owners = this.consumedHeaders.get(snapshot.source) ?? new Set<TokenScope>();
      owners.add(scope);
      this.consumedHeaders.set(snapshot.source, owners);
    }
    for (const source of new Set([headers?.requestHeaders.source, headers?.defaultHeaders.source])) {
      if (typeof source !== 'object' || source === null) {
        continue;
      }
      const sourceScopes = this.headerSources.get(source) ?? new Set<TokenScope>();
      sourceScopes.add(scope);
      this.headerSources.set(source, sourceScopes);
      headerSourceScopes.push({ source, scopes: sourceScopes });
    }
    return scope;
  }

  /** Recovers an unambiguous request from the original header-layer identities copied by legacy hooks. */
  scopeForHeaderSources(...sources: unknown[]): TokenScope | undefined {
    let candidates: Set<TokenScope> | undefined;
    for (const source of sources) {
      if (typeof source !== 'object' || source === null) {
        continue;
      }
      const scopes = this.headerSources.get(source);
      if (!scopes) {
        return undefined;
      }
      if (candidates) {
        for (const candidate of candidates) {
          if (!scopes.has(candidate)) {
            candidates.delete(candidate);
          }
        }
      } else {
        candidates = new Set(scopes);
      }
    }
    return candidates?.size === 1 ? candidates.values().next().value : undefined;
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
