import { isReadonlyArray } from './utils/values';
import { getHeadersIterator, getPlatformHeader, getVerifiedPlatformHeader } from './platform-headers';
export { getPlatformHeader } from './platform-headers';
import {
  copyWorkloadHeaderCredential,
  rememberWorkloadHeaderCredential,
  rememberWorkloadHeaderValues,
  workloadHeaderCredential,
} from './auth/workload-token-provenance';

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
  try {
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
  } catch {
    return undefined;
  }
};

interface HeaderPropertySnapshot {
  descriptor: PropertyDescriptor;
  capture?: () => void;
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
) =>
  current && previous
    ? 'value' in current
      ? 'value' in previous && current.value === previous.value
      : !('value' in previous) && current.get === previous.get
    : current === previous;

const getHeaderRowDescriptor = (row: object, key: string): PropertyDescriptor | undefined => {
  const seen = new Set<object>();
  try {
    for (let object: object | null = row; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) return undefined;
      seen.add(object);
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return descriptor;
    }
  } catch {
    // Preserve the first actual read when a proxy cannot expose its descriptor.
  }
  return undefined;
};

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
  rows?: Map<HeaderEntry, Map<number, HeaderRowSnapshot>>;
  arraySlots?: Map<number, HeaderSlotSnapshot<HeaderEntry>>;
}

const invalidatedHeaderInputs = <T>(
  headers: readonly T[],
  previous: ReadonlyMap<T, number>,
  slots: ReadonlyMap<number, HeaderSlotSnapshot<T>> | undefined,
): Set<T> => {
  const duplicates = new Map([...previous].filter(([, count]) => count > 1).map(([input]) => [input, 0]));
  const length = getHeaderRowDescriptor(headers, 'length')?.value;
  if (typeof length !== 'number') return new Set();
  // Removing a duplicate changes its ordinal. Count captured opaque slots without rereading getters.
  for (let index = 0; duplicates.size && index < length; index += 1) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const retained = slots?.get(index);
    const observed = retained && sameHeaderProperty(descriptor, retained.descriptor);
    if (!observed && (!descriptor || !('value' in descriptor))) return new Set(duplicates.keys());
    const input = observed ? retained.input : descriptor!.value;
    const count = duplicates.get(input);
    if (count !== undefined) duplicates.set(input, count + 1);
  }
  return new Set(
    [...duplicates].filter(([input, count]) => count < previous.get(input)!).map(([input]) => input),
  );
};

function* iterateHeaderArray(headers: readonly HeaderEntry[], replay: HeaderReplay): Generator<HeaderEntry> {
  const counts = new Map([...(replay.rows ?? [])].map(([row, occurrences]) => [row, occurrences.size]));
  for (const row of invalidatedHeaderInputs(headers, counts, replay.arraySlots)) replay.rows?.delete(row);
  let index = 0;
  // Match native array iteration's live length, with each row validated before reading the next slot.
  for (; index < Math.min(Math.floor(headers.length), Number.MAX_SAFE_INTEGER); index += 1) {
    const descriptor = getHeaderRowDescriptor(headers, String(index));
    const retained = replay.arraySlots?.get(index);
    const observed = retained && sameHeaderProperty(descriptor, retained.descriptor);
    const row = observed ? retained.input : headers[index]!;
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
    if (slot >= index) replay.arraySlots?.delete(slot);
  }
}

function* iterateHeaderValues(name: string, snapshot: HeaderValuesSnapshot): Generator<HeaderValue> {
  const { source, slots } = snapshot;
  const counts = new Map<unknown, number>();
  for (const { input } of slots.values()) {
    if (input !== null && (typeof input === 'object' || typeof input === 'function'))
      counts.set(input, (counts.get(input) ?? 0) + 1);
  }
  const invalidated = invalidatedHeaderInputs(source, counts, slots);
  for (const [index, slot] of slots) if (invalidated.has(slot.input)) slots.delete(index);
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
    const normalized = needsCoercion ? new Headers([[name, value]]).get(name)! : value;
    if (!descriptor || !('value' in descriptor) || descriptor.value !== value || needsCoercion) {
      // A stateful read can replace its own slot. Retain the observed value until a later change.
      const currentDescriptor = getHeaderRowDescriptor(source, String(index));
      slots.set(index, {
        descriptor: currentDescriptor,
        input: value,
        value: normalized,
      });
    }
    yield normalized;
  }
  for (const slot of slots.keys()) {
    if (slot >= index) slots.delete(slot);
  }
}

export const hasNativeHeadersBrand = (headers: object): boolean => {
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
        return getVerifiedPlatformHeader(headers, 'authorization') !== undefined;
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

/** Unknown iterable implementations must dispatch the same snapshot used for credential attribution. */
export const canPreserveHeaderInput = (headers: HeadersLike): boolean => {
  if (!headers) return true;
  try {
    if (!Array.isArray(headers) && Symbol.iterator in headers) {
      return hasNativeHeadersBrand(headers) && getPlatformHeader(headers, 'Authorization') !== undefined;
    }
    return canReplayHeaderInput(headers);
  } catch {
    return false;
  }
};

/** Reads only data descriptors, so unrelated structural header values remain untouched until dispatch. */
export const getStructuralHeaderValue = (
  headers: HeadersLike,
  requestedName: string,
): { value: string | null } | undefined => {
  if (!headers) return { value: null };
  try {
    if (brand_privateNullableHeaders in headers || (!Array.isArray(headers) && Symbol.iterator in headers)) {
      return undefined;
    }
    const requested = requestedName.toLowerCase();
    const entries: [string, HeaderValue][] = [];
    const copyInput = (input: unknown): { value: HeaderValue } | undefined =>
      input === null || input === undefined || typeof input === 'string' ? { value: input } : undefined;
    if (Array.isArray(headers)) {
      const length = Object.getOwnPropertyDescriptor(headers, 'length')?.value;
      if (typeof length !== 'number') return undefined;
      for (let index = 0; index < length; index += 1) {
        const rowDescriptor = Object.getOwnPropertyDescriptor(headers, String(index));
        if (!rowDescriptor || !('value' in rowDescriptor) || !Array.isArray(rowDescriptor.value)) {
          return undefined;
        }
        const nameDescriptor = Object.getOwnPropertyDescriptor(rowDescriptor.value, '0');
        const valueDescriptor = Object.getOwnPropertyDescriptor(rowDescriptor.value, '1');
        if (!nameDescriptor || !('value' in nameDescriptor) || typeof nameDescriptor.value !== 'string') {
          return undefined;
        }
        if (nameDescriptor.value.toLowerCase() !== requested) continue;
        if (!valueDescriptor || !('value' in valueDescriptor)) {
          return undefined;
        }
        const input = copyInput(valueDescriptor.value);
        if (!input) return undefined;
        entries.push([nameDescriptor.value, input.value]);
      }
    } else {
      for (const key of Reflect.ownKeys(headers)) {
        if (typeof key !== 'string' || key.toLowerCase() !== requested) continue;
        const descriptor = Object.getOwnPropertyDescriptor(headers, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) return undefined;
        const input = copyInput(descriptor.value);
        if (!input) return undefined;
        entries.push([key, input.value]);
      }
    }
    return {
      value: new Headers(entries as unknown as [string, string][]).get(requestedName),
    };
  } catch {
    return undefined;
  }
};

const hasStatefulArrayProperties = (
  array: readonly unknown[],
  iterator?: () => Iterator<unknown>,
): boolean => {
  const seen = new Set<object>();
  try {
    if (iterator !== undefined && iterator !== getArrayIterator(array)) return true;
    for (let object: object | null = array; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) return true;
      seen.add(object);
      for (const key of Reflect.ownKeys(object)) {
        if (key !== Symbol.iterator && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (descriptor && !('value' in descriptor)) return true;
      }
    }
  } catch {
    // Uninspectable proxy descriptors do not make the actual value iteration invalid.
    return true;
  }
  return false;
};

function* iterateHeaders(
  headers: HeadersLike,
  replay?: HeaderReplay,
  provenance?: { unknown: boolean; values?: Headers },
): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    if (provenance) provenance.unknown = true;
    const { values, nulls } = headers;
    if (provenance) provenance.values = values;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<HeaderEntry>;
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
        ((Array.isArray(headers) && iterator === getArrayIterator(headers)) ||
          (!Array.isArray(headers) && iterator === nativeHeadersIterator)));
  }
  if (typeof iterator === 'function') {
    const iteration =
      replay?.refreshable && Array.isArray(headers)
        ? iterateHeaderArray(headers, replay)
        : iterator.call(headers);
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
        const retained = replay.properties.get(key);
        if (
          retained &&
          descriptor &&
          (!sameHeaderProperty(descriptor, retained.descriptor) ||
            descriptor.enumerable !== retained.descriptor.enumerable)
        ) {
          replay.properties.delete(key);
        }
        if (!descriptor?.enumerable) continue;
        propertyDescriptors.set(key, descriptor);
        entries.push([key, replay.properties.has(key) ? undefined : Reflect.get(headers, key)]);
      }
      // A getter may remove itself during its first read. Retain its position before surviving aliases.
      let nextKey: string | undefined;
      const present = new Set(entries.map((entry) => entry[0]));
      const previousKeys = new Set(replay.propertyOrder);
      const liveAliases = new Map<string, string>();
      for (const [key] of entries) {
        const name = key as string;
        if (previousKeys.has(name)) continue;
        if (!liveAliases.has(name.toLowerCase())) liveAliases.set(name.toLowerCase(), name);
      }
      const missing = new Map<string | undefined, HeaderEntry[]>();
      const positions = new Map(entries.map(([key], index) => [key, index]));
      for (const key of [...(replay.propertyOrder ?? [])].reverse()) {
        if (present.has(key)) {
          nextKey = key;
        } else if (replay.properties.has(key)) {
          // Newly supplied aliases override captured accessors; existing aliases keep their original order.
          const liveAlias = liveAliases.get(key.toLowerCase());
          const nextPosition = nextKey === undefined ? undefined : positions.get(nextKey);
          const liveAliasPosition = liveAlias === undefined ? undefined : positions.get(liveAlias);
          const before =
            liveAlias === undefined ||
            (nextPosition !== undefined &&
              liveAliasPosition !== undefined &&
              nextPosition <= liveAliasPosition)
              ? nextKey
              : liveAlias;
          const bucket = missing.get(before) ?? [];
          bucket.push([key, undefined]);
          missing.set(before, bucket);
        }
      }
      const ordered: HeaderEntry[] = [];
      for (const entry of entries) {
        for (const retained of missing.get(entry[0] as string)?.reverse() ?? []) ordered.push(retained);
        ordered.push(entry);
      }
      for (const retained of missing.get(undefined)?.reverse() ?? []) ordered.push(retained);
      replay.propertyOrder = ordered.map((entry) => entry[0] as string);
      iter = ordered;
    } else {
      iter = Object.entries(headers);
    }
  }
  // Reusing a tuple at another position still owns a separate initial accessor read.
  const rowOccurrences = new Map<HeaderEntry, number>();
  for (let row of iter) {
    const occurrence = rowOccurrences.get(row) ?? 0;
    if (!shouldClear && replay) rowOccurrences.set(row, occurrence + 1);
    // Replacing one tuple column must not reread an unchanged getter in the other.
    const retainedRows = !shouldClear ? replay?.rows?.get(row) : undefined;
    const retainedRow = retainedRows?.get(occurrence);
    const trackRow = !shouldClear && (retainedRow || replay?.refreshable);
    const nameDescriptor = trackRow ? getHeaderRowDescriptor(row, '0') : undefined;
    const retainName =
      retainedRow &&
      retainedRow.nameStateful &&
      (!nameDescriptor || sameHeaderProperty(nameDescriptor, retainedRow.nameDescriptor));
    const name = retainName ? retainedRow.name : row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const nameStateful = retainName || !nameDescriptor || !('value' in nameDescriptor);
    const valueDescriptor = trackRow ? getHeaderRowDescriptor(row, '1') : undefined;
    if (
      retainedRow &&
      retainedRow.valueStateful &&
      !retainedRow.values &&
      (!valueDescriptor || sameHeaderProperty(valueDescriptor, retainedRow.valueDescriptor))
    ) {
      retainedRows?.set(occurrence, {
        ...retainedRow,
        name,
        nameDescriptor: retainName ? retainedRow.nameDescriptor : nameDescriptor,
        nameStateful,
      });
      for (const [, value] of retainedRow.entries) yield [name, value];
      continue;
    }
    const capturedRow: (readonly [string, string | null])[] | undefined = trackRow ? [] : undefined;
    const retained = shouldClear ? replay?.properties?.get(name) : undefined;
    if (retained && !retained.values) {
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
    const descriptor = propertyDescriptors.get(name);
    const rowReplay = trackRow
      ? { refreshable: !!valueDescriptor && 'value' in valueDescriptor }
      : shouldClear && replay
        ? { refreshable: !descriptor || 'value' in descriptor }
        : replay;
    const property: HeaderPropertySnapshot | undefined =
      shouldClear && replay && descriptor ? { descriptor } : undefined;
    if (property && replay) replay.property = property;
    const retainedValues =
      retained?.values ??
      (retainedRow && (!valueDescriptor || sameHeaderProperty(valueDescriptor, retainedRow.valueDescriptor))
        ? retainedRow.values
        : undefined);
    const headerValue = retainedValues?.source ?? row[1];
    const values = isReadonlyArray(headerValue) ? headerValue : [headerValue];
    const statefulValues =
      rowReplay?.refreshable && isReadonlyArray(headerValue) && hasStatefulArrayProperties(values);
    const valueIterator = retainedValues?.iterator ?? values[Symbol.iterator];
    const valueSnapshot =
      replay && isReadonlyArray(headerValue) && valueIterator === getArrayIterator(values)
        ? (retainedValues ?? { source: values, iterator: valueIterator, slots: new Map() })
        : undefined;
    if (property && valueSnapshot) property.values = valueSnapshot;
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
      const capturedValue =
        capturedRow && !rowReplay?.refreshable && value !== null
          ? new Headers([[name, value]]).get(name)!
          : value;
      capturedRow?.push([name, capturedValue]);
      yield [name, capturedValue];
    }
    if (valueSnapshot?.slots.size && rowReplay) rowReplay.refreshable = false;
    if (capturedRow && replay) {
      if (nameStateful || !rowReplay?.refreshable) {
        replay.rows ??= new Map();
        const rows = replay.rows.get(row) ?? new Map<number, HeaderRowSnapshot>();
        rows.set(occurrence, {
          name,
          nameDescriptor: retainName ? retainedRow.nameDescriptor : nameDescriptor,
          nameStateful,
          valueDescriptor,
          valueStateful: !rowReplay?.refreshable,
          entries: capturedRow,
          ...(valueSnapshot ? { values: valueSnapshot } : {}),
        });
        replay.rows.set(row, rows);
      } else {
        retainedRows?.delete(occurrence);
        if (retainedRows?.size === 0) replay.rows?.delete(row);
      }
    }
    if (property && replay) {
      if (!rowReplay?.refreshable) {
        property.capture?.();
        delete property.capture;
        try {
          const current = Object.getOwnPropertyDescriptor(headers, name);
          if (current && sameHeaderProperty(current, property.descriptor)) {
            // A first read can hide itself; later visibility changes must still invalidate its replay.
            property.descriptor = { ...property.descriptor, enumerable: current.enumerable === true };
          }
        } catch {
          // A proxy may stop exposing descriptors after its first value was consumed.
        }
        replay.properties!.set(name, property);
      }
      delete replay.property;
    }
  }
  for (const [row, retained] of replay?.rows ?? []) {
    const occurrences = rowOccurrences.get(row) ?? 0;
    for (const occurrence of retained?.keys() ?? []) {
      if (occurrence >= occurrences) retained?.delete(occurrence);
    }
    if (retained?.size === 0) replay?.rows?.delete(row);
  }
}

const mergeHeaderEntries = (
  newHeaders: {
    source: HeadersLike;
    entries: Iterable<readonly [string, string | null]>;
    provenance: { unknown: boolean; values?: Headers };
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
        const credentialSource = provenance.values ?? source;
        const sourceCredential = credentialSource ? workloadHeaderCredential(credentialSource) : undefined;
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
        const property = replay.property;
        // Capture once after the property finishes, preserving platform normalization without rescanning
        // an expanding Set-Cookie collection after every append.
        property.capture ??= () => {
          const value = targetHeaders.get(lowerName);
          property.entry = [
            name,
            value !== null && lowerName === 'set-cookie'
              ? [...targetHeaders.entries()].filter(([key]) => key === lowerName).map(([, entry]) => entry)
              : value,
          ];
        };
      }
    }
    hasAuthorizationLayer ||= suppliesAuthorization;
  }
  const result = { [brand_privateNullableHeaders]: true as const, values: targetHeaders, nulls: nullHeaders };
  if (credential !== undefined) {
    const copiedCredential = copyWorkloadHeaderCredential(credential);
    rememberWorkloadHeaderCredential(result, copiedCredential, targetHeaders);
    rememberWorkloadHeaderValues(targetHeaders, copiedCredential);
  }
  return result;
};

interface HeaderReadContext {
  captured: WeakMap<object, NullableHeaders>;
  preferred: WeakMap<object, NullableHeaders>;
  onRead?: ((source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void) | undefined;
}

let headerReadContext: HeaderReadContext | undefined;
const capturedHeaderReplays = new WeakMap<NullableHeaders, { source: HeadersLike; replay: HeaderReplay }>();

const copyHeaderValues = <T extends { values?: HeaderValuesSnapshot }>(snapshot: T): T => ({
  ...snapshot,
  ...(snapshot.values ? { values: { ...snapshot.values, slots: new Map(snapshot.values.slots) } } : {}),
});

const copyHeaderReplay = (replay: HeaderReplay): HeaderReplay => ({
  ...replay,
  ...(replay.properties
    ? {
        properties: new Map(
          [...replay.properties].map(([key, property]) => [key, copyHeaderValues(property)]),
        ),
      }
    : {}),
  ...(replay.propertyOrder ? { propertyOrder: [...replay.propertyOrder] } : {}),
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

/** Captures synchronous protected-hook reads without leaving request state ambient across an await. */
export function captureHeaderReads<T>(
  operation: () => T,
  preferred: { source: HeadersLike; snapshot: NullableHeaders }[] = [],
  onRead?: (source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void,
): { result: T; captured: WeakMap<object, NullableHeaders> } {
  const previous = headerReadContext;
  const context: HeaderReadContext = { captured: new WeakMap(), preferred: new WeakMap(), onRead };
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
  const context = headerReadContext;
  const result = mergeHeaderEntries(
    newHeaders.map((originalSource) => {
      const source =
        typeof originalSource === 'object' && originalSource !== null
          ? (context?.preferred.get(originalSource) ?? originalSource)
          : originalSource;
      const provenance = { unknown: false };
      const replay = context && source === originalSource ? { refreshable: true } : undefined;
      const capturedReplay =
        replay ??
        (source && brand_privateNullableHeaders in source
          ? capturedHeaderReplays.get(source)?.replay
          : undefined);
      const entry = {
        source,
        provenance,
        ...(replay ? { replay } : {}),
        entries: iterateHeaders(source, replay, provenance),
      };
      if (!context || typeof originalSource !== 'object' || originalSource === null) return entry;

      // Capture each raw layer separately; merged hook headers cannot seed one source's snapshot.
      const snapshot = mergeHeaderEntries([entry]);
      context.captured.set(originalSource, snapshot);
      if (capturedReplay) {
        capturedHeaderReplays.set(snapshot, {
          source: originalSource,
          replay: copyHeaderReplay(capturedReplay),
        });
      }
      context.onRead?.(originalSource, snapshot);
      return { source: snapshot, provenance: { unknown: true }, entries: iterateHeaders(snapshot) };
    }),
  );
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
  customBuildInput?: {
    source: HeadersLike;
    defaultSource: HeadersLike;
    replayable: boolean;
    defaultReplayable: boolean;
    owned: boolean;
    independentAuthorization: boolean;
    preventCredentialUpgrade: boolean;
  };
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

/** Reads Request internal headers through its defining getter, bypassing caller property shadows. */
export const getRequestHeaders = (request: unknown): Headers | undefined => {
  if (typeof request !== 'object' || request === null) return undefined;
  try {
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
  } catch {
    // A Request-shaped proxy can pass instanceof without satisfying the platform's internal brand.
  }
  return undefined;
};
