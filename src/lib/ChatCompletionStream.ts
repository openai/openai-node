import * as Core from 'openai/core';
import { OpenAIError, APIUserAbortError } from 'openai/error';
import {
  Completions,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionCreateParams,
  ChatCompletionCreateParamsBase,
} from 'openai/resources/chat/completions';
import {
  AbstractChatCompletionRunner,
  type AbstractChatCompletionRunnerEvents,
} from './AbstractChatCompletionRunner';
import { type ReadableStream } from 'openai/_shims/index';
import { Stream } from 'openai/streaming';

export interface ChatCompletionStreamEvents extends AbstractChatCompletionRunnerEvents {
  content: (contentDelta: string, contentSnapshot: string) => void;
  chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;
}

export type ChatCompletionStreamParams = Omit<ChatCompletionCreateParamsBase, 'stream'> & {
  stream?: true;
};

export class ChatCompletionStream
  extends AbstractChatCompletionRunner<ChatCompletionStreamEvents>
  implements AsyncIterable<ChatCompletionChunk>
{
  #currentChatCompletionSnapshot: ChatCompletionSnapshot | undefined;

  get currentChatCompletionSnapshot(): ChatCompletionSnapshot | undefined {
    return this.#currentChatCompletionSnapshot;
  }

  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream: ReadableStream): ChatCompletionStream {
    const runner = new ChatCompletionStream();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  static createChatCompletion(
    completions: Completions,
    params: ChatCompletionStreamParams,
    options?: Core.RequestOptions,
  ): ChatCompletionStream {
    const runner = new ChatCompletionStream();
    runner._run(() => runner._runChatCompletion(completions, { ...params, stream: true }, options));
    return runner;
  }

  #beginRequest() {
    if (this.ended) return;
    this.#currentChatCompletionSnapshot = undefined;
  }
  #addChunk(chunk: ChatCompletionChunk) {
    if (this.ended) return;
    const completion = this.#accumulateChatCompletion(chunk);
    this._emit('chunk', chunk, completion);
    const delta = chunk.choices[0]?.delta.content;
    const snapshot = completion.choices[0]?.message;
    if (delta != null && snapshot?.role === 'assistant' && snapshot?.content) {
      this._emit('content', delta, snapshot.content);
    }
  }
  #endRequest(): ChatCompletion {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = this.#currentChatCompletionSnapshot;
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any chunks`);
    }
    this.#currentChatCompletionSnapshot = undefined;
    return finalizeChatCompletion(snapshot);
  }

  protected override async _createChatCompletion(
    completions: Completions,
    params: ChatCompletionCreateParams,
    options?: Core.RequestOptions,
  ): Promise<ChatCompletion> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    this.#beginRequest();
    const stream = await completions.create(
      { ...params, stream: true },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    for await (const chunk of stream) {
      this.#addChunk(chunk);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(this.#endRequest());
  }

  protected async _fromReadableStream(
    readableStream: ReadableStream,
    options?: Core.RequestOptions,
  ): Promise<ChatCompletion> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    this.#beginRequest();
    this._connected();
    const stream = Stream.fromReadableStream<ChatCompletionChunk>(readableStream, this.controller);
    let chatId;
    for await (const chunk of stream) {
      if (chatId && chatId !== chunk.id) {
        // A new request has been made.
        this._addChatCompletion(this.#endRequest());
      }

      this.#addChunk(chunk);
      chatId = chunk.id;
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(this.#endRequest());
  }

  #accumulateChatCompletion(chunk: ChatCompletionChunk): ChatCompletionSnapshot {
    let snapshot = this.#currentChatCompletionSnapshot;
    if (!snapshot) {
      const { choices, ...rest } = chunk;
      this.#currentChatCompletionSnapshot = snapshot = {
        ...rest,
        choices: [],
      };
    }
    for (const { delta, finish_reason, index } of chunk.choices) {
      let choice = snapshot.choices[index];
      if (!choice) snapshot.choices[index] = choice = { finish_reason, index, message: delta };
      else {
        if (finish_reason) choice.finish_reason = finish_reason;
        const { content, function_call, role } = delta;
        if (content) choice.message.content = (choice.message.content || '') + content;
        if (role) choice.message.role = role;
        if (function_call) {
          if (!choice.message.function_call) choice.message.function_call = function_call;
          else {
            if (function_call.arguments)
              choice.message.function_call.arguments =
                (choice.message.function_call.arguments || '') + function_call.arguments;
            if (function_call.name) choice.message.function_call.name = function_call.name;
          }
        }
      }
    }
    return snapshot;
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    const pushQueue: ChatCompletionChunk[] = [];
    const readQueue: ((chunk: ChatCompletionChunk | undefined) => void)[] = [];
    let done = false;

    this.on('chunk', (chunk) => {
      const reader = readQueue.shift();
      if (reader) {
        reader(chunk);
      } else {
        pushQueue.push(chunk);
      }
    });

    this.on('end', () => {
      done = true;
      for (const reader of readQueue) {
        reader(undefined);
      }
      readQueue.length = 0;
    });

    return {
      next: async (): Promise<IteratorResult<ChatCompletionChunk>> => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise<ChatCompletionChunk | undefined>((resolve) => readQueue.push(resolve)).then(
            (chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }),
          );
        }
        const chunk = pushQueue.shift()!;
        return { value: chunk, done: false };
      },
    };
  }

  toReadableStream(): ReadableStream {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}

function finalizeChatCompletion(snapshot: ChatCompletionSnapshot): ChatCompletion {
  const { id, choices, created, model } = snapshot;
  return {
    id,
    choices: choices.map(({ message, finish_reason, index }): ChatCompletion.Choice => {
      if (!finish_reason) throw new OpenAIError(`missing finish_reason for choice ${index}`);
      const { content = null, function_call, role } = message;
      if (!role) throw new OpenAIError(`missing role for choice ${index}`);
      if (function_call) {
        const { arguments: args, name } = function_call;
        if (args == null) throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
        if (!name) throw new OpenAIError(`missing function_call.name for choice ${index}`);
        return { message: { content, function_call: { arguments: args, name }, role }, finish_reason, index };
      }
      return { message: { content: content, role }, finish_reason, index };
    }),
    created,
    model,
    object: 'chat.completion',
  };
}

/**
 * Represents a streamed chunk of a chat completion response returned by model,
 * based on the provided input.
 */
export interface ChatCompletionSnapshot {
  /**
   * A unique identifier for the chat completion.
   */
  id: string;

  /**
   * A list of chat completion choices. Can be more than one if `n` is greater
   * than 1.
   */
  choices: Array<ChatCompletionSnapshot.Choice>;

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created.
   */
  created: number;

  /**
   * The model to generate the completion.
   */
  model: string;
}

export namespace ChatCompletionSnapshot {
  export interface Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    message: Choice.Message;

    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, or `function_call`
     * if the model called a function.
     */
    finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter' | null;

    /**
     * The index of the choice in the list of choices.
     */
    index: number;
  }

  export namespace Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    export interface Message {
      /**
       * The contents of the chunk message.
       */
      content?: string | null;

      /**
       * The name and arguments of a function that should be called, as generated by the
       * model.
       */
      function_call?: Message.FunctionCall;

      /**
       * The role of the author of this message.
       */
      role?: 'system' | 'user' | 'assistant' | 'function';
    }

    export namespace Message {
      /**
       * The name and arguments of a function that should be called, as generated by the
       * model.
       */
      export interface FunctionCall {
        /**
         * The arguments to call the function with, as generated by the model in JSON
         * format. Note that the model does not always generate valid JSON, and may
         * hallucinate parameters not defined by your function schema. Validate the
         * arguments in your code before calling your function.
         */
        arguments?: string;

        /**
         * The name of the function to call.
         */
        name?: string;
      }
    }
  }
}
