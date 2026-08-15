import { OpenAIError, APIError } from './error';
import type { ReadableStream } from '../internal/shim-types';
import { makeReadableStream, ReadableStreamToAsyncIterable } from '../internal/shims';
import { findDoubleNewlineIndex, LineDecoder } from '../internal/decoders/line';
import { isAbortError } from '../internal/errors';
import { encodeUTF8 } from '../internal/utils/bytes';
import { loggerFor } from '../internal/utils/log';
import type { OpenAI } from '../client';

type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

/** A decoded server-sent event before its JSON payload has been parsed. */
export type ServerSentEvent = {
  /** Explicit SSE event name, or `null` when the event has no `event:` field. */
  event: string | null;
  /** Joined contents of the event's `data:` fields. */
  data: string;
  /** Original event lines retained for diagnostics when parsing fails. */
  raw: string[];
};

/**
 * A single-consumption asynchronous API response stream.
 *
 * Use {@link Stream.tee} when two consumers need the same events. Breaking out of
 * a response-backed stream early aborts its request; branches created by `tee()`
 * instead share {@link Stream.controller} for explicit cancellation.
 */
export class Stream<Item> implements AsyncIterable<Item> {
  /** Abort controller for the underlying request and all branches created with `tee()`. */
  controller: AbortController;
  #client: OpenAI | undefined;
  private iterator: () => AsyncIterator<Item>;

  /** Wraps an asynchronous event iterator and the controller that owns its request. */
  constructor(iterator: () => AsyncIterator<Item>, controller: AbortController, client?: OpenAI) {
    this.iterator = iterator;
    this.controller = controller;
    this.#client = client;
  }

  /**
   * Decodes an SSE response into parsed JSON events.
   *
   * The resulting stream can be consumed only once, ignores events after `[DONE]`, and
   * surfaces API error payloads as `APIError` instances. When
   * `synthesizeEventData` is enabled, each item also includes its SSE event name.
   */
  static fromSSEResponse<Item>(
    response: Response,
    controller: AbortController,
    client?: OpenAI,
    synthesizeEventData?: boolean,
  ): Stream<Item> {
    let consumed = false;
    const logger = client ? loggerFor(client) : console;

    async function* iterator(): AsyncIterator<Item, any, undefined> {
      if (consumed) {
        throw new OpenAIError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
      }
      consumed = true;
      let done = false;
      let receivedCompletionSentinel = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.data.startsWith('[DONE]')) {
            receivedCompletionSentinel = true;
            break;
          }

          if (sse.event === null || !sse.event.startsWith('thread.')) {
            let data;

            try {
              data = JSON.parse(sse.data) as any;
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }

            if (data && data.error) {
              throw new APIError(undefined, data.error, undefined, response.headers);
            }

            yield synthesizeEventData ? { event: sse.event, data } : data;
          } else {
            let data;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              console.error(`Could not parse message into JSON:`, sse.data);
              console.error(`From chunk:`, sse.raw);
              throw e;
            }
            // SSE error events surface as APIError instances.
            if (sse.event === 'error') {
              throw new APIError(undefined, data.error, data.message, undefined);
            }
            yield { event: sse.event, data } as any;
          }
        }
        done = true;
      } catch (e) {
        // Abort errors and cleanup failures after the completion sentinel are non-fatal.
        if (
          receivedCompletionSentinel ||
          isAbortError(e) ||
          (controller.signal.aborted && e === controller.signal.reason)
        ) {
          return;
        }
        throw e;
      } finally {
        // If the user `break`s, abort the ongoing request.
        if (!done) {
          controller.abort();
        }
      }
    }

    return new Stream(iterator, controller, client);
  }

  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream<Item>(
    readableStream: ReadableStream,
    controller: AbortController,
    client?: OpenAI,
  ): Stream<Item> {
    let consumed = false;

    async function* iterLines(): AsyncGenerator<string, void, unknown> {
      const lineDecoder = new LineDecoder();
      const reader = readableStream.getReader();
      let closed = false;
      let cancelPromise: Promise<void> | undefined;
      const cancel = () => {
        cancelPromise ??= reader.cancel();
        cancelPromise.catch(() => undefined);
      };

      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        if (controller.signal.aborted) {
          cancel();
          return;
        }

        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) {
            closed = true;
            break;
          }
          if (controller.signal.aborted) {
            return;
          }

          for (const line of lineDecoder.decode(chunk)) {
            if (controller.signal.aborted) {
              return;
            }
            yield line;
          }
        }

        if (controller.signal.aborted) {
          return;
        }
        for (const line of lineDecoder.flush()) {
          if (controller.signal.aborted) {
            return;
          }
          yield line;
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        if (!closed) {
          cancel();
        }
        reader.releaseLock();
      }
    }

    async function* iterator(): AsyncIterator<Item, any, undefined> {
      if (consumed) {
        throw new OpenAIError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done) {
            continue;
          }
          if (line) {
            yield JSON.parse(line) as Item;
          }
        }
        done = true;
      } catch (e) {
        // If the user calls `stream.controller.abort()`, we should exit without throwing.
        if (controller.signal.aborted || isAbortError(e)) {
          return;
        }
        throw e;
      } finally {
        // If the user `break`s, abort the ongoing request.
        if (!done) {
          controller.abort();
        }
      }
    }

    return new Stream(iterator, controller, client);
  }

  /** Starts consuming this stream; attempting to consume it again throws. */
  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return this.iterator();
  }

  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee(): [Stream<Item>, Stream<Item>] {
    const left: Promise<IteratorResult<Item>>[] = [];
    const right: Promise<IteratorResult<Item>>[] = [];
    const iterator = this.iterator();

    const teeIterator = (queue: Promise<IteratorResult<Item>>[]): AsyncIterator<Item> => ({
      next: () => {
        if (queue.length === 0) {
          const result = iterator.next();
          left.push(result);
          right.push(result);
        }
        return queue.shift()!;
      },
    });

    return [
      new Stream(() => teeIterator(left), this.controller, this.#client),
      new Stream(() => teeIterator(right), this.controller, this.#client),
    ];
  }

  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream(): ReadableStream {
    let iter: AsyncIterator<Item>;

    return makeReadableStream({
      start: async () => {
        iter = this[Symbol.asyncIterator]();
      },
      async pull(ctrl: any) {
        try {
          const { value, done } = await iter.next();
          if (done) {
            return ctrl.close();
          }

          const bytes = encodeUTF8(JSON.stringify(value) + '\n');

          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      },
    });
  }
}

/**
 * Decodes complete SSE records from a response and aborts when its body is absent.
 *
 * @yields {ServerSentEvent} Each decoded server-sent event in wire order.
 */
export async function* _iterSSEMessages(
  response: Response,
  controller: AbortController,
): AsyncGenerator<ServerSentEvent, void, unknown> {
  if (!response.body) {
    controller.abort();
    if (
      (globalThis as any).navigator !== undefined &&
      (globalThis as any).navigator.product === 'ReactNative'
    ) {
      throw new OpenAIError(
        `The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`,
      );
    }
    throw new OpenAIError(`Attempted to iterate over a response with no body`);
  }

  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();

  const iter = ReadableStreamToAsyncIterable<Bytes>(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) {
        yield sse;
      }
    }
  }

  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) {
      yield sse;
    }
  }
}

// A `\r\n\r\n` separator may retain up to three bytes from the previous chunk.
const DOUBLE_NEWLINE_DELIMITER_MAX_OVERLAP_BYTES = 3;

/**
 * Given an async iterable iterator, iterates over it and yields full
 * SSE chunks, i.e. yields when a double new-line is encountered.
 *
 * @yields {Uint8Array} A complete SSE chunk.
 */
async function* iterSSEChunks(iterator: AsyncIterableIterator<Bytes>): AsyncGenerator<Uint8Array> {
  let data = new Uint8Array();
  let dataStart = 0;
  let dataEnd = 0;
  let searchStartIndex = 0;

  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }

    let binaryChunk: Uint8Array;
    if (chunk instanceof ArrayBuffer) {
      binaryChunk = new Uint8Array(chunk);
    } else if (typeof chunk === 'string') {
      binaryChunk = encodeUTF8(chunk);
    } else {
      binaryChunk = chunk;
    }

    if (dataEnd + binaryChunk.length > data.length) {
      const bufferedLength = dataEnd - dataStart;

      // Compact only when it reclaims substantial space without moving a large live tail repeatedly.
      if (dataStart >= data.length / 2 && bufferedLength + binaryChunk.length <= data.length) {
        data.copyWithin(0, dataStart, dataEnd);
      } else {
        const newData = new Uint8Array(Math.max(data.length * 2, bufferedLength + binaryChunk.length));
        newData.set(data.subarray(dataStart, dataEnd));
        data = newData;
      }

      searchStartIndex -= dataStart;
      dataStart = 0;
      dataEnd = bufferedLength;
    }

    data.set(binaryChunk, dataEnd);
    dataEnd += binaryChunk.length;

    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data.subarray(searchStartIndex, dataEnd))) !== -1) {
      patternIndex += searchStartIndex;
      yield data.slice(dataStart, patternIndex);
      dataStart = patternIndex;
      searchStartIndex = dataStart;
    }

    searchStartIndex = Math.max(dataStart, dataEnd - DOUBLE_NEWLINE_DELIMITER_MAX_OVERLAP_BYTES);
  }

  if (dataEnd > dataStart) {
    yield data.slice(dataStart, dataEnd);
  }
}

class SSEDecoder {
  private data: string[];
  private event: string | null = null;
  private chunks: string[];

  constructor() {
    this.data = [];
    this.chunks = [];
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }

    if (!line) {
      // empty line and we didn't previously encounter any messages
      if (!this.event && !this.data.length) {
        return null;
      }

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks,
      };

      this.event = null;
      this.data = [];
      this.chunks = [];

      return sse;
    }

    this.chunks.push(line);

    if (line.startsWith(':')) {
      return null;
    }

    const [fieldname, , initialValue] = partition(line, ':');
    let value = initialValue;

    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (fieldname === 'event') {
      this.event = value;
    } else if (fieldname === 'data') {
      this.data.push(value);
    }

    return null;
  }
}

function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.slice(0, index), delimiter, str.slice(index + delimiter.length)];
  }

  return [str, '', ''];
}
