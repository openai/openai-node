import { isReadonlyArray } from './utils/values';
import { getArrayIterator, HeaderSourceProtocol } from './header-source-protocol';
import { HeaderIteratorObservations } from './header-iterator-observations';
import { invalidateHeaderSlots, recordHeaderPosition } from './header-array-occurrences';
import type { HeaderSlotSnapshot } from './header-array-occurrences';
import type { NullableHeaders } from './headers';
import {
  HeaderDescriptorRead,
  observeHeaderDescriptor,
  sameHeaderProperty,
  unknownHeaderDescriptor,
} from './header-descriptor-evidence';
import type { HeaderDescriptorHistory } from './header-descriptor-evidence';

export { getArrayIterator, hasNativeHeadersBrand } from './header-source-protocol';

/** Values accepted by the canonical header parser, including explicit removal. */
export type HeaderValue = string | undefined | null;
type HeaderEntry = readonly (HeaderValue | readonly HeaderValue[])[];

const assertAuthorizationEvidence = (name: string, verificationLost: boolean) => {
  if (verificationLost && name.toLowerCase() === 'authorization') {
    throw new TypeError('Cannot replay Authorization after header descriptor evidence is lost');
  }
};

/** Raw header sources whose occurrence history can be retained across attempts. */
export type HeaderSource =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>;

/** Canonical normalization and merged-value access, supplied by headers.ts for one parse. */
export interface HeaderReplayCallbacks {
  /** The owning layer controls whether a newly emitted request alias supersedes a retained accessor. */
  layer?: 'request' | 'default' | undefined;
  /** Normalizes one stateful value once before retaining it. */
  normalize: (name: string, value: string) => string;
  /** Reads a completed record property's normalized result before the next alias is merged. */
  capture: (name: string) => readonly [string, string | readonly string[] | null];
  /** Reuses the prior canonical snapshot when a source returns an already-consumed iterator. */
  previous: (snapshot: NullableHeaders | undefined) => Iterable<readonly [string, string | null]>;
  /** Reports whether the iterable protocol is a platform Headers implementation. */
  onIterator?: (native: boolean) => void;
}

interface HeaderPropertySnapshot {
  descriptor: PropertyDescriptor;
  entry?: readonly [string, string | readonly string[] | null];
  values?: HeaderValuesSnapshot;
  afterRead?: { descriptor: PropertyDescriptor | undefined };
  valueStateful?: boolean;
}

interface HeaderRecordSnapshot {
  descriptor: PropertyDescriptor | undefined;
  // Null records a completed array that emitted nothing; undefined means it was not observed.
  value?: HeaderPropertySnapshot['entry'] | null;
}

interface ArrayTraversal {
  length?: { boundary: number; fromDescriptor: boolean };
}

interface HeaderValuesSnapshot extends ArrayTraversal {
  source: readonly HeaderValue[];
  protocol: HeaderSourceProtocol<HeaderValue>;
  slots: Map<number, HeaderSlotSnapshot & { value: HeaderValue }>;
}

interface HeaderRowSnapshot {
  name: string;
  nameHistory: HeaderDescriptorHistory;
  nameStateful: boolean;
  valueHistory: HeaderDescriptorHistory;
  valueStateful: boolean;
  entries: readonly (readonly [string, string | null])[];
  values?: HeaderValuesSnapshot;
}

interface HeaderReplayState extends ArrayTraversal {
  refreshable: boolean;
  unverifiedHeaders?: boolean;
  protocol: HeaderSourceProtocol<HeaderEntry>;
  nestedIterations: HeaderIteratorObservations<HeaderPropertySnapshot['entry']>;
  snapshot?: NullableHeaders;
  properties?: Map<string, HeaderPropertySnapshot>;
  propertyOrder?: Map<string, HeaderRecordSnapshot>;
  changedAliases?: Map<string, string>;
  rows?: Map<HeaderEntry, Map<number, HeaderRowSnapshot>>;
  arraySlots?: Map<number, HeaderSlotSnapshot<HeaderEntry>>;
  removedArraySlots?: Set<number>;
  arrayPositions?: ReadonlyMap<HeaderEntry, ReadonlySet<number>>;
}

// Preserve first-traversal live reads; later visits use verified descriptors or the observed boundary.
function* iterateArrayIndices(source: readonly unknown[], traversal: ArrayTraversal): Generator<number> {
  const previousLength = traversal.length;
  let fromDescriptor = previousLength?.fromDescriptor ?? true;
  let index = 0;
  // The first traversal keeps native live-length reads. Replay uses the data descriptor when those
  // reads matched it; otherwise it retains the visited rows without invoking a length trap again.
  for (; ; index += 1) {
    let length: number;
    let lengthDescriptor: PropertyDescriptor | undefined;
    if (previousLength) {
      lengthDescriptor = fromDescriptor ? observeHeaderDescriptor(source, 'length').descriptor : undefined;
      length =
        lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : previousLength.boundary;
    } else {
      ({ length } = source);
      lengthDescriptor = observeHeaderDescriptor(source, 'length').descriptor;
    }
    fromDescriptor &&=
      typeof length === 'number' &&
      !!lengthDescriptor &&
      'value' in lengthDescriptor &&
      lengthDescriptor.value === length;
    if (!(index < Math.min(Math.floor(length), Number.MAX_SAFE_INTEGER))) {
      break;
    }
    yield index;
  }
  traversal.length = { boundary: index, fromDescriptor };
}

// Descriptor evidence, tombstones, and duplicate invalidation share one observable traversal.
// oxlint-disable-next-line eslint/complexity
function* iterateHeaderArray(
  headers: readonly HeaderEntry[],
  replay: HeaderReplayState,
  observeVerification: (lost: boolean) => void,
): Generator<HeaderEntry> {
  const counts = new Map([...(replay.rows ?? [])].map(([row, occurrences]) => [row, occurrences.size]));
  const invalidated =
    replay.length?.fromDescriptor === false
      ? new Set<HeaderEntry>()
      : invalidateHeaderSlots(headers, counts, replay.arraySlots, replay.arrayPositions);
  for (const row of invalidated) {
    replay.rows?.delete(row);
  }
  const positions = new Map<HeaderEntry, Set<number>>();
  let boundary = 0;
  // Match native array iteration's live length on first use, while preserving an opaque observed
  // boundary across retries without invoking a proxy length trap again.
  for (const index of iterateArrayIndices(headers, replay)) {
    boundary = index + 1;
    const descriptorState = observeHeaderDescriptor(headers, String(index));
    const removed = replay.removedArraySlots?.has(index) === true;
    const retained = replay.arraySlots?.get(index);
    const read = new HeaderDescriptorRead(descriptorState, retained?.history);
    observeVerification(read.verificationLost);
    const observed = retained && read.retained;
    const row: HeaderEntry = observed ? retained.input : Reflect.get(headers, String(index));
    if (row === undefined) {
      if (removed || (retained && descriptorState.state === 'absent')) {
        // A captured slot deleted between attempts is an intentional tombstone. Read first so a
        // proxy that still produces a replacement row remains authoritative despite no descriptor.
        replay.arraySlots?.delete(index);
        if (retained) {
          replay.rows?.delete(retained.input);
        }
        replay.removedArraySlots ??= new Set();
        replay.removedArraySlots.add(index);
        continue;
      }
      throw new TypeError('expected header row to be present');
    }
    replay.removedArraySlots?.delete(index);
    yield row;
    recordHeaderPosition(positions, row, index);
    const afterRead = observeHeaderDescriptor(headers, String(index));
    if (observed) {
      replay.arraySlots?.set(index, { ...retained, history: read.complete(afterRead) });
    } else if (read.needsCapture(row, afterRead)) {
      replay.arraySlots ??= new Map();
      replay.arraySlots.set(index, {
        history: read.complete(afterRead),
        input: row,
      });
    } else {
      replay.arraySlots?.delete(index);
    }
  }
  for (const slot of replay.arraySlots?.keys() ?? []) {
    if (slot >= boundary) {
      replay.arraySlots?.delete(slot);
    }
  }
  for (const slot of replay.removedArraySlots?.keys() ?? []) {
    if (slot >= boundary) {
      replay.removedArraySlots?.delete(slot);
    }
  }
  // Publish only complete traversals; forks share this immutable observation until their next read.
  replay.arrayPositions = new Map([...positions].filter(([row]) => replay.rows?.has(row)));
}

function* iterateHeaderValues(
  name: string,
  snapshot: HeaderValuesSnapshot,
  normalize: HeaderReplayCallbacks['normalize'],
): Generator<HeaderValue> {
  const { source, slots } = snapshot;
  const counts = new Map<unknown, number>();
  const positions = new Map<unknown, Set<number>>();
  for (const [index, { input }] of slots) {
    if (input !== null && (typeof input === 'object' || typeof input === 'function')) {
      counts.set(input, (counts.get(input) ?? 0) + 1);
      recordHeaderPosition(positions, input, index);
    }
  }
  const invalidated =
    snapshot.length?.fromDescriptor === false
      ? new Set<unknown>()
      : invalidateHeaderSlots(source, counts, slots, positions);
  for (const [index, slot] of slots) {
    if (invalidated.has(slot.input)) {
      slots.delete(index);
    }
  }
  let boundary = 0;
  for (const index of iterateArrayIndices(source, snapshot)) {
    boundary = index + 1;
    const descriptorState = observeHeaderDescriptor(source, String(index));
    const retained = slots.get(index);
    const read = new HeaderDescriptorRead(descriptorState, retained?.history);
    assertAuthorizationEvidence(name, read.verificationLost);
    if (retained && read.retained) {
      yield retained.value;
      const afterRead = observeHeaderDescriptor(source, String(index));
      slots.set(index, { ...retained, history: read.complete(afterRead) });
      continue;
    }
    slots.delete(index);
    const value = source[index];
    const needsCoercion = value !== null && (typeof value === 'object' || typeof value === 'function');
    const normalized = needsCoercion ? normalize(name, value) : value;
    const afterRead = observeHeaderDescriptor(source, String(index));
    if (read.needsCapture(value, afterRead, needsCoercion)) {
      // A stateful read can replace its own slot. Retain the observed value until a later change.
      slots.set(index, {
        history: read.complete(afterRead),
        input: value,
        value: normalized,
      });
    }
    yield normalized;
  }
  for (const slot of slots.keys()) {
    if (slot >= boundary) {
      slots.delete(slot);
    }
  }
}

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

const captureRecordEntries = (
  headers: HeaderSource,
  replay: HeaderReplayState,
  descriptors: Map<string, PropertyDescriptor>,
  present: Set<string>,
): HeaderEntry[] => {
  replay.properties ??= new Map();
  const entries: HeaderEntry[] = [];
  // Records read getters eagerly, matching Object.entries before any row is validated.
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key !== 'string') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    if (descriptor) {
      present.add(key);
    }
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

const earlierEntry = (
  retainedPosition: string | undefined,
  liveAlias: string | undefined,
  positions: ReadonlyMap<HeaderValue | readonly HeaderValue[], number>,
): string | undefined => {
  if (liveAlias === undefined) {
    return retainedPosition;
  }
  if (retainedPosition === undefined) {
    return liveAlias;
  }
  const retainedIndex = positions.get(retainedPosition);
  const aliasIndex = positions.get(liveAlias);
  return retainedIndex !== undefined && aliasIndex !== undefined && retainedIndex <= aliasIndex
    ? retainedPosition
    : liveAlias;
};

const retainMissingRecordEntry = (
  key: string,
  nextKey: string | undefined,
  replay: HeaderReplayState,
  presentProperties: ReadonlySet<string>,
  liveAliases: ReadonlyMap<string, string>,
  positions: ReadonlyMap<HeaderValue | readonly HeaderValue[], number>,
  missing: Map<string | undefined, HeaderEntry[]>,
) => {
  const property = replay.properties?.get(key);
  if (!presentProperties.has(key) && property?.afterRead?.descriptor) {
    replay.properties?.delete(key);
    return;
  }
  // Current aliases override missing captured accessors without changing the live keys' order.
  const liveAlias = liveAliases.get(key.toLowerCase());
  const before = earlierEntry(nextKey, liveAlias, positions);
  const bucket = missing.get(before) ?? [];
  bucket.push([key, undefined]);
  missing.set(before, bucket);
};

const orderRecordEntries = (
  entries: HeaderEntry[],
  replay: HeaderReplayState,
  descriptors: Map<string, PropertyDescriptor>,
  presentProperties: ReadonlySet<string>,
): HeaderEntry[] => {
  const present = new Set(entries.map(([key]) => key));
  const liveAliases = new Map<string, string>();
  for (const [key] of entries) {
    const name = key as string;
    if (!liveAliases.has(name.toLowerCase())) {
      liveAliases.set(name.toLowerCase(), name);
    }
  }
  const missing = new Map<string | undefined, HeaderEntry[]>();
  const positions = new Map(entries.map(([key], index) => [key, index]));
  let nextKey: string | undefined;
  for (const key of reversed([...(replay.propertyOrder?.keys() ?? [])])) {
    if (present.has(key)) {
      nextKey = key;
    } else if (replay.properties?.has(key)) {
      retainMissingRecordEntry(key, nextKey, replay, presentProperties, liveAliases, positions, missing);
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
  replay.propertyOrder = new Map(
    ordered.map(([key]) => [
      key as string,
      { descriptor: descriptors.get(key as string), value: replay.propertyOrder?.get(key as string)?.value },
    ]),
  );
  replay.changedAliases = new Map();
  return ordered;
};

const readRowName = (row: HeaderEntry, retained: HeaderRowSnapshot | undefined, track: boolean) => {
  const observation = track ? observeHeaderDescriptor(row, '0') : unknownHeaderDescriptor;
  const nameRead = new HeaderDescriptorRead(
    observation,
    retained?.nameStateful ? retained.nameHistory : undefined,
  );
  const name = retained && nameRead.retained ? retained.name : row[0];
  if (typeof name !== 'string') {
    throw new TypeError('expected header name to be a string');
  }
  return {
    name,
    nameRead,
    nameStateful: nameRead.retained || !observation.descriptor || !('value' in observation.descriptor),
  };
};

const readRow = (row: HeaderEntry, occurrence: number, clear: boolean, replay?: HeaderReplayState) => {
  const retainedRows = clear ? undefined : replay?.rows?.get(row);
  const retained = retainedRows?.get(occurrence);
  const track = !clear && !!(retained || replay?.refreshable);
  const name = readRowName(row, retained, track);
  const valueRead = new HeaderDescriptorRead(
    track ? observeHeaderDescriptor(row, '1') : unknownHeaderDescriptor,
    retained?.valueHistory,
  );
  return {
    row,
    occurrence,
    retainedRows,
    retained,
    track,
    ...name,
    valueRead,
    captured: track ? ([] as (readonly [string, string | null])[]) : undefined,
  };
};
type RowRead = ReturnType<typeof readRow>;

const completeRowEvidence = (row: RowRead) => ({
  nameHistory: row.nameRead.complete(observeHeaderDescriptor(row.row, '0')),
  valueHistory: row.valueRead.complete(observeHeaderDescriptor(row.row, '1')),
});

function* renameEntries(
  name: string,
  entries: HeaderRowSnapshot['entries'],
): Generator<readonly [string, string | null]> {
  for (const [, value] of entries) {
    yield [name, value];
  }
}

const retainedRowEntries = (row: RowRead) => {
  const { retained, name, nameStateful, valueRead } = row;
  if (!retained?.valueStateful || retained.values || !valueRead.retained) {
    return;
  }
  row.retainedRows?.set(row.occurrence, {
    ...retained,
    ...completeRowEvidence(row),
    name,
    nameStateful,
  });
  return renameEntries(name, retained.entries);
};

function* retainedPropertyEntries(
  name: string,
  entry: HeaderPropertySnapshot['entry'],
): Generator<readonly [string, string | null]> {
  if (!entry) {
    return;
  }
  yield [name, null];
  const [, value] = entry;
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
    const { descriptor: valueDescriptor } = row.valueRead.observation;
    return { refreshable: !!valueDescriptor && 'value' in valueDescriptor };
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
  if (row.retained && row.valueRead.retained) {
    return row.retained.values;
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined satisfies noImplicitReturns when no value was retained.
  return undefined;
};

// Protocol classification must stay adjacent to the single observable nested-value read.
// oxlint-disable-next-line eslint/complexity
const readHeaderValues = (
  row: RowRead,
  retained: HeaderValuesSnapshot | undefined,
  refresh: { refreshable: boolean } | undefined,
  descriptor: PropertyDescriptor | undefined,
  property: HeaderPropertySnapshot | undefined,
  replay?: HeaderReplayState,
) => {
  const headerValue = retained?.source ?? row.row[1];
  if (property && refresh && descriptor && 'value' in descriptor && headerValue !== descriptor.value) {
    // A proxy's ordinary data descriptor cannot authorize rereading a different observed value.
    refresh.refreshable = false;
  }
  const values = isReadonlyArray(headerValue) ? headerValue : [headerValue];
  const stateful = refresh?.refreshable && isReadonlyArray(headerValue) && hasStatefulArrayProperties(values);
  const nested: HeaderValuesSnapshot | undefined =
    replay && isReadonlyArray(headerValue)
      ? (retained ?? { source: values, protocol: new HeaderSourceProtocol<HeaderValue>(), slots: new Map() })
      : undefined;
  const protocol = (nested?.protocol ?? new HeaderSourceProtocol<HeaderValue>(false)).capture(values);
  assertAuthorizationEvidence(row.name, protocol.verificationLost);
  if (protocol.kind !== 'iterable') {
    throw new TypeError('Header value arrays must be iterable');
  }
  const snapshot = protocol.refreshable ? nested : undefined;
  if (refresh?.refreshable && isReadonlyArray(headerValue) && (stateful || !protocol.refreshable)) {
    refresh.refreshable = false;
  }
  // Record the completed array value even when its new protocol becomes snapshot-only.
  return { protocol, snapshot, source: nested?.source };
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
  if (row.nameStateful || !refresh?.refreshable || values) {
    replay.rows ??= new Map();
    const rows = replay.rows.get(row.row) ?? new Map<number, HeaderRowSnapshot>();
    rows.set(row.occurrence, {
      name: row.name,
      ...completeRowEvidence(row),
      nameStateful: row.nameStateful,
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
  replay: HeaderReplayState,
) => {
  try {
    const current = Object.getOwnPropertyDescriptor(headers, name);
    property.afterRead = { descriptor: current };
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

const sameRecordValue = (
  current: NonNullable<HeaderPropertySnapshot['entry']>[1],
  previous: NonNullable<HeaderPropertySnapshot['entry']>[1],
) => {
  if (isReadonlyArray(current) && isReadonlyArray(previous)) {
    return current.length === previous.length && current.every((value, index) => value === previous[index]);
  }
  return current === previous;
};

const rememberRecordValue = (
  name: string,
  current: HeaderRecordSnapshot['value'],
  replay: HeaderReplayState,
  layer: HeaderReplayCallbacks['layer'],
) => {
  const prior = replay.propertyOrder?.get(name);
  if (!prior || current === undefined) {
    return;
  }
  // Other layers compare replacements with their last emitted value, even after an empty iteration.
  if (layer !== 'request' && current === null && prior.value !== undefined) {
    return;
  }
  // Compare canonical values after their normal read; array identity alone misses in-place replacements.
  // Null-only removals retain their existing ordering; replacement values can supersede cached accessors.
  // Newly emitted request aliases override retained accessors; defaults preserve no-emission precedence.
  if (
    prior.value !== undefined &&
    current !== null &&
    current[1] !== null &&
    (prior.value === null ? layer === 'request' : !sameRecordValue(current[1], prior.value[1]))
  ) {
    replay.changedAliases ??= new Map();
    const lowerName = name.toLowerCase();
    if (!replay.changedAliases.has(lowerName)) {
      replay.changedAliases.set(lowerName, name);
    }
  }
  replay.propertyOrder?.set(name, { ...prior, value: current });
};

const supersededRecordProperty = (
  name: string,
  descriptor: PropertyDescriptor | undefined,
  property: HeaderPropertySnapshot | undefined,
  replay?: HeaderReplayState,
) => !descriptor && property && replay?.changedAliases?.has(name.toLowerCase());

const rememberParsedRow = (
  row: RowRead,
  headers: HeaderSource,
  property: HeaderPropertySnapshot | undefined,
  values: ReturnType<typeof readHeaderValues>,
  refresh: { refreshable: boolean } | undefined,
  emitted: boolean,
  callbacks: HeaderReplayCallbacks,
  replay?: HeaderReplayState,
) => {
  const { snapshot } = values;
  if ((snapshot?.slots.size || snapshot?.length?.fromDescriptor === false) && refresh) {
    refresh.refreshable = false;
  }
  rememberRow(row, refresh, snapshot, replay);
  if (!property || !replay) {
    return;
  }
  property.valueStateful = !refresh?.refreshable;
  if (emitted && (snapshot || !refresh?.refreshable)) {
    property.entry = callbacks.capture(row.name);
  }
  if (values.source) {
    rememberRecordValue(row.name, emitted ? property.entry : null, replay, callbacks.layer);
  }
  if (snapshot || !refresh?.refreshable) {
    rememberProperty(headers, row.name, property, replay);
  }
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
  // Nested replacements become observable after ordering, before a later missing accessor is replayed.
  if (supersededRecordProperty(row.name, descriptor, retainedProperty, replay)) {
    return;
  }
  if (retainedProperty && !retainedProperty.values) {
    yield* retainedPropertyEntries(row.name, retainedProperty.entry);
    return;
  }
  const refresh = rowRefreshState(row, descriptor, clear, replay);
  const property: HeaderPropertySnapshot | undefined =
    clear && replay && descriptor ? { descriptor } : undefined;
  const values = readHeaderValues(
    row,
    retainedRowValues(row, retainedProperty),
    refresh,
    descriptor,
    property,
    replay,
  );
  const { protocol, snapshot } = values;
  if (property && snapshot) {
    property.values = snapshot;
  }
  const { iteration } = protocol.iterate(
    snapshot ? () => iterateHeaderValues(row.name, snapshot, callbacks.normalize) : undefined,
  );
  const observation = replay?.nestedIterations.capture(iteration, {
    source: values.source,
    name: row.name,
    descriptor: property?.descriptor,
    history: replay.propertyOrder,
    refreshable: protocol.refreshable,
  });
  let didClear: boolean;
  if (observation?.reused) {
    // Related layers can receive the same exhausted cursor; reuse its completed canonical value.
    yield* retainedPropertyEntries(row.name, observation.entry);
    didClear = observation.entry !== undefined;
  } else {
    didClear = yield* captureRowValues(
      row,
      { [Symbol.iterator]: () => iteration },
      refresh,
      clear,
      native,
      callbacks,
      replay,
    );
  }
  protocol.finish();
  rememberParsedRow(row, headers, property, values, refresh, didClear, callbacks, replay);
  observation?.complete(property);
}

const finishReplay = (
  headers: HeaderSource,
  protocol: ReturnType<HeaderSourceProtocol<HeaderEntry>['capture']>,
  occurrences: Map<HeaderEntry, number>,
  replay?: HeaderReplayState,
) => {
  protocol.finish();
  if (replay && (protocol.kind !== 'iterable' || !protocol.refreshable || !Array.isArray(headers))) {
    delete replay.arrayPositions;
  }
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
  const protocol = (replay?.protocol ?? new HeaderSourceProtocol<HeaderEntry>(false)).capture(
    headers,
    callbacks.onIterator,
  );
  if (replay) {
    replay.refreshable = protocol.refreshable;
    replay.unverifiedHeaders = protocol.unverifiedHeaders;
  }
  const clear = protocol.kind === 'record';
  let slotVerificationLost = false;
  const descriptors = new Map<string, PropertyDescriptor>();
  const presentProperties = new Set<string>();
  let entries: Iterable<HeaderEntry>;
  if (protocol.kind === 'iterable') {
    const { iteration, reused } = protocol.iterate(
      replay && Array.isArray(headers)
        ? () =>
            iterateHeaderArray(headers, replay, (lost) => {
              slotVerificationLost = lost;
            })
        : undefined,
    );
    if (reused) {
      if (replay) {
        replay.refreshable = false;
      }
      for (const entry of callbacks.previous(replay?.snapshot)) {
        assertAuthorizationEvidence(entry[0], protocol.verificationLost);
        yield entry;
      }
      return;
    }
    entries = { [Symbol.iterator]: () => iteration };
  } else if (replay) {
    entries = orderRecordEntries(
      captureRecordEntries(headers, replay, descriptors, presentProperties),
      replay,
      descriptors,
      presentProperties,
    );
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
    assertAuthorizationEvidence(
      read.name,
      protocol.verificationLost ||
        slotVerificationLost ||
        read.nameRead.verificationLost ||
        read.valueRead.verificationLost,
    );
    yield* replayRow(read, headers, descriptors.get(read.name), clear, protocol.native, callbacks, replay);
  }
  finishReplay(headers, protocol, occurrences, replay);
}

const copyHeaderValues = <T extends { values?: HeaderValuesSnapshot }>(snapshot: T): T => ({
  ...snapshot,
  ...(snapshot.values
    ? {
        values: {
          ...snapshot.values,
          protocol: snapshot.values.protocol.fork(),
          slots: new Map(snapshot.values.slots),
        },
      }
    : {}),
});

const copyHeaderReplay = (replay: HeaderReplayState): HeaderReplayState => ({
  ...replay,
  protocol: replay.protocol.fork(),
  ...(replay.properties
    ? {
        properties: new Map(
          [...replay.properties].map(([key, property]) => [key, copyHeaderValues(property)]),
        ),
      }
    : {}),
  ...(replay.propertyOrder ? { propertyOrder: new Map(replay.propertyOrder) } : {}),
  ...(replay.changedAliases ? { changedAliases: new Map(replay.changedAliases) } : {}),
  ...(replay.arraySlots ? { arraySlots: new Map(replay.arraySlots) } : {}),
  ...(replay.removedArraySlots ? { removedArraySlots: new Set(replay.removedArraySlots) } : {}),
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

const hasOnlyLiveHeaderValues = (values: HeaderValuesSnapshot | undefined) =>
  !values || (!values.slots.size && values.length?.fromDescriptor !== false);

/** Reads ordinary inputs without retaining state for another attempt. */
export const iterateHeaderEntries = (headers: HeaderSource, callbacks: HeaderReplayCallbacks) =>
  replayHeaderEntries(headers, callbacks);

/** Owns occurrence capture, invalidation, pruning and copying for one header layer. */
export class HeaderReplay {
  private state: HeaderReplayState;

  /** Creates an empty replay owner; deferred layers may initially prohibit refresh. */
  constructor(refreshable = true) {
    this.state = {
      refreshable,
      protocol: new HeaderSourceProtocol(),
      nestedIterations: new HeaderIteratorObservations(),
    };
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
    const propertiesLive = [...(state.properties?.values() ?? [])].every(
      (property) => !property.valueStateful && hasOnlyLiveHeaderValues(property.values),
    );
    const rowsLive = [...(state.rows?.values() ?? [])].every((rows) =>
      [...rows.values()].every(
        (row) => !row.nameStateful && !row.valueStateful && hasOnlyLiveHeaderValues(row.values),
      ),
    );
    return (
      state.refreshable &&
      !state.unverifiedHeaders &&
      propertiesLive &&
      rowsLive &&
      state.length?.fromDescriptor !== false &&
      !state.arraySlots?.size &&
      !state.removedArraySlots?.size
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
    next.state = { ...this.state, protocol: this.state.protocol.fork(), refreshable: true };
    delete next.state.unverifiedHeaders;
    delete next.state.snapshot;
    if (snapshot) {
      next.state.snapshot = snapshot;
    }
    return next;
  }

  /** Copies per-layer caches while sharing completed iterator observations. */
  fork(): HeaderReplay {
    const copy = new HeaderReplay();
    copy.state = copyHeaderReplay(this.state);
    return copy;
  }
}
