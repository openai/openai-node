import { APIUserAbortError, OpenAIError } from '../error';

export class EventStream<EventTypes extends BaseEvents> {
  controller: AbortController = new AbortController();

  #connectedPromise: Promise<void>;
  #resolveConnectedPromise: () => void = () => {};
  #rejectConnectedPromise: (error: OpenAIError) => void = () => {};

  #endPromise: Promise<void>;
  #resolveEndPromise: () => void = () => {};
  #rejectEndPromise: (error: OpenAIError) => void = () => {};

  #listeners: {
    [Event in keyof EventTypes]?: EventListeners<EventTypes, Event>;
  } = {};
  #abortListeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  #ended = false;
  #errored = false;
  #aborted = false;
  #catchingPromiseCreated = false;

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
    this.#connectedPromise.catch(() => {});
    this.#endPromise.catch(() => {});
  }

  protected _run(this: EventStream<EventTypes>, executor: () => Promise<any>) {
    // Unfortunately if we call `executor()` immediately we get runtime errors about
    // references to `this` before the `super()` constructor call returns.
    setTimeout(() => {
      Promise.resolve()
        .then(executor)
        .then(() => {
          try {
            this._emitFinal();
          } catch (error) {
            this.#handleError(error);
            return;
          }
          this._emit('end');
        }, this.#handleError.bind(this));
    }, 0);
  }

  protected _connected(this: EventStream<EventTypes>) {
    if (this.ended) return;
    this.#resolveConnectedPromise();
    this._emit('connect');
  }

  get ended(): boolean {
    return this.#ended;
  }

  get errored(): boolean {
    return this.#errored;
  }

  get aborted(): boolean {
    return this.#aborted;
  }

  abort() {
    this.controller.abort();
  }

  protected _listenForAbort(signal: AbortSignal | null | undefined) {
    if (!signal || this.ended) return;
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
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  on<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> =
      this.#listeners[event] || (this.#listeners[event] = []);
    listeners.push({ listener });
    return this;
  }

  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  off<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners = this.#listeners[event];
    if (!listeners) return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0) listeners.splice(index, 1);
    return this;
  }

  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  once<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> =
      this.#listeners[event] || (this.#listeners[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }

  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted<Event extends keyof EventTypes>(
    event: Event,
  ): Promise<
    EventParameters<EventTypes, Event> extends [infer Param] ? Param
    : EventParameters<EventTypes, Event> extends [] ? void
    : EventParameters<EventTypes, Event>
  > {
    return new Promise((resolve, reject) => {
      this.#catchingPromiseCreated = true;
      if (event !== 'error') this.once('error', reject);
      this.once(event, resolve as any);
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
    type Result = IteratorResult<Parameters>;
    type Reader = {
      resolve: (result: Result) => void;
      reject: (error: OpenAIError) => void;
    };

    const pushQueue: Parameters[] = [];
    const readQueue: Reader[] = [];
    let ended = this.ended;
    let failure: OpenAIError | undefined;
    let failureDelivered = false;

    const doneResult = (): Result => ({ value: undefined as never, done: true });
    const finishReaders = () => {
      while (readQueue.length) {
        readQueue.shift()!.resolve(doneResult());
      }
    };
    const rejectReader = () => {
      if (!failure || failureDelivered || !readQueue.length) return;
      failureDelivered = true;
      readQueue.shift()!.reject(failure);
    };
    const cleanup = () => {
      this.off(event, onEvent as EventListener<EventTypes, Event>);
      this.off('end', onEnd);
      if (event !== 'error') this.off('error', onFailure);
      if (event !== 'abort') this.off('abort', onFailure);
    };
    const onEvent = (...args: Parameters) => {
      if (ended) return;
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve({ value: args, done: false });
      } else {
        pushQueue.push(args);
      }
    };
    const onFailure = (error: OpenAIError) => {
      failure = error;
      if (!pushQueue.length) rejectReader();
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
      this.on(event, onEvent as EventListener<EventTypes, Event>);
      this.on('end', onEnd);
      if (event !== 'error') this.on('error', onFailure);
      if (event !== 'abort') this.on('abort', onFailure);
    }

    return {
      next: () => {
        const value = pushQueue.shift();
        if (value) return Promise.resolve({ value, done: false });

        if (failure && !failureDelivered) {
          failureDelivered = true;
          return Promise.reject(failure);
        }

        if (ended) return Promise.resolve(doneResult());

        return new Promise<Result>((resolve, reject) => {
          readQueue.push({ resolve, reject });
        });
      },
      return: () => {
        ended = true;
        pushQueue.length = 0;
        cleanup();
        finishReaders();
        return Promise.resolve(doneResult());
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

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

  _emit<Event extends keyof BaseEvents>(event: Event, ...args: EventParameters<BaseEvents, Event>): void;
  _emit<Event extends keyof EventTypes>(event: Event, ...args: EventParameters<EventTypes, Event>): void;
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
      listeners.forEach(({ listener }: any) => listener(...(args as any)));
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

  protected _emitFinal(): void {}
}

type EventListener<Events, EventType extends keyof Events> = Events[EventType];

type EventListeners<Events, EventType extends keyof Events> = Array<{
  listener: EventListener<Events, EventType>;
  once?: boolean;
}>;

export type EventParameters<Events, EventType extends keyof Events> = {
  [Event in EventType]: EventListener<Events, EventType> extends (...args: infer P) => any ? P : never;
}[EventType];

export interface BaseEvents {
  connect: () => void;
  error: (error: OpenAIError) => void;
  abort: (error: APIUserAbortError) => void;
  end: () => void;
}
