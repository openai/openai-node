import * as Core from 'openai/core';
import { type CompletionUsage } from 'openai/resources/completions';
import {
  type Completions,
  type ChatCompletion,
  type ChatCompletionMessage,
  type ChatCompletionMessageParam,
  type ChatCompletionCreateParams,
} from 'openai/resources/chat/completions';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import {
  type RunnableFunction,
  isRunnableFunctionWithParse,
  type BaseFunctionsArgs,
} from './RunnableFunction';
import { ChatCompletionFunctionRunnerParams } from './ChatCompletionRunner';
import { ChatCompletionStreamingFunctionRunnerParams } from './ChatCompletionStreamingRunner';

export abstract class AbstractChatCompletionRunner<
  Events extends CustomEvents<any> = AbstractChatCompletionRunnerEvents,
> {
  controller: AbortController = new AbortController();

  #connectedPromise: Promise<void>;
  #resolveConnectedPromise: () => void = () => {};
  #rejectConnectedPromise: (error: OpenAIError) => void = () => {};

  #endPromise: Promise<void>;
  #resolveEndPromise: () => void = () => {};
  #rejectEndPromise: (error: OpenAIError) => void = () => {};

  #listeners: { [Event in keyof Events]?: ListenersForEvent<Events, Event> } = {};

  protected _chatCompletions: ChatCompletion[] = [];
  messages: (ChatCompletionMessage | ChatCompletionMessageParam)[] = [];

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
        this._emitFinal();
        this._emit('end');
      }, this.#handleError);
    }, 0);
  }

  protected _addChatCompletion(chatCompletion: ChatCompletion): ChatCompletion {
    this._chatCompletions.push(chatCompletion);
    this._emit('chatCompletion', chatCompletion);
    const message = chatCompletion.choices[0]?.message;
    if (message) this._addMessage(message);
    return chatCompletion;
  }

  protected _addMessage(message: ChatCompletionMessage | ChatCompletionMessageParam, emit = true) {
    this.messages.push(message);
    if (emit) {
      this._emit('message', message);
      if (message.role === 'function' && message.content) {
        this._emit('functionCallResult', message.content);
      } else if (message.function_call) {
        this._emit('functionCall', message.function_call);
      }
    }
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

  /**
   * @returns a promise that resolves with the final ChatCompletion, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
   */
  async finalChatCompletion(): Promise<ChatCompletion> {
    await this.done();
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (!completion) throw new OpenAIError('stream ended without producing a ChatCompletion');
    return completion;
  }

  #getFinalContent(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.role === 'assistant') return message.content;
    }
    return null;
  }

  /**
   * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalContent(): Promise<string | null> {
    await this.done();
    return this.#getFinalContent();
  }

  /**
   * @returns a promise that resolves with the the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalMessage(): Promise<ChatCompletionMessage> {
    await this.done();
    const message = this.messages[this.messages.length - 1];
    if (!message) throw new OpenAIError('stream ended without producing a ChatCompletionMessage');
    return message;
  }

  #getFinalFunctionCall(): ChatCompletionMessage.FunctionCall | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.function_call) return message.function_call;
    }
  }

  /**
   * @returns a promise that resolves with the content of the final FunctionCall, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalFunctionCall(): Promise<ChatCompletionMessage.FunctionCall | undefined> {
    await this.done();
    return this.#getFinalFunctionCall();
  }

  #getFinalFunctionCallResult(): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.role === 'function' && message.content != null) return message.content;
    }
  }

  async finalFunctionCallResult(): Promise<string | undefined> {
    await this.done();
    return this.#getFinalFunctionCallResult();
  }

  #calculateTotalUsage(): CompletionUsage {
    const total: CompletionUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    };
    for (const { usage } of this._chatCompletions) {
      if (usage) {
        total.completion_tokens += usage.completion_tokens;
        total.prompt_tokens += usage.prompt_tokens;
        total.total_tokens += usage.total_tokens;
      }
    }
    return total;
  }

  async totalUsage(): Promise<CompletionUsage> {
    await this.done();
    return this.#calculateTotalUsage();
  }

  allChatCompletions(): ChatCompletion[] {
    return [...this._chatCompletions];
  }

  #handleError = (error: unknown) => {
    this.#errored = true;
    if (error instanceof Error && error.name === 'AbortError') {
      error = new APIUserAbortError();
    }
    if (error instanceof APIUserAbortError) {
      this.#aborted = true;
      this._emit('abort', error);
    }
    const openAIError: OpenAIError =
      error instanceof OpenAIError ? error : (
        new OpenAIError(error instanceof Error ? error.message : String(error))
      );
    this._emit('error', openAIError);
  };

  protected _emit<Event extends keyof Events>(event: Event, ...args: EventParameters<Events, Event>) {
    // make sure we don't emit any events after end
    if (this.#ended) return;

    if (event === 'end') {
      this.#ended = true;
      this.#resolveEndPromise();
    }

    const listeners: ListenersForEvent<Events, Event> | undefined = this.#listeners[event];
    if (listeners) {
      this.#listeners[event] = listeners.filter((l) => !l.once) as any;
      listeners.forEach(({ listener }: any) => listener(...args));
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

  protected _emitFinal() {
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (completion) this._emit('finalChatCompletion', completion);
    const finalMessage = this.messages[this.messages.length - 1];
    if (finalMessage) this._emit('finalMessage', finalMessage);
    const finalContent = this.#getFinalContent();
    if (finalContent) this._emit('finalContent', finalContent);

    const finalFunctionCall = this.#getFinalFunctionCall();
    if (finalFunctionCall) this._emit('finalFunctionCall', finalFunctionCall);

    const finalFunctionCallResult = this.#getFinalFunctionCallResult();
    if (finalFunctionCallResult != null) this._emit('finalFunctionCallResult', finalFunctionCallResult);

    if (this._chatCompletions.some((c) => c.usage)) {
      this._emit('totalUsage', this.#calculateTotalUsage());
    }
  }

  protected async _createChatCompletion(
    completions: Completions,
    params: ChatCompletionCreateParams,
    options?: Core.RequestOptions,
  ): Promise<ChatCompletion> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    const chatCompletion = await completions.create(
      { ...params, stream: false },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    return this._addChatCompletion(chatCompletion);
  }

  protected async _runChatCompletion(
    completions: Completions,
    params: ChatCompletionCreateParams,
    options?: Core.RequestOptions,
  ): Promise<ChatCompletion> {
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    return await this._createChatCompletion(completions, params, options);
  }

  protected async _runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    completions: Completions,
    params:
      | ChatCompletionFunctionRunnerParams<FunctionsArgs>
      | ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions & { maxChatCompletions?: number },
  ) {
    const { function_call = 'auto', stream, ...restParams } = params;
    const isSingleFunctionCall = typeof function_call !== 'string' && function_call?.name;

    const functionsByName: Record<string, RunnableFunction<any>> = {};
    for (const f of params.functions) {
      functionsByName[f.name || f.function.name] = f;
    }

    const functions: ChatCompletionCreateParams.Function[] = params.functions.map(
      (f): ChatCompletionCreateParams.Function => ({
        name: f.name || f.function.name,
        parameters: f.parameters as Record<string, unknown>,
        description: f.description,
      }),
    );

    for (const message of params.messages) {
      this._addMessage(message, false);
    }

    for (let i = 0; i < (options?.maxChatCompletions ?? 5); ++i) {
      const chatCompletion: ChatCompletion = await this._createChatCompletion(
        completions,
        {
          ...restParams,
          function_call,
          functions,
          messages: [...this.messages],
        },
        options,
      );
      const message = chatCompletion.choices[0]?.message;
      if (!message) {
        throw new OpenAIError(`missing message in ChatCompletion response`);
      }
      if (!message.function_call) return;
      const { name, arguments: args } = message.function_call;
      const fn = functionsByName[name];
      if (!fn || (typeof function_call !== 'string' && name !== function_call?.name)) {
        this._addMessage({
          role: 'function',
          name,
          content: `Invalid function_call: ${JSON.stringify(name)}. Available options are: ${functions
            .map((f) => JSON.stringify(f.name))
            .join(', ')}. Please try again`,
        });
        if (isSingleFunctionCall) return;
        continue;
      }
      let parsed;
      try {
        parsed = isRunnableFunctionWithParse(fn) ? await fn.parse(args) : args;
      } catch (error) {
        this._addMessage({
          role: 'function',
          name,
          content: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const rawContent = await (fn.function as any)(parsed as any, this);
      const content =
        typeof rawContent === 'string' ? rawContent
        : rawContent === undefined ? 'undefined'
        : JSON.stringify(rawContent);
      this._addMessage({ role: 'function', name, content });

      if (isSingleFunctionCall) return;
    }
  }
}

type CustomEvents<Event extends string> = {
  [k in Event]: k extends keyof AbstractChatCompletionRunnerEvents ? AbstractChatCompletionRunnerEvents[k]
  : (...args: any[]) => void;
};

type ListenerForEvent<
  Events extends CustomEvents<any>,
  Event extends keyof Events,
> = Event extends keyof AbstractChatCompletionRunnerEvents ? AbstractChatCompletionRunnerEvents[Event]
: Events[Event];

type ListenersForEvent<Events extends CustomEvents<any>, Event extends keyof Events> = Array<{
  listener: ListenerForEvent<Events, Event>;
  once?: boolean;
}>;
type EventParameters<Events extends CustomEvents<any>, Event extends keyof Events> = Parameters<
  ListenerForEvent<Events, Event>
>;

export interface AbstractChatCompletionRunnerEvents {
  connect: () => void;
  functionCall: (functionCall: ChatCompletionMessage.FunctionCall) => void;
  message: (message: ChatCompletionMessage | ChatCompletionMessageParam) => void;
  chatCompletion: (completion: ChatCompletion) => void;
  finalContent: (contentSnapshot: string) => void;
  finalMessage: (message: ChatCompletionMessage | ChatCompletionMessageParam) => void;
  finalChatCompletion: (completion: ChatCompletion) => void;
  finalFunctionCall: (functionCall: ChatCompletionMessage.FunctionCall) => void;
  functionCallResult: (content: string) => void;
  finalFunctionCallResult: (content: string) => void;
  error: (error: OpenAIError) => void;
  abort: (error: APIUserAbortError) => void;
  end: () => void;
  totalUsage: (usage: CompletionUsage) => void;
}
