/** Distinguishes an unavailable probe from confirmed absence and a visible descriptor. */
export type HeaderDescriptorObservation =
  | { readonly state: 'unknown' | 'absent'; readonly descriptor: undefined }
  | { readonly state: 'present'; readonly descriptor: PropertyDescriptor };

/** A probe that could not establish whether the property exists. */
export const unknownHeaderDescriptor: HeaderDescriptorObservation = {
  state: 'unknown',
  descriptor: undefined,
};

const absentHeaderDescriptor: HeaderDescriptorObservation = { state: 'absent', descriptor: undefined };

/** Immutable evidence surrounding the original value read, shared safely across replay forks. */
export interface HeaderDescriptorHistory {
  /** Descriptor observed before reading or coercing the retained value. */
  readonly before: HeaderDescriptorObservation;
  /** Earliest available evidence after that read, including a getter's self-removal. */
  readonly after: HeaderDescriptorObservation;
}

/** Reads the defining descriptor without invoking a property getter. */
export const observeHeaderDescriptor = (
  source: object,
  key: string | symbol,
): HeaderDescriptorObservation => {
  const seen = new Set<object>();
  try {
    for (let object: object | null = source; object; object = Object.getPrototypeOf(object)) {
      if (seen.has(object)) {
        return unknownHeaderDescriptor;
      }
      seen.add(object);
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) {
        return { state: 'present', descriptor };
      }
    }
    return absentHeaderDescriptor;
  } catch {
    // An unavailable descriptor does not make the actual value read invalid.
    return unknownHeaderDescriptor;
  }
};

/** Compares value/getter identity; record visibility is handled by the record replay owner. */
export const sameHeaderProperty = (
  current: PropertyDescriptor | undefined,
  previous: PropertyDescriptor | undefined,
): boolean => {
  if (!current || !previous) {
    return current === previous;
  }
  if ('value' in current) {
    return 'value' in previous && current.value === previous.value;
  }
  return !('value' in previous) && current.get === previous.get;
};

const retainsHistory = (current: HeaderDescriptorObservation, history: HeaderDescriptorHistory): boolean => {
  if (current.state === 'unknown') {
    return true;
  }
  if (current.state === 'absent') {
    return history.after.state !== 'present';
  }
  return (
    sameHeaderProperty(current.descriptor, history.before.descriptor) ||
    sameHeaderProperty(current.descriptor, history.after.descriptor)
  );
};

/** Owns retention, invalidation and evidence recovery for one slot or tuple-column read. */
export class HeaderDescriptorRead {
  private readonly history: HeaderDescriptorHistory | undefined;
  readonly observation: HeaderDescriptorObservation;

  /** Starts a read, discarding prior evidence only when the current probe proves a change. */
  constructor(observation: HeaderDescriptorObservation, previous?: HeaderDescriptorHistory) {
    this.observation = observation;
    this.history = previous && retainsHistory(observation, previous) ? previous : undefined;
  }

  /** Whether the prior captured value still belongs to this property. */
  get retained(): boolean {
    return this.history !== undefined;
  }

  /** Whether a fresh read needs capture instead of ordinary live data-slot iteration. */
  needsCapture(input: unknown, after: HeaderDescriptorObservation, force = false): boolean {
    const { descriptor } = this.observation;
    return (
      force ||
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.value !== input ||
      after.state === 'unknown' ||
      !sameHeaderProperty(after.descriptor, descriptor)
    );
  }

  /** Completes a read, recovering unknown evidence without replacing known self-removal history. */
  complete(after: HeaderDescriptorObservation): HeaderDescriptorHistory {
    let recovered = after;
    if (this.history) {
      if (this.history.after.state === 'unknown') {
        if (after.state === 'unknown') {
          recovered = this.observation;
        }
      } else {
        recovered = this.history.after;
      }
    }
    return {
      before: this.history?.before ?? this.observation,
      after: recovered,
    };
  }
}
