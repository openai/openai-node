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
import { APIError, OpenAIError } from '../../error';
import type OpenAI from '../../index';
import { EventStream } from '../EventStream';
import type { BaseEvents } from '../EventStream';
import type { ResponseFunctionCallArgumentsDeltaEvent, ResponseTextDeltaEvent } from './EventTypes';
import {
  accumulateResponseWithContext,
  cloneValidatedResponse,
  createResponseContext,
  hasRoutedOutputCallIdentity,
  replaceResponseOutputItem,
  validateResponseOutputItemIdentity,
} from '../../internal/responses/response-accumulator';
import { ensureCanonicalOutputText } from '../../internal/responses/canonical-output-text';
import { hasOwn, isObj } from '../../internal/utils/values';
import type { ParseableToolsParams } from '../ResponsesParser';
import { addOutputText, maybeParseResponse } from '../ResponsesParser';
import { Stream } from '../../streaming';

type EventField<Event> = Event extends unknown ? keyof Event : never;

// Require every generated native event field here. Unknown hidden transport members remain private.
const nativeEventFields: Record<EventField<ResponseStreamEvent>, true> = {
  annotation: true,
  annotation_index: true,
  arguments: true,
  background: true,
  code: true,
  command: true,
  command_index: true,
  content_index: true,
  delta: true,
  input: true,
  item: true,
  item_id: true,
  logprobs: true,
  message: true,
  obfuscation: true,
  output: true,
  output_format: true,
  output_index: true,
  param: true,
  part: true,
  partial_image_b64: true,
  partial_image_index: true,
  quality: true,
  refusal: true,
  response: true,
  sequence_number: true,
  size: true,
  status: true,
  summary_index: true,
  text: true,
  type: true,
};

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

/** Responses API events with normalized lifecycle output and snapshot-enhanced delta listeners. */
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
    'response.output_text.delta' | 'response.function_call_arguments.delta' | 'error'
  > & {
    /** Called for every supported response event that passes the replay sequence filter. */
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
  #accumulatorContext = createResponseContext();
  #outputPositions = new Map<number, number>();
  #wireByIdentity = new Map<string, number>();
  #interimOrderDirty = false;
  #completedOutput = new Map<number, Response['output'][number]>();
  #unfinishedOutput = new Map<number, string>();

  /** Creates an unstarted stream, retaining request parameters for structured-output parsing. */
  constructor(params: ResponseStreamingParams | null) {
    super();
    this.#params = params;
    this.once('end', () => {
      this.#outputPositions.clear();
      this.#wireByIdentity.clear();
      this.#completedOutput.clear();
      this.#unfinishedOutput.clear();
    });
  }

  /** Starts a new response stream or replays an existing response by its identifier. */
  static createResponse<ParsedT>(
    client: OpenAI,
    params: ResponseStreamParams,
    options?: RequestOptions,
  ): ResponseStream<ParsedT> {
    // SAFETY: The runner's request path forces stream: true; the constructor retains the same caller parameters for parsing metadata.
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
    this.#accumulatorContext = createResponseContext();
    this.#outputPositions.clear();
    this.#wireByIdentity.clear();
    this.#interimOrderDirty = false;
    this.#completedOutput.clear();
    this.#unfinishedOutput.clear();
  }

  #prepareEvent(event: ResponseStreamEvent): ResponseStreamEvent | null {
    if (
      event.type === 'response.created' ||
      event.type === 'response.queued' ||
      event.type === 'response.in_progress' ||
      event.type === 'response.completed' ||
      event.type === 'response.failed' ||
      event.type === 'response.incomplete'
    ) {
      if (!hasOwn(event, 'response')) {
        throw new OpenAIError('Lifecycle events require their own response field.');
      }
      const { response: wireResponse, ...fields } = event;
      if (!isObj(wireResponse)) {
        throw new OpenAIError('Lifecycle events require a response object.');
      }
      let response = structuredClone(wireResponse);
      if (this.#currentResponseSnapshot && response.id !== this.#currentResponseSnapshot.id) {
        throw new OpenAIError('Lifecycle response identity changed.');
      }
      if (!hasOwn(response, 'output') || response.output == null) {
        let output: Response['output'];
        if (event.type === 'response.completed') {
          output = [...this.#completedOutput]
            // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array; ES2020 declarations do not include toSorted.
            .sort(([left], [right]) => left - right)
            .map(([, item]) => structuredClone(item));
        } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          output = [...this.#outputPositions.keys()]
            // oxlint-disable-next-line unicorn/no-array-sort -- Sort fresh wire indexes; retain partial and completed items.
            .sort((left, right) => left - right)
            .map((index) => structuredClone(this.#outputAtWireIndex(index)!));
        } else {
          output = [];
        }
        response = { ...response, output };
        if (
          event.type === 'response.completed' ||
          event.type === 'response.failed' ||
          event.type === 'response.incomplete'
        ) {
          addOutputText(response);
        }
      }
      if (event.type === 'response.completed') {
        this.#assertComplete(response);
      }
      return { ...fields, type: event.type, sequence_number: event.sequence_number, response };
    }
    return this.#prepareOutputEvent(event);
  }

  #prepareOutputEvent(event: ResponseStreamEvent): ResponseStreamEvent | null {
    if (!this.#currentResponseSnapshot || !hasOwn(event, 'output_index') || !('output_index' in event)) {
      return event;
    }
    const index = event.output_index;
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new OpenAIError('Invalid response output index.');
    }
    let position: number;
    if (event.type === 'response.output_item.added') {
      if (event.item == null) {
        return null;
      }
      if (this.#completedOutput.has(index) || this.#unfinishedOutput.has(index)) {
        throw new OpenAIError(`Duplicate response output index ${index}.`);
      }
      position = this.#currentResponseSnapshot.output.length;
    } else {
      const existing = this.#outputPositions.get(index);
      if (existing === undefined) {
        throw new OpenAIError(`missing output at index ${index}`);
      }
      position = existing;
    }
    return new Proxy(event, {
      get(target, property) {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- Preserve the sanitized event fields and their receiver while translating only the dispatch index.
        return property === 'output_index' ? position : Reflect.get(target, property, target);
      },
    });
  }

  #outputAtWireIndex(wireIndex: number): Response['output'][number] | undefined {
    const position = this.#outputPositions.get(wireIndex);
    return (
      this.#completedOutput.get(wireIndex) ??
      (position === undefined ? undefined : this.#currentResponseSnapshot?.output[position])
    );
  }

  #assertComplete(response: Response): void {
    if (this.#unfinishedOutput.size === 0 && this.#completedOutput.size === 0) {
      return;
    }
    const finalItems = new Map((response.output ?? []).map((item) => [outputIdentity(item), item]));
    for (const item of this.#completedOutput.values()) {
      const replacement = finalItems.get(outputIdentity(item));
      if (replacement) {
        validateResponseOutputItemIdentity(item, replacement, 'response.completed');
      }
    }
    for (const [wireIndex, identity] of this.#unfinishedOutput) {
      const replacement = finalItems.get(identity);
      if (!replacement) {
        throw new OpenAIError('Cannot complete response with unfinished output items.');
      }
      const previous = this.#outputAtWireIndex(wireIndex);
      if (!previous) {
        throw new OpenAIError('Cannot complete response with a missing output identity.');
      }
      validateResponseOutputItemIdentity(previous, replacement, 'response.completed');
    }
  }

  #recordOutput(event: ResponseStreamEvent, response: Response, position: number | undefined) {
    if (event.type === 'response.completed') {
      this.#interimOrderDirty = false;
      return;
    }
    if (response !== this.#currentResponseSnapshot) {
      const previous = new Map<string, number>();
      for (const [wireIndex, item] of this.#completedOutput) {
        previous.set(outputIdentity(item), wireIndex);
      }
      for (const [wireIndex, identity] of this.#unfinishedOutput) {
        previous.set(identity, wireIndex);
      }
      const positions = new Map<number, number>();
      this.#wireByIdentity.clear();
      for (const [newPosition, item] of response.output.entries()) {
        const identity = outputIdentity(item);
        const oldWireIndex = previous.get(identity);
        const wireIndex = oldWireIndex ?? newPosition;
        const done = this.#completedOutput.get(wireIndex);
        const unfinished = this.#unfinishedOutput.get(wireIndex);
        if (
          positions.has(wireIndex) ||
          (done && outputIdentity(done) !== identity) ||
          (unfinished !== undefined && unfinished !== identity)
        ) {
          throw new OpenAIError('Response snapshot has conflicting output positions.');
        }
        const previousItem = this.#outputAtWireIndex(wireIndex);
        if (previousItem) {
          validateResponseOutputItemIdentity(previousItem, item, event.type);
        }
        positions.set(wireIndex, newPosition);
        this.#wireByIdentity.set(identity, wireIndex);
        if (done) {
          this.#completedOutput.set(wireIndex, structuredClone(item));
        } else {
          this.#unfinishedOutput.set(wireIndex, identity);
        }
      }
      this.#outputPositions = positions;
      this.#interimOrderDirty = !['response.failed', 'response.incomplete'].includes(event.type);
      if (['response.created', 'response.queued', 'response.in_progress'].includes(event.type)) {
        this.#reorderInterimOutput(response);
      }
      return;
    }
    if (position === undefined) {
      return;
    }
    if (event.type === 'response.output_item.added' && event.item != null) {
      this.#outputPositions.set(event.output_index, position);
      const identity = outputIdentity(event.item);
      this.#unfinishedOutput.set(event.output_index, identity);
      this.#wireByIdentity.set(identity, event.output_index);
      this.#interimOrderDirty = true;
    } else if (event.type === 'response.output_item.done') {
      const item = response.output[position];
      if (!item) {
        throw new OpenAIError(`missing output at index ${event.output_index}`);
      }
      this.#completedOutput.set(event.output_index, structuredClone(item));
      this.#unfinishedOutput.delete(event.output_index);
    }
  }

  #reorderInterimOutput(response: Response) {
    if (!this.#interimOrderDirty) {
      return;
    }
    const ordered = [...this.#outputPositions];
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort the fresh map entries; the source supports ES2020.
    ordered.sort(([left], [right]) => left - right);
    if (ordered.some(([, oldPosition], newPosition) => oldPosition !== newPosition)) {
      const derivedText = this.#accumulatorContext.canonicalSnapshot === response;
      response.output = ordered.map(([, oldPosition]) => response.output[oldPosition]!);
      this.#outputPositions = new Map(ordered.map(([wireIndex], newPosition) => [wireIndex, newPosition]));
      this.#accumulatorContext = createResponseContext();
      if (derivedText) {
        ensureCanonicalOutputText(this.#accumulatorContext, response);
      }
    }
    this.#interimOrderDirty = false;
  }

  #updateInterimResponse(incoming: Response, snapshot: Response): boolean {
    if (!Array.isArray(incoming.output)) {
      return false;
    }
    const suppliedText = hasOwn(incoming, 'output_text') ? incoming.output_text : undefined;
    if (incoming.output.length !== 0) {
      // The temporary response validates only the supplied items. Its derived
      // output_text is not the aggregate for the retained full response.
      const validated = cloneValidatedResponse(createResponseContext(), incoming);
      const replacements: { wire: number; position: number; item: Response['output'][number] }[] = [];
      for (const item of validated.output) {
        const wire = this.#wireByIdentity.get(outputIdentity(item));
        const position = wire === undefined ? undefined : this.#outputPositions.get(wire);
        if (wire === undefined || position === undefined) {
          return false;
        }
        replacements.push({ wire, position, item });
      }
      const updateText = suppliedText == null;
      if (!updateText) {
        // Explicit interim text replaces the full aggregate after any required
        // reorder; deriving text from retained messages here would be discarded.
        this.#accumulatorContext.canonicalSnapshot = undefined;
      }
      for (const { wire, position, item } of replacements) {
        replaceResponseOutputItem(this.#accumulatorContext, snapshot, position, item, updateText);
        if (this.#completedOutput.has(wire)) {
          this.#completedOutput.set(wire, structuredClone(item));
        }
      }
      this.#reorderInterimOutput(snapshot);
    }
    const { output } = snapshot;
    let outputText = suppliedText;
    if (outputText == null) {
      ensureCanonicalOutputText(this.#accumulatorContext, snapshot);
      outputText = snapshot.output_text;
    } else {
      this.#accumulatorContext.canonicalSnapshot = undefined;
    }
    for (const key of Object.keys(snapshot)) {
      if (!hasOwn(incoming, key)) {
        Reflect.deleteProperty(snapshot, key);
      }
    }
    Object.defineProperties(
      snapshot,
      Object.getOwnPropertyDescriptors({ ...incoming, output, output_text: outputText }),
    );
    return true;
  }

  // oxlint-disable-next-line complexity -- Accumulate one native event, preserve admitted routing fields, then dispatch its matching enriched event.
  #addEvent(this: ResponseStream<ParsedT>, event: ResponseStreamEvent, starting_after: number | null) {
    if (this.ended) {
      return;
    }

    const maybeEmit = (name: string, event: ResponseStreamEvent & { snapshot?: string }) => {
      if (starting_after == null || event.sequence_number > starting_after) {
        // SAFETY: The caller derives the event name from the dispatched event discriminator; this bridge preserves the corresponding payload.
        this._emit(name as any, event);
      }
    };

    if (event.type === 'error') {
      // First-party providers nest their error payload; retain flat compatibility for
      // serialized events matching the currently published event schema.
      const error =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- An error event can contain malformed server data; validate its container before extracting error details.
        'error' in event && typeof event.error === 'object' && event.error !== null ? event.error : event;
      throw new APIError(undefined, error, event.message, undefined);
    }

    let dispatchEvent: ResponseStreamEvent = event;
    let outputPosition: number | undefined;
    const response = accumulateResponseWithContext(
      event,
      this.#currentResponseSnapshot,
      this.#accumulatorContext,
      true,
      (sanitizedEvent) => {
        dispatchEvent = sanitizedEvent;
        const prepared = this.#prepareEvent(sanitizedEvent);
        if (prepared) {
          if (hasOwn(prepared, 'output_index') && 'output_index' in prepared) {
            outputPosition = prepared.output_index;
          } else if (hasOwn(prepared, 'response') && 'response' in prepared) {
            dispatchEvent = prepared;
            if (
              (prepared.type === 'response.created' ||
                prepared.type === 'response.queued' ||
                prepared.type === 'response.in_progress') &&
              this.#currentResponseSnapshot
            ) {
              if (this.#updateInterimResponse(prepared.response, this.#currentResponseSnapshot)) {
                return null;
              }
              const identities = new Set(prepared.response.output.map(outputIdentity));
              const retained = this.#currentResponseSnapshot.output.filter(
                (item) => !identities.has(outputIdentity(item)),
              );
              if (retained.length) {
                return {
                  ...prepared,
                  response: { ...prepared.response, output: [...prepared.response.output, ...retained] },
                };
              }
            }
          }
        }
        return prepared;
      },
    );
    this.#recordOutput(dispatchEvent, response, outputPosition);
    this.#currentResponseSnapshot = response;
    if (dispatchEvent.type === 'response.output_item.added' && dispatchEvent.item == null) {
      return;
    }
    const wireSnapshot = { ...dispatchEvent };
    for (const key of Object.keys(nativeEventFields)) {
      const descriptor = Object.getOwnPropertyDescriptor(dispatchEvent, key);
      if (descriptor && !descriptor.enumerable) {
        Object.defineProperty(wireSnapshot, key, {
          // oxlint-disable-next-line anti-slop/no-reflect-get -- Read accepted non-enumerable fields from the sanitized Proxy, never the original transport.
          value: Reflect.get(dispatchEvent, key, dispatchEvent),
          enumerable: true,
        });
      }
    }
    const eventSnapshot = structuredClone(wireSnapshot);
    maybeEmit('event', eventSnapshot);

    switch (wireSnapshot.type) {
      case 'response.output_text.delta': {
        const output = response.output[outputPosition ?? wireSnapshot.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${wireSnapshot.output_index}`);
        }
        if (output.type === 'message') {
          const content = output.content[wireSnapshot.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${wireSnapshot.content_index}`);
          }
          if (content.type !== 'output_text') {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }

          maybeEmit('response.output_text.delta', {
            ...structuredClone(wireSnapshot),
            snapshot: content.text,
          });
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const output = response.output[outputPosition ?? wireSnapshot.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${wireSnapshot.output_index}`);
        }
        if (output.type === 'function_call') {
          maybeEmit('response.function_call_arguments.delta', {
            ...structuredClone(wireSnapshot),
            snapshot: output.arguments,
          });
        }
        break;
      }
      default: {
        maybeEmit(wireSnapshot.type, eventSnapshot);
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
    this.#reorderInterimOutput(snapshot);
    this.#currentResponseSnapshot = undefined;
    this.#accumulatorContext = createResponseContext();
    this.#outputPositions.clear();
    this.#wireByIdentity.clear();
    this.#interimOrderDirty = false;
    this.#completedOutput.clear();
    this.#unfinishedOutput.clear();
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
      throw this._userAbortError();
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
      throw this._userAbortError();
    }
    return this.#endRequest();
  }

  /** Iterates over response events; stopping iteration early aborts the underlying request. */
  [Symbol.asyncIterator](this: ResponseStream<ParsedT>): AsyncIterator<ResponseStreamEvent> {
    return this._createIterator<ResponseStreamEvent>(
      (push) => {
        const onEvent = (event: ResponseStreamEvent) => push(event);
        this.on('event', onEvent);
        return () => this.off('event', onEvent);
      },
      { onReturn: () => this.abort() },
    );
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

function outputIdentity(item: Response['output'][number]): string {
  return JSON.stringify([
    item.type,
    !hasRoutedOutputCallIdentity(item) && hasOwn(item, 'id') ? item.id : null,
    hasOwn(item, 'call_id') && 'call_id' in item ? item.call_id : null,
  ]);
}

function finalizeResponse<ParsedT>(
  snapshot: Response,
  params: ResponseStreamingParams | null,
): ParsedResponse<ParsedT> {
  return maybeParseResponse(snapshot, params);
}
