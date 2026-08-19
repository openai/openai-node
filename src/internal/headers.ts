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

  override entries = () => this.current().entries();

  override keys = () => this.current().keys();

  override values = () => this.current().values();

  override [Symbol.iterator] = () => this.entries();

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

/**
 * Creates an authenticated Azure header carrier without first appending a raw
 * credential to native Headers, where rejected values appear in diagnostics.
 */
export const buildAzureAuthenticationHeaders = (...headers: AzureAuthenticationValues): NullableHeaders => {
  const carrier: NullableHeaders = {
    [brand_privateNullableHeaders]: true,
    values: new DeferredAzureAuthenticationHeaders(),
    nulls: new Set<string>(),
  };
  azureAuthenticationHeaders.set(carrier, headers);
  azureAuthenticationHeaderCarriers.set(carrier.values, carrier);
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
    const azureHeaders = azureAuthenticationHeaders.get(headers);
    if (azureHeaders !== undefined) {
      let layers = azureAuthenticationHeaderSnapshots.get(headers);
      if (!layers) {
        layers = Object.freeze(azureHeaders.map((layer) => Object.freeze([...iterateHeaders(layer)])));
        azureAuthenticationHeaderSnapshots.set(headers, layers);
      }
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
