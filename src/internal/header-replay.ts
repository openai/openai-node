import { isReadonlyArray } from './utils/values';
import {
  getHeadersIterator,
  getPlatformHeader,
  getVerifiedPlatformHeader,
  hasNativeHeadersBrand,
} from './platform-headers';

type HeaderValue = string | undefined | null;
type HeaderEntry = readonly (HeaderValue | readonly HeaderValue[])[];
export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

// Preserve the canonical module's tree-shaking annotation.
// oxlint-disable-next-line eslint/no-inline-comments
export const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');

/**
 * Users can pass explicit nulls to unset default headers. When we parse them
 * into a standard headers type we need to preserve that information.
 */
export interface NullableHeaders {
  /** Brand check, prevent users from creating a NullableHeaders. */
  [brand_privateNullableHeaders]: true;
  /** Parsed headers. */
  values: Headers;
  /** Set of lowercase header names explicitly set to null. */
  nulls: Set<string>;
}

const getArrayIterator = <T>(headers: readonly T[]) => {
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
    // Uninspectable protocols remain opaque.
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit fallback satisfies noImplicitReturns.
    return undefined;
  }
};

interface HeaderPropertySnapshot {
  slot: HeaderSlot<readonly [string, string | readonly string[] | null] | undefined>;
  capture?: () => void;
  values?: HeaderValuesSnapshot;
}

interface ArrayTraversal {
  length?: { boundary: number; fromDescriptor: boolean };
}

interface HeaderValuesSnapshot extends ArrayTraversal {
  source: readonly HeaderValue[];
  iterator: () => Iterator<HeaderValue>;
  slots: Map<number, CapturedSlot<HeaderValue> & { input: HeaderValue }>;
}

interface HeaderRowSnapshot {
  name: HeaderSlot<string>;
  value: HeaderSlot<readonly (readonly [string, string | null])[]>;
  values?: HeaderValuesSnapshot;
}

type HeaderSlot<T> = { kind: 'live'; descriptor: PropertyDescriptor | undefined; value: T } | CapturedSlot<T>;
interface CapturedSlot<T> {
  kind: 'captured';
  descriptor: PropertyDescriptor | undefined;
  omittedDuringRead: boolean;
  value: T;
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

const reversed = <T>(values: readonly T[] = []): T[] =>
  // ES2021 declaration compatibility: the copied array is private to this traversal.
  // oxlint-disable-next-line unicorn/no-array-reverse
  [...values].reverse();

const matchesSlot = <T>(slot: HeaderSlot<T> | undefined, descriptor: PropertyDescriptor | undefined) =>
  slot !== undefined &&
  (descriptor
    ? sameHeaderProperty(descriptor, slot.descriptor)
    : slot.kind === 'captured' && slot.omittedDuringRead);

const retainsSlot = <T>(slot: HeaderSlot<T> | undefined, descriptor?: PropertyDescriptor) =>
  slot?.kind === 'captured' && matchesSlot(slot, descriptor);

const captureSlot = <T>(
  value: T,
  descriptor: PropertyDescriptor | undefined,
  omittedDuringRead = !descriptor,
): CapturedSlot<T> => ({ kind: 'captured', value, descriptor, omittedDuringRead });

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
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit fallback satisfies noImplicitReturns.
  return undefined;
};

interface RecordReplay {
  kind: 'record';
  properties: Map<string, HeaderPropertySnapshot>;
  propertyOrder: Map<string, PropertyDescriptor | undefined>;
  property?: HeaderPropertySnapshot;
}

interface TupleReplay {
  iterator: () => Iterator<HeaderEntry>;
  iterations: WeakSet<object>;
  rows: Map<HeaderEntry, Map<number, HeaderRowSnapshot>>;
}
interface RemovedSlot {
  kind: 'removed';
}

interface ArrayReplay extends TupleReplay, ArrayTraversal {
  kind: 'array';
  slots: Map<number, CapturedSlot<HeaderEntry> | RemovedSlot>;
}
interface IteratorReplay extends TupleReplay {
  kind: 'iterator';
  unverifiedHeaders: boolean;
}
type IterableReplay = ArrayReplay | IteratorReplay;

/** One layer owns its source classification and occurrence captures across refreshes. */
export class HeaderReplay {
  state: { kind: 'pending' } | RecordReplay | IterableReplay = { kind: 'pending' };
  snapshot: NullableHeaders | undefined;
  refreshable: boolean;
  constructor(refreshable = true) {
    this.refreshable = refreshable;
  }

  get property() {
    return this.state.kind === 'record' ? this.state.property : undefined;
  }

  get unverifiedHeaders() {
    return this.state.kind === 'iterator' && this.state.unverifiedHeaders;
  }

  get replayable() {
    const { state } = this;
    return (
      this.refreshable &&
      (state.kind === 'pending' ||
        (state.kind === 'record'
          ? [...state.properties.values()].every((property) => property.slot.kind === 'live')
          : [...state.rows.values()].every((rows) =>
              [...rows.values()].every((row) => row.name.kind === 'live' && row.value.kind === 'live'),
            ) &&
            (state.kind === 'iterator'
              ? !state.unverifiedHeaders
              : state.length?.fromDescriptor !== false && !state.slots.size)))
    );
  }

  next(snapshot: NullableHeaders | undefined): HeaderReplay {
    const next = new HeaderReplay();
    next.state = this.state;
    next.snapshot = snapshot;
    return next;
  }
}

const invalidatedHeaderInputs = <T, S extends CapturedSlot<unknown>>(
  headers: readonly unknown[],
  traversal: ArrayTraversal,
  previous: ReadonlyMap<T, number>,
  slots: ReadonlyMap<number, S | RemovedSlot>,
  input: (slot: S) => T,
): Set<T> => {
  const duplicates = new Map([...previous].filter(([, count]) => count > 1).map(([value]) => [value, 0]));
  if (!duplicates.size || !traversal.length?.fromDescriptor) {
    return new Set();
  }
  const length = getHeaderRowDescriptor(headers, 'length')?.value;
  if (typeof length !== 'number') {
    return new Set();
  }
  // Removing an occurrence changes its ordinal. Reuse observed opaque slots instead of invoking getters.
  for (let index = 0; index < length; index += 1) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const slot = slots.get(index);
    const retained = slot?.kind === 'captured' ? slot : undefined;
    const observed = retained && retainsSlot(retained, descriptor);
    if (!observed && (!descriptor || !('value' in descriptor))) {
      return new Set(duplicates.keys());
    }
    const value = observed ? input(retained) : descriptor?.value;
    const count = duplicates.get(value);
    if (count !== undefined) {
      duplicates.set(value, count + 1);
    }
  }
  return new Set(
    [...duplicates].filter(([value, count]) => count < (previous.get(value) ?? 0)).map(([value]) => value),
  );
};

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
      lengthDescriptor = fromDescriptor ? getHeaderRowDescriptor(source, 'length') : undefined;
      length =
        lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : previousLength.boundary;
    } else {
      ({ length } = source);
      lengthDescriptor = getHeaderRowDescriptor(source, 'length');
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

// Read/yield sequencing is observable: capture self-removal only after the consumer serializes the slot.
// oxlint-disable-next-line eslint/complexity
function* iterateHeaderArray(headers: readonly HeaderEntry[], replay: ArrayReplay): Generator<HeaderEntry> {
  const counts = new Map([...replay.rows].map(([row, occurrences]) => [row, occurrences.size]));
  for (const row of invalidatedHeaderInputs(headers, replay, counts, replay.slots, (slot) => slot.value)) {
    replay.rows.delete(row);
  }
  for (const index of iterateArrayIndices(headers, replay)) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const previous = replay.slots.get(index);
    const retained = previous?.kind === 'captured' ? previous : undefined;
    if (retained && retainsSlot(retained, descriptor)) {
      yield retained.value;
      continue;
    }
    replay.slots?.delete(index);
    const row = headers[index];
    if (row === undefined) {
      if (previous && !descriptor) {
        replay.slots.set(index, { kind: 'removed' });
        continue;
      }
      throw new TypeError('expected header row to be present');
    }
    if (!descriptor || !('value' in descriptor) || row !== descriptor.value) {
      const slot = captureSlot(row, descriptor);
      replay.slots.set(index, slot);
      yield row;
      // Reading or serializing the row may remove its own slot. Only that missing slot stays retained.
      slot.omittedDuringRead = !getHeaderRowDescriptor(headers, String(index));
    } else {
      yield row;
    }
  }
  for (const slot of replay.slots?.keys() ?? []) {
    if (slot >= (replay.length?.boundary ?? 0)) {
      replay.slots?.delete(slot);
    }
  }
}

const invalidateHeaderValues = (snapshot: HeaderValuesSnapshot) => {
  const { source, slots } = snapshot;
  const counts = new Map<HeaderValue, number>();
  for (const { input } of slots.values()) {
    if (input !== null && (typeof input === 'object' || typeof input === 'function')) {
      counts.set(input, (counts.get(input) ?? 0) + 1);
    }
  }
  const invalidated = invalidatedHeaderInputs(source, snapshot, counts, slots, (slot) => slot.input);
  for (const [index, slot] of slots) {
    if (invalidated.has(slot.input)) {
      slots.delete(index);
    }
  }
};

function* iterateHeaderValues(name: string, snapshot: HeaderValuesSnapshot): Generator<HeaderValue> {
  const { source, slots } = snapshot;
  invalidateHeaderValues(snapshot);
  for (const index of iterateArrayIndices(source, snapshot)) {
    const descriptor = getHeaderRowDescriptor(source, String(index));
    const retained = slots.get(index);
    if (retained && retainsSlot(retained, descriptor)) {
      yield retained.value;
      continue;
    }
    slots.delete(index);
    const value = source[index];
    const needsCoercion = value !== null && (typeof value === 'object' || typeof value === 'function');
    const normalized = needsCoercion ? new Headers([[name, value]]).get(name) : value;
    if (!descriptor || !('value' in descriptor) || descriptor.value !== value || needsCoercion) {
      // A stateful read can replace its own slot. Retain the observed value until a later change.
      slots.set(index, {
        ...captureSlot(normalized, getHeaderRowDescriptor(source, String(index))),
        input: value,
      });
    }
    yield normalized;
  }
  for (const slot of slots.keys()) {
    if (slot >= (snapshot.length?.boundary ?? 0)) {
      slots.delete(slot);
    }
  }
}

const hasStatefulArrayProperties = (
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

/** Checks retryable hook inputs without invoking their iterable protocol or value getters. */
export const canReplayHeaderInput = (headers: HeadersLike, inputs = new Set<object>()): boolean => {
  if (!headers) {
    return true;
  }
  if (inputs.has(headers)) {
    return false;
  }
  inputs.add(headers);
  try {
    if (brand_privateNullableHeaders in headers) {
      return true;
    }
    let descriptor: PropertyDescriptor | undefined;
    const seen = new Set<object>();
    for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (seen.has(prototype)) {
        return false;
      }
      seen.add(prototype);
      descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (descriptor) {
        break;
      }
    }
    if (descriptor) {
      if (typeof descriptor.value !== 'function') {
        return false;
      }
      if (Array.isArray(headers)) {
        if (descriptor.value !== getArrayIterator(headers) || hasStatefulArrayProperties(headers)) {
          return false;
        }
        const length = Object.getOwnPropertyDescriptor(headers, 'length')?.value;
        for (let index = 0; index < length; index += 1) {
          if (!Object.getOwnPropertyDescriptor(headers, String(index))) {
            return false;
          }
        }
      } else {
        return getVerifiedPlatformHeader(headers, 'authorization') !== undefined;
      }
    }
    return Object.entries(Object.getOwnPropertyDescriptors(headers)).every(([key, property]) => {
      if (Array.isArray(headers) ? !/^(?:0|[1-9]\d*)$/u.test(key) : !property.enumerable) {
        return true;
      }
      if (!('value' in property)) {
        return false;
      }
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

/** Unknown iterable implementations must dispatch the same snapshot used for credential attribution. */
export const canPreserveHeaderInput = (headers: HeadersLike): boolean => {
  if (!headers) {
    return true;
  }
  try {
    if (!Array.isArray(headers) && Symbol.iterator in headers) {
      return hasNativeHeadersBrand(headers) && getPlatformHeader(headers, 'Authorization') !== undefined;
    }
    return canReplayHeaderInput(headers);
  } catch {
    return false;
  }
};

const restoreCapturedRecordEntries = (
  record: RecordReplay,
  entries: HeaderEntry[],
  propertyDescriptors: Map<string, PropertyDescriptor>,
): HeaderEntry[] => {
  // A getter may remove itself during its first read. Retain its position before surviving aliases.
  let nextKey: string | null = null;
  const present = new Set(entries.map((entry) => entry[0]));
  const liveAliases = new Map<string, string>();
  for (const [key] of entries) {
    const name = key as string;
    if (
      !sameHeaderProperty(propertyDescriptors.get(name), record.propertyOrder.get(name)) &&
      !liveAliases.has(name.toLowerCase())
    ) {
      liveAliases.set(name.toLowerCase(), name);
    }
  }
  const missing = new Map<string | null, HeaderEntry[]>();
  for (const key of reversed([...record.propertyOrder.keys()])) {
    if (present.has(key)) {
      nextKey = key;
    } else if (retainsSlot(record.properties.get(key)?.slot)) {
      // New or changed aliases override captured accessors; unchanged aliases keep their original order.
      const before = liveAliases.get(key.toLowerCase()) ?? nextKey;
      const bucket = missing.get(before) ?? [];
      bucket.push([key, undefined]);
      missing.set(before, bucket);
    } else {
      record.properties.delete(key);
    }
  }
  const ordered: HeaderEntry[] = [];
  for (const entry of entries) {
    for (const retained of reversed(missing.get(entry[0] as string))) {
      ordered.push(retained);
    }
    ordered.push(entry);
  }
  for (const retained of reversed(missing.get(null))) {
    ordered.push(retained);
  }
  record.propertyOrder = new Map(
    ordered.map(([key]) => [key as string, propertyDescriptors.get(key as string)]),
  );
  return ordered;
};

const observeHeaderRecord = (
  headers: object,
  record: RecordReplay,
  propertyDescriptors: Map<string, PropertyDescriptor>,
): HeaderEntry[] => {
  // Match Object.entries' eager descriptor/get order while recognizing one-shot accessors.
  const entries: HeaderEntry[] = [];
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key !== 'string') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    const retained = record.properties.get(key);
    if (
      retained &&
      descriptor &&
      (!matchesSlot(retained.slot, descriptor) ||
        descriptor.enumerable !== retained.slot.descriptor?.enumerable)
    ) {
      record.properties.delete(key);
    }
    if (!descriptor?.enumerable) {
      continue;
    }
    propertyDescriptors.set(key, descriptor);
    entries.push([key, record.properties.has(key) ? undefined : Reflect.get(headers, key)]);
  }
  return restoreCapturedRecordEntries(record, entries, propertyDescriptors);
};

type OccurrenceSource =
  | {
      kind: 'record';
      source: object;
      record: RecordReplay | undefined;
      descriptors: Map<string, PropertyDescriptor>;
    }
  | { kind: 'tuple'; iterable: IterableReplay | undefined; native: boolean };

// Read/yield sequencing is observable: capture self-removal only after the consumer serializes the slot.
// oxlint-disable-next-line eslint/complexity
function* iterateHeaderOccurrence(
  row: HeaderEntry,
  occurrence: number,
  source: OccurrenceSource,
  replay: HeaderReplay | undefined,
): IterableIterator<readonly [string, string | null]> {
  const shouldClear = source.kind === 'record';
  const record = source.kind === 'record' ? source.record : undefined;
  const iterable = source.kind === 'tuple' ? source.iterable : undefined;
  // Replacing one tuple column must not reread an unchanged getter in the other.
  const retainedRows = shouldClear ? undefined : iterable?.rows?.get(row);
  const retainedRow = retainedRows?.get(occurrence);
  const trackRow = !shouldClear && (retainedRow || replay?.refreshable);
  const nameDescriptor = trackRow ? getHeaderRowDescriptor(row, '0') : undefined;
  const retainName = retainedRow && retainsSlot(retainedRow.name, nameDescriptor);
  const name = retainName ? retainedRow.name.value : row[0];
  if (typeof name !== 'string') {
    throw new TypeError('expected header name to be a string');
  }
  const nameStateful = retainName || !nameDescriptor || !('value' in nameDescriptor);
  let capturedName: HeaderSlot<string> = { kind: 'live', descriptor: nameDescriptor, value: name };
  if (retainName) {
    capturedName = { ...retainedRow.name };
  } else if (nameStateful && trackRow) {
    capturedName = captureSlot(name, nameDescriptor);
  }
  const valueDescriptor = trackRow ? getHeaderRowDescriptor(row, '1') : undefined;
  if (retainedRow && !retainedRow.values && retainsSlot(retainedRow.value, valueDescriptor)) {
    if (capturedName.kind === 'captured') {
      capturedName.omittedDuringRead = !getHeaderRowDescriptor(row, '0');
    }
    retainedRows?.set(occurrence, { ...retainedRow, name: capturedName });
    for (const [, value] of retainedRow.value.value) {
      yield [name, value];
    }
    return;
  }
  const capturedRow: (readonly [string, string | null])[] | undefined = trackRow ? [] : undefined;
  const retained = shouldClear ? record?.properties?.get(name) : undefined;
  if (retained && !retained.values) {
    if (retained.slot.value) {
      yield [name, null];
      const [, value] = retained.slot.value;
      if (isReadonlyArray(value)) {
        for (const item of value) {
          yield [name, item];
        }
      } else if (value !== null) {
        yield [name, value];
      }
    }
    return;
  }
  const descriptor = source.kind === 'record' ? source.descriptors.get(name) : undefined;
  let rowReplay: { refreshable: boolean } | undefined = replay;
  if (trackRow) {
    rowReplay = { refreshable: !!valueDescriptor && 'value' in valueDescriptor };
  } else if (shouldClear && replay) {
    rowReplay = { refreshable: !descriptor || 'value' in descriptor };
  }
  const property: HeaderPropertySnapshot | undefined =
    shouldClear && replay && descriptor ? { slot: captureSlot(undefined, descriptor) } : undefined;
  if (property && record) {
    record.property = property;
  }
  const retainedValues =
    retained?.values ??
    (retainedRow && matchesSlot(retainedRow.value, valueDescriptor) ? retainedRow.values : undefined);
  const headerValue = retainedValues?.source ?? row[1];
  if (shouldClear && rowReplay && descriptor && 'value' in descriptor && headerValue !== descriptor.value) {
    // A proxy's ordinary data descriptor cannot authorize rereading a different observed value.
    rowReplay.refreshable = false;
  }
  const values = isReadonlyArray(headerValue) ? headerValue : [headerValue];
  const statefulValues =
    rowReplay?.refreshable && isReadonlyArray(headerValue) && hasStatefulArrayProperties(values);
  const liveValues = retained?.slot.kind === 'live' || retainedRow?.value.kind === 'live';
  const valueIterator = (liveValues ? undefined : retainedValues?.iterator) ?? values[Symbol.iterator];
  const valueSnapshot: HeaderValuesSnapshot | undefined =
    replay && isReadonlyArray(headerValue) && valueIterator === getArrayIterator(values)
      ? (retainedValues ?? { source: values, iterator: valueIterator, slots: new Map() })
      : undefined;
  if (property && valueSnapshot) {
    property.values = valueSnapshot;
  }
  if (
    rowReplay?.refreshable &&
    isReadonlyArray(headerValue) &&
    (statefulValues || hasStatefulArrayProperties(values, valueIterator))
  ) {
    rowReplay.refreshable = false;
  }
  let didClear = false;
  const valueIteration = valueSnapshot
    ? iterateHeaderValues(name, valueSnapshot)
    : { [Symbol.iterator]: () => Reflect.apply(valueIterator, values, []) };
  for (const value of valueIteration) {
    if (rowReplay && value !== null && (typeof value === 'object' || typeof value === 'function')) {
      rowReplay.refreshable = false;
    }
    if (replay && source.kind === 'tuple' && source.native && typeof value !== 'string') {
      // Platform Headers only yields strings; a nullable source is a custom one-shot candidate.
      replay.refreshable = false;
    }
    if (value === undefined) {
      continue;
    }

    // Objects keys always overwrite older headers, they never append.
    // Yield a null to clear the header before adding the new values.
    if (shouldClear && !didClear) {
      didClear = true;
      capturedRow?.push([name, null]);
      yield [name, null];
    }
    const capturedValue =
      capturedRow && !rowReplay?.refreshable && value !== null
        ? new Headers([[name, value]]).get(name)
        : value;
    capturedRow?.push([name, capturedValue]);
    yield [name, capturedValue];
  }
  if (capturedName.kind === 'captured') {
    capturedName.omittedDuringRead = !getHeaderRowDescriptor(row, '0');
  }
  if (rowReplay && (valueSnapshot?.slots.size || valueSnapshot?.length?.fromDescriptor === false)) {
    rowReplay.refreshable = false;
  }
  if (capturedRow && iterable) {
    if (nameStateful || !rowReplay?.refreshable || valueSnapshot) {
      const rows = iterable.rows.get(row) ?? new Map<number, HeaderRowSnapshot>();
      rows.set(occurrence, {
        name: capturedName,
        value: rowReplay?.refreshable
          ? { kind: 'live', descriptor: valueDescriptor, value: capturedRow }
          : captureSlot(capturedRow, valueDescriptor, !getHeaderRowDescriptor(row, '1')),
        ...(valueSnapshot ? { values: valueSnapshot } : {}),
      });
      iterable.rows.set(row, rows);
    } else {
      retainedRows?.delete(occurrence);
      if (retainedRows?.size === 0) {
        iterable.rows?.delete(row);
      }
    }
  }
  if (property && record) {
    if (valueSnapshot || !rowReplay?.refreshable) {
      property.capture?.();
      delete property.capture;
      if (rowReplay?.refreshable) {
        property.slot = { kind: 'live', descriptor: property.slot.descriptor, value: property.slot.value };
      } else {
        try {
          const current = Object.getOwnPropertyDescriptor(
            source.kind === 'record' ? source.source : row,
            name,
          );
          property.slot = captureSlot(property.slot.value, property.slot.descriptor, !current?.enumerable);
          if (current && sameHeaderProperty(current, property.slot.descriptor)) {
            // A first read can hide itself; later visibility changes must still invalidate its replay.
            property.slot.descriptor = {
              ...property.slot.descriptor,
              enumerable: current.enumerable === true,
            };
          }
        } catch {
          // Preserve the successful read when a membrane prevents distinguishing self-removal.
          property.slot = captureSlot(property.slot.value, property.slot.descriptor, true);
        }
      }
      record.properties.set(name, property);
    }
    delete record.property;
  }
}

// Source classification and iterator reuse must finish before the first observable row read.
// oxlint-disable-next-line eslint/complexity
export function* iterateHeaders(
  headers: HeadersLike,
  replay?: HeaderReplay,
  provenance?: { unknown: boolean; values?: Headers },
): IterableIterator<readonly [string, string | null]> {
  if (!headers) {
    return;
  }

  if (brand_privateNullableHeaders in headers) {
    if (provenance) {
      provenance.unknown = true;
    }
    const { values, nulls } = headers;
    if (provenance) {
      provenance.values = values;
    }
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<HeaderEntry>;
  const propertyDescriptors = new Map<string, PropertyDescriptor>();
  let record = replay?.state.kind === 'record' ? replay.state : undefined;
  let iterable =
    replay?.state.kind === 'array' || replay?.state.kind === 'iterator' ? replay.state : undefined;
  // Snapshot the iterable protocol across realms without rereading a caller-controlled getter.
  const hasIterator = !record && (iterable !== undefined || Symbol.iterator in headers);
  const iterator: (() => Iterator<HeaderEntry>) | undefined =
    iterable?.iterator ?? (hasIterator ? Reflect.get(headers, Symbol.iterator) : undefined);
  const nativeHeadersIterator =
    (replay || provenance) && typeof iterator === 'function' && !Array.isArray(headers)
      ? getHeadersIterator(headers)
      : undefined;
  if (provenance) {
    provenance.unknown = typeof iterator === 'function' && iterator === nativeHeadersIterator;
  }
  if (replay) {
    // Custom iterators may be one-shot whether inherited or owned. Platform Headers
    // are reusable across realms, where instanceof cannot identify them.
    replay.refreshable =
      !hasIterator ||
      (typeof iterator === 'function' &&
        ((Array.isArray(headers) && iterator === getArrayIterator(headers)) ||
          (!Array.isArray(headers) && iterator === nativeHeadersIterator)));
  }
  if (typeof iterator === 'function') {
    if (replay) {
      iterable ??= Array.isArray(headers)
        ? { kind: 'array', iterator, iterations: new WeakSet(), rows: new Map(), slots: new Map() }
        : {
            kind: 'iterator',
            iterator,
            iterations: new WeakSet(),
            rows: new Map(),
            unverifiedHeaders: false,
          };
      if (iterable.kind === 'iterator') {
        iterable.unverifiedHeaders =
          nativeHeadersIterator !== undefined &&
          iterator === nativeHeadersIterator &&
          !hasNativeHeadersBrand(headers);
      }
      replay.state = iterable;
    }
    const iteration =
      replay?.refreshable && iterable?.kind === 'array' && Array.isArray(headers)
        ? iterateHeaderArray(headers, iterable)
        : iterator.call(headers);
    if (replay?.refreshable && iterable) {
      if (iterable.iterations.has(iteration)) {
        // Headers-shaped custom sources can return a consumed iterator despite matching descriptors.
        replay.refreshable = false;
        yield* iterateHeaders(replay.snapshot, undefined, provenance);
        return;
      }
      iterable.iterations.add(iteration);
    }
    iter = { [Symbol.iterator]: () => iteration };
  } else {
    shouldClear = true;
    if (replay) {
      record ??= { kind: 'record', properties: new Map(), propertyOrder: new Map() };
      replay.state = record;
      iter = observeHeaderRecord(headers, record, propertyDescriptors);
    } else {
      iter = Object.entries(headers);
    }
  }
  const occurrenceSource: OccurrenceSource = shouldClear
    ? { kind: 'record', source: headers, record, descriptors: propertyDescriptors }
    : {
        kind: 'tuple',
        iterable,
        native: nativeHeadersIterator !== undefined && iterator === nativeHeadersIterator,
      };
  // Reusing a tuple at another position still owns a separate initial accessor read.
  const rowOccurrences = new Map<HeaderEntry, number>();
  for (const row of iter) {
    const occurrence = rowOccurrences.get(row) ?? 0;
    if (!shouldClear && replay) {
      rowOccurrences.set(row, occurrence + 1);
    }
    yield* iterateHeaderOccurrence(row, occurrence, occurrenceSource, replay);
  }
  for (const [row, retained] of iterable?.rows ?? []) {
    const occurrences = rowOccurrences.get(row) ?? 0;
    for (const occurrence of retained?.keys() ?? []) {
      if (occurrence >= occurrences) {
        retained?.delete(occurrence);
      }
    }
    if (retained?.size === 0) {
      iterable?.rows?.delete(row);
    }
  }
}

const copyHeaderValues = <T extends { values?: HeaderValuesSnapshot }>(snapshot: T): T => ({
  ...snapshot,
  ...(snapshot.values ? { values: { ...snapshot.values, slots: new Map(snapshot.values.slots) } } : {}),
});

export const copyHeaderReplay = (replay: HeaderReplay): HeaderReplay => {
  const copy = new HeaderReplay(replay.refreshable);
  copy.snapshot = replay.snapshot;
  const { state } = replay;
  if (state.kind === 'pending') {
    copy.state = state;
  } else if (state.kind === 'record') {
    copy.state = {
      ...state,
      properties: new Map(
        [...state.properties].map(([key, value]) => [
          key,
          { ...copyHeaderValues(value), slot: { ...value.slot } },
        ]),
      ),
      propertyOrder: new Map(state.propertyOrder),
    };
  } else {
    copy.state = {
      ...state,
      ...(state.kind === 'array' ? { slots: new Map(state.slots) } : {}),
      rows: new Map(
        [...state.rows].map(([row, occurrences]) => [
          row,
          new Map([...occurrences].map(([index, snapshot]) => [index, copyHeaderValues(snapshot)])),
        ]),
      ),
    };
  }
  return copy;
};
