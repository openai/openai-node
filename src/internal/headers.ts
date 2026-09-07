import { isReadonlyArray } from './utils/values';
import { rememberWorkloadHeaderCredential, workloadHeaderCredential } from './auth/workload-token-provenance';

type HeaderValue = string | undefined | null;
type HeaderEntry = readonly (HeaderValue | readonly HeaderValue[])[];
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

const getArrayIterator = (headers: readonly unknown[]) => {
  let platformIterator: (() => Iterator<HeaderEntry>) | undefined;
  let prototype: object | null = headers;
  const seen = new Set<object>();
  while (prototype) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
    if (descriptor) {
      // Array.prototype is itself an array, including in another realm. Any
      // earlier protocol descriptor is a caller override and may be one-shot.
      if (platformIterator || !Array.isArray(prototype) || typeof descriptor.value !== 'function') {
        return undefined;
      }
      platformIterator = descriptor.value as () => Iterator<HeaderEntry>;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return platformIterator;
};

const getHeadersIterator = (headers: object) => {
  const seen = new Set<object>();
  for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
    if (!iterator) continue;
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    const entries = Object.getOwnPropertyDescriptor(prototype, 'entries')?.value;
    if (
      typeof constructor === 'function' &&
      Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Headers' &&
      Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
      Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Headers' &&
      typeof iterator.value === 'function' &&
      iterator.value === entries
    ) {
      return iterator.value as () => Iterator<HeaderEntry>;
    }
    return undefined;
  }
  return undefined;
};

function* iterateHeaders(
  headers: HeadersLike,
  replay?: { refreshable: boolean },
): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<HeaderEntry>;
  // Snapshot the iterable protocol across realms without rereading a caller-controlled getter.
  const hasIterator = Symbol.iterator in headers;
  const iterator: (() => Iterator<HeaderEntry>) | undefined = hasIterator
    ? headers[Symbol.iterator]
    : undefined;
  if (replay) {
    // Custom iterators may be one-shot whether inherited or owned. Platform Headers
    // are reusable across realms, where instanceof cannot identify them.
    replay.refreshable =
      !hasIterator ||
      (typeof iterator === 'function' &&
        ((Array.isArray(headers) && iterator === getArrayIterator(headers)) ||
          (!Array.isArray(headers) && iterator === getHeadersIterator(headers))));
  }
  if (typeof iterator === 'function') {
    iter = { [Symbol.iterator]: () => iterator.call(headers) };
  } else {
    shouldClear = true;
    if (replay) {
      // Match Object.entries' eager descriptor/get order while recognizing one-shot accessors.
      const entries: HeaderEntry[] = [];
      for (const key of Reflect.ownKeys(headers)) {
        if (typeof key !== 'string') continue;
        const descriptor = Object.getOwnPropertyDescriptor(headers, key);
        if (!descriptor?.enumerable) continue;
        if (!('value' in descriptor)) replay.refreshable = false;
        entries.push([key, Reflect.get(headers, key)]);
      }
      iter = entries;
    } else {
      iter = Object.entries(headers);
    }
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

const mergeHeaderEntries = (
  newHeaders: { source: HeadersLike; entries: Iterable<readonly [string, string | null]> }[],
): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  let credential: ReturnType<typeof workloadHeaderCredential>;
  for (const { source, entries } of newHeaders) {
    const seenHeaders = new Set<string>();
    for (const [name, value] of entries) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      if (lowerName === 'authorization') {
        credential = source ? (workloadHeaderCredential(source) ?? null) : null;
      }
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(lowerName, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  const result = { [brand_privateNullableHeaders]: true as const, values: targetHeaders, nulls: nullHeaders };
  if (credential !== undefined) {
    rememberWorkloadHeaderCredential(result, credential);
    rememberWorkloadHeaderCredential(targetHeaders, credential);
  }
  return result;
};

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders =>
  mergeHeaderEntries(newHeaders.map((source) => ({ source, entries: iterateHeaders(source) })));

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (source: HeadersLike) => {
  const replay = { refreshable: true };
  const snapshot = mergeHeaderEntries([{ source, entries: iterateHeaders(source, replay) }]);
  return {
    source,
    snapshot,
    refresh: () => (replay.refreshable ? buildHeaders([source]) : snapshot),
  };
};

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};
