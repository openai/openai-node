import { isReadonlyArray } from './utils/values';

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
  let arrayPrototype: readonly unknown[] | undefined;
  let prototype: object | null = Object.getPrototypeOf(headers);
  const seen = new Set<object>();
  while (prototype) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    // Array.prototype is itself an array, including in another realm. Subclass
    // prototypes are ordinary objects; intermediate array instances do not win.
    if (Array.isArray(prototype)) arrayPrototype = prototype;
    prototype = Object.getPrototypeOf(prototype);
  }
  return arrayPrototype?.[Symbol.iterator];
};

const getHeadersIterator = (headers: object) => {
  const seen = new Set<object>();
  for (
    let prototype = Object.getPrototypeOf(headers);
    prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    if (
      typeof constructor === 'function' &&
      Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Headers' &&
      Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
      Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Headers'
    ) {
      const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator)?.value;
      const entries = Object.getOwnPropertyDescriptor(prototype, 'entries')?.value;
      if (typeof entries === 'function' && iterator === entries) return iterator;
    }
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
  const iterator: (() => Iterator<HeaderEntry>) | undefined =
    Symbol.iterator in headers ? headers[Symbol.iterator] : undefined;
  if (replay) {
    // Custom iterators may be one-shot whether inherited or owned. Platform Headers
    // are reusable across realms, where instanceof cannot identify them.
    replay.refreshable =
      typeof iterator !== 'function' ||
      (Array.isArray(headers) &&
        (iterator === Array.prototype[Symbol.iterator] || iterator === getArrayIterator(headers))) ||
      (!Array.isArray(headers) && iterator === getHeadersIterator(headers));
  }
  if (typeof iterator === 'function') {
    iter = { [Symbol.iterator]: () => iterator.call(headers) };
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

const mergeHeaderEntries = (newHeaders: Iterable<readonly [string, string | null]>[]): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  for (const headers of newHeaders) {
    const seenHeaders = new Set<string>();
    for (const [name, value] of headers) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
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
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders =>
  mergeHeaderEntries(newHeaders.map((headers) => iterateHeaders(headers)));

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (source: HeadersLike) => {
  const replay = { refreshable: true };
  const snapshot = mergeHeaderEntries([iterateHeaders(source, replay)]);
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
