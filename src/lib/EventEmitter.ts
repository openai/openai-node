/** The listener callback associated with one event name in an event map. */
type EventListener<Events, EventType extends keyof Events> = Events[EventType];

type EventListeners<Events, EventType extends keyof Events> = {
  listener: EventListener<Events, EventType>;
  once?: boolean;
  removed?: boolean;
  detached?: boolean;
}[];

/** The positional listener arguments associated with a named event. */
export type EventParameters<Events, EventType extends keyof Events> = Record<
  EventType,
  EventListener<Events, EventType> extends (...args: infer P) => any ? P : never
>[EventType];

/** Result of awaiting an event: no value, one unwrapped value, or its argument tuple. */
export type EmittedEventResult<Args extends unknown[]> = [Args] extends [[infer Param]]
  ? Param
  : [Args] extends [[]]
    ? void
    : [Args] extends [[unknown?]]
      ? Args[0]
      : [Args] extends [[unknown, unknown, ...unknown[]]]
        ? Args
        :
            | Args
            | ([] extends Args ? undefined : never)
            | (Args extends [...infer Prefix, infer Last] ? ([] extends Prefix ? Last : never) : Args[0]);

/** A lightweight event emitter with type-safe listeners and promise-based event waiting. */
export class EventEmitter<EventTypes extends Record<string, (...args: any) => any>> {
  #listeners: {
    [Event in keyof EventTypes]?: EventListeners<EventTypes, Event>;
  } = Object.create(null);
  #emittedListenerRegistrations = new WeakMap<
    object,
    { event: PropertyKey; registration: { removed?: boolean; detached?: boolean } }
  >();
  #pendingListenerCleanup = new Set<PropertyKey>();
  #listenerDispatchDepth = 0;

  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this, so that calls can be chained
   */
  on<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> = (this.#listeners[event] ||= []);
    listeners.push({ listener });
    return this;
  }

  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this, so that calls can be chained
   */
  off<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners = this.#listeners[event];
    if (!listeners) {
      return this;
    }

    // SAFETY: Listener functions are object identities used as WeakMap keys; registration and removal use the same function instance.
    const emittedRegistration = this.#emittedListenerRegistrations.get(listener as object);
    if (
      emittedRegistration?.event === event &&
      !emittedRegistration.registration.removed &&
      !emittedRegistration.registration.detached
    ) {
      // SAFETY: The stored registration event was compared with this event above, preserving the event/listener type correlation.
      this.#removeEmittedListener(
        event,
        emittedRegistration.registration as EventListeners<EventTypes, Event>[number],
      );
      return this;
    }
    const index = listeners.findIndex(
      (registration) => !registration.removed && registration.listener === listener,
    );
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    return this;
  }

  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this, so that calls can be chained
   */
  once<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> = (this.#listeners[event] ||= []);
    listeners.push({ listener, once: true });
    return this;
  }

  #onceForEmitted<Event extends keyof EventTypes>(
    event: Event,
    listener: EventListener<EventTypes, Event>,
  ): void {
    const previousListeners = this.#listeners[event];
    const previousLength = previousListeners?.length ?? 0;
    this.once(event, listener);
    const listeners = this.#listeners[event];
    const [registration] = listeners?.slice(-1) ?? [];
    if (
      (previousListeners === undefined || listeners === previousListeners) &&
      listeners?.length === previousLength + 1 &&
      registration?.listener === listener &&
      registration.once
    ) {
      // SAFETY: Listener functions are object identities used as WeakMap keys; registration and removal use the same function instance.
      this.#emittedListenerRegistrations.set(listener as object, { event, registration });
    }
  }

  #removeEmittedListener<Event extends keyof EventTypes>(
    event: Event,
    registration: EventListeners<EventTypes, Event>[number],
  ): void {
    if (registration.removed) {
      return;
    }

    registration.removed = true;
    // SAFETY: Listener functions are object identities used as WeakMap keys; registration and removal use the same function instance.
    this.#emittedListenerRegistrations.delete(registration.listener as object);
    this.#pendingListenerCleanup.add(event);
    if (this.#listenerDispatchDepth === 0) {
      this.#cleanupEmittedListeners();
    }
  }

  #cleanupEmittedListeners(): void {
    for (const event of this.#pendingListenerCleanup) {
      // SAFETY: Pending cleanup keys are added only from registered EventTypes events; the key retains its event-map membership.
      const eventType = event as keyof EventTypes;
      const listeners = this.#listeners[eventType];
      if (listeners) {
        // SAFETY: Filtering only removes registrations from the same event bucket and preserves the listener signatures for that event.
        this.#listeners[eventType] = listeners.filter((listener) => !listener.removed) as any;
      }
    }
    this.#pendingListenerCleanup.clear();
  }

  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * Events without arguments resolve to `undefined`, single-argument events resolve
   * to that argument, and events with multiple arguments resolve to an argument tuple.
   *
   * @returns A promise for the next event, or a rejection if an error occurs first.
   * Requesting the `error` event resolves with the emitted error instead.
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted<Event extends keyof EventTypes>(
    event: Event,
  ): Promise<EmittedEventResult<EventParameters<EventTypes, Event>>> {
    return new Promise((resolve, reject) => {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Failures and rejection reasons can be arbitrary JavaScript values; preserve them until inspection or forwarding.
      const onError = (error: unknown) => {
        // SAFETY: This callback is paired with the same event when registered and removed; its variadic body forwards the event tuple or captured error.
        this.off(event, onEvent as any);
        reject(error);
      };
      const onEvent = (...values: unknown[]) => {
        if (event !== 'error') {
          // SAFETY: This callback is paired with the same event when registered and removed; its variadic body forwards the event tuple or captured error.
          this.off('error', onError as any);
        }
        // SAFETY: The emitted API returns the sole argument or the full tuple according to its existing EventTypes-dependent result contract.
        resolve((values.length > 1 ? values : values[0]) as any);
      };

      if (event !== 'error') {
        // SAFETY: This callback is paired with the same event when registered and removed; its variadic body forwards the event tuple or captured error.
        this.#onceForEmitted('error', onError as any);
      }
      // SAFETY: This callback is paired with the same event when registered and removed; its variadic body forwards the event tuple or captured error.
      this.#onceForEmitted(event, onEvent as any);
    });
  }

  protected _emit<Event extends keyof EventTypes>(
    this: EventEmitter<EventTypes>,
    event: Event,
    ...args: EventParameters<EventTypes, Event>
  ) {
    const listeners: EventListeners<EventTypes, Event> | undefined = this.#listeners[event];
    if (listeners) {
      // SAFETY: Filtering only removes registrations from the same event bucket and preserves the listener signatures for that event.
      this.#listeners[event] = listeners.filter((listener) => {
        if (listener.once) {
          listener.detached = true;
        }
        return !listener.once && !listener.removed;
      }) as any;
      let listenerThrew = false;
      let firstListenerError: unknown;
      this.#listenerDispatchDepth += 1;
      try {
        // SAFETY: The listener bucket and argument tuple come from the same EventTypes key; this bridges TypeScript generic indexed-access correlation.
        for (const registration of listeners as any) {
          if (!registration.removed) {
            try {
              const { listener } = registration;
              // SAFETY: The listener bucket and argument tuple come from the same EventTypes key; this bridges TypeScript generic indexed-access correlation.
              listener(...(args as any));
            } catch (error) {
              if (!listenerThrew) {
                listenerThrew = true;
                firstListenerError = error;
              }
            }
          }
        }
      } finally {
        this.#listenerDispatchDepth -= 1;
        if (this.#listenerDispatchDepth === 0) {
          this.#cleanupEmittedListeners();
        }
      }
      if (listenerThrew) {
        throw firstListenerError;
      }
    }
  }

  protected _hasListener(event: keyof EventTypes): boolean {
    const listeners = this.#listeners[event];
    return listeners && listeners.some((listener) => !listener.removed);
  }
}
