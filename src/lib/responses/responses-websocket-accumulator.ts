import { OpenAIError } from '../../core/error';
import type { ResponseOutputSnapshot } from '../../internal/responses/canonical-output-text';
import { ensureCanonicalOutputText } from '../../internal/responses/canonical-output-text';
import {
  accumulateWebSocketOutput,
  cloneValidatedResponse,
  createResponseContext,
  isResponseOutputEvent,
} from '../../internal/responses/response-accumulator';
import { hasOwn } from '../../internal/utils';
import { isObj } from '../../internal/utils/values';
import type { ResponsesWebSocketEvent } from './responses-websocket-lane';

/** Provisional output is never substituted for a completed, failed, or incomplete response. */
export type ResponsesWebSocketAccumulatorState =
  | { phase: 'provisional'; snapshot: ResponseOutputSnapshot }
  | { phase: 'unavailable'; error: Error }
  | { phase: 'terminal'; event: ResponsesWebSocketEvent };

/**
 * Optional, caller-fed reconstruction of one lane's provisional output.
 *
 * Feed the raw events returned by lane.receive(). Use a separate instance per
 * lane. This helper never reads, sends, closes, or registers a listener on a
 * socket; raw events remain in the caller's hands. Tools remain output data.
 * Reading current returns a detached copy.
 *
 * A socket stream can omit the item/content scaffolding required for deltas.
 * Such a response is marked unavailable until the next creation or terminal
 * event. Terminal events, including failures and errors, are retained exactly as
 * delivered, without filling omitted output from provisional data.
 */
export class ResponsesWebSocketAccumulator {
  #context = createResponseContext();
  #current: ResponsesWebSocketAccumulatorState | undefined;

  get current(): ResponsesWebSocketAccumulatorState | undefined {
    if (this.#current?.phase === 'provisional') {
      return {
        phase: 'provisional',
        snapshot: ResponsesWebSocketAccumulator.#copyOutput(this.#current.snapshot),
      };
    }
    return structuredClone(this.#current);
  }

  // Provisional output is made of parsed JSON containers and immutable scalars.
  // Detach containers without flattening and copying the accumulated strings at
  // each read. Error and terminal snapshots use structuredClone as before.
  static #copyOutput<T>(value: T): T {
    if (Array.isArray(value)) {
      // SAFETY: Copying the array preserves every element's type and order.
      return value.map((item) => ResponsesWebSocketAccumulator.#copyOutput(item)) as T;
    }
    if (isObj(value)) {
      // SAFETY: Copying own data properties preserves the snapshot's JSON shape.
      // fromEntries defines "__proto__" as an own property instead of invoking a setter.
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, ResponsesWebSocketAccumulator.#copyOutput(item)]),
      ) as T;
    }
    return value;
  }

  /** Drop retained provisional and terminal state without affecting any lane. */
  reset(): void {
    this.#context = createResponseContext();
    this.#current = undefined;
  }

  // Validate the scaffold that argument deltas extend. SSE starts with typed
  // models, while raw WebSocket items can omit or corrupt these required fields.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Output from a raw lane event has not passed a tool schema. This is its opt-in accumulator boundary.
  static #validateToolScaffold(item: unknown): void {
    if (!isObj(item)) {
      throw new OpenAIError('Invalid Responses WebSocket output item');
    }
    if (item['type'] === 'function_call' || item['type'] === 'custom_tool_call') {
      const field = item['type'] === 'function_call' ? 'arguments' : 'input';
      if (
        !hasOwn(item, 'name') ||
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The caller feeds raw socket events; validate own required tool fields before exposing a typed snapshot.
        typeof item['name'] !== 'string' ||
        !hasOwn(item, field) ||
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Missing and numeric tool data cannot be extended as text.
        typeof item[field] !== 'string'
      ) {
        throw new OpenAIError('Invalid Responses WebSocket tool scaffold');
      }
    }
  }

  static #validateOutputEvent(event: Parameters<typeof accumulateWebSocketOutput>[0]): void {
    switch (event.type) {
      case 'response.output_item.added':
      case 'response.output_item.done': {
        ResponsesWebSocketAccumulator.#validateToolScaffold(event.item);
        break;
      }
      case 'response.function_call_arguments.delta':
      case 'response.custom_tool_call_input.delta': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The cloned raw event has not been schema-validated; do not coerce data into typed tool arguments.
        if (typeof event.delta !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket tool delta');
        }
        break;
      }
      case 'response.function_call_arguments.done': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A final raw argument payload must satisfy the field exposed by the provisional snapshot.
        if (typeof event.arguments !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket tool arguments');
        }
        break;
      }
      case 'response.custom_tool_call_input.done': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Do not substitute omitted, null or object input for the typed text field.
        if (typeof event.input !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket custom tool input');
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  #start(event: { response?: unknown }): void {
    this.reset();
    if (!isObj(event.response)) {
      throw new OpenAIError('Responses WebSocket created event must contain a response');
    }
    // Only output fields are normalized; omitted response metadata is never invented.
    const { output, output_text: outputText } = event.response;
    if (
      (output !== undefined && !Array.isArray(output)) ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate optional text from an untyped WebSocket lifecycle before placing it in a typed provisional snapshot.
      (outputText !== undefined && typeof outputText !== 'string')
    ) {
      throw new OpenAIError('Invalid Responses WebSocket initial output');
    }
    if (output !== undefined) {
      for (const item of output) {
        ResponsesWebSocketAccumulator.#validateToolScaffold(item);
      }
    }
    const snapshot = cloneValidatedResponse(this.#context, {
      output: output ?? [],
      output_text: outputText ?? '',
    });
    if (outputText === undefined) {
      ensureCanonicalOutputText(this.#context, snapshot);
    }
    this.#current = { phase: 'provisional', snapshot };
  }

  /** Record one raw lane event. Unknown event types leave the current state unchanged. */
  add(event: ResponsesWebSocketEvent): void {
    if (
      event.type === 'response.completed' ||
      event.type === 'response.failed' ||
      event.type === 'response.incomplete' ||
      event.type === 'error'
    ) {
      this.#context = createResponseContext();
      this.#current = { phase: 'terminal', event: structuredClone(event) };
      return;
    }
    try {
      if (event.type === 'response.created') {
        this.#start({ response: event.response });
        return;
      }
      if (
        !isResponseOutputEvent(event) ||
        this.#current?.phase === 'unavailable' ||
        this.#current?.phase === 'terminal'
      ) {
        return;
      }
      if (this.#current?.phase !== 'provisional') {
        throw new OpenAIError("Cannot reconstruct WebSocket output before 'response.created'");
      }
      const outputEvent = structuredClone(event);
      ResponsesWebSocketAccumulator.#validateOutputEvent(outputEvent);
      accumulateWebSocketOutput(outputEvent, this.#current.snapshot, this.#context);
    } catch (error) {
      this.#current = {
        phase: 'unavailable',
        error: error instanceof Error ? error : new OpenAIError('Invalid Responses WebSocket output event'),
      };
    }
  }
}
