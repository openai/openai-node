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
  record: (token: string) => void;
  matches: (authorization: string) => boolean;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
  private readonly contexts = new WeakMap<object, TokenScope>();
  private readonly options = new WeakMap<object, Set<TokenScope>>();
  private readonly results = new WeakMap<object, string | null>();

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
  begin(options: object, context: object = {}): TokenScope {
    const tokens = new Set<string>();
    const scopes = this.options.get(options) ?? new Set<TokenScope>();
    let disposed = false;
    const scope: TokenScope = {
      context,
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
    return scope;
  }

  /** Resolves explicit ownership or the unambiguous original-options path used by legacy hooks. */
  scopeFor(options: object, context: object | undefined): TokenScope | undefined {
    if (context !== undefined) {
      return this.contexts.get(context);
    }
    const scopes = this.options.get(options);
    return scopes?.size === 1 ? scopes.values().next().value : undefined;
  }
}
