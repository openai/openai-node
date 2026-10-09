import type {
  Response,
  ResponsesClientEvent,
  ResponsesServerEvent,
} from '../../resources/responses/responses';
import { WebSocketError } from '../../resources/responses/internal-base';
import { OpenAIError } from '../../core/error';
import { hasOwn, isObj } from '../../internal/utils/values';
import {
  cloneResponse,
  createCanonicalResponseContext,
  ensureCanonicalOutputText,
} from '../../internal/responses/canonical-output-text';

type WireResponse = Omit<Response, 'output' | 'output_text'> &
  Partial<Pick<Response, 'output' | 'output_text'>>;

type WireEvent<Event> = Event extends { response: Response }
  ? Omit<Event, 'response'> & {
      response: WireResponse;
    }
  : Event;

/** Raw lane events, including future types with unknown fields. Response output may be omitted. */
export type ResponsesWebSocketEvent =
  | WireEvent<ResponsesServerEvent>
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Future wire event fields have no SDK schema and must remain unknown to callers.
  | {
      /** The server's event tag, which may be newer than the SDK. */
      type: string;
      [key: string]: unknown;
    };

function isEventType<Type extends ResponsesServerEvent['type']>(
  event: ResponsesWebSocketEvent,
  ...types: Type[]
): event is Extract<WireEvent<ResponsesServerEvent>, { type: Type }> {
  return types.some((type) => event.type === type);
}

/** @internal */
export function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OpenAIError('Responses WebSocket limits must be positive integers');
  }
  return value;
}

/** A single ordered local consumer. Canceling receive cancels only that wait. */
export class ResponsesWebSocketLane {
  declare readonly streamID: string | undefined;
  readonly #streamID: string | undefined;
  readonly #send: (event: ResponsesClientEvent) => void;
  readonly #release: (bytes: number) => void;
  readonly #maxEvents: number;
  readonly #maxBytes: number;
  #bytes = 0;
  readonly #queue: ({ event: ResponsesWebSocketEvent; bytes: number } | undefined)[] = [];
  #queueHead = 0;
  #wake: (() => void) | undefined;
  #failure: Error | undefined;
  #reading = false;

  /** Created by ResponsesWebSocketSession.lane().
   * @internal
   */
  constructor(
    streamID: string | undefined,
    send: (event: ResponsesClientEvent) => void,
    release: (bytes: number) => void,
    maxEvents: number,
    maxBytes: number,
  ) {
    this.#streamID = streamID;
    Object.defineProperty(this, 'streamID', {
      value: streamID,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this.#send = send;
    this.#release = release;
    this.#maxEvents = maxEvents;
    this.#maxBytes = maxBytes;
  }

  /** Sends a request on this lane, omitting HTTP-only stream/background fields. previous_response_id remains caller-controlled. */
  create(
    request: Omit<
      Extract<ResponsesClientEvent, { type: 'response.create' }>,
      'type' | 'stream_id' | 'stream' | 'background'
    >,
  ): void {
    if (this.#failure) {
      throw this.#failure;
    }
    const event: Extract<ResponsesClientEvent, { type: 'response.create' }> = {
      ...request,
      type: 'response.create',
    };
    // The SDK owns this envelope; a top-level hook must not replace its routing.
    Object.defineProperty(event, 'toJSON', { value: undefined });
    delete event.stream;
    delete event.background;
    if (this.#streamID === undefined) {
      delete event.stream_id;
    } else {
      Object.defineProperty(event, 'stream_id', { value: this.#streamID, enumerable: true });
    }
    this.#send(event);
  }

  /** Returns the next raw event without filling omitted output or computing output_text. */
  async receive(options: { signal?: AbortSignal } = {}): Promise<ResponsesWebSocketEvent> {
    this.#acquireReader();
    try {
      const item = await this.#receive(options);
      return item.event;
    } finally {
      this.#reading = false;
    }
  }

  #acquireReader(): void {
    if (this.#reading) {
      throw new OpenAIError('Responses WebSocket lane already has a reader');
    }
    this.#reading = true;
  }

  async #receive(options: {
    signal?: AbortSignal | undefined;
  }): Promise<{ event: ResponsesWebSocketEvent; bytes: number }> {
    const { signal } = options;
    for (;;) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      const item = this.#queue[this.#queueHead];
      if (item) {
        this.#queue[this.#queueHead] = undefined;
        this.#queueHead += 1;
        if (this.#queueHead >= 64 && this.#queueHead * 2 >= this.#queue.length) {
          this.#queue.splice(0, this.#queueHead);
          this.#queueHead = 0;
        }
        this.#release(item.bytes);
        this.#bytes -= item.bytes;
        return item;
      }
      if (this.#failure) {
        throw this.#failure;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop, promise/avoid-new -- A single ordered consumer waits for socket callbacks; canceling a wait must preserve queued events.
      await new Promise<void>((resolve) => {
        this.#wake = () => resolve();
        signal?.addEventListener('abort', this.#wake, { once: true });
      }).finally(() => {
        if (this.#wake) {
          signal?.removeEventListener('abort', this.#wake);
        }
        this.#wake = undefined;
      });
    }
  }

  /**
   * Consumes the next response, returning completed, failed, or incomplete results.
   * Collects finalized items and uses the existing Responses snapshot normalizer.
   * Socket error events retain their nested data.
   * Raw events remain observable on the original connection. maxResponseBytes
   * optionally bounds the cumulative UTF-8 event bytes consumed for this result.
   * There is no cumulative limit unless maxResponseBytes is supplied; the lane's
   * queue budget only limits events waiting to be consumed. Exceeding the limit
   * before a terminal event fails this lane, so the partial response cannot be
   * consumed as a new result by a later call. Cancellation after consuming events
   * also fails the lane; cancellation before consuming anything leaves it reusable.
   * An invalid completed output item or terminal response fails only this lane.
   */
  async finalResponse(options: { signal?: AbortSignal; maxResponseBytes?: number } = {}): Promise<Response> {
    const { signal } = options;
    const maxBytes =
      options.maxResponseBytes === undefined ? Infinity : positiveInteger(options.maxResponseBytes);
    const completedOutput = new Map<number, Response['output'][number]>();
    let consumedBytes = 0;
    this.#acquireReader();
    try {
      for (;;) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Protocol order is required to accumulate one response.
        const { event, bytes } = await this.#receive({ signal });
        consumedBytes += bytes;
        const terminal = isEventType(
          event,
          'error',
          'response.completed',
          'response.failed',
          'response.incomplete',
        );
        if (consumedBytes > maxBytes) {
          const error = new OpenAIError('Responses WebSocket accumulated response limit exceeded');
          if (!terminal) {
            this.fail(error);
          }
          throw error;
        }
        if (isEventType(event, 'error')) {
          throw new WebSocketError('Responses WebSocket request failed', event);
        }
        if (isEventType(event, 'response.created')) {
          completedOutput.clear();
        } else if (isEventType(event, 'response.output_item.done')) {
          this.#validateOutputItem(event);
          completedOutput.set(event.output_index, structuredClone(event.item));
        }
        if (terminal) {
          this.#validateTerminalResponse(event);
          return this.#finalizeResponse(event.response, completedOutput);
        }
      }
    } catch (error) {
      if (consumedBytes > 0 && signal?.aborted) {
        this.fail(new OpenAIError('Responses WebSocket final response canceled after consuming events'));
      }
      throw error;
    } finally {
      this.#reading = false;
    }
  }

  #finalizeResponse(
    response: WireResponse,
    completedOutput: Map<number, Response['output'][number]>,
  ): Response {
    const context = createCanonicalResponseContext();
    try {
      // Socket deltas need not include the setup events required by SSE.
      // The terminal response is authoritative; finalized items fill an omitted output.
      const completedEntries = [...completedOutput];
      completedEntries.sort(([left], [right]) => left - right);
      const output = hasOwn(response, 'output') ? response.output : undefined;
      const outputText = hasOwn(response, 'output_text') ? response.output_text : undefined;
      if (
        (output !== undefined &&
          output !== null &&
          (!Array.isArray(output) ||
            !output.every((item) => ResponsesWebSocketLane.#isValidOutputItem(item)))) ||
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate present wire fields before exposing a typed final response.
        (outputText !== undefined && outputText !== null && typeof outputText !== 'string')
      ) {
        throw new OpenAIError('Invalid Responses WebSocket terminal response');
      }
      const snapshot = cloneResponse(context, {
        ...response,
        output: output ?? completedEntries.map(([, item]) => item),
        output_text: outputText ?? '',
      });
      if (outputText === undefined || outputText === null) {
        ensureCanonicalOutputText(context, snapshot);
      }
      return snapshot;
    } catch {
      const error = new OpenAIError('Invalid Responses WebSocket terminal response');
      this.fail(error);
      throw error;
    }
  }

  #validateOutputItem(event: { output_index: number; item: unknown }): void {
    if (
      !hasOwn(event, 'output_index') ||
      !Number.isSafeInteger(event.output_index) ||
      event.output_index < 0
    ) {
      const error = new OpenAIError('Responses WebSocket output index must be a nonnegative integer');
      this.fail(error);
      throw error;
    }
    if (!hasOwn(event, 'item')) {
      const error = new OpenAIError('Responses WebSocket output item must be an own property');
      this.fail(error);
      throw error;
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Completed output items must be wire objects before they enter the typed response.
    if (event.item === null || typeof event.item !== 'object' || Array.isArray(event.item)) {
      const error = new OpenAIError('Responses WebSocket output item must be an object');
      this.fail(error);
      throw error;
    }
    if (!ResponsesWebSocketLane.#isValidOutputItem(event.item)) {
      const error = new OpenAIError('Invalid Responses WebSocket completed output item');
      this.fail(error);
      throw error;
    }
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the wire boundary that validates untyped output items.
  static #isValidOutputItem(item: unknown): boolean {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Wire items require an own string discriminator, including unknown future variants.
    if (!isObj(item) || !hasOwn(item, 'type') || typeof item['type'] !== 'string') {
      return false;
    }
    if (item['type'] !== 'message') {
      return true;
    }
    return (
      hasOwn(item, 'content') &&
      Array.isArray(item['content']) &&
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Validate untyped message parts before exposing the final response.
      item['content'].every((content: unknown) => {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Message parts use the same wire discriminator contract.
        if (!isObj(content) || !hasOwn(content, 'type') || typeof content['type'] !== 'string') {
          return false;
        }
        return (
          content['type'] !== 'output_text' ||
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Canonical text accumulation consumes this exact wire field.
          (hasOwn(content, 'text') && typeof content['text'] === 'string')
        );
      })
    );
  }

  #validateTerminalResponse(event: { response?: unknown }): void {
    if (
      !hasOwn(event, 'response') ||
      event.response === null ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate the untrusted terminal envelope before normalizing a typed response snapshot.
      typeof event.response !== 'object' ||
      Array.isArray(event.response)
    ) {
      const error = new OpenAIError('Responses WebSocket terminal response must be an object');
      this.fail(error);
      throw error;
    }
  }

  /** Detaches this consumer without canceling remote work. Its ID remains reserved until reconnect. */
  close(): void {
    this.fail(new OpenAIError('Responses WebSocket lane is closed'));
  }

  /** Preserves already accepted events when the transport ends.
   * @internal
   */
  end(error: Error): void {
    if (this.#failure) {
      return;
    }
    this.#failure = error;
    // Keep queued events owned by the session until drain, close, or reconnect.
    this.#wake?.();
  }

  /** @internal */
  get ended(): boolean {
    return this.#failure !== undefined;
  }

  /** @internal */
  push(event: ResponsesWebSocketEvent, bytes: number): void {
    if (this.#failure) {
      this.#release(bytes);
      return;
    }
    if (this.#queue.length - this.#queueHead >= this.#maxEvents || bytes > this.#maxBytes - this.#bytes) {
      this.#release(bytes);
      this.fail(new OpenAIError('Responses WebSocket lane buffer limit exceeded'));
      return;
    }
    this.#bytes += bytes;
    this.#queue.push({ event, bytes });
    this.#wake?.();
  }

  /** @internal */
  fail(error: Error): void {
    this.#failure ??= error;
    for (const item of this.#queue) {
      if (item) {
        this.#release(item.bytes);
      }
    }
    this.#queue.length = 0;
    this.#queueHead = 0;
    this.#bytes = 0;
    this.#wake?.();
  }
}
