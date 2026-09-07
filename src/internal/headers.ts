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
    if (descriptor && Array.isArray(prototype)) {
      // Array.prototype is itself an array, including in another realm. Match
      // the captured function without evaluating an intervening iterator getter.
      if (typeof descriptor.value !== 'function') {
        prototype = Object.getPrototypeOf(prototype);
        continue;
      }
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      if (
        typeof constructor !== 'function' ||
        Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value !== prototype
      ) {
        prototype = Object.getPrototypeOf(prototype);
        continue;
      }
      if (platformIterator) return undefined;
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
  }
  return undefined;
};

interface HeaderReplay {
  refreshable: boolean;
  unverifiedHeaders?: boolean;
  iterator?: () => Iterator<HeaderEntry>;
  iterations?: WeakSet<object>;
  snapshot?: NullableHeaders;
}

const hasNativeHeadersBrand = (headers: object): boolean => {
  try {
    Headers.prototype.has.call(headers, 'authorization');
    return true;
  } catch {
    return false;
  }
};

const hasIndexedAccessor = (values: readonly unknown[]) => {
  for (let index = 0; index < values.length; index += 1) {
    let owner: object | null = values;
    let descriptor: PropertyDescriptor | undefined;
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, String(index));
      owner = Object.getPrototypeOf(owner);
    }
    if (descriptor && !('value' in descriptor)) return true;
  }
  return false;
};

function* iterateHeaders(
  headers: HeadersLike,
  replay?: HeaderReplay,
  provenance?: { unknown: boolean },
): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    if (provenance) provenance.unknown = true;
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
  const hasIterator = replay?.iterator !== undefined || Symbol.iterator in headers;
  const iterator: (() => Iterator<HeaderEntry>) | undefined =
    replay?.iterator ?? (hasIterator ? Reflect.get(headers, Symbol.iterator) : undefined);
  const nativeHeadersIterator =
    (replay || provenance) && typeof iterator === 'function' && !Array.isArray(headers)
      ? getHeadersIterator(headers)
      : undefined;
  if (provenance) {
    provenance.unknown = typeof iterator === 'function' && iterator === nativeHeadersIterator;
  }
  if (replay) {
    replay.unverifiedHeaders =
      nativeHeadersIterator !== undefined &&
      iterator === nativeHeadersIterator &&
      !hasNativeHeadersBrand(headers);
    // Custom iterators may be one-shot whether inherited or owned. Platform Headers
    // are reusable across realms, where instanceof cannot identify them.
    replay.refreshable =
      !hasIterator ||
      (typeof iterator === 'function' &&
        ((Array.isArray(headers) && iterator === getArrayIterator(headers) && !hasIndexedAccessor(headers)) ||
          (!Array.isArray(headers) && iterator === nativeHeadersIterator)));
  }
  if (typeof iterator === 'function') {
    const iteration = iterator.call(headers);
    if (replay?.refreshable) {
      replay.iterator = iterator;
      replay.iterations ??= new WeakSet<object>();
      if (replay.iterations.has(iteration)) {
        // Headers-shaped custom sources can return a consumed iterator despite matching descriptors.
        replay.refreshable = false;
        yield* iterateHeaders(replay.snapshot, undefined, provenance);
        return;
      }
      replay.iterations.add(iteration);
    }
    iter = { [Symbol.iterator]: () => iteration };
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
    if (replay && Array.isArray(row) && hasIndexedAccessor(row)) replay.refreshable = false;
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const rawValues = row[1];
    let values: Iterable<HeaderValue>;
    if (isReadonlyArray(rawValues)) {
      const headerValues = rawValues as readonly HeaderValue[];
      const iterator = headerValues[Symbol.iterator];
      if (
        replay &&
        (typeof iterator !== 'function' ||
          iterator !== getArrayIterator(headerValues) ||
          hasIndexedAccessor(headerValues))
      ) {
        replay.refreshable = false;
      }
      values =
        typeof iterator === 'function'
          ? { [Symbol.iterator]: () => iterator.call(headerValues) }
          : headerValues;
    } else {
      values = [rawValues];
    }
    let didClear = false;
    for (const value of values) {
      if (
        replay &&
        nativeHeadersIterator !== undefined &&
        iterator === nativeHeadersIterator &&
        typeof value !== 'string'
      ) {
        // Platform Headers only yields strings; a nullable source is a custom one-shot candidate.
        replay.refreshable = false;
      }
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
  newHeaders: {
    source: HeadersLike;
    entries: Iterable<readonly [string, string | null]>;
    provenance: { unknown: boolean };
  }[],
): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  let credential: ReturnType<typeof workloadHeaderCredential>;
  let hasAuthorizationLayer = false;
  for (const { source, entries, provenance } of newHeaders) {
    const seenHeaders = new Set<string>();
    let suppliesAuthorization = false;
    for (const [name, value] of entries) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      if (lowerName === 'authorization') {
        suppliesAuthorization = true;
        const sourceCredential = source ? workloadHeaderCredential(source) : undefined;
        // Native copies lose metadata; raw record/tuple layers explicitly supply independent credentials.
        credential =
          sourceCredential !== undefined
            ? sourceCredential
            : provenance.unknown
              ? hasAuthorizationLayer
                ? null
                : undefined
              : null;
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
    hasAuthorizationLayer ||= suppliesAuthorization;
  }
  const result = { [brand_privateNullableHeaders]: true as const, values: targetHeaders, nulls: nullHeaders };
  if (credential !== undefined) {
    rememberWorkloadHeaderCredential(result, credential);
    rememberWorkloadHeaderCredential(targetHeaders, credential);
  }
  return result;
};

interface HeaderReadContext {
  captured: WeakMap<object, NullableHeaders>;
  preferred: WeakMap<object, NullableHeaders>;
}

let headerReadContext: HeaderReadContext | undefined;

/** Captures synchronous protected-hook reads without leaving request state ambient across an await. */
export function captureHeaderReads<T>(
  operation: () => T,
  preferred: { source: HeadersLike; snapshot: NullableHeaders }[] = [],
): { result: T; captured: WeakMap<object, NullableHeaders> } {
  const previous = headerReadContext;
  const context: HeaderReadContext = { captured: new WeakMap(), preferred: new WeakMap() };
  for (const { source, snapshot } of preferred) {
    if (typeof source === 'object' && source !== null) context.preferred.set(source, snapshot);
  }
  headerReadContext = context;
  try {
    return { result: operation(), captured: context.captured };
  } finally {
    headerReadContext = previous;
  }
}

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const result = mergeHeaderEntries(
    newHeaders.map((originalSource) => {
      const source =
        typeof originalSource === 'object' && originalSource !== null
          ? (headerReadContext?.preferred.get(originalSource) ?? originalSource)
          : originalSource;
      const provenance = { unknown: false };
      return { source, provenance, entries: iterateHeaders(source, undefined, provenance) };
    }),
  );
  if (newHeaders.length === 1) {
    const source = newHeaders[0];
    if (typeof source === 'object' && source !== null) headerReadContext?.captured.set(source, result);
  }
  return result;
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export interface HeaderSnapshot {
  readonly source: HeadersLike;
  readonly snapshot: NullableHeaders;
  readonly refreshable: boolean;
  readonly replayable: boolean;
  readonly initialized: boolean;
  refresh: (...sources: [] | [HeadersLike]) => NullableHeaders;
  seed: (source: HeadersLike, snapshot: NullableHeaders | undefined) => void;
  fork: () => HeaderSnapshot;
}

const createHeaderSnapshot = (
  initialSource: HeadersLike,
  initial?: { snapshot?: NullableHeaders; refreshable?: boolean; deferred?: boolean },
): HeaderSnapshot => {
  let source = initialSource;
  let replay: HeaderReplay = { refreshable: initial?.refreshable ?? true };
  let snapshot = initial?.snapshot;
  const initialize = () => {
    if (snapshot) return snapshot;
    const provenance = { unknown: false };
    snapshot = mergeHeaderEntries([
      { source, provenance, entries: iterateHeaders(source, replay, provenance) },
    ]);
    return snapshot;
  };
  if (!initial?.deferred) initialize();
  return {
    get source() {
      return source;
    },
    get snapshot() {
      return initialize();
    },
    get refreshable() {
      return replay.refreshable;
    },
    get initialized() {
      return snapshot !== undefined;
    },
    get replayable() {
      return replay.refreshable && !replay.unverifiedHeaders;
    },
    refresh: (...sources: [] | [HeadersLike]) => {
      const currentSource = sources.length === 0 ? source : sources[0];
      if (snapshot && currentSource === snapshot) return snapshot;
      if (!snapshot || currentSource !== source || replay.refreshable) {
        const priorSnapshot = snapshot;
        const nextReplay: HeaderReplay = {
          refreshable: true,
          ...(currentSource === source
            ? {
                iterator: replay.iterator,
                iterations: replay.iterations,
                ...(priorSnapshot ? { snapshot: priorSnapshot } : {}),
              }
            : undefined),
        };
        const nextProvenance = { unknown: false };
        const nextSnapshot = mergeHeaderEntries([
          {
            source: currentSource,
            provenance: nextProvenance,
            entries: iterateHeaders(currentSource, nextReplay, nextProvenance),
          },
        ]);
        if (
          currentSource === source &&
          nextReplay.unverifiedHeaders &&
          priorSnapshot &&
          [...priorSnapshot.values.keys(), ...priorSnapshot.nulls].some(
            (name) => !nextSnapshot.values.has(name) && !nextSnapshot.nulls.has(name),
          )
        ) {
          // Missing foreign rows may come from a partially exhausted cursor, not an intentional deletion.
          replay.refreshable = false;
          return priorSnapshot;
        }
        source = currentSource;
        replay = nextReplay;
        snapshot = nextSnapshot;
      }
      return initialize();
    },
    seed: (currentSource, captured) => {
      if (!snapshot && currentSource === source && captured) {
        snapshot = captured;
        replay.refreshable = false;
      }
    },
    fork: () => createHeaderSnapshot(source, { snapshot: initialize(), refreshable: replay.refreshable }),
  };
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (initialSource: HeadersLike): HeaderSnapshot =>
  createHeaderSnapshot(initialSource);

/** Parsed header layers shared by preparation and automatic retries. */
export interface WorkloadHeaderSnapshots {
  requestHeaders: HeaderSnapshot;
  defaultHeaders: HeaderSnapshot;
}

/** Materializes each source once within one request, without sharing credentials between requests. */
export function createWorkloadHeaderSnapshots(
  request: HeadersLike,
  defaults: HeadersLike,
  {
    captured,
    deferRequest = false,
    deferDefault = false,
  }: {
    captured?: WeakMap<object, NullableHeaders>;
    deferRequest?: boolean;
    deferDefault?: boolean;
  } = {},
): WorkloadHeaderSnapshots {
  const capturedSnapshot = (source: HeadersLike) =>
    typeof source === 'object' && source !== null ? captured?.get(source) : undefined;
  const capturedDefault = capturedSnapshot(defaults);
  const defaultHeaders = createHeaderSnapshot(defaults, {
    ...(capturedDefault ? { snapshot: capturedDefault } : {}),
    refreshable: false,
    deferred: deferDefault && !capturedDefault,
  });
  const capturedRequest = capturedSnapshot(request);
  return {
    defaultHeaders,
    requestHeaders:
      request === defaults
        ? defaultHeaders.fork()
        : createHeaderSnapshot(request, {
            ...(capturedRequest ? { snapshot: capturedRequest } : {}),
            refreshable: false,
            deferred: deferRequest && !capturedRequest,
          }),
  };
}

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};

/** Extracts native and foreign Request headers without evaluating caller-controlled tag getters. */
export const getRequestHeaders = (request: unknown): Headers | undefined => {
  if (typeof request !== 'object' || request === null) return undefined;
  if (typeof Request !== 'undefined' && request instanceof Request) return request.headers;
  const seen = new Set<object>();
  for (
    let prototype = Object.getPrototypeOf(request);
    prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    if (
      typeof constructor === 'function' &&
      Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Request' &&
      Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
      Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Request'
    ) {
      return (request as Request).headers;
    }
  }
  return undefined;
};
