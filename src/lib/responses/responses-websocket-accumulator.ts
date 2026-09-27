import { OpenAIError } from '../../core/error';
import type { ResponseOutputSnapshot } from '../../internal/responses/canonical-output-text';
import { ensureCanonicalOutputText, getOutputText } from '../../internal/responses/canonical-output-text';
import {
  accumulateWebSocketOutput,
  cloneValidatedResponse,
  createResponseContext,
  isResponseOutputEvent,
} from '../../internal/responses/response-accumulator';
import { hasOwn } from '../../internal/utils';
import { isObj } from '../../internal/utils/values';
import type { ResponseOutputItem } from '../../resources/responses/responses';
import type { ResponsesWebSocketEvent } from './responses-websocket-lane';

/** The discriminator is checked; other wire fields can be absent or not schema-valid yet. */
type ProvisionalOutputItem = {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- These are exactly the generated field names, but raw provisional values have deliberately not been schema-decoded.
  [Type in ResponseOutputItem['type']]: { type: Type } & Partial<
    Record<Exclude<keyof Extract<ResponseOutputItem, { type: Type }>, 'type'>, unknown>
  >;
}[ResponseOutputItem['type']];
type PartSelector = { content_index: number; annotation_index?: number } | { summary_index: number };

// Keep the raw boundary aligned with the generated discriminants. Future wire
// items still belong to the raw lane and authoritative terminal event.
const outputItemTypes = {
  message: true,
  file_search_call: true,
  function_call: true,
  function_call_output: true,
  web_search_call: true,
  computer_call: true,
  computer_call_output: true,
  reasoning: true,
  program: true,
  program_output: true,
  tool_search_call: true,
  tool_search_output: true,
  additional_tools: true,
  compaction: true,
  image_generation_call: true,
  code_interpreter_call: true,
  local_shell_call: true,
  local_shell_call_output: true,
  shell_call: true,
  shell_call_output: true,
  apply_patch_call: true,
  apply_patch_call_output: true,
  mcp_call: true,
  mcp_list_tools: true,
  mcp_approval_request: true,
  mcp_approval_response: true,
  custom_tool_call: true,
  custom_tool_call_output: true,
} satisfies Record<ResponseOutputItem['type'], true>;

/** Provisional output is never substituted for a completed, failed, or incomplete response. */
export type ResponsesWebSocketAccumulatorState =
  | { phase: 'provisional'; snapshot: { output: ProvisionalOutputItem[]; output_text: string } }
  | { phase: 'unavailable'; error: Error }
  | { phase: 'terminal'; event: ResponsesWebSocketEvent };

/**
 * Optional, caller-fed reconstruction of one lane's provisional output.
 *
 * Feed the raw events returned by lane.receive(). Use a separate instance per
 * lane. This helper never reads, sends, closes, or registers a listener on a
 * socket; raw events remain in the caller's hands. Tools remain output data.
 * Raw deltas give per-event progress. Use outputAt(event.output_index) when an
 * item finishes, or pass its content_index/summary_index to read only a changed
 * part. For citations use content_index and annotation_index together. A full
 * current, item, or part read materializes its entire nested contents, so
 * reserve those reads for when that complete snapshot is needed.
 *
 * A socket stream can omit the item/content scaffolding required for deltas.
 * Such a response is marked unavailable until the next creation or terminal
 * event. Terminal events, including failures and errors, are retained exactly as
 * delivered, without filling omitted output from provisional data.
 */
export class ResponsesWebSocketAccumulator {
  #context = createResponseContext();
  #current:
    | { phase: 'provisional'; snapshot: ResponseOutputSnapshot }
    | Exclude<ResponsesWebSocketAccumulatorState, { phase: 'provisional' }>
    | undefined;

  /** Materialize the full state. For per-item progress prefer outputAt(). */
  get current(): ResponsesWebSocketAccumulatorState | undefined {
    if (this.#current?.phase === 'provisional') {
      if (this.#context.outputTextDirty) {
        this.#current.snapshot.output_text = this.#current.snapshot.output
          .map((output) => getOutputText(this.#context, output))
          .join('');
        this.#context.outputTextDirty = false;
      }
      return {
        phase: 'provisional',
        snapshot: ResponsesWebSocketAccumulator.#copyOutput(this.#current.snapshot),
      };
    }
    return structuredClone(this.#current);
  }

  /**
   * Read one provisional item by wire output_index, or just one message/
   * reasoning part with its wire content_index/summary_index. Add annotation_index
   * to content_index to read one raw citation. Full item and part reads copy all
   * nested entries; prefer a selector for progress on a growing collection.
   * Copies remain valid after further events, and cannot change the accumulator.
   * Returns undefined for absent/mismatched parts or outside provisional output.
   */
  outputAt(outputIndex: number): ProvisionalOutputItem | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Raw socket parts and annotations are preserved, not schema-decoded. Requiring narrowing avoids an unproven public SDK contract.
  outputAt(outputIndex: number, part: PartSelector): unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Only the generated output discriminator is validated; every raw nested value must remain unknown to callers.
  outputAt(outputIndex: number, part?: PartSelector): unknown {
    if (this.#current?.phase !== 'provisional') {
      return undefined;
    }
    const output = ResponsesWebSocketAccumulator.#at(this.#current.snapshot.output, outputIndex);
    if (!part) {
      return ResponsesWebSocketAccumulator.#copyOutput(output);
    }
    if ('content_index' in part) {
      if (output?.type === 'message' || output?.type === 'reasoning') {
        const content = ResponsesWebSocketAccumulator.#at(output.content, part.content_index);
        if ('annotation_index' in part) {
          return ResponsesWebSocketAccumulator.#copyOutput(
            content?.type === 'output_text'
              ? ResponsesWebSocketAccumulator.#at(content.annotations, part.annotation_index)
              : undefined,
          );
        }
        return ResponsesWebSocketAccumulator.#copyOutput(content);
      }
    } else if (output?.type === 'reasoning') {
      return ResponsesWebSocketAccumulator.#copyOutput(
        ResponsesWebSocketAccumulator.#at(output.summary, part.summary_index),
      );
    }
    return undefined;
  }

  // Validate the same index rules at every selector depth before copying only
  // the selected entry. The caller-supplied wire scaffold may not be an array.
  static #at<T extends readonly unknown[]>(
    collection: T | undefined,
    index: number | undefined,
  ): T[number] | undefined {
    if (!Array.isArray(collection) || index === undefined || !Number.isSafeInteger(index) || index < 0) {
      return undefined;
    }
    return collection[index];
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

  // Validate the discriminant and scaffolds that deltas and canonical text use. Raw
  // WebSocket items have not been decoded through the generated response union.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Output from a raw lane event has not passed a tool schema. This is its opt-in accumulator boundary.
  static #validateOutputScaffold(item: unknown): void {
    if (
      !isObj(item) ||
      !hasOwn(item, 'type') ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- An unknown discriminator cannot satisfy the generated typed preview union.
      typeof item['type'] !== 'string' ||
      !hasOwn(outputItemTypes, item['type'])
    ) {
      throw new OpenAIError('Invalid Responses WebSocket output item');
    }
    if (item['type'] === 'message') {
      if (!Array.isArray(item['content'])) {
        throw new OpenAIError('Invalid Responses WebSocket message content');
      }
      for (const part of item['content']) {
        ResponsesWebSocketAccumulator.#validateContentPart(part);
      }
    }
    if (
      item['type'] === 'function_call' ||
      item['type'] === 'custom_tool_call' ||
      item['type'] === 'mcp_call'
    ) {
      const field = item['type'] === 'custom_tool_call' ? 'input' : 'arguments';
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
      if (
        item['type'] === 'mcp_call' &&
        (!hasOwn(item, 'server_label') ||
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The server identity on an MCP scaffold is raw data, not a generated decoded string.
          typeof item['server_label'] !== 'string')
      ) {
        throw new OpenAIError('Invalid Responses WebSocket MCP server label');
      }
    }
  }

  // Check only fields used by canonicalization; other provisional metadata stays raw.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Parts from the WebSocket wire are not schema-decoded, including within the initial output.
  static #validateContentPart(part: unknown): void {
    if (
      !isObj(part) ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Raw output_text must not be silently coerced during a later provisional read.
      (part['type'] === 'output_text' && typeof part['text'] !== 'string')
    ) {
      throw new OpenAIError('Invalid Responses WebSocket content part');
    }
  }

  static #validateOutputEvent(event: Parameters<typeof accumulateWebSocketOutput>[0]): void {
    switch (event.type) {
      case 'response.output_item.added':
      case 'response.output_item.done': {
        ResponsesWebSocketAccumulator.#validateOutputScaffold(event.item);
        break;
      }
      case 'response.content_part.added':
      case 'response.content_part.done': {
        ResponsesWebSocketAccumulator.#validateContentPart(event.part);
        break;
      }
      case 'response.function_call_arguments.delta':
      case 'response.mcp_call_arguments.delta':
      case 'response.custom_tool_call_input.delta':
      case 'response.output_text.delta':
      case 'response.refusal.delta': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The cloned raw event has not been schema-validated; do not coerce data into typed tool arguments.
        if (typeof event.delta !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket tool delta');
        }
        break;
      }
      case 'response.function_call_arguments.done':
      case 'response.mcp_call_arguments.done': {
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
      case 'response.output_text.done': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only actual wire text can replace the accumulated message text.
        if (typeof event.text !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket completed text');
        }
        break;
      }
      case 'response.refusal.done': {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Refusals use their own finalized wire text field.
        if (typeof event.refusal !== 'string') {
          throw new OpenAIError('Invalid Responses WebSocket completed refusal');
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
        ResponsesWebSocketAccumulator.#validateOutputScaffold(item);
      }
    }
    const snapshot = cloneValidatedResponse(this.#context, {
      output: output ?? [],
      output_text: outputText ?? '',
    });
    if (outputText === undefined) {
      ensureCanonicalOutputText(this.#context, snapshot);
    }
    this.#context.deferOutputText = true;
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
