import * as Core from 'openai/core';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import { Run, RunSubmitToolOutputsParamsBase } from 'openai/resources/beta/threads/runs/runs';
import { RunCreateParamsBase, Runs } from 'openai/resources/beta/threads/runs/runs';
import { ThreadCreateAndRunParamsBase, Threads } from 'openai/resources/beta/threads/threads';

export abstract class AbstractAssistantStreamRunner<
  Events extends CustomEvents<any> = AbstractAssistantRunnerEvents,
> {
  controller: AbortController = new AbortController();

  #connectedPromise: Promise<void>;
  #resolveConnectedPromise: () => void = () => {};
  #rejectConnectedPromise: (error: OpenAIError) => void = () => {};

  #endPromise: Promise<void>;
  #resolveEndPromise: () => void = () => {};
  #rejectEndPromise: (error: OpenAIError) => void = () => {};

  #listeners: { [Event in keyof Events]?: ListenersForEvent<Events, Event> } = {};

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

  protected _run(executor: () => Promise<any>) {
    // Unfortunately if we call `executor()` immediately we get runtime errors about
    // references to `this` before the `super()` constructor call returns.
    setTimeout(() => {
      executor().then(() => {
        // this._emitFinal();
        this._emit('end');
      }, this.#handleError);
    }, 0);
  }

  protected _addRun(run: Run): Run {
    return run;
  }

  protected _connected() {
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

  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  on<Event extends keyof Events>(event: Event, listener: ListenerForEvent<Events, Event>): this {
    const listeners: ListenersForEvent<Events, Event> =
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
  off<Event extends keyof Events>(event: Event, listener: ListenerForEvent<Events, Event>): this {
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
  once<Event extends keyof Events>(event: Event, listener: ListenerForEvent<Events, Event>): this {
    const listeners: ListenersForEvent<Events, Event> =
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
  emitted<Event extends keyof Events>(
    event: Event,
  ): Promise<
    EventParameters<Events, Event> extends [infer Param] ? Param
    : EventParameters<Events, Event> extends [] ? void
    : EventParameters<Events, Event>
  > {
    return new Promise((resolve, reject) => {
      this.#catchingPromiseCreated = true;
      if (event !== 'error') this.once('error', reject);
      this.once(event, resolve as any);
    });
  }

  async done(): Promise<void> {
    this.#catchingPromiseCreated = true;
    await this.#endPromise;
  }

  #handleError = (error: unknown) => {
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
  };

  protected _emit<Event extends keyof Events>(event: Event, ...args: EventParameters<Events, Event>) {
    // make sure we don't emit any events after end
    if (this.#ended) {
      return;
    }

    if (event === 'end') {
      this.#ended = true;
      this.#resolveEndPromise();
    }

    const listeners: ListenersForEvent<Events, Event> | undefined = this.#listeners[event];
    if (listeners) {
      this.#listeners[event] = listeners.filter((l) => !l.once) as any;
      listeners.forEach(({ listener }: any) => listener(...args));
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

  protected async _threadAssistantStream(
    body: ThreadCreateAndRunParamsBase,
    thread: Threads,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    return await this._createThreadAssistantStream(thread, body, options);
  }

  protected async _runAssistantStream(
    threadId: string,
    runs: Runs,
    params: RunCreateParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    return await this._createAssistantStream(runs, threadId, params, options);
  }

  protected async _runToolAssistantStream(
    threadId: string,
    runId: string,
    runs: Runs,
    params: RunSubmitToolOutputsParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    return await this._createToolAssistantStream(runs, threadId, runId, params, options);
  }

  protected async _createThreadAssistantStream(
    thread: Threads,
    body: ThreadCreateAndRunParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    // this.#validateParams(params);

    const runResult = await thread.createAndRun(
      { ...body, stream: false },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    return this._addRun(runResult as Run);
  }

  protected async _createToolAssistantStream(
    run: Runs,
    threadId: string,
    runId: string,
    params: RunSubmitToolOutputsParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }

    const runResult = await run.submitToolOutputs(
      threadId,
      runId,
      { ...params, stream: false },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    return this._addRun(runResult as Run);
  }

  protected async _createAssistantStream(
    run: Runs,
    threadId: string,
    params: RunCreateParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    // this.#validateParams(params);

    const runResult = await run.create(
      threadId,
      { ...params, stream: false },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    return this._addRun(runResult as Run);
  }
}

type CustomEvents<Event extends string> = {
  [k in Event]: k extends keyof AbstractAssistantRunnerEvents ? AbstractAssistantRunnerEvents[k]
  : (...args: any[]) => void;
};

type ListenerForEvent<Events extends CustomEvents<any>, Event extends keyof Events> = Event extends (
  keyof AbstractAssistantRunnerEvents
) ?
  AbstractAssistantRunnerEvents[Event]
: Events[Event];

type ListenersForEvent<Events extends CustomEvents<any>, Event extends keyof Events> = Array<{
  listener: ListenerForEvent<Events, Event>;
  once?: boolean;
}>;
type EventParameters<Events extends CustomEvents<any>, Event extends keyof Events> = Parameters<
  ListenerForEvent<Events, Event>
>;

export interface AbstractAssistantRunnerEvents {
  connect: () => void;
  run: (run: Run) => void;
  error: (error: OpenAIError) => void;
  abort: (error: APIUserAbortError) => void;
  end: () => void;
}
