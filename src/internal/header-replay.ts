import { isReadonlyArray } from './utils/values';
import { getHeadersIterator } from './platform-headers';
import type { NullableHeaders } from './headers';

/** Values accepted by the canonical header parser, including explicit removal. */
export type HeaderValue = string | undefined | null;
type HeaderEntry = readonly (HeaderValue | readonly HeaderValue[])[];
/** Raw header sources whose occurrence history can be retained across attempts. */
export type HeaderSource =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>;

/** Canonical normalization and merged-value access, supplied by headers.ts for one parse. */
export interface HeaderReplayCallbacks {
  /** Normalizes one stateful value once before retaining it. */
  normalize: (name: string, value: string) => string;
  /** Reads a completed record property's normalized result before the next alias is merged. */
  capture: (name: string) => readonly [string, string | readonly string[] | null];
  /** Reuses the prior canonical snapshot when a source returns an already-consumed iterator. */
  previous: (snapshot: NullableHeaders | undefined) => Iterable<readonly [string, string | null]>;
  /** Reports whether the iterable protocol is a platform Headers implementation. */
  onIterator?: (native: boolean) => void;
}

/** Reads the defining array iterator without evaluating intervening accessors. */
export const getArrayIterator = <T>(headers: readonly T[]) => {
  try {
    let platformIterator: (() => Iterator<T>) | undefined;
    let prototype: object | null = headers;
    const seen = new Set<object>();
    while (prototype) {
      if (seen.has(prototype)) {
        return;
      }
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
        if (platformIterator) {
          return;
        }
        platformIterator = descriptor.value as () => Iterator<T>;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return platformIterator;
  } catch {
    // An opaque prototype chain does not identify a native array iterator.
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined satisfies noImplicitReturns for a fallible probe.
  return undefined;
};

interface HeaderPropertySnapshot {
  descriptor: PropertyDescriptor;
  entry?: readonly [string, string | readonly string[] | null];
  values?: HeaderValuesSnapshot;
}

interface HeaderSlotSnapshot<T = unknown> {
  descriptor: PropertyDescriptor | undefined;
  input: T;
}

interface HeaderValuesSnapshot {
  source: readonly HeaderValue[];
  iterator: () => Iterator<HeaderValue>;
  slots: Map<number, HeaderSlotSnapshot & { value: HeaderValue }>;
}

interface HeaderRowSnapshot {
  name: string;
  nameDescriptor: PropertyDescriptor | undefined;
  nameStateful: boolean;
  valueDescriptor: PropertyDescriptor | undefined;
  valueStateful: boolean;
  entries: readonly (readonly [string, string | null])[];
  values?: HeaderValuesSnapshot;
}

const sameHeaderProperty = (
  current: PropertyDescriptor | undefined,
  previous: PropertyDescriptor | undefined,
) => {
  if (!current || !previous) {
    return current === previous;
  }
  if ('value' in current) {
    return 'value' in previous && current.value === previous.value;
  }
  return !('value' in previous) && current.get === previous.get;
};

const getHeaderRowDescriptor = (row: object, key: string): PropertyDescriptor | undefined => {
  const seen = new Set<object>();
  try {
    for (let object: object | null = row; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) {
        return;
      }
      seen.add(object);
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) {
        return descriptor;
      }
    }
  } catch {
    // Preserve the first actual read when a proxy cannot expose its descriptor.
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined satisfies noImplicitReturns for a fallible probe.
  return undefined;
};

interface HeaderReplayState {
  refreshable: boolean;
  unverifiedHeaders?: boolean;
  iterator?: () => Iterator<HeaderEntry>;
  iterations?: WeakSet<object>;
  snapshot?: NullableHeaders;
  record?: boolean;
  properties?: Map<string, HeaderPropertySnapshot>;
  propertyOrder?: Map<string, PropertyDescriptor | undefined>;
  rows?: Map<HeaderEntry, Map<number, HeaderRowSnapshot>>;
  arraySlots?: Map<number, HeaderSlotSnapshot<HeaderEntry>>;
}

type HeaderOccurrenceCounts<T> = Map<T, { previous: number; current: number }>;

const duplicateHeaderOccurrences = <T>(previous: ReadonlyMap<T, number>): HeaderOccurrenceCounts<T> =>
  new Map(
    [...previous]
      .filter(([, count]) => count > 1)
      .map(([input, count]) => [input, { previous: count, current: 0 }]),
  );

const countHeaderOccurrences = <T>(
  headers: readonly T[],
  length: number,
  slots: ReadonlyMap<number, HeaderSlotSnapshot<T>> | undefined,
  duplicates: HeaderOccurrenceCounts<T>,
  accessors: HeaderOccurrenceCounts<() => unknown>,
): boolean => {
  let unreadable = false;
  // Removing a duplicate changes its ordinal. Count captured opaque slots without rereading getters.
  for (let index = 0; (duplicates.size || accessors.size) && index < length; index += 1) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const accessorCount = descriptor?.get && accessors.get(descriptor.get);
    if (accessorCount) {
      accessorCount.current += 1;
    }
    const retained = slots?.get(index);
    let input: T;
    if (retained && sameHeaderProperty(descriptor, retained.descriptor)) {
      ({ input } = retained);
    } else if (descriptor && 'value' in descriptor) {
      input = descriptor.value;
    } else {
      unreadable = true;
      continue;
    }
    const count = duplicates.get(input);
    if (count) {
      count.current += 1;
    }
  }
  return unreadable;
};

const invalidateHeaderSlots = <T>(
  headers: readonly T[],
  previous: ReadonlyMap<T, number>,
  slots: Map<number, HeaderSlotSnapshot<T>> | undefined,
): Set<T> => {
  const duplicates = duplicateHeaderOccurrences(previous);
  const length = getHeaderRowDescriptor(headers, 'length')?.value;
  if (typeof length !== 'number') {
    return new Set();
  }
  const previousAccessors = new Map<() => unknown, number>();
  for (const { descriptor } of slots?.values() ?? []) {
    if (descriptor?.get) {
      previousAccessors.set(descriptor.get, (previousAccessors.get(descriptor.get) ?? 0) + 1);
    }
  }
  const accessors = duplicateHeaderOccurrences(previousAccessors);
  const unreadable = countHeaderOccurrences(headers, length, slots, duplicates, accessors);
  const invalidated = new Set(
    [...duplicates]
      .filter(([, count]) => unreadable || count.current < count.previous)
      .map(([input]) => input),
  );
  for (const [index, slot] of slots ?? []) {
    const getter = slot.descriptor?.get;
    const count = getter && accessors.get(getter);
    if (count && count.current < count.previous) {
      slots?.delete(index);
      invalidated.add(slot.input);
    }
  }
  return invalidated;
};

function* iterateHeaderArray(
  headers: readonly HeaderEntry[],
  replay: HeaderReplayState,
): Generator<HeaderEntry> {
  const counts = new Map([...(replay.rows ?? [])].map(([row, occurrences]) => [row, occurrences.size]));
  for (const row of invalidateHeaderSlots(headers, counts, replay.arraySlots)) {
    replay.rows?.delete(row);
  }
  let index = 0;
  // Match native array iteration's live length, with each row validated before reading the next slot.
  for (; index < Math.min(Math.floor(headers.length), Number.MAX_SAFE_INTEGER); index += 1) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const retained = replay.arraySlots?.get(index);
    const observed = retained && sameHeaderProperty(descriptor, retained.descriptor);
    const row: HeaderEntry = observed ? retained.input : Reflect.get(headers, String(index));
    yield row;
    const current = getHeaderRowDescriptor(headers, String(index));
    if (
      observed ||
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.value !== row ||
      !sameHeaderProperty(current, descriptor)
    ) {
      replay.arraySlots ??= new Map();
      replay.arraySlots.set(index, { descriptor: current, input: row });
    } else {
      replay.arraySlots?.delete(index);
    }
  }
  for (const slot of replay.arraySlots?.keys() ?? []) {
    if (slot >= index) {
      replay.arraySlots?.delete(slot);
    }
  }
}

function* iterateHeaderValues(
  name: string,
  snapshot: HeaderValuesSnapshot,
  normalize: HeaderReplayCallbacks['normalize'],
): Generator<HeaderValue> {
  const { source, slots } = snapshot;
  const counts = new Map<unknown, number>();
  for (const { input } of slots.values()) {
    if (input !== null && (typeof input === 'object' || typeof input === 'function')) {
      counts.set(input, (counts.get(input) ?? 0) + 1);
    }
  }
  const invalidated = invalidateHeaderSlots(source, counts, slots);
  for (const [index, slot] of slots) {
    if (invalidated.has(slot.input)) {
      slots.delete(index);
    }
  }
  let index = 0;
  for (; index < Math.min(Math.floor(source.length), Number.MAX_SAFE_INTEGER); index += 1) {
    const descriptor = getHeaderRowDescriptor(source, String(index));
    const retained = slots.get(index);
    if (retained && sameHeaderProperty(descriptor, retained.descriptor)) {
      yield retained.value;
      continue;
    }
    slots.delete(index);
    const value = source[index];
    const needsCoercion = value !== null && (typeof value === 'object' || typeof value === 'function');
    const normalized = needsCoercion ? normalize(name, value) : value;
    if (!descriptor || !('value' in descriptor) || descriptor.value !== value || needsCoercion) {
      // A stateful read can replace its own slot. Retain the observed value until a later change.
      slots.set(index, {
        descriptor: getHeaderRowDescriptor(source, String(index)),
        input: value,
        value: normalized,
      });
    }
    yield normalized;
  }
  for (const slot of slots.keys()) {
    if (slot >= index) {
      slots.delete(slot);
    }
  }
}

/** Checks whether native Headers methods accept this receiver. */
export const hasNativeHeadersBrand = (headers: object): boolean => {
  try {
    Headers.prototype.has.call(headers, 'authorization');
    return true;
  } catch {
    return false;
  }
};

/** Detects stateful array slots without consuming their values. */
export const hasStatefulArrayProperties = (
  array: readonly unknown[],
  iterator?: () => Iterator<unknown>,
): boolean => {
  const seen = new Set<object>();
  try {
    if (iterator !== undefined && iterator !== getArrayIterator(array)) {
      return true;
    }
    for (let object: object | null = array; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) {
        return true;
      }
      seen.add(object);
      for (const key of Reflect.ownKeys(object)) {
        if (key !== Symbol.iterator && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key))) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (descriptor && !('value' in descriptor)) {
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

const captureHeaderProtocol = (
  headers: HeaderSource,
  callbacks: HeaderReplayCallbacks,
  replay?: HeaderReplayState,
) => {
  // Snapshot the iterable protocol without rereading a caller-controlled getter.
  const hasIterator = !replay?.record && (replay?.iterator !== undefined || Symbol.iterator in headers);
  const iterator: (() => Iterator<HeaderEntry>) | undefined =
    replay?.iterator ?? (hasIterator ? Reflect.get(headers, Symbol.iterator) : undefined);
  const nativeIterator =
    (replay || callbacks.onIterator) && typeof iterator === 'function' && !Array.isArray(headers)
      ? getHeadersIterator(headers)
      : undefined;
  const native = typeof iterator === 'function' && iterator === nativeIterator;
  callbacks.onIterator?.(native);
  if (replay) {
    replay.unverifiedHeaders = native && !hasNativeHeadersBrand(headers);
    // Custom iterators may be one-shot whether inherited or owned.
    replay.refreshable =
      !hasIterator ||
      (typeof iterator === 'function' &&
        (Array.isArray(headers) ? iterator === getArrayIterator(headers) : native));
  }
  return { iterator, native };
};

const captureRecordEntries = (
  headers: HeaderSource,
  replay: HeaderReplayState,
  descriptors: Map<string, PropertyDescriptor>,
): HeaderEntry[] => {
  replay.record = true;
  replay.properties ??= new Map();
  const entries: HeaderEntry[] = [];
  // Records read getters eagerly, matching Object.entries before any row is validated.
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key !== 'string') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    const retained = replay.properties.get(key);
    if (
      retained &&
      descriptor &&
      (!sameHeaderProperty(descriptor, retained.descriptor) ||
        descriptor.enumerable !== retained.descriptor.enumerable)
    ) {
      replay.properties.delete(key);
    }
    if (!descriptor?.enumerable) {
      continue;
    }
    descriptors.set(key, descriptor);
    entries.push([key, replay.properties.has(key) ? undefined : Reflect.get(headers, key)]);
  }
  return entries;
};

function* reversed<T>(values: readonly T[]): Generator<T> {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    yield Reflect.get(values, index);
  }
}

const orderRecordEntries = (
  entries: HeaderEntry[],
  replay: HeaderReplayState,
  descriptors: Map<string, PropertyDescriptor>,
): HeaderEntry[] => {
  const present = new Set(entries.map(([key]) => key));
  const liveAliases = new Map<string, string>();
  for (const [key] of entries) {
    const name = key as string;
    if (sameHeaderProperty(descriptors.get(name), replay.propertyOrder?.get(name))) {
      continue;
    }
    if (!liveAliases.has(name.toLowerCase())) {
      liveAliases.set(name.toLowerCase(), name);
    }
  }
  const missing = new Map<string | undefined, HeaderEntry[]>();
  let nextKey: string | undefined;
  for (const key of reversed([...(replay.propertyOrder?.keys() ?? [])])) {
    if (present.has(key)) {
      nextKey = key;
    } else if (replay.properties?.has(key)) {
      // New or changed aliases override captured accessors; unchanged aliases keep their order.
      const before = liveAliases.get(key.toLowerCase()) ?? nextKey;
      const bucket = missing.get(before) ?? [];
      bucket.push([key, undefined]);
      missing.set(before, bucket);
    }
  }
  const ordered: HeaderEntry[] = [];
  for (const entry of entries) {
    for (const retained of reversed(missing.get(entry[0] as string) ?? [])) {
      ordered.push(retained);
    }
    ordered.push(entry);
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Undefined identifies retained entries appended after all live keys.
  for (const retained of reversed(missing.get(undefined) ?? [])) {
    ordered.push(retained);
  }
  replay.propertyOrder = new Map(ordered.map(([key]) => [key as string, descriptors.get(key as string)]));
  return ordered;
};

const readRowName = (row: HeaderEntry, retained: HeaderRowSnapshot | undefined, track: boolean) => {
  const descriptor = track ? getHeaderRowDescriptor(row, '0') : undefined;
  const retain =
    retained?.nameStateful && (!descriptor || sameHeaderProperty(descriptor, retained.nameDescriptor));
  const name = retain ? retained.name : row[0];
  if (typeof name !== 'string') {
    throw new TypeError('expected header name to be a string');
  }
  return {
    name,
    nameDescriptor: retain ? retained.nameDescriptor : descriptor,
    nameStateful: !!retain || !descriptor || !('value' in descriptor),
  };
};

const readRow = (row: HeaderEntry, occurrence: number, clear: boolean, replay?: HeaderReplayState) => {
  const retainedRows = clear ? undefined : replay?.rows?.get(row);
  const retained = retainedRows?.get(occurrence);
  const track = !clear && !!(retained || replay?.refreshable);
  const name = readRowName(row, retained, track);
  return {
    row,
    occurrence,
    retainedRows,
    retained,
    track,
    ...name,
    valueDescriptor: track ? getHeaderRowDescriptor(row, '1') : undefined,
    captured: track ? ([] as (readonly [string, string | null])[]) : undefined,
  };
};
type RowRead = ReturnType<typeof readRow>;

function* renameEntries(
  name: string,
  entries: HeaderRowSnapshot['entries'],
): Generator<readonly [string, string | null]> {
  for (const [, value] of entries) {
    yield [name, value];
  }
}

const retainedRowEntries = (row: RowRead) => {
  const { retained, valueDescriptor, name, nameDescriptor, nameStateful } = row;
  if (
    !retained?.valueStateful ||
    retained.values ||
    (valueDescriptor && !sameHeaderProperty(valueDescriptor, retained.valueDescriptor))
  ) {
    return;
  }
  row.retainedRows?.set(row.occurrence, { ...retained, name, nameDescriptor, nameStateful });
  return renameEntries(name, retained.entries);
};

function* retainedPropertyEntries(
  name: string,
  property: HeaderPropertySnapshot,
): Generator<readonly [string, string | null]> {
  if (!property.entry) {
    return;
  }
  yield [name, null];
  const [, value] = property.entry;
  if (isReadonlyArray(value)) {
    for (const item of value) {
      yield [name, item];
    }
  } else if (value !== null) {
    yield [name, value];
  }
}

const rowRefreshState = (
  row: RowRead,
  descriptor: PropertyDescriptor | undefined,
  clear: boolean,
  replay?: HeaderReplayState,
) => {
  if (row.track) {
    return { refreshable: !!row.valueDescriptor && 'value' in row.valueDescriptor };
  }
  if (clear && replay) {
    return { refreshable: !descriptor || 'value' in descriptor };
  }
  return replay;
};

const retainedRowValues = (row: RowRead, property: HeaderPropertySnapshot | undefined) => {
  if (property?.values) {
    return property.values;
  }
  if (
    row.retained &&
    (!row.valueDescriptor || sameHeaderProperty(row.valueDescriptor, row.retained.valueDescriptor))
  ) {
    return row.retained.values;
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined satisfies noImplicitReturns when no value was retained.
  return undefined;
};

const readHeaderValues = (
  row: RowRead,
  retained: HeaderValuesSnapshot | undefined,
  refresh: { refreshable: boolean } | undefined,
  replay?: HeaderReplayState,
) => {
  const headerValue = retained?.source ?? row.row[1];
  const values = isReadonlyArray(headerValue) ? headerValue : [headerValue];
  const stateful = refresh?.refreshable && isReadonlyArray(headerValue) && hasStatefulArrayProperties(values);
  const iterator = retained?.iterator ?? values[Symbol.iterator];
  const snapshot =
    replay && isReadonlyArray(headerValue) && iterator === getArrayIterator(values)
      ? (retained ?? { source: values, iterator, slots: new Map() })
      : undefined;
  if (
    refresh?.refreshable &&
    isReadonlyArray(headerValue) &&
    (stateful || hasStatefulArrayProperties(values, iterator))
  ) {
    refresh.refreshable = false;
  }
  return { values, iterator, snapshot };
};

function* captureRowValues(
  row: RowRead,
  valueIteration: Iterable<HeaderValue>,
  refresh: { refreshable: boolean } | undefined,
  clear: boolean,
  native: boolean,
  callbacks: HeaderReplayCallbacks,
  replay?: HeaderReplayState,
): Generator<readonly [string, string | null], boolean> {
  let didClear = false;
  const { name, captured } = row;
  for (const value of valueIteration) {
    if (refresh && value !== null && (typeof value === 'object' || typeof value === 'function')) {
      refresh.refreshable = false;
    }
    // Platform Headers only yields strings; nullable values identify a one-shot custom source.
    if (replay && native && typeof value !== 'string') {
      replay.refreshable = false;
    }
    if (value === undefined) {
      continue;
    }
    if (clear && !didClear) {
      didClear = true;
      captured?.push([name, null]);
      yield [name, null];
    }
    const capturedValue =
      captured && !refresh?.refreshable && value !== null ? callbacks.normalize(name, value) : value;
    captured?.push([name, capturedValue]);
    yield [name, capturedValue];
  }
  return didClear;
}

const rememberRow = (
  row: RowRead,
  refresh: { refreshable: boolean } | undefined,
  values: HeaderValuesSnapshot | undefined,
  replay?: HeaderReplayState,
) => {
  if (!row.captured || !replay) {
    return;
  }
  if (row.nameStateful || !refresh?.refreshable) {
    replay.rows ??= new Map();
    const rows = replay.rows.get(row.row) ?? new Map<number, HeaderRowSnapshot>();
    rows.set(row.occurrence, {
      name: row.name,
      nameDescriptor: row.nameDescriptor,
      nameStateful: row.nameStateful,
      valueDescriptor: row.valueDescriptor,
      valueStateful: !refresh?.refreshable,
      entries: row.captured,
      ...(values ? { values } : {}),
    });
    replay.rows.set(row.row, rows);
  } else {
    row.retainedRows?.delete(row.occurrence);
    if (row.retainedRows?.size === 0) {
      replay.rows?.delete(row.row);
    }
  }
};

const rememberProperty = (
  headers: HeaderSource,
  name: string,
  property: HeaderPropertySnapshot,
  emitted: boolean,
  callbacks: HeaderReplayCallbacks,
  replay: HeaderReplayState,
) => {
  if (emitted) {
    property.entry = callbacks.capture(name);
  }
  try {
    const current = Object.getOwnPropertyDescriptor(headers, name);
    if (current && sameHeaderProperty(current, property.descriptor)) {
      // A first read can hide itself; later visibility changes must invalidate its replay.
      property.descriptor = { ...property.descriptor, enumerable: current.enumerable === true };
    }
  } catch {
    // A proxy may stop exposing descriptors after its first value was consumed.
  }
  replay.properties ??= new Map();
  replay.properties.set(name, property);
};

function* replayRow(
  row: RowRead,
  headers: HeaderSource,
  descriptor: PropertyDescriptor | undefined,
  clear: boolean,
  native: boolean,
  callbacks: HeaderReplayCallbacks,
  replay?: HeaderReplayState,
): Generator<readonly [string, string | null]> {
  const retainedEntries = retainedRowEntries(row);
  if (retainedEntries) {
    yield* retainedEntries;
    return;
  }
  const retainedProperty = clear ? replay?.properties?.get(row.name) : undefined;
  if (retainedProperty && !retainedProperty.values) {
    yield* retainedPropertyEntries(row.name, retainedProperty);
    return;
  }
  const refresh = rowRefreshState(row, descriptor, clear, replay);
  const property: HeaderPropertySnapshot | undefined =
    clear && replay && descriptor ? { descriptor } : undefined;
  const { values, iterator, snapshot } = readHeaderValues(
    row,
    retainedRowValues(row, retainedProperty),
    refresh,
    replay,
  );
  if (property && snapshot) {
    property.values = snapshot;
  }
  const iteration = snapshot
    ? iterateHeaderValues(row.name, snapshot, callbacks.normalize)
    : { [Symbol.iterator]: () => Reflect.apply(iterator, values, []) };
  const didClear = yield* captureRowValues(row, iteration, refresh, clear, native, callbacks, replay);
  if (snapshot?.slots.size && refresh) {
    refresh.refreshable = false;
  }
  rememberRow(row, refresh, snapshot, replay);
  if (property && replay && !refresh?.refreshable) {
    rememberProperty(headers, row.name, property, didClear, callbacks, replay);
  }
}

const pruneRows = (occurrences: Map<HeaderEntry, number>, replay?: HeaderReplayState) => {
  for (const [row, retained] of replay?.rows ?? []) {
    const count = occurrences.get(row) ?? 0;
    for (const occurrence of retained.keys()) {
      if (occurrence >= count) {
        retained.delete(occurrence);
      }
    }
    if (retained.size === 0) {
      replay?.rows?.delete(row);
    }
  }
};

function* replayHeaderEntries(
  headers: HeaderSource,
  callbacks: HeaderReplayCallbacks,
  replay?: HeaderReplayState,
): IterableIterator<readonly [string, string | null]> {
  const { iterator, native } = captureHeaderProtocol(headers, callbacks, replay);
  const clear = typeof iterator !== 'function';
  const descriptors = new Map<string, PropertyDescriptor>();
  let entries: Iterable<HeaderEntry>;
  if (typeof iterator === 'function') {
    const iteration =
      replay?.refreshable && Array.isArray(headers)
        ? iterateHeaderArray(headers, replay)
        : iterator.call(headers);
    if (replay?.refreshable) {
      replay.iterator = iterator;
      replay.iterations ??= new WeakSet<object>();
      if (replay.iterations.has(iteration)) {
        replay.refreshable = false;
        yield* callbacks.previous(replay.snapshot);
        return;
      }
      replay.iterations.add(iteration);
    }
    entries = { [Symbol.iterator]: () => iteration };
  } else if (replay) {
    entries = orderRecordEntries(captureRecordEntries(headers, replay, descriptors), replay, descriptors);
  } else {
    entries = Object.entries(headers);
  }
  const occurrences = new Map<HeaderEntry, number>();
  for (const row of entries) {
    const occurrence = occurrences.get(row) ?? 0;
    if (!clear && replay) {
      occurrences.set(row, occurrence + 1);
    }
    const read = readRow(row, occurrence, clear, replay);
    yield* replayRow(read, headers, descriptors.get(read.name), clear, native, callbacks, replay);
  }
  pruneRows(occurrences, replay);
}

const copyHeaderValues = <T extends { values?: HeaderValuesSnapshot }>(snapshot: T): T => ({
  ...snapshot,
  ...(snapshot.values ? { values: { ...snapshot.values, slots: new Map(snapshot.values.slots) } } : {}),
});

const copyHeaderReplay = (replay: HeaderReplayState): HeaderReplayState => ({
  ...replay,
  ...(replay.properties
    ? {
        properties: new Map(
          [...replay.properties].map(([key, property]) => [key, copyHeaderValues(property)]),
        ),
      }
    : {}),
  ...(replay.propertyOrder ? { propertyOrder: new Map(replay.propertyOrder) } : {}),
  ...(replay.arraySlots ? { arraySlots: new Map(replay.arraySlots) } : {}),
  ...(replay.rows
    ? {
        rows: new Map(
          [...replay.rows].map(([row, occurrences]) => [
            row,
            new Map([...occurrences].map(([index, snapshot]) => [index, copyHeaderValues(snapshot)])),
          ]),
        ),
      }
    : {}),
});

/** Reads ordinary inputs without retaining state for another attempt. */
export const iterateHeaderEntries = (headers: HeaderSource, callbacks: HeaderReplayCallbacks) =>
  replayHeaderEntries(headers, callbacks);

/** Owns occurrence capture, invalidation, pruning and copying for one header layer. */
export class HeaderReplay {
  private state: HeaderReplayState;

  /** Creates an empty replay owner; deferred layers may initially prohibit refresh. */
  constructor(refreshable = true) {
    this.state = { refreshable };
  }

  /** Whether the observed protocol permits refreshing this layer. */
  get refreshable(): boolean {
    return this.state.refreshable;
  }

  /** Whether a Headers-shaped protocol could not be verified by its native implementation. */
  get unverifiedHeaders(): boolean {
    return this.state.unverifiedHeaders === true;
  }

  /** Whether a retry can read the source again without retained one-shot state. */
  get replayable(): boolean {
    const { state } = this;
    return (
      state.refreshable &&
      !state.unverifiedHeaders &&
      !state.properties?.size &&
      !state.rows &&
      !state.arraySlots?.size
    );
  }

  /** Refreshes all occurrence caches together and yields entries to canonical header merging. */
  entries(
    headers: HeaderSource,
    callbacks: HeaderReplayCallbacks,
  ): IterableIterator<readonly [string, string | null]> {
    return replayHeaderEntries(headers, callbacks, this.state);
  }

  /** Starts another attempt with this layer's history and its prior canonical snapshot. */
  next(snapshot?: NullableHeaders): HeaderReplay {
    const next = new HeaderReplay();
    next.state = { ...this.state, refreshable: true };
    delete next.state.unverifiedHeaders;
    delete next.state.snapshot;
    if (snapshot) {
      next.state.snapshot = snapshot;
    }
    return next;
  }

  /** Copies every mutable occurrence cache while retaining consumed-iterator identity. */
  fork(): HeaderReplay {
    const copy = new HeaderReplay();
    copy.state = copyHeaderReplay(this.state);
    return copy;
  }
}
