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

const getArrayIterator = <T>(headers: readonly T[]) => {
  let platformIterator: (() => Iterator<T>) | undefined;
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
      platformIterator = descriptor.value as () => Iterator<T>;
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

interface HeaderPropertySnapshot {
  descriptor?: PropertyDescriptor | undefined;
  entry?: readonly [string, string | readonly string[] | null];
}

interface HeaderArraySlotSnapshot {
  descriptor: PropertyDescriptor;
  entry: HeaderEntry;
}

interface HeaderReplay {
  refreshable: boolean;
  unverifiedHeaders?: boolean;
  iterator?: () => Iterator<HeaderEntry>;
  iterations?: WeakSet<object>;
  snapshot?: NullableHeaders;
  record?: boolean;
  properties?: Map<string, HeaderPropertySnapshot>;
  propertyOrder?: string[];
  property?: HeaderPropertySnapshot;
  rows?: WeakMap<object, readonly (readonly [string, string | null])[]>;
  arraySlots?: Map<number, HeaderArraySlotSnapshot>;
}

const hasNativeHeadersBrand = (headers: object): boolean => {
  try {
    Headers.prototype.has.call(headers, 'authorization');
    return true;
  } catch {
    return false;
  }
};

/** Checks retryable hook inputs without invoking their iterable protocol or value getters. */
export const canReplayHeaderInput = (headers: HeadersLike, inputs = new Set<object>()): boolean => {
  if (!headers) return true;
  if (inputs.has(headers)) return false;
  inputs.add(headers);
  try {
    if (brand_privateNullableHeaders in headers) return true;
    let descriptor: PropertyDescriptor | undefined;
    const seen = new Set<object>();
    for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (seen.has(prototype)) return false;
      seen.add(prototype);
      descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (descriptor) break;
    }
    if (descriptor) {
      if (typeof descriptor.value !== 'function') return false;
      if (Array.isArray(headers)) {
        if (descriptor.value !== getArrayIterator(headers) || hasStatefulArrayProperties(headers))
          return false;
        const length = Object.getOwnPropertyDescriptor(headers, 'length')?.value;
        for (let index = 0; index < length; index += 1) {
          if (!Object.getOwnPropertyDescriptor(headers, String(index))) return false;
        }
      } else {
        return (
          descriptor.value === getHeadersIterator(headers) &&
          (hasNativeHeadersBrand(headers) || getPlatformHeader(headers, 'authorization') !== undefined)
        );
      }
    }
    return Object.entries(Object.getOwnPropertyDescriptors(headers)).every(([key, property]) => {
      if (Array.isArray(headers) ? !/^(0|[1-9]\d*)$/.test(key) : !property.enumerable) return true;
      if (!('value' in property)) return false;
      return Array.isArray(property.value)
        ? canReplayHeaderInput(property.value, inputs)
        : property.value === null ||
            (typeof property.value !== 'object' && typeof property.value !== 'function');
    });
  } catch {
    return false;
  } finally {
    inputs.delete(headers);
  }
};

const hasStatefulArrayProperties = (
  array: readonly unknown[],
  iterator?: () => Iterator<unknown>,
  capturedProtocol = false,
  retainIndexedAccessors = false,
): boolean => {
  const seen = new Set<object>();
  try {
    if (iterator !== undefined && iterator !== getArrayIterator(array)) return true;
    for (let object: object | null = array; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) return true;
      seen.add(object);
      for (const key of Reflect.ownKeys(object)) {
        if (capturedProtocol && key === Symbol.iterator) continue;
        if (key !== Symbol.iterator && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (
          descriptor &&
          !('value' in descriptor) &&
          !(retainIndexedAccessors && typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key))
        ) {
          return true;
        }
      }
    }
  } catch {
    // Uninspectable proxy descriptors do not make the actual value iteration invalid.
    return true;
  }
  return false;
};

const getArrayIndexDescriptor = (array: readonly unknown[], index: number) => {
  const seen = new Set<object>();
  for (let object: object | null = array; object; object = Object.getPrototypeOf(object)) {
    if (seen.has(object)) return undefined;
    seen.add(object);
    const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
    if (descriptor) return descriptor;
  }
  return undefined;
};

const isSameArraySlot = (
  retained: HeaderArraySlotSnapshot,
  descriptor: PropertyDescriptor | undefined,
): boolean => {
  if (!descriptor || 'value' in descriptor) return false;
  const previous = retained.descriptor;
  return (
    !('value' in previous) &&
    previous.get === descriptor.get &&
    previous.set === descriptor.set &&
    previous.enumerable === descriptor.enumerable &&
    previous.configurable === descriptor.configurable
  );
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
  const accessorProperties = new Set<string>();
  const propertyDescriptors = new Map<string, PropertyDescriptor>();
  // Snapshot the iterable protocol across realms without rereading a caller-controlled getter.
  const hasIterator = !replay?.record && (replay?.iterator !== undefined || Symbol.iterator in headers);
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
        ((Array.isArray(headers) &&
          iterator === getArrayIterator(headers) &&
          !hasStatefulArrayProperties(headers, iterator, true, true)) ||
          (!Array.isArray(headers) && iterator === nativeHeadersIterator)));
  }
  if (
    replay?.refreshable &&
    typeof iterator === 'function' &&
    Array.isArray(headers) &&
    iterator === getArrayIterator(headers)
  ) {
    replay.iterator = iterator;
    replay.arraySlots ??= new Map();
    const rows: HeaderEntry[] = [];
    for (let index = 0; index < headers.length; index += 1) {
      const descriptor = getArrayIndexDescriptor(headers, index);
      const retained = replay.arraySlots.get(index);
      if (retained && isSameArraySlot(retained, descriptor)) {
        rows.push(retained.entry);
        continue;
      }
      replay.arraySlots.delete(index);
      const row = Reflect.get(headers, String(index)) as HeaderEntry;
      if (descriptor && !('value' in descriptor)) {
        replay.arraySlots.set(index, { descriptor, entry: row });
      }
      rows.push(row);
    }
    iter = rows;
  } else if (typeof iterator === 'function') {
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
      replay.record = true;
      // Match Object.entries' eager descriptor/get order while recognizing one-shot accessors.
      let entries: HeaderEntry[] = [];
      replay.properties ??= new Map();
      for (const key of Reflect.ownKeys(headers)) {
        if (typeof key !== 'string') continue;
        const descriptor = Object.getOwnPropertyDescriptor(headers, key);
        if (!descriptor?.enumerable) continue;
        propertyDescriptors.set(key, descriptor);
        const previous = replay.properties.get(key)?.descriptor;
        if (
          previous &&
          ('value' in descriptor
            ? !('value' in previous) || descriptor.value !== previous.value
            : 'value' in previous || descriptor.get !== previous.get)
        ) {
          // A captured one-shot value belongs to its property, not a later replacement.
          replay.properties.delete(key);
        }
        if (!('value' in descriptor)) accessorProperties.add(key);
        entries.push([key, replay.properties.has(key) ? undefined : Reflect.get(headers, key)]);
      }
      // A getter may remove itself during its first read. Retain its position before surviving aliases.
      let nextKey: string | undefined;
      const present = new Set(entries.map((entry) => entry[0]));
      const missing = new Map<string | undefined, HeaderEntry[]>();
      for (const key of [...(replay.propertyOrder ?? [])].reverse()) {
        if (present.has(key)) {
          nextKey = key;
        } else if (replay.properties.has(key)) {
          const bucket = missing.get(nextKey) ?? [];
          bucket.push([key, undefined]);
          missing.set(nextKey, bucket);
        }
      }
      const ordered: HeaderEntry[] = [];
      for (const entry of entries) {
        for (const retained of missing.get(entry[0] as string)?.reverse() ?? []) ordered.push(retained);
        ordered.push(entry);
      }
      for (const retained of missing.get(undefined)?.reverse() ?? []) ordered.push(retained);
      entries = ordered;
      replay.propertyOrder = entries.map((entry) => entry[0] as string);
      iter = entries;
    } else {
      iter = Object.entries(headers);
    }
  }
  for (let row of iter) {
    const retainedRow = !shouldClear && replay?.rows?.get(row);
    if (retainedRow) {
      yield* retainedRow;
      continue;
    }
    const statefulRow = replay?.refreshable && !shouldClear && hasStatefulArrayProperties(row);
    const capturedRow: (readonly [string, string | null])[] | undefined = statefulRow ? [] : undefined;
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const retained = shouldClear ? replay?.properties?.get(name) : undefined;
    if (retained) {
      if (retained.entry) {
        yield [name, null];
        const value = retained.entry[1];
        if (isReadonlyArray(value)) {
          for (const item of value) yield [name, item];
        } else if (value !== null) {
          yield [name, value];
        }
      }
      continue;
    }
    const rowReplay = statefulRow
      ? { refreshable: false }
      : shouldClear && replay
        ? { refreshable: !accessorProperties.has(name) }
        : replay;
    const property: HeaderPropertySnapshot | undefined =
      shouldClear && replay ? { descriptor: propertyDescriptors.get(name) } : undefined;
    if (property && replay) replay.property = property;
    const headerValue = row[1];
    const values = isReadonlyArray(headerValue) ? headerValue : [headerValue];
    const statefulValues =
      rowReplay?.refreshable && isReadonlyArray(headerValue) && hasStatefulArrayProperties(values);
    const valueIterator = values[Symbol.iterator];
    if (
      rowReplay?.refreshable &&
      isReadonlyArray(headerValue) &&
      (statefulValues || hasStatefulArrayProperties(values, valueIterator))
    ) {
      rowReplay.refreshable = false;
    }
    let didClear = false;
    for (const value of { [Symbol.iterator]: () => Reflect.apply(valueIterator, values, []) }) {
      if (rowReplay && value !== null && (typeof value === 'object' || typeof value === 'function')) {
        rowReplay.refreshable = false;
      }
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
        capturedRow?.push([name, null]);
        yield [name, null];
      }
      const capturedValue = capturedRow && value !== null ? new Headers([[name, value]]).get(name)! : value;
      capturedRow?.push([name, capturedValue]);
      yield [name, capturedValue];
    }
    if (capturedRow && replay) {
      replay.rows ??= new WeakMap();
      replay.rows.set(row, capturedRow);
    }
    if (property && replay) {
      if (!rowReplay?.refreshable) replay.properties!.set(name, property);
      delete replay.property;
    }
  }
}

const mergeHeaderEntries = (
  newHeaders: {
    source: HeadersLike;
    entries: Iterable<readonly [string, string | null]>;
    provenance: { unknown: boolean };
    replay?: HeaderReplay;
  }[],
): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  let credential: ReturnType<typeof workloadHeaderCredential>;
  let hasAuthorizationLayer = false;
  for (const { source, entries, provenance, replay } of newHeaders) {
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
      if (replay?.property) {
        replay.property.entry = [
          name,
          value !== null && lowerName === 'set-cookie'
            ? [...targetHeaders.entries()].filter(([key]) => key === lowerName).map(([, entry]) => entry)
            : targetHeaders.get(lowerName),
        ];
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
  onCapture?: ((source: HeadersLike, snapshot: NullableHeaders) => void) | undefined;
  captured: WeakMap<object, NullableHeaders>;
  preferred: WeakMap<object, NullableHeaders>;
}

let headerReadContext: HeaderReadContext | undefined;
const capturedHeaderReplays = new WeakMap<NullableHeaders, { source: HeadersLike; replay: HeaderReplay }>();

const copyHeaderReplay = (replay: HeaderReplay): HeaderReplay => ({
  ...replay,
  ...(replay.properties ? { properties: new Map(replay.properties) } : {}),
  ...(replay.propertyOrder ? { propertyOrder: [...replay.propertyOrder] } : {}),
});

/** Captures synchronous protected-hook reads without leaving request state ambient across an await. */
export function captureHeaderReads<T>(
  operation: () => T,
  preferred: { source: HeadersLike; snapshot: NullableHeaders }[] = [],
  onCapture?: (source: HeadersLike, snapshot: NullableHeaders) => void,
): { result: T; captured: WeakMap<object, NullableHeaders> } {
  const previous = headerReadContext;
  const context: HeaderReadContext = { captured: new WeakMap(), preferred: new WeakMap(), onCapture };
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
  let capturedReplay: HeaderReplay | undefined;
  const result = mergeHeaderEntries(
    newHeaders.map((originalSource) => {
      const source =
        typeof originalSource === 'object' && originalSource !== null
          ? (headerReadContext?.preferred.get(originalSource) ?? originalSource)
          : originalSource;
      const provenance = { unknown: false };
      const replay =
        headerReadContext && newHeaders.length === 1 && source === originalSource
          ? { refreshable: true }
          : undefined;
      capturedReplay =
        replay ??
        (source && brand_privateNullableHeaders in source
          ? capturedHeaderReplays.get(source)?.replay
          : undefined);
      return {
        source,
        provenance,
        ...(replay ? { replay } : {}),
        entries: iterateHeaders(source, replay, provenance),
      };
    }),
  );
  if (newHeaders.length === 1) {
    const source = newHeaders[0];
    if (typeof source === 'object' && source !== null && headerReadContext) {
      headerReadContext.captured.set(source, result);
      if (capturedReplay)
        capturedHeaderReplays.set(result, { source, replay: copyHeaderReplay(capturedReplay) });
      headerReadContext.onCapture?.(source, result);
    }
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
  initial?: {
    snapshot?: NullableHeaders;
    refreshable?: boolean;
    deferred?: boolean;
    replay?: HeaderReplay;
    materialization?: { source: HeadersLike; snapshot?: NullableHeaders };
  },
): HeaderSnapshot => {
  let source = initialSource;
  // Forks share only their first materialization; source replacement and replay state stay layer-local.
  const materialization = initial?.materialization ?? { source: initialSource };
  const captured = initial?.snapshot ? capturedHeaderReplays.get(initial.snapshot) : undefined;
  let replay: HeaderReplay =
    initial?.replay ??
    (captured && captured.source === source
      ? copyHeaderReplay(captured.replay)
      : { refreshable: initial?.refreshable ?? true });
  let snapshot = initial?.snapshot;
  const inheritMaterialization = () => {
    if (!snapshot && source === materialization.source && materialization.snapshot) {
      snapshot = materialization.snapshot;
      const metadata = capturedHeaderReplays.get(snapshot);
      replay = metadata ? copyHeaderReplay(metadata.replay) : { refreshable: false };
    }
  };
  const rememberMaterialization = () => {
    if (snapshot && source === materialization.source && !materialization.snapshot) {
      materialization.snapshot = snapshot;
    }
  };
  const initialize = () => {
    inheritMaterialization();
    if (snapshot) return snapshot;
    const provenance = { unknown: false };
    snapshot = mergeHeaderEntries([
      { source, provenance, replay, entries: iterateHeaders(source, replay, provenance) },
    ]);
    capturedHeaderReplays.set(snapshot, { source, replay: copyHeaderReplay(replay) });
    rememberMaterialization();
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
      return (
        replay.refreshable &&
        !replay.unverifiedHeaders &&
        !replay.properties?.size &&
        !replay.rows &&
        !replay.arraySlots?.size
      );
    },
    refresh: (...sources: [] | [HeadersLike]) => {
      inheritMaterialization();
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
                record: replay.record,
                properties: replay.properties,
                propertyOrder: replay.propertyOrder,
                rows: replay.rows,
                arraySlots: replay.arraySlots,
              }
            : undefined),
        };
        const nextProvenance = { unknown: false };
        let nextSnapshot = mergeHeaderEntries([
          {
            source: currentSource,
            provenance: nextProvenance,
            replay: nextReplay,
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
          // Missing foreign rows are ambiguous, but newly observed rows remain authoritative.
          nextSnapshot = buildHeaders([priorSnapshot, nextSnapshot]);
        }
        source = currentSource;
        replay = nextReplay;
        snapshot = nextSnapshot;
        capturedHeaderReplays.set(snapshot, { source, replay: copyHeaderReplay(replay) });
        rememberMaterialization();
      }
      return initialize();
    },
    seed: (currentSource, captured) => {
      if (!snapshot && currentSource === source && captured) {
        snapshot = captured;
        const metadata = capturedHeaderReplays.get(captured);
        replay =
          metadata && metadata.source === source ? copyHeaderReplay(metadata.replay) : { refreshable: false };
        rememberMaterialization();
      }
    },
    fork: () =>
      createHeaderSnapshot(source, {
        ...(snapshot ? { snapshot } : {}),
        deferred: !snapshot,
        replay: copyHeaderReplay(replay),
        materialization,
      }),
  };
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (initialSource: HeadersLike): HeaderSnapshot =>
  createHeaderSnapshot(initialSource);

/** Parsed header layers shared by preparation and automatic retries. */
export interface WorkloadHeaderSnapshots {
  requestHeaders: ReturnType<typeof snapshotHeaders>;
  defaultHeaders: ReturnType<typeof snapshotHeaders>;
  customBuildInput?: { source: HeadersLike; replayable: boolean };
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

/** Reads platform collections without consuming the iterable later handed to custom fetch. */
export const getPlatformHeader = (
  headers: HeadersLike,
  name: string,
): { value: string | null } | undefined => {
  if (!headers) return undefined;
  const platformIterator = getHeadersIterator(headers);
  if (!platformIterator) return undefined;
  const seen = new Set<object>();
  let actualIterator: PropertyDescriptor | undefined;
  for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (seen.has(prototype)) return undefined;
    seen.add(prototype);
    actualIterator ??= Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
    if (actualIterator && actualIterator.value !== platformIterator) return undefined;
    if (Object.getOwnPropertyDescriptor(prototype, Symbol.iterator)?.value !== platformIterator) continue;
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    if (
      typeof constructor !== 'function' ||
      Object.getOwnPropertyDescriptor(constructor, 'name')?.value !== 'Headers' ||
      Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value !== prototype ||
      Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value !== 'Headers'
    )
      continue;
    const getter = Object.getOwnPropertyDescriptor(prototype, 'get')?.value;
    if (typeof getter === 'function') {
      return { value: Reflect.apply(getter, headers, [name]) };
    }
  }
  return undefined;
};

/** Reads Request internal headers through its defining getter, bypassing caller property shadows. */
export const getRequestHeaders = (request: unknown): Headers | undefined => {
  if (typeof request !== 'object' || request === null) return undefined;
  if (typeof Request !== 'undefined' && request instanceof Request) {
    return Object.getOwnPropertyDescriptor(Request.prototype, 'headers')?.get?.call(request);
  }
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
      return Object.getOwnPropertyDescriptor(prototype, 'headers')?.get?.call(request);
    }
  }
  return undefined;
};
