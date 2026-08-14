import { APIUserAbortError, OpenAIError } from '../error';

type EventQueue<Value> = {
  readonly length: number;
  enqueue: (value: Value) => void;
  dequeue: () => Value | undefined;
  clear: () => void;
};

function createEventQueue<Value>(): EventQueue<Value> {
  let entries: (Value | undefined)[] = [];
  let head = 0;

  return {
    get length() {
      return entries.length - head;
    },
    enqueue(value) {
      entries.push(value);
    },
    dequeue() {
      if (head === entries.length) {
        return undefined;
      }

      const value = entries[head];
      entries[head] = undefined;
      head += 1;

      if (head === entries.length) {
        entries = [];
        head = 0;
      } else if (head >= 1024 && head * 2 >= entries.length) {
        entries = entries.slice(head);
        head = 0;
      }

      return value;
    },
    clear() {
      entries = [];
      head = 0;
    },
  };
}

/** An abortable event stream with typed listeners, asynchronous iteration, and lifecycle state. */
export class EventStream<EventTypes extends BaseEvents> {
  /** Controls the underlying request; aborting this controller cancels the stream. */
  controller: AbortController = new AbortController();

  #connectedPromise: Promise<void>;
  // oxlint-disable class-methods-use-this -- Deferred promise resolvers are intentionally per-instance mutable callbacks.
  #resolveConnectedPromise: () => void = () => undefined;
  #rejectConnectedPromise: (error: OpenAIError) => void = () => undefined;

  #endPromise: Promise<void>;
  #resolveEndPromise: () => void = () => undefined;
  #rejectEndPromise: (error: OpenAIError) => void = () => undefined;
  // oxlint-enable class-methods-use-this

  #listeners: {
    [Event in keyof EventTypes]?: EventListeners<EventTypes, Event>;
  } = Object.create(null);
  #abortListeners: { signal: AbortSignal; listener: () => void }[] = [];

  #ended = false;
  #errored = false;
  #aborted = false;
  #catchingPromiseCreated = false;

  /** Creates an unstarted stream with independent connection and completion lifecycle promises. */
  constructor() {
    this.#connectedPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnectedPromise = resolve;
      this.#rejectConnectedPromise = reject;
    });

    this.#endPromise = new Promise<void>((resolve, reject) => {
      this.#resolveEndPromise = resolve;
      this.#rejectEndPromise = reject;
    });

    // Don't let these promises cause unhandled rejection errors.
    // we will manually cause an unhandled rejection error later
    // if the user hasn't registered any error listener or called
    // any promise-returning method.
    this.#connectedPromise.catch(() => undefined);
    this.#endPromise.catch(() => undefined);
  }

  protected _run(this: EventStream<EventTypes>, executor: () => Promise<any>) {
    // Unfortunately if we call `executor()` immediately we get runtime errors about
    // references to `this` before the `super()` constructor call returns.
    setTimeout(() => {
      let failed = false;

      Promise.resolve()
        .then(executor)
        .catch((error) => {
          failed = true;
          this.#handleError(error);
        })
        .then(() => {
          if (failed) {
            return;
          }

          try {
            this._emitFinal();
          } catch (error) {
            this.#handleError(error);
            return;
          }
          this._emit('end');
        });
    }, 0);
  }

  protected _connected(this: EventStream<EventTypes>) {
    if (this.ended) {
      return;
    }
    this.#resolveConnectedPromise();
    this._emit('connect');
  }

  /** Whether the stream has finished successfully, failed, or been aborted. */
  get ended(): boolean {
    return this.#ended;
  }

  /** Whether an error or user cancellation has been observed. */
  get errored(): boolean {
    return this.#errored;
  }

  /** Whether the stream ended because its request was cancelled. */
  get aborted(): boolean {
    return this.#aborted;
  }

  /**
   * Cancels the underlying request; {@link done} and {@link events} observe cancellation.
   * Promises returned by {@link emitted} for other events may remain pending.
   */
  abort() {
    this.controller.abort();
  }

  protected _listenForAbort(signal: AbortSignal | null | undefined) {
    if (!signal || this.ended) {
      return;
    }
    if (signal.aborted) {
      this.controller.abort();
      return;
    }

    const listener = () => this.controller.abort();
    signal.addEventListener('abort', listener, { once: true });
    this.#abortListeners.push({ signal, listener });
  }

  #removeAbortListeners() {
    for (const { signal, listener } of this.#abortListeners.splice(0)) {
      signal.removeEventListener('abort', listener);
    }
  }

  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns This stream, so that listener registration calls can be chained.
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
   * @returns This stream, so that listener registration calls can be chained.
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
   * @returns This stream, so that listener registration calls can be chained.
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
      this.#catchingPromiseCreated = true;
      const onError = (error: OpenAIError) => {
        this.off(event, onEvent as EventListener<EventTypes, Event>);
        reject(error);
      };
      const onEvent = (...values: unknown[]) => {
        if (event !== 'error') {
          this.off('error', onError);
        }
        resolve((values.length > 1 ? values : values[0]) as any);
      };

      if (event !== 'error') {
        this.once('error', onError);
      }
      this.once(event, onEvent as EventListener<EventTypes, Event>);
    });
  }

  /**
   * Returns an async iterator that yields every time the event is triggered.
   * The iterator ends when the stream ends and rejects if the stream errors
   * or is aborted. If you request the 'error' or 'abort' event, the iterator
   * yields that event instead of rejecting.
   *
   * Example:
   *
   *   for await (const [message] of stream.events('message')) {
   *     await processMessage(message);
   *   }
   */
  events<Event extends keyof EventTypes>(
    event: Event,
  ): AsyncIterableIterator<EventParameters<EventTypes, Event>> {
    type Parameters = EventParameters<EventTypes, Event>;
    return this._createIterator<Parameters>(
      (push) => {
        const onEvent = (...args: Parameters) => push(args);
        this.on(event, onEvent as EventListener<EventTypes, Event>);
        return () => this.off(event, onEvent as EventListener<EventTypes, Event>);
      },
      {
        // When iterating the 'error' or 'abort' event itself, yield it as a
        // value instead of rejecting the iterator.
        rejectOnError: event !== 'error',
        rejectOnAbort: event !== 'abort',
      },
    );
  }

  /**
   * Shared buffered async-iterator adapter over this stream's events.
   *
   * `attach` registers the producer listener(s) with the given `push` and
   * returns a cleanup function that removes them. Termination is handled
   * here: the iterator ends when the stream ends, listeners are removed on
   * end/return, and a terminal error is retained until buffered values have
   * drained so it is surfaced even when no reader was waiting when it fired.
   */
  protected _createIterator<T>(
    attach: (push: (value: T) => void) => () => void,
    {
      rejectOnError = true,
      rejectOnAbort = true,
      onReturn,
    }: { rejectOnError?: boolean; rejectOnAbort?: boolean; onReturn?: () => void } = {},
  ): AsyncIterableIterator<T> {
    type Result = IteratorResult<T>;
    type Reader = {
      resolve: (result: Result) => void;
      reject: (error: OpenAIError) => void;
    };

    const pushQueue = createEventQueue<T>();
    const readQueue = createEventQueue<Reader>();
    let ended = this.ended;
    let failure: OpenAIError | undefined;
    let failureDelivered = false;
    let detach: () => void = () => undefined;

    const doneResult = (): Result => ({ value: undefined as never, done: true });
    const finishReaders = () => {
      while (readQueue.length) {
        readQueue.dequeue()!.resolve(doneResult());
      }
    };
    const rejectReader = () => {
      if (!failure || failureDelivered || !readQueue.length) {
        return;
      }
      failureDelivered = true;
      readQueue.dequeue()!.reject(failure);
    };
    const cleanup = () => {
      detach();
      this.off('end', onEnd);
      if (rejectOnError) {
        this.off('error', onFailure);
      }
      if (rejectOnAbort) {
        this.off('abort', onFailure);
      }
    };
    const push = (value: T) => {
      if (ended) {
        return;
      }
      const reader = readQueue.dequeue();
      if (reader) {
        reader.resolve({ value, done: false });
      } else {
        pushQueue.enqueue(value);
      }
    };
    const onFailure = (error: OpenAIError) => {
      failure = error;
      if (!pushQueue.length) {
        rejectReader();
      }
    };
    const onEnd = () => {
      ended = true;
      cleanup();
      if (!pushQueue.length) {
        rejectReader();
        finishReaders();
      }
    };

    if (!ended) {
      detach = attach(push);
      this.on('end', onEnd);
      if (rejectOnError) {
        this.on('error', onFailure);
      }
      if (rejectOnAbort) {
        this.on('abort', onFailure);
      }
    }

    return {
      next: (): Promise<Result> => {
        if (pushQueue.length) {
          return Promise.resolve({ value: pushQueue.dequeue()!, done: false });
        }

        if (failure && !failureDelivered) {
          failureDelivered = true;
          return Promise.reject(failure);
        }

        if (ended) {
          return Promise.resolve(doneResult());
        }

        return new Promise<Result>((resolve, reject) => {
          readQueue.enqueue({ resolve, reject });
        });
      },
      return: () => {
        ended = true;
        pushQueue.clear();
        cleanup();
        finishReaders();
        if (onReturn) {
          // The consumer explicitly ended iteration, so any failure the
          // onReturn callback triggers (e.g. aborting the stream) is
          // self-inflicted; mark the stream's terminal promise as handled so
          // it does not surface as an unhandled rejection.
          void this.done().catch(() => undefined);
          onReturn();
        }
        return Promise.resolve(doneResult());
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Resolves when the stream ends successfully or rejects when it fails or is aborted. */
  async done(): Promise<void> {
    this.#catchingPromiseCreated = true;
    await this.#endPromise;
  }

  #handleError(this: EventStream<EventTypes>, error: unknown) {
    this.#errored = true;
    if (error instanceof Error && error.name === 'AbortError') {
      error = new APIUserAbortError();
    }
    if (error instanceof APIUserAbortError) {
      this.#aborted = true;
      return this._emit('abort', error);
    }
    if (error instanceof OpenAIError) {
      return this._emit('error', error);
    }
    if (error instanceof Error) {
      const openAIError: OpenAIError = new OpenAIError(error.message);
      // @ts-ignore
      openAIError.cause = error;
      return this._emit('error', openAIError);
    }
    return this._emit('error', new OpenAIError(String(error)));
  }

  /** Returns whether an event currently has one or more registered listeners. */
  protected _hasListeners<Event extends keyof EventTypes>(event: Event): boolean {
    return Boolean(this.#listeners[event]?.length);
  }

  /** Dispatches a connection, failure, cancellation, or completion lifecycle event. */
  _emit<Event extends keyof BaseEvents>(event: Event, ...args: EventParameters<BaseEvents, Event>): void;
  /** Dispatches a typed stream event to all listeners registered for that event. */
  _emit<Event extends keyof EventTypes>(event: Event, ...args: EventParameters<EventTypes, Event>): void;
  /** Dispatches a stream event and performs the associated lifecycle transitions. */
  _emit<Event extends keyof EventTypes>(
    this: EventStream<EventTypes>,
    event: Event,
    ...args: EventParameters<EventTypes, Event>
  ) {
    // make sure we don't emit any events after end
    if (this.#ended) {
      return;
    }

    if (event === 'end') {
      this.#removeAbortListeners();
      this.#ended = true;
      this.#resolveEndPromise();
    }

    const listeners: EventListeners<EventTypes, Event> | undefined = this.#listeners[event];
    if (listeners) {
      this.#listeners[event] = listeners.filter((l) => !l.once) as any;
      for (const { listener } of listeners as any) {
        listener(...(args as any));
      }
    }

    if (event === 'abort') {
      const error = args[0] as APIUserAbortError;
      if (!this.#catchingPromiseCreated && !listeners?.length) {
        Promise.reject(error);
      }
      this.#rejectConnectedPromise(error);
      this.#rejectEndPromise(error);
      this._emit('end');
      return;
    }

    if (event === 'error') {
      // NOTE: _emit('error', error) should only be called from #handleError().

      const error = args[0] as OpenAIError;
      if (!this.#catchingPromiseCreated && !listeners?.length) {
        // Trigger an unhandled rejection if the user hasn't registered any error handlers.
        // If you are seeing stack traces here, make sure to handle errors via either:
        // - runner.on('error', () => ...)
        // - await runner.done()
        // - await runner.finalChatCompletion()
        // - etc.
        Promise.reject(error);
      }
      this.#rejectConnectedPromise(error);
      this.#rejectEndPromise(error);
      this._emit('end');
    }
  }

  // oxlint-disable-next-line class-methods-use-this -- Subclasses override this instance hook.
  protected _emitFinal(): void {
    // Hook for subclasses.
  }
}

/** The listener callback associated with one event name in a stream event map. */
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

/** Lifecycle events shared by all SDK streaming helpers. */
export interface BaseEvents {
  /** Called when the underlying request or readable stream is ready to produce events. */
  connect: () => void;
  /** Called when the stream fails for a reason other than user cancellation. */
  error: (error: OpenAIError) => void;
  /** Called when the underlying request is cancelled. */
  abort: (error: APIUserAbortError) => void;
  /** Called after a successful completion, failure, or cancellation. */
  end: () => void;
}
