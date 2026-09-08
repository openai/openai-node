import { sameHeaderProperty } from './header-descriptor-evidence';

interface IteratorObservation<T> {
  source: object;
  descriptor: PropertyDescriptor;
  entry: T | undefined;
}

/** Shares completed record cursor reads between related header layers and retries. */
export class HeaderIteratorObservations<T> {
  private readonly observations = new WeakMap<object, Map<string, IteratorObservation<T>>>();

  /** Selects a prior read without reviving a property whose layer observed removal or replacement. */
  capture(
    iteration: object,
    {
      source,
      name,
      descriptor,
      history,
      refreshable,
    }: {
      source: object | undefined;
      name: string;
      descriptor: PropertyDescriptor | undefined;
      history: ReadonlyMap<string, { value?: T | null }> | undefined;
      refreshable: boolean;
    },
  ) {
    if (refreshable || !source || !descriptor) {
      return;
    }
    const observed = this.observations.get(iteration)?.get(name);
    const reused = !!(
      history?.get(name)?.value !== undefined &&
      observed &&
      observed.source === source &&
      sameHeaderProperty(descriptor, observed.descriptor) &&
      descriptor.enumerable === observed.descriptor.enumerable
    );
    return {
      reused,
      // An undefined entry can represent a successfully completed, non-emitting cursor.
      entry: reused ? observed?.entry : undefined,
      complete: (completed: { descriptor: PropertyDescriptor; entry?: T } | undefined) => {
        if (!completed) {
          return;
        }
        const { descriptor: completedDescriptor, entry } = completed;
        const entries = this.observations.get(iteration) ?? new Map<string, IteratorObservation<T>>();
        // A layer that observed removal must not replace a sibling's completed observation with an empty read.
        if (!entries.has(name)) {
          entries.set(name, { source, descriptor: completedDescriptor, entry });
          this.observations.set(iteration, entries);
        }
      },
    };
  }
}
