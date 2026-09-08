import { HeaderDescriptorRead, observeHeaderDescriptor } from './header-descriptor-evidence';
import type { HeaderDescriptorHistory } from './header-descriptor-evidence';

export interface HeaderSlotSnapshot<T = unknown> {
  history: HeaderDescriptorHistory;
  input: T;
}

type HeaderPositions<T> = ReadonlyMap<T, ReadonlySet<number>>;
interface HeaderOccurrence {
  previous: number;
  current: number;
  moved: boolean;
  positions: ReadonlySet<number> | undefined;
}
type HeaderOccurrenceCounts<T> = Map<T, HeaderOccurrence>;

/** Records observed positions without assigning identities to indistinguishable duplicate occurrences. */
export const recordHeaderPosition = <T>(positions: Map<T, Set<number>>, input: T, index: number) => {
  const indices = positions.get(input) ?? new Set<number>();
  indices.add(index);
  positions.set(input, indices);
};

const duplicateHeaderOccurrences = <T>(
  previous: ReadonlyMap<T, number>,
  positions?: HeaderPositions<T>,
): HeaderOccurrenceCounts<T> =>
  new Map(
    [...previous]
      .filter(([, count]) => count > 1)
      .map(([input, count]) => [
        input,
        { previous: count, current: 0, moved: false, positions: positions?.get(input) },
      ]),
  );

const countHeaderOccurrence = (count: HeaderOccurrence | undefined, index: number, verified: boolean) => {
  if (!count) {
    return;
  }
  if (verified && count.current < count.previous && count.positions) {
    count.moved ||= !count.positions.has(index);
  }
  count.current += 1;
};

const countHeaderOccurrences = <T>(
  headers: readonly T[],
  length: number,
  slots: ReadonlyMap<number, HeaderSlotSnapshot<T>> | undefined,
  duplicates: HeaderOccurrenceCounts<T>,
  accessors: HeaderOccurrenceCounts<() => unknown>,
): boolean => {
  let unreadable = false;
  // Count captured opaque slots without rereading getters or inferring movement from a failed probe.
  for (let index = 0; (duplicates.size || accessors.size) && index < length; index += 1) {
    const observation = observeHeaderDescriptor(headers, String(index));
    const { descriptor } = observation;
    const retained = slots?.get(index);
    const verified = observation.state !== 'unknown';
    const getter = descriptor?.get ?? (verified ? undefined : retained?.history.before.descriptor?.get);
    countHeaderOccurrence(getter && accessors.get(getter), index, verified);
    let input: T;
    if (retained && new HeaderDescriptorRead(observation, retained.history).retained) {
      ({ input } = retained);
    } else if (descriptor && 'value' in descriptor) {
      input = descriptor.value;
    } else {
      unreadable = true;
      continue;
    }
    countHeaderOccurrence(duplicates.get(input), index, verified);
  }
  return unreadable;
};

const changedHeaderOccurrences = (count: HeaderOccurrence) => count.moved || count.current < count.previous;

/** Invalidates cached duplicates when observed removal or movement makes their ordinal ambiguous. */
export const invalidateHeaderSlots = <T>(
  headers: readonly T[],
  previous: ReadonlyMap<T, number>,
  slots: Map<number, HeaderSlotSnapshot<T>> | undefined,
  positions?: HeaderPositions<T>,
): Set<T> => {
  const duplicates = duplicateHeaderOccurrences(previous, positions);
  const length = observeHeaderDescriptor(headers, 'length').descriptor?.value;
  if (typeof length !== 'number') {
    return new Set();
  }
  const accessorPositions = new Map<() => unknown, Set<number>>();
  for (const [index, { history }] of slots ?? []) {
    const { descriptor } = history.before;
    if (descriptor?.get) {
      recordHeaderPosition(accessorPositions, descriptor.get, index);
    }
  }
  const accessors = duplicateHeaderOccurrences(
    new Map([...accessorPositions].map(([getter, indices]) => [getter, indices.size])),
    accessorPositions,
  );
  const unreadable = countHeaderOccurrences(headers, length, slots, duplicates, accessors);
  const invalidated = new Set(
    [...duplicates]
      .filter(([, count]) => unreadable || changedHeaderOccurrences(count))
      .map(([input]) => input),
  );
  for (const [index, slot] of slots ?? []) {
    const getter = slot.history.before.descriptor?.get;
    const count = getter && accessors.get(getter);
    if (count && changedHeaderOccurrences(count)) {
      slots?.delete(index);
      invalidated.add(slot.input);
    }
  }
  return invalidated;
};
