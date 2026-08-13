/** The listener callback associated with one event name in an event map. */
type EventListener<Events, EventType extends keyof Events> = Events[EventType];

type EventListeners<Events, EventType extends keyof Events> = {
  listener: EventListener<Events, EventType>;
  once?: boolean;
}[];

/** The positional listener arguments associated with a named event. */
export type EventParameters<Events, EventType extends keyof Events> = Record<
  EventType,
  EventListener<Events, EventType> extends (...args: infer P) => any ? P : never
>[EventType];

/** A lightweight event emitter with type-safe listeners and promise-based event waiting. */
export class EventEmitter<EventTypes extends Record<string, (...args: any) => any>> {
  #listeners: {
    [Event in keyof EventTypes]?: EventListeners<EventTypes, Event>;
  } = Object.create(null);

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
    const index = listeners.findIndex((l) => l.listener === listener);
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
  ): Promise<
    EventParameters<EventTypes, Event> extends [infer Param]
      ? Param
      : EventParameters<EventTypes, Event> extends []
        ? void
        : EventParameters<EventTypes, Event>
  > {
    return new Promise((resolve, reject) => {
      const onError = (error: unknown) => {
        this.off(event, onEvent as any);
        reject(error);
      };
      const onEvent = (...values: unknown[]) => {
        if (event !== 'error') {
          this.off('error', onError as any);
        }
        resolve((values.length > 1 ? values : values[0]) as any);
      };

      if (event !== 'error') {
        this.once('error', onError as any);
      }
      this.once(event, onEvent as any);
    });
  }

  protected _emit<Event extends keyof EventTypes>(
    this: EventEmitter<EventTypes>,
    event: Event,
    ...args: EventParameters<EventTypes, Event>
  ) {
    const listeners: EventListeners<EventTypes, Event> | undefined = this.#listeners[event];
    if (listeners) {
      this.#listeners[event] = listeners.filter((l) => !l.once) as any;
      for (const { listener } of listeners as any) {
        listener(...(args as any));
      }
    }
  }

  protected _hasListener(event: keyof EventTypes): boolean {
    const listeners = this.#listeners[event];
    return listeners && listeners.length > 0;
  }
}
