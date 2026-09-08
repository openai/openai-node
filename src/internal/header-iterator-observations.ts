import { sameHeaderProperty } from './header-descriptor-evidence';

interface IteratorProperty {
  source: object;
  descriptor: PropertyDescriptor;
  identity: object;
  predecessor: object | undefined;
}

interface IteratorObservation<T> extends IteratorProperty {
  entry: T | undefined;
}

const sameIteratorProperty = (property: IteratorProperty, source: object, descriptor: PropertyDescriptor) =>
  property.source === source &&
  sameHeaderProperty(descriptor, property.descriptor) &&
  descriptor.enumerable === property.descriptor.enumerable;

/** Shares completed record cursor reads between related header layers and retries. */
export class HeaderIteratorObservations<T> {
  private observations = new WeakMap<object, Map<string, IteratorObservation<T>>>();
  private properties = new Map<string, IteratorProperty>();

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
    if (!source || !descriptor) {
      this.properties.delete(name);
      return;
    }
    const previous = history?.get(name)?.value === undefined ? undefined : this.properties.get(name);
    const observed = this.observations.get(iteration)?.get(name);
    let property = previous;
    if (!property || !sameIteratorProperty(property, source, descriptor)) {
      // Siblings observing the same transition can share its completed value. Restoring an
      // exhausted older source has a different predecessor and cannot revive its observation.
      property =
        !refreshable &&
        observed &&
        previous &&
        observed.predecessor === previous.identity &&
        sameIteratorProperty(observed, source, descriptor)
          ? observed
          : { source, descriptor, identity: {}, predecessor: previous?.identity };
    }
    this.properties.set(name, property);
    const reused = !!(
      !refreshable &&
      observed &&
      observed.identity === property.identity &&
      sameIteratorProperty(observed, source, descriptor)
    );
    const selectedProperty = property;
    return {
      reused,
      // An undefined entry can represent a successfully completed, non-emitting cursor.
      entry: reused ? observed?.entry : undefined,
      complete: (completed: { descriptor: PropertyDescriptor; entry?: T } | undefined) => {
        if (!completed) {
          return;
        }
        const { descriptor: completedDescriptor, entry } = completed;
        const completedProperty = { ...selectedProperty, descriptor: completedDescriptor };
        this.properties.set(name, completedProperty);
        if (refreshable) {
          return;
        }
        const entries = this.observations.get(iteration) ?? new Map<string, IteratorObservation<T>>();
        // A layer that observed removal must not replace a sibling's completed observation with an empty read.
        if (!entries.has(name)) {
          entries.set(name, { ...completedProperty, entry });
          this.observations.set(iteration, entries);
        }
      },
    };
  }

  /** Releases property ownership that is absent from the completed layer. */
  retain(history: ReadonlyMap<string, unknown> | undefined): void {
    for (const name of this.properties.keys()) {
      if (!history?.has(name)) {
        this.properties.delete(name);
      }
    }
  }

  /** Shares completed values while keeping each layer's property ownership independent. */
  fork(): HeaderIteratorObservations<T> {
    const fork = new HeaderIteratorObservations<T>();
    fork.observations = this.observations;
    fork.properties = new Map(this.properties);
    return fork;
  }
}
