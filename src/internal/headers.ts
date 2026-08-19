import { assertAzureCredentialHeaderValue, isAzureAuthenticationHeader } from './azure';
import { isReadonlyArray } from './utils/values';

type HeaderValue = string | undefined | null;
export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');
const httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * @internal
 * Users can pass explicit nulls to unset default headers. When we parse them
 * into a standard headers type we need to preserve that information.
 */
export type NullableHeaders = {
  /** Brand check, prevent users from creating a NullableHeaders. */
  [brand_privateNullableHeaders]: true;
  /** Parsed headers. */
  values: Headers;
  /** Set of lowercase header names explicitly set to null. */
  nulls: Set<string>;
};

type AzureAuthenticationValues = ReadonlyArray<HeadersLike>;
type AzureAuthenticationLayer = ReadonlyArray<readonly [string, string | null]>;
type AzureAuthenticationHeaderMutation = {
  kind: 'append' | 'replace' | 'delete';
  values: string[];
};

// Object-identity branding cannot be forged by caller-provided header records.
const azureAuthenticationHeaders = new WeakMap<NullableHeaders, AzureAuthenticationValues>();
const azureAuthenticationHeaderCarriers = new WeakMap<Headers, NullableHeaders>();
const azureAuthenticationHeaderSnapshots = new WeakMap<
  NullableHeaders,
  ReadonlyArray<AzureAuthenticationLayer>
>();
const azureAuthenticationHeaderMutations = new WeakMap<
  Headers,
  Map<string, AzureAuthenticationHeaderMutation>
>();

const azureAuthenticationNullCarriers = new WeakMap<Set<string>, NullableHeaders>();

const snapshotAzureAuthenticationHeaders = (
  carrier: NullableHeaders,
): ReadonlyArray<AzureAuthenticationLayer> | undefined => {
  const headers = azureAuthenticationHeaders.get(carrier);
  if (headers === undefined) return undefined;

  let layers = azureAuthenticationHeaderSnapshots.get(carrier);
  if (!layers) {
    layers = Object.freeze(headers.map((layer) => Object.freeze([...iterateHeaders(layer)])));
    azureAuthenticationHeaderSnapshots.set(carrier, layers);
  }
  return layers;
};

class DeferredAzureAuthenticationHeaders extends Headers {
  constructor() {
    super();
    azureAuthenticationHeaderMutations.set(this, new Map());
  }

  override get = (name: string): string | null => {
    const normalized = String(name).toLowerCase();
    Headers.prototype.has.call(this, normalized);
    return this.current().get(normalized) ?? null;
  };

  override has = (name: string): boolean => {
    const normalized = String(name).toLowerCase();
    Headers.prototype.has.call(this, normalized);
    return this.current().has(normalized);
  };

  override entries = (): ReturnType<Headers['entries']> =>
    this.current().entries() as ReturnType<Headers['entries']>;

  override keys = (): ReturnType<Headers['keys']> => this.current().keys() as ReturnType<Headers['keys']>;

  override values = (): ReturnType<Headers['values']> =>
    this.current().values() as ReturnType<Headers['values']>;

  override [Symbol.iterator] = (): ReturnType<Headers[typeof Symbol.iterator]> => this.entries();

  override forEach = (
    callback: (value: string, key: string, parent: Headers) => void,
    thisArg?: unknown,
  ): void => {
    for (const [name, value] of this.entries()) {
      callback.call(thisArg, value, name, this);
    }
  };

  private current(): Map<string, string> {
    const carrier = azureAuthenticationHeaderCarriers.get(this);
    const source = carrier ? iterateHeaders(carrier) : Headers.prototype.entries.call(this);
    const effective = new Map<string, string>();
    for (const [name, value] of source) {
      const normalized = name.toLowerCase();
      if (value === null) {
        effective.delete(normalized);
        continue;
      }
      const previous = effective.get(normalized);
      effective.set(normalized, previous === undefined ? value : `${previous}, ${value}`);
    }
    return new Map([...effective].sort(([left], [right]) => Number(left > right) - Number(left < right)));
  }

  override append = (name: string, value: string): void => {
    this.update(name, value, 'append');
  };

  override set = (name: string, value: string): void => {
    this.update(name, value, 'replace');
  };

  override delete = (name: string): void => {
    const normalized = String(name).toLowerCase();
    Headers.prototype.delete.call(this, normalized);
    azureAuthenticationHeaderMutations.get(this)?.set(normalized, { kind: 'delete', values: [] });
  };

  private update(name: string, value: string, operation: 'append' | 'replace'): void {
    const normalized = String(name).toLowerCase();
    const authentication = isAzureAuthenticationHeader(normalized);
    const normalizedValue = authentication ? String(value) : value;
    let safe = true;

    if (authentication) {
      try {
        assertAzureCredentialHeaderValue(normalizedValue);
      } catch {
        safe = false;
      }
    }

    if (safe) {
      if (operation === 'append') {
        Headers.prototype.append.call(this, normalized, normalizedValue);
      } else {
        Headers.prototype.set.call(this, normalized, normalizedValue);
      }
    } else if (operation === 'replace') {
      Headers.prototype.delete.call(this, normalized);
    } else {
      Headers.prototype.has.call(this, normalized);
    }

    const mutations = azureAuthenticationHeaderMutations.get(this);
    if (!mutations) return;
    const previous = mutations.get(normalized);
    const kind =
      operation === 'replace' || previous?.kind === 'delete' || previous?.kind === 'replace'
        ? 'replace'
        : 'append';
    const previousValues = operation === 'replace' || previous?.kind === 'delete' ? [] : previous?.values;
    mutations.set(normalized, {
      kind,
      values: authentication ? [...(previousValues ?? []), normalizedValue] : [],
    });
  }
}

class DeferredAzureAuthenticationNulls extends Set<string> {
  private initialized = false;
  private readonly inherited = new Set<string>();

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const carrier = azureAuthenticationNullCarriers.get(this);
    if (!carrier) return;

    for (const layer of snapshotAzureAuthenticationHeaders(carrier) ?? []) {
      for (const [name, value] of layer) {
        const normalized = name.toLowerCase();
        if (value === null) {
          super.add(normalized);
          this.inherited.add(normalized);
        } else {
          super.delete(normalized);
          this.inherited.delete(normalized);
        }
      }
    }
  }

  override get size(): number {
    this.initialize();
    return super.size;
  }

  override has(value: string): boolean {
    this.initialize();
    return super.has(value);
  }

  override entries(): SetIterator<[string, string]> {
    this.initialize();
    return super.entries();
  }

  override keys(): SetIterator<string> {
    this.initialize();
    return super.keys();
  }

  override values(): SetIterator<string> {
    this.initialize();
    return super.values();
  }

  override [Symbol.iterator](): SetIterator<string> {
    this.initialize();
    return super[Symbol.iterator]();
  }

  override forEach(
    callback: (value: string, key: string, parent: Set<string>) => void,
    thisArg?: unknown,
  ): void {
    this.initialize();
    super.forEach(callback, thisArg);
  }

  override add(value: string): this {
    this.initialize();
    super.add(value);
    return this;
  }

  override delete(value: string): boolean {
    this.initialize();
    const removed = super.delete(value);
    if (removed && this.inherited.delete(value)) {
      azureAuthenticationNullCarriers.get(this)?.values.delete(value);
    }
    return removed;
  }

  override clear(): void {
    this.initialize();
    for (const value of [...super.values()]) {
      this.delete(value);
    }
  }
}

/**
 * Creates an authenticated Azure header carrier without first appending a raw
 * credential to native Headers, where rejected values appear in diagnostics.
 */
export const buildAzureAuthenticationHeaders = (...headers: AzureAuthenticationValues): NullableHeaders => {
  const carrier: NullableHeaders = {
    [brand_privateNullableHeaders]: true,
    values: new DeferredAzureAuthenticationHeaders(),
    nulls: new DeferredAzureAuthenticationNulls(),
  };
  azureAuthenticationHeaders.set(carrier, headers);
  azureAuthenticationHeaderCarriers.set(carrier.values, carrier);
  azureAuthenticationNullCarriers.set(carrier.nulls, carrier);
  return carrier;
};

function* iterateHeaders(headers: HeadersLike): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    const nullNames = new Set([...nulls].map((name) => name.toLowerCase()));
    const deferredValues = azureAuthenticationHeaderCarriers.has(values);
    const keys = deferredValues ? Headers.prototype.keys.call(values) : values.keys();
    const visibleNames = new Set([...keys, ...nullNames].map((name) => name.toLowerCase()));
    const mutations = azureAuthenticationHeaderMutations.get(values);
    const layers = snapshotAzureAuthenticationHeaders(headers);
    if (layers !== undefined) {
      for (const layer of layers) {
        const seen = new Set<string>();
        for (const [name, value] of layer) {
          const normalized = name.toLowerCase();
          const mutation = mutations?.get(normalized);
          if (
            nullNames.has(normalized) ||
            mutation?.kind === 'delete' ||
            mutation?.kind === 'replace' ||
            (visibleNames.has(normalized) && mutation?.kind !== 'append')
          ) {
            continue;
          }
          if (!seen.has(normalized)) {
            seen.add(normalized);
            yield [name, null];
          }
          yield [name, value];
        }
      }
    }
    const emitted = new Set<string>();
    const entries = deferredValues ? Headers.prototype.entries.call(values) : values.entries();
    for (const [name, value] of entries) {
      const normalized = name.toLowerCase();
      const mutation = mutations?.get(normalized);
      if (mutation && isAzureAuthenticationHeader(normalized)) {
        emitted.add(normalized);
        for (const pending of mutation.values) {
          yield [name, pending];
        }
      } else {
        yield [name, value];
      }
    }
    if (mutations) {
      for (const [name, mutation] of mutations) {
        if (!isAzureAuthenticationHeader(name) || emitted.has(name)) continue;
        for (const pending of mutation.values) {
          yield [name, pending];
        }
      }
    }
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<readonly (HeaderValue | readonly HeaderValue[])[]>;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === undefined) continue;

      // Objects keys always overwrite older headers, they never append.
      // Yield a null to clear the header before adding the new values.
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}

/** Validates only the final authentication values without native construction. */
export const assertAzureAuthenticationHeaders = (headers: HeadersLike): void => {
  for (const [name, value] of iterateHeaders(headers)) {
    if (value !== null && isAzureAuthenticationHeader(name)) {
      assertAzureCredentialHeaderValue(value);
    }
  }
};

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  const protectsAzureCredentials = newHeaders.some(
    (headers) =>
      typeof headers === 'object' &&
      headers !== null &&
      azureAuthenticationHeaders.has(headers as NullableHeaders),
  );
  const pendingAuthenticationHeaders = new Map<string, string[]>();

  for (const headers of newHeaders) {
    const seenHeaders = new Set<string>();
    for (const [name, value] of iterateHeaders(headers)) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      const deferAuthenticationHeader = protectsAzureCredentials && isAzureAuthenticationHeader(lowerName);
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        nullHeaders.add(lowerName);
      } else {
        if (deferAuthenticationHeader) {
          const pending = pendingAuthenticationHeaders.get(lowerName);
          if (pending) {
            pending.push(value);
          } else {
            pendingAuthenticationHeaders.set(lowerName, [value]);
          }
        } else {
          targetHeaders.append(lowerName, value);
        }
        nullHeaders.delete(lowerName);
      }
    }
  }
  for (const values of pendingAuthenticationHeaders.values()) {
    for (const value of values) {
      assertAzureCredentialHeaderValue(value);
    }
  }
  for (const [name, values] of pendingAuthenticationHeaders) {
    for (const value of values) {
      targetHeaders.append(name, value);
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};
