import type {
  ParsedResponse,
  Response,
  ResponseCreateParamsBase,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
  ResponseTextConfig,
} from '../../resources/responses/responses';
import type { RequestOptions } from '../../internal/request-options';
import type { ReadableStream } from '../../internal/shim-types';
import { APIUserAbortError, OpenAIError } from '../../error';
import type OpenAI from '../../index';
import { EventStream } from '../EventStream';
import type { BaseEvents } from '../EventStream';
import type { ResponseFunctionCallArgumentsDeltaEvent, ResponseTextDeltaEvent } from './EventTypes';
import { accumulateResponse } from './ResponseAccumulator';
import type { ParseableToolsParams } from '../ResponsesParser';
import { maybeParseResponse } from '../ResponsesParser';
import { Stream } from '../../streaming';

/** Parameters for starting a new response stream or replaying an existing response. */
export type ResponseStreamParams = ResponseCreateAndStreamParams | ResponseStreamByIdParams;

/** Response-creation parameters accepted by the streaming convenience helper. */
export type ResponseCreateAndStreamParams = Omit<ResponseCreateParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** Parameters for replaying an existing response and optionally filtering emitted events. */
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

/** Raw Responses API events, lifecycle notifications, and snapshot-enhanced delta listeners. */
type ResponseEvents = BaseEvents &
  Omit<
    {
      [K in ResponseStreamEvent['type']]: (
        event: Extract<
          ResponseStreamEvent,
          {
            /** Event discriminator that selects the listener's precise server-event payload. */
            type: K;
          }
        >,
      ) => void;
    },
    'response.output_text.delta' | 'response.function_call_arguments.delta'
  > & {
    /** Called for every raw response event that passes the replay sequence filter. */
    event: (event: ResponseStreamEvent) => void;
    /** Called with each text fragment and the complete text accumulated for its content part. */
    'response.output_text.delta': (event: ResponseTextDeltaEvent) => void;
    /** Called with each argument fragment and the complete JSON accumulated for its function call. */
    'response.function_call_arguments.delta': (event: ResponseFunctionCallArgumentsDeltaEvent) => void;
  };

/** Response request parameters retained to parse structured output and tool arguments. */
export type ResponseStreamingParams = Omit<ResponseCreateParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** Streams Responses API events while accumulating the latest response and parsed output. */
export class ResponseStream<ParsedT = null>
  extends EventStream<ResponseEvents>
  implements AsyncIterable<ResponseStreamEvent>
{
  #params: ResponseStreamingParams | null;
  #currentResponseSnapshot: Response | undefined;
  #finalResponse: ParsedResponse<ParsedT> | undefined;

  /** Creates an unstarted stream, retaining request parameters for structured-output parsing. */
  constructor(params: ResponseStreamingParams | null) {
    super();
    this.#params = params;
  }

  /** Starts a new response stream or replays an existing response by its identifier. */
  static createResponse<ParsedT>(
    client: OpenAI,
    params: ResponseStreamParams,
    options?: RequestOptions,
  ): ResponseStream<ParsedT> {
    const runner = new ResponseStream<ParsedT>(params as ResponseCreateParamsStreaming);
    runner._run(() =>
      runner._createOrRetrieveResponse(client, params, {
        ...options,
        __metadata: { ...options?.__metadata, helperMethod: 'stream' },
      }),
    );
    return runner;
  }

  /** Consumes serialized response events from a readable stream in another runtime. */
  static fromReadableStream(stream: ReadableStream): ResponseStream<null> {
    const runner = new ResponseStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  #beginRequest() {
    if (this.ended) {
      return;
    }
    this.#currentResponseSnapshot = undefined;
  }

  #addEvent(this: ResponseStream<ParsedT>, event: ResponseStreamEvent, starting_after: number | null) {
    if (this.ended) {
      return;
    }

    const maybeEmit = (name: string, event: ResponseStreamEvent & { snapshot?: string }) => {
      if (starting_after == null || event.sequence_number > starting_after) {
        this._emit(name as any, event);
      }
    };

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
      default: {
        maybeEmit(event.type, event);
        break;
      }
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

  /** Iterates over response events; stopping iteration early aborts the underlying request. */
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
   * Waits for the stream to end and returns its latest accumulated response.
   *
   * A clean end after at least one response event resolves even when the response is
   * incomplete. Network errors, cancellation, and streams without a response reject.
   */
  async finalResponse(): Promise<ParsedResponse<ParsedT>> {
    await this.done();
    const response = this.#finalResponse;
    if (!response) {
      throw new OpenAIError('stream ended without producing a Response');
    }
    return response;
  }
}

function finalizeResponse<ParsedT>(
  snapshot: Response,
  params: ResponseStreamingParams | null,
): ParsedResponse<ParsedT> {
  return maybeParseResponse(snapshot, params);
}
