import {
  ResponseTextConfig,
  type ParsedResponse,
  type Response,
  type ResponseCreateParamsBase,
  type ResponseCreateParamsStreaming,
  type ResponseStreamEvent,
} from '../../resources/responses/responses';
import { RequestOptions } from '../../internal/request-options';
import { type ReadableStream } from '../../internal/shim-types';
import { APIError, APIUserAbortError, OpenAIError } from '../../error';
import OpenAI from '../../index';
import { type BaseEvents, EventStream } from '../EventStream';
import { type ResponseFunctionCallArgumentsDeltaEvent, type ResponseTextDeltaEvent } from './EventTypes';
import { accumulateResponse } from './ResponseAccumulator';
import { maybeParseResponse, ParseableToolsParams } from '../ResponsesParser';
import { Stream } from '../../streaming';

export type ResponseStreamParams = ResponseCreateAndStreamParams | ResponseStreamByIdParams;

export type ResponseCreateAndStreamParams = Omit<ResponseCreateParamsBase, 'stream'> & {
  stream?: true;
};

export type ResponseStreamByIdParams = {
  /**
   * The ID of the response to stream.
   */
  response_id: string;
  /**
   * If provided, events with a sequence number less than or equal to this value
   * will not be emitted. The helper still replays them internally to build a
   * complete snapshot for later events and `finalResponse()`.
   */
  starting_after?: number;
  /**
   * Configuration options for a text response from the model. Can be plain text or
   * structured JSON data. Learn more:
   *
   * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
   * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
   */
  text?: ResponseTextConfig;

  /**
   * An array of tools the model may call while generating a response. When continuing a stream, provide
   * the same tools as the original request.
   */
  tools?: ParseableToolsParams;
};

type ResponseEvents = BaseEvents &
  Omit<
    {
      [K in ResponseStreamEvent['type']]: (event: Extract<ResponseStreamEvent, { type: K }>) => void;
    },
    'response.output_text.delta' | 'response.function_call_arguments.delta' | 'error'
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
    options?: RequestOptions,
  ): ResponseStream<ParsedT> {
    const runner = new ResponseStream<ParsedT>(params as ResponseCreateParamsStreaming);
    runner._run(() =>
      runner._createOrRetrieveResponse(client, params, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  static fromReadableStream(stream: ReadableStream): ResponseStream<null> {
    const runner = new ResponseStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  #beginRequest() {
    if (this.ended) return;
    this.#currentResponseSnapshot = undefined;
  }

  #addEvent(this: ResponseStream<ParsedT>, event: ResponseStreamEvent, starting_after: number | null) {
    if (this.ended) return;

    const maybeEmit = (name: string, event: ResponseStreamEvent & { snapshot?: string }) => {
      if (starting_after == null || event.sequence_number > starting_after) {
        this._emit(name as any, event);
      }
    };

    if (event.type === 'error') {
      // The API reports failures with an `error` event instead of a non-2xx response, so
      // convert it before snapshot accumulation and event emission. Throwing hands it to
      // `EventStream`'s error path, which rejects `finalResponse()` and async iteration.
      throw new APIError(undefined, event, event.message, undefined);
    }

    const response = accumulateResponse(event, this.#currentResponseSnapshot);
    this.#currentResponseSnapshot = response;
    maybeEmit('event', event);

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

          maybeEmit('response.output_text.delta', {
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
          maybeEmit('response.function_call_arguments.delta', {
            ...event,
            snapshot: output.arguments,
          });
        }
        break;
      }
      default:
        maybeEmit(event.type, event);
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

  protected async _createOrRetrieveResponse(
    client: OpenAI,
    params: ResponseStreamParams,
    options?: RequestOptions,
  ): Promise<ParsedResponse<ParsedT>> {
    this._listenForAbort(options?.signal);
    this.#beginRequest();

    let stream: Stream<ResponseStreamEvent> | undefined;
    let starting_after: number | null = null;
    if ('response_id' in params) {
      // Keep the full replay so that `accumulateResponse()` sees `response.created` and can build
      // complete snapshots before locally filtering events at `starting_after`.
      stream = await client.responses.retrieve(
        params.response_id,
        { stream: true },
        { ...options, signal: this.controller.signal, stream: true },
      );
      starting_after = params.starting_after ?? null;
    } else {
      stream = await client.responses.create(
        { ...params, stream: true },
        { ...options, signal: this.controller.signal },
      );
    }

    this._connected();
    for await (const event of stream) {
      this.#addEvent(event, starting_after);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this.#endRequest();
  }

  protected async _fromReadableStream(
    readableStream: ReadableStream,
    options?: RequestOptions,
  ): Promise<ParsedResponse<ParsedT>> {
    this._listenForAbort(options?.signal);
    this.#beginRequest();
    this._connected();
    const stream = Stream.fromReadableStream<ResponseStreamEvent>(readableStream, this.controller);
    for await (const event of stream) {
      this.#addEvent(event, null);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this.#endRequest();
  }

  [Symbol.asyncIterator](this: ResponseStream<ParsedT>): AsyncIterator<ResponseStreamEvent> {
    type Result = IteratorResult<ResponseStreamEvent>;
    type Reader = {
      resolve: (result: Result) => void;
      reject: (error: OpenAIError) => void;
    };

    const pushQueue: ResponseStreamEvent[] = [];
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
      this.off('event', onEvent);
      this.off('end', onEnd);
      this.off('abort', onFailure);
      this.off('error', onFailure);
    };
    const onEvent = (event: ResponseStreamEvent) => {
      if (ended) return;
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve({ value: event, done: false });
      } else {
        pushQueue.push(event);
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
      this.on('event', onEvent);
      this.on('end', onEnd);
      this.on('abort', onFailure);
      this.on('error', onFailure);
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
        this.abort();
        return Promise.resolve(doneResult());
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
