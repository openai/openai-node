import { getPlatformHeader, getVerifiedPlatformHeader } from '../platform-headers';
import type { NullableHeaders, WorkloadHeaderSnapshots } from '../headers';

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

const observeHeaderMutations = (headers: object, credential: HeaderCredential): void => {
  if (observedHeaderMutations.has(headers)) {
    return;
  }
  let platform: object | undefined;
  try {
    Headers.prototype.has.call(headers, 'authorization');
    platform = Headers.prototype;
  } catch {
    try {
      platform = getPlatformHeader(headers, 'authorization')?.prototype;
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
export function rememberWorkloadHeaderValues(headers: object, credential: HeaderCredential | null): void {
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
  record: (token: string) => HeaderCredential;
  select: (credential: HeaderCredential) => void;
  recoverCopy: (authorization: string | null) => HeaderCredential | undefined;
  revoke: () => void;
  dispose: () => void;
}

/** Owns authentication provenance for individual request attempts without retaining a token cache. */
export class WorkloadTokenProvenance {
  private readonly parseHeaders: (values: Headers) => NullableHeaders;

  /** Uses the canonical header parser while keeping its dependency on provenance acyclic. */
  constructor(parseHeaders: (values: Headers) => NullableHeaders) {
    this.parseHeaders = parseHeaders;
  }

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
        const value: unknown = 'value' in descriptor ? descriptor.value : undefined;
        return typeof value === 'object' && value !== null ? value : undefined;
      }
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
    const platformHeader = getPlatformHeader(values, 'authorization');
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
    let disposed = false;
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
        for (const credential of credentials) {
          credential.revoked = true;
        }
      },
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        credentials.clear();
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
