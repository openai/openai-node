import {
  type ParsedResponse,
  type Response,
  type ResponseCreateParamsBase,
  type ResponseCreateParamsStreaming,
  type ResponseStreamEvent,
} from '../../resources/responses/responses';
import * as Core from '../../core';
import { APIUserAbortError, OpenAIError } from '../../error';
import OpenAI from '../../index';
import { type BaseEvents, EventStream } from '../EventStream';
import { type ResponseFunctionCallArgumentsDeltaEvent, type ResponseTextDeltaEvent } from './EventTypes';
import { maybeParseResponse } from '../ResponsesParser';

export type ResponseStreamParams = Omit<ResponseCreateParamsBase, 'stream'> & {
  stream?: true;
};

type ResponseEvents = BaseEvents &
  Omit<
    {
      [K in ResponseStreamEvent['type']]: (event: Extract<ResponseStreamEvent, { type: K }>) => void;
    },
    'response.output_text.delta' | 'response.function_call_arguments.delta'
  > & {
    event: (event: ResponseStreamEvent) => void;
    'response.output_text.delta': (event: ResponseTextDeltaEvent) => void;
    'response.function_call_arguments.delta': (event: ResponseFunctionCallArgumentsDeltaEvent) => void;
  };

export type ResponseStreamingParams = Omit<ResponseCreateParamsBase, 'stream'> & {
  stream?: true;
};

export class ResponseStream<ParsedT = null>
  extends EventStream<ResponseEvents>
  implements AsyncIterable<ResponseStreamEvent>
{
  #params: ResponseStreamingParams | null;
  #currentResponseSnapshot: Response | undefined;
  #finalResponse: ParsedResponse<ParsedT> | undefined;

  constructor(params: ResponseStreamingParams | null) {
    super();
    this.#params = params;
  }

  static createResponse<ParsedT>(
    client: OpenAI,
    params: ResponseStreamParams,
    options?: Core.RequestOptions,
  ): ResponseStream<ParsedT> {
    const runner = new ResponseStream<ParsedT>(params as ResponseCreateParamsStreaming);
    runner._run(() =>
      runner._createResponse(client, params, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  #beginRequest() {
    if (this.ended) return;
    this.#currentResponseSnapshot = undefined;
  }

  #addEvent(this: ResponseStream<ParsedT>, event: ResponseStreamEvent) {
    if (this.ended) return;

    const response = this.#accumulateResponse(event);
    this._emit('event', event);

    switch (event.type) {
      case 'response.output_text.delta': {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === 'message') {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== 'output_text') {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }

          this._emit('response.output_text.delta', {
            ...event,
            snapshot: content.text,
          });
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === 'function_call') {
          this._emit('response.function_call_arguments.delta', {
            ...event,
            snapshot: output.arguments,
          });
        }
        break;
      }
      default:
        // @ts-ignore
        this._emit(event.type, event);
        break;
    }
  }

  #endRequest(): ParsedResponse<ParsedT> {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = this.#currentResponseSnapshot;
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any events`);
    }
    this.#currentResponseSnapshot = undefined;
    const parsedResponse = finalizeResponse<ParsedT>(snapshot, this.#params);
    this.#finalResponse = parsedResponse;

    return parsedResponse;
  }

  protected async _createResponse(
    client: OpenAI,
    params: ResponseStreamingParams,
    options?: Core.RequestOptions,
  ): Promise<ParsedResponse<ParsedT>> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
    this.#beginRequest();

    const stream = await client.responses.create(
      { ...params, stream: true },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    for await (const event of stream) {
      this.#addEvent(event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this.#endRequest();
  }

  #accumulateResponse(event: ResponseStreamEvent): Response {
    let snapshot = this.#currentResponseSnapshot;
    if (!snapshot) {
      if (event.type !== 'response.created') {
        throw new OpenAIError(
          `When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`,
        );
      }
      snapshot = this.#currentResponseSnapshot = event.response;
      return snapshot;
    }

    switch (event.type) {
      case 'response.output_item.added': {
        snapshot.output.push(event.item);
        break;
      }
      case 'response.content_part.added': {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === 'message') {
          output.content.push(event.part);
        }
        break;
      }
      case 'response.output_text.delta': {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === 'message') {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== 'output_text') {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          content.text += event.delta;
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === 'function_call') {
          output.arguments += event.delta;
        }
        break;
      }
      case 'response.completed': {
        this.#currentResponseSnapshot = event.response;
        break;
      }
    }

    return snapshot;
  }

  [Symbol.asyncIterator](this: ResponseStream<ParsedT>): AsyncIterator<ResponseStreamEvent> {
    const pushQueue: ResponseStreamEvent[] = [];
    const readQueue: {
      resolve: (event: ResponseStreamEvent | undefined) => void;
      reject: (err: unknown) => void;
    }[] = [];
    let done = false;

    this.on('event', (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });

    this.on('end', () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(undefined);
      }
      readQueue.length = 0;
    });

    this.on('abort', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    this.on('error', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    return {
      next: async (): Promise<IteratorResult<ResponseStreamEvent>> => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise<ResponseStreamEvent | undefined>((resolve, reject) =>
            readQueue.push({ resolve, reject }),
          ).then((event) => (event ? { value: event, done: false } : { value: undefined, done: true }));
        }
        const event = pushQueue.shift()!;
        return { value: event, done: false };
      },
      return: async () => {
        this.abort();
        return { value: undefined, done: true };
      },
    };
  }

  /**
   * @returns a promise that resolves with the final Response, or rejects
   * if an error occurred or the stream ended prematurely without producing a REsponse.
   */
  async finalResponse(): Promise<ParsedResponse<ParsedT>> {
    await this.done();
    const response = this.#finalResponse;
    if (!response) throw new OpenAIError('stream ended without producing a ChatCompletion');
    return response;
  }
}

function finalizeResponse<ParsedT>(
  snapshot: Response,
  params: ResponseStreamingParams | null,
): ParsedResponse<ParsedT> {
  return maybeParseResponse(snapshot, params);
}
