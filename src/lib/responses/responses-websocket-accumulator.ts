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
import type { Response, ResponseOutputItem } from '../../resources/responses/responses';
import type { ResponsesWebSocketEvent } from './responses-websocket-lane';

/** The discriminator is checked; other wire fields can be absent or not schema-valid yet. */
type ProvisionalOutputItem = {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- These are exactly the generated field names, but raw provisional values have deliberately not been schema-decoded.
  [Type in ResponseOutputItem['type']]: { type: Type } & Partial<
    Record<Exclude<keyof Extract<ResponseOutputItem, { type: Type }>, 'type'>, unknown>
  >;
}[ResponseOutputItem['type']];
type PartSelector = { content_index: number; annotation_index?: number } | { summary_index: number };
type OutputEvent = Parameters<typeof accumulateWebSocketOutput>[0] & { stream_id?: unknown };
type SparseEvent = Extract<
  OutputEvent,
  {
    type:
      | 'response.output_text.delta'
      | 'response.output_text.done'
      | 'response.refusal.delta'
      | 'response.refusal.done'
      | 'response.content_part.added'
      | 'response.content_part.done'
      | 'response.function_call_arguments.delta'
      | 'response.function_call_arguments.done'
      | 'response.custom_tool_call_input.delta'
      | 'response.custom_tool_call_input.done'
      | 'response.mcp_call_arguments.delta'
      | 'response.mcp_call_arguments.done';
  }
>;
type SparseContentEvent = Extract<SparseEvent, { content_index: number }>;
type ShellEvent = Extract<
  OutputEvent,
  { type: 'response.shell_call_output_content.delta' | 'response.shell_call_output_content.done' }
>;
type OutputItemEvent = Extract<
  OutputEvent,
  { type: 'response.output_item.added' | 'response.output_item.done' }
>;
interface PartialOutput {
  /** Observed wire output position, without allocating missing positions. */
  output_index: number;
  /** Item identity supplied by the sparse event. */
  item_id: string;
  /** Observed function or MCP arguments; absent until received. */
  arguments?: string;
  /** Observed custom-tool input; absent until received. */
  input?: string;
  /** Indexed raw content fields; missing item/part discriminators are not invented. */
  content?: { content_index: number; data: unknown }[];
  /** Per-command stream fields and complete done arrays, without inferred flat placement. */
  commands?: { command_index: number; data: unknown }[];
}
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Preserve raw future part/command metadata; validate each field before using it for accumulation.
type ObservedFields = Record<string, unknown>;
interface PartialRecord {
  item_id: string;
  kind: 'message' | 'function_call' | 'custom_tool_call' | 'mcp_call' | 'shell_call_output';
  arguments?: string;
  input?: string;
  content: Map<number, ObservedFields>;
  commands?: Map<number, ObservedFields>;
}

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
  | {
      phase: 'provisional';
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- As with output items, only generated field names are typed: provisional wire metadata is not yet validated and must be narrowed by callers.
      snapshot: { output: ProvisionalOutputItem[]; output_text: string } & {
        [Field in Exclude<keyof Response, 'output' | 'output_text'>]?: unknown;
      };
      /** Fields observed without actual item/part scaffolds, in numeric wire order. */
      partialOutput?: PartialOutput[];
    }
  | { phase: 'unavailable'; error: Error }
  | { phase: 'terminal'; event: ResponsesWebSocketEvent };

/**
 * Optional, caller-fed reconstruction of one lane's provisional output.
 *
 * Feed the raw events returned by lane.receive(). Use a separate instance per
 * lane. This helper never reads, sends, closes, or registers a listener on a
 * socket; raw events remain in the caller's hands. Tools remain output data.
 * Provisional response metadata is preserved as received and is not yet schema
 * validated. Narrow its unknown fields before use. Omitted fields remain absent.
 * Raw deltas give per-event progress. Use outputAt(event.output_index) when an
 * item finishes, or pass its content_index/summary_index to read only a changed
 * part. For citations use content_index and annotation_index together. A full
 * current, item, or part read materializes its entire nested contents, so
 * reserve those reads for when that complete snapshot is needed.
 *
 * Sparse text, refusal and tool deltas remain visible in partialOutput without
 * inventing missing item metadata. Observed output text contributes to output_text.
 * Shell observations retain received stream fields and complete per-command done
 * arrays. Flat command placement is not inferred; absent fields stay absent.
 * Actual item and part events replace matching observations authoritatively.
 * Invalid output is unavailable until a new creation or terminal event.
 * Terminal events, including failures and errors, are retained exactly as
 * delivered, without filling omitted output from provisional data.
 */
export class ResponsesWebSocketAccumulator {
  #context = createResponseContext();
  readonly #indices = new Map<number, number>();
  readonly #partial = new Map<number, PartialRecord>();
  // Owned by this turn. Only scalar bounds are retained; item/command mutations refresh them.
  readonly #shellBounds = new Map<string, number>();
  #streamID: unknown;
  #partialStream: { value: string | undefined } | undefined;
  #current:
    | { phase: 'provisional'; snapshot: ResponseOutputSnapshot }
    | Exclude<ResponsesWebSocketAccumulatorState, { phase: 'provisional' }>
    | undefined;

  /** Materialize the full state. For per-item progress prefer outputAt(). */
  get current(): ResponsesWebSocketAccumulatorState | undefined {
    if (this.#current?.phase === 'provisional') {
      if (this.#context.outputTextDirty) {
        this.#current.snapshot.output_text = this.#outputText();
        this.#context.outputTextDirty = false;
      }
      const snapshot = ResponsesWebSocketAccumulator.#copyOutput(this.#current.snapshot);
      const { output } = snapshot;
      snapshot.output = ResponsesWebSocketAccumulator.#ordered(this.#indices).flatMap(([index, position]) => {
        const item = output[position];
        return item ? [ResponsesWebSocketAccumulator.#overlayTool(item, this.#partial.get(index))] : [];
      });
      return {
        phase: 'provisional',
        snapshot,
        ...(this.#partial.size ? { partialOutput: this.#partialOutput() } : {}),
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
    const output = this.#output(outputIndex);
    if (!part) {
      const copy = ResponsesWebSocketAccumulator.#copyOutput(output);
      return copy
        ? ResponsesWebSocketAccumulator.#overlayTool(copy, this.#partial.get(outputIndex))
        : undefined;
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
    this.#indices.clear();
    this.#partial.clear();
    this.#shellBounds.clear();
    this.#streamID = undefined;
    this.#partialStream = undefined;
    this.#current = undefined;
  }

  #output(index: number): ResponseOutputItem | undefined {
    const position = this.#indices.get(index);
    return this.#current?.phase === 'provisional' && position !== undefined
      ? this.#current.snapshot.output[position]
      : undefined;
  }

  // Overlay only on detached read copies. Raw item metadata and the core identity cache stay unchanged.
  static #overlayTool(item: ResponseOutputItem, partial: PartialRecord | undefined): ResponseOutputItem {
    if (item.type === 'function_call' && partial?.arguments !== undefined) {
      item.arguments = partial.arguments;
    }
    if (item.type === 'custom_tool_call' && partial?.input !== undefined) {
      item.input = partial.input;
    }
    return item;
  }

  static #unidentifiedTool(item: ResponseOutputItem): boolean {
    return (item.type === 'function_call' || item.type === 'custom_tool_call') && item.id === undefined;
  }

  static #ordered<T>(entries: Map<number, T>): [number, T][] {
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort only a new array; keep source declarations compatible with the configured ES2020 library.
    return [...entries].sort(([a], [b]) => a - b);
  }

  #orderedIndices(): number[] {
    // oxlint-disable-next-line unicorn/no-array-sort -- This new array cannot mutate retained state; Array.toSorted is outside the configured ES2020 library.
    return [...new Set([...this.#indices.keys(), ...this.#partial.keys()])].sort((a, b) => a - b);
  }

  #partialOutput(): PartialOutput[] {
    return ResponsesWebSocketAccumulator.#ordered(this.#partial).map(([outputIndex, item]) => ({
      output_index: outputIndex,
      item_id: item.item_id,
      ...(item.arguments === undefined ? {} : { arguments: item.arguments }),
      ...(item.input === undefined ? {} : { input: item.input }),
      ...(item.content.size
        ? {
            content: ResponsesWebSocketAccumulator.#ordered(item.content).map(([contentIndex, data]) => ({
              content_index: contentIndex,
              data: ResponsesWebSocketAccumulator.#copyOutput(data),
            })),
          }
        : {}),
      ...(item.commands?.size
        ? {
            commands: ResponsesWebSocketAccumulator.#ordered(item.commands).map(([commandIndex, data]) => ({
              command_index: commandIndex,
              data: ResponsesWebSocketAccumulator.#copyOutput(data),
            })),
          }
        : {}),
    }));
  }

  #outputText(): string {
    return this.#orderedIndices()
      .map((index) => {
        const output = this.#output(index);
        const partial = this.#partial.get(index);
        const text = output ? getOutputText(this.#context, output) : '';
        return (
          text +
          (partial
            ? ResponsesWebSocketAccumulator.#ordered(partial.content)
                .map(([, data]) => {
                  if (data['type'] !== undefined && data['type'] !== 'output_text') {
                    return '';
                  }
                  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only observed string text contributes to the aggregate; unrelated raw metadata remains untouched.
                  return typeof data['text'] === 'string' ? data['text'] : '';
                })
                .join('')
            : '')
        );
      })
      .join('');
  }

  static #index(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new OpenAIError('Responses WebSocket indices must be non-negative safe integers');
    }
  }

  static #hasSlot(collection: readonly unknown[], index: number): boolean {
    return Array.isArray(collection) && hasOwn(collection, index);
  }

  #observeSparse(event: OutputEvent): boolean {
    let kind: PartialRecord['kind'];
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.output_text.done':
      case 'response.refusal.delta':
      case 'response.refusal.done':
      case 'response.content_part.added':
      case 'response.content_part.done': {
        kind = 'message';
        break;
      }
      case 'response.function_call_arguments.delta':
      case 'response.function_call_arguments.done': {
        kind = 'function_call';
        break;
      }
      case 'response.custom_tool_call_input.delta':
      case 'response.custom_tool_call_input.done': {
        kind = 'custom_tool_call';
        break;
      }
      case 'response.mcp_call_arguments.delta':
      case 'response.mcp_call_arguments.done': {
        kind = 'mcp_call';
        break;
      }
      default: {
        return false;
      }
    }
    return this.#observeSparseTarget(event, kind);
  }

  #observeSparseTarget(event: SparseEvent, kind: PartialRecord['kind']): boolean {
    if ('part' in event && event.part.type !== 'output_text' && event.part.type !== 'refusal') {
      return false;
    }
    const output = this.#output(event.output_index);
    const unboundTool = output !== undefined && ResponsesWebSocketAccumulator.#unidentifiedTool(output);
    if (output && ((!unboundTool && output.id !== event.item_id) || output.type !== kind)) {
      throw new OpenAIError('Responses WebSocket item identity or kind does not match');
    }
    if ('content_index' in event) {
      ResponsesWebSocketAccumulator.#index(event.content_index);
      if (
        output?.type === 'message' &&
        (ResponsesWebSocketAccumulator.#hasSlot(output.content, event.content_index) ||
          (event.type === 'response.content_part.added' && event.content_index === output.content.length))
      ) {
        return false;
      }
    } else if (output && !unboundTool) {
      return false;
    }
    const item = this.#observedItem(event, kind, unboundTool ? output : undefined);
    this.#bindPartial(event.stream_id);
    this.#writeSparse(event, item);
    this.#partial.set(event.output_index, item);
    return true;
  }

  #observedItem(
    event: Pick<SparseEvent, 'output_index' | 'item_id'>,
    kind: PartialRecord['kind'],
    seed?: ResponseOutputItem,
  ): PartialRecord {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Raw WS events must supply their own string item identity before observed facts are admitted.
    if (typeof event.item_id !== 'string' || !event.item_id) {
      throw new OpenAIError('Invalid Responses WebSocket sparse identity');
    }
    const item = this.#partial.get(event.output_index);
    if (item && (item.item_id !== event.item_id || item.kind !== kind)) {
      throw new OpenAIError('Responses WebSocket sparse item identity or kind does not match');
    }
    return (
      item ?? {
        item_id: event.item_id,
        kind,
        content: new Map(),
        ...(seed?.type === 'function_call' ? { arguments: seed.arguments } : {}),
        ...(seed?.type === 'custom_tool_call' ? { input: seed.input } : {}),
      }
    );
  }

  #writeSparse(event: SparseEvent, item: PartialRecord): void {
    if ('content_index' in event) {
      ResponsesWebSocketAccumulator.#writeSparseContent(event, item);
      this.#context.outputTextDirty = true;
    } else if (
      event.type === 'response.custom_tool_call_input.delta' ||
      event.type === 'response.custom_tool_call_input.done'
    ) {
      item.input =
        event.type === 'response.custom_tool_call_input.delta'
          ? (item.input ?? '') + event.delta
          : event.input;
    } else {
      item.arguments =
        event.type === 'response.function_call_arguments.delta' ||
        event.type === 'response.mcp_call_arguments.delta'
          ? (item.arguments ?? '') + event.delta
          : event.arguments;
    }
  }

  static #writeSparseContent(event: SparseContentEvent, item: PartialRecord): void {
    if ('part' in event) {
      item.content.set(event.content_index, Object.fromEntries(Object.entries(event.part)));
      return;
    }
    const data = item.content.get(event.content_index) ?? {};
    if (event.type === 'response.output_text.delta' || event.type === 'response.output_text.done') {
      if (data['type'] !== undefined && data['type'] !== 'output_text') {
        throw new OpenAIError('Responses WebSocket sparse content kind does not match');
      }
      data['text'] =
        event.type === 'response.output_text.delta'
          ? ResponsesWebSocketAccumulator.#extend(data['text'], event.delta)
          : event.text;
      if (hasOwn(event, 'logprobs')) {
        const previous = data['logprobs'];
        if (
          event.type === 'response.output_text.delta' &&
          Array.isArray(previous) &&
          Array.isArray(event.logprobs)
        ) {
          for (const entry of event.logprobs) {
            previous.push(entry);
          }
        } else {
          data['logprobs'] = event.logprobs;
        }
      }
    } else {
      if (data['type'] !== undefined && data['type'] !== 'refusal') {
        throw new OpenAIError('Responses WebSocket sparse content kind does not match');
      }
      data['refusal'] =
        event.type === 'response.refusal.delta'
          ? ResponsesWebSocketAccumulator.#extend(data['refusal'], event.delta)
          : event.refusal;
    }
    item.content.set(event.content_index, data);
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Parse a raw observed scalar here before appending text; absent fields remain absent elsewhere.
  static #extend(value: unknown, delta: string): string {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provisional wire fields have not passed a final-response schema.
    if (value !== undefined && typeof value !== 'string') {
      throw new OpenAIError('Invalid Responses WebSocket sparse text');
    }
    return (value ?? '') + delta;
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the parser for the raw stream identity, invoked only when admitting the new partial mode.
  #bindPartial(streamID: unknown): void {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Do not admit a non-string routing identity from raw WS input.
    if (streamID !== undefined && typeof streamID !== 'string') {
      throw new OpenAIError('Responses WebSocket stream does not match sparse output');
    }
    if (this.#current === undefined) {
      this.#streamID = streamID;
    }
    if (streamID !== this.#streamID) {
      throw new OpenAIError('Responses WebSocket stream does not match sparse output');
    }
    this.#partialStream = { value: streamID };
  }

  #validateShellTarget(event: ShellEvent): void {
    const output = this.#output(event.output_index);
    if (
      output?.type !== 'shell_call_output' ||
      output.id !== event.item_id ||
      !Array.isArray(output.output)
    ) {
      throw new OpenAIError('Responses WebSocket shell output identity does not match');
    }
    ResponsesWebSocketAccumulator.#index(event.command_index);
    const limit = this.#shellBounds.get(output.call_id);
    if (limit !== undefined && event.command_index >= limit) {
      throw new OpenAIError('Missing Responses WebSocket shell command');
    }
  }

  #cacheShellBound(item: ResponseOutputItem, appended = false): void {
    if (item.type !== 'shell_call') {
      return;
    }
    const previous = this.#shellBounds.get(item.call_id);
    if (appended && previous !== undefined) {
      if (previous >= 0) {
        this.#shellBounds.set(item.call_id, item.action.commands.length);
      }
      return;
    }
    const action: unknown = item.action;
    const commands = isObj(action) ? action['commands'] : undefined;
    let bound = -1;
    if (Array.isArray(commands)) {
      const positions = Object.keys(commands).filter(
        (key) => /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < commands.length,
      );
      if (positions.length === commands.length) {
        bound = commands.length;
      }
    }
    this.#shellBounds.set(item.call_id, bound);
  }

  static #validateShellDelta(
    event: Extract<ShellEvent, { type: 'response.shell_call_output_content.delta' }>,
  ): void {
    if (!isObj(event.delta)) {
      throw new OpenAIError('Invalid Responses WebSocket shell delta');
    }
    for (const field of ['stdout', 'stderr'] as const) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate all supplied stream fields before mutating the observed command.
      if (hasOwn(event.delta, field) && typeof event.delta[field] !== 'string') {
        throw new OpenAIError('Invalid Responses WebSocket shell delta');
      }
    }
  }

  #observeShell(event: OutputEvent): boolean {
    if (
      event.type !== 'response.shell_call_output_content.delta' &&
      event.type !== 'response.shell_call_output_content.done'
    ) {
      return false;
    }
    this.#validateShellTarget(event);
    if (event.type === 'response.shell_call_output_content.delta') {
      ResponsesWebSocketAccumulator.#validateShellDelta(event);
    }
    const item = this.#observedItem(event, 'shell_call_output');
    const commands = item.commands ?? new Map();
    if (event.type === 'response.shell_call_output_content.done') {
      if (!Array.isArray(event.output)) {
        throw new OpenAIError('Missing Responses WebSocket shell completion');
      }
      commands.set(event.command_index, { output: event.output });
    } else {
      const data = commands.get(event.command_index) ?? {};
      for (const field of ['stdout', 'stderr'] as const) {
        if (hasOwn(event.delta, field)) {
          const delta = event.delta[field];
          if (delta !== undefined) {
            data[field] = ResponsesWebSocketAccumulator.#extend(data[field], delta);
          }
        }
      }
      commands.set(event.command_index, data);
    }
    this.#bindPartial(event.stream_id);
    item.commands = commands;
    this.#partial.set(event.output_index, item);
    return true;
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

  #start(event: { response?: unknown; stream_id?: unknown }): void {
    this.reset();
    this.#streamID = event.stream_id;
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
      ...event.response,
      output: output ?? [],
      output_text: outputText ?? '',
    });
    if (outputText === undefined) {
      ensureCanonicalOutputText(this.#context, snapshot);
    }
    this.#context.deferOutputText = true;
    this.#current = { phase: 'provisional', snapshot };
    for (let index = 0; index < snapshot.output.length; index += 1) {
      this.#indices.set(index, index);
    }
    for (const item of snapshot.output) {
      if (item.type === 'shell_call' && !this.#shellBounds.has(item.call_id)) {
        this.#cacheShellBound(item);
      }
    }
  }

  #refresh(event: { response?: unknown; stream_id?: unknown }): void {
    if (!isObj(event.response)) {
      throw new OpenAIError('Responses WebSocket lifecycle must contain a response');
    }
    const binding = this.#partialStream;
    const responseID: unknown =
      this.#current?.phase === 'provisional'
        ? Object.getOwnPropertyDescriptor(this.#current.snapshot, 'id')?.value
        : undefined;
    if (
      binding &&
      (event.stream_id !== binding.value || (responseID !== undefined && event.response['id'] !== responseID))
    ) {
      throw new OpenAIError('Responses WebSocket lifecycle identity does not match sparse output');
    }
    if (event.response['output'] !== undefined || this.#current?.phase !== 'provisional') {
      this.#start(event);
    } else {
      const indices = [...this.#indices];
      const partial = [...this.#partial];
      const dirty = this.#context.outputTextDirty;
      this.#start({
        ...event,
        response: {
          ...event.response,
          output: this.#current.snapshot.output,
          output_text: event.response['output_text'] ?? this.#current.snapshot.output_text,
        },
      });
      this.#indices.clear();
      for (const [index, position] of indices) {
        this.#indices.set(index, position);
      }
      for (const [index, item] of partial) {
        this.#partial.set(index, item);
      }
      if (event.response['output_text'] === undefined) {
        this.#context.outputTextDirty = dirty ?? false;
      }
    }
    this.#partialStream = binding;
  }

  #addItem(event: OutputItemEvent): void {
    const starting = this.#current === undefined;
    const context = starting ? createResponseContext() : this.#context;
    context.deferOutputText = true;
    const snapshot: ResponseOutputSnapshot =
      this.#current?.phase === 'provisional' ? this.#current.snapshot : { output: [], output_text: '' };
    const position = this.#indices.get(event.output_index) ?? snapshot.output.length;
    const partial = this.#partial.get(event.output_index);
    if (
      partial &&
      ((hasOwn(event.item, 'id') && partial.item_id !== event.item.id) || partial.kind !== event.item.type)
    ) {
      throw new OpenAIError('Responses WebSocket full item does not match sparse output');
    }
    accumulateWebSocketOutput(
      {
        ...event,
        type: this.#indices.has(event.output_index) ? event.type : 'response.output_item.added',
        output_index: position,
      },
      snapshot,
      context,
    );
    if (starting) {
      this.#bindPartial(event.stream_id);
    }
    this.#context = context;
    this.#current = { phase: 'provisional', snapshot };
    this.#indices.set(event.output_index, position);
    this.#cacheShellBound(event.item);
    if (partial?.content.size) {
      this.#context.outputTextDirty = true;
    }
    this.#partial.delete(event.output_index);
  }

  #forgetObservation(event: OutputEvent & { output_index: number }): void {
    const item = this.#partial.get(event.output_index);
    if (!item) {
      return;
    }
    if (
      (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') &&
      item.content.delete(event.content_index)
    ) {
      this.#context.outputTextDirty = true;
    }
    if (
      !item.content.size &&
      !item.commands?.size &&
      item.arguments === undefined &&
      item.input === undefined
    ) {
      this.#partial.delete(event.output_index);
    }
  }

  #addOutput(event: OutputEvent): void {
    if (this.#partialStream && event.stream_id !== this.#partialStream.value) {
      throw new OpenAIError('Responses WebSocket stream does not match sparse output');
    }
    if (!('output_index' in event)) {
      throw new OpenAIError('Missing Responses WebSocket output index');
    }
    ResponsesWebSocketAccumulator.#index(event.output_index);
    if (this.#observeSparse(event)) {
      if (this.#current === undefined) {
        this.#context.deferOutputText = true;
        this.#current = { phase: 'provisional', snapshot: { output: [], output_text: '' } };
      }
      return;
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      this.#addItem(event);
      return;
    }
    if (this.#current?.phase !== 'provisional') {
      throw new OpenAIError('Missing Responses WebSocket output');
    }
    if (this.#observeShell(event)) {
      return;
    }
    const position = this.#indices.get(event.output_index);
    if (position === undefined) {
      throw new OpenAIError('Missing Responses WebSocket output scaffold');
    }
    accumulateWebSocketOutput({ ...event, output_index: position }, this.#current.snapshot, this.#context);
    if (event.type === 'response.shell_call_command.added') {
      const item = this.#output(event.output_index);
      if (item) {
        this.#cacheShellBound(item, true);
      }
    }
    this.#forgetObservation(event);
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
      this.#indices.clear();
      this.#partial.clear();
      this.#shellBounds.clear();
      this.#partialStream = undefined;
      this.#current = { phase: 'terminal', event: structuredClone(event) };
      return;
    }
    try {
      if (event.type === 'response.created') {
        this.#start({ response: event.response, stream_id: event.stream_id });
        return;
      }
      if (
        (event.type === 'response.queued' || event.type === 'response.in_progress') &&
        this.#current?.phase !== 'terminal' &&
        this.#current?.phase !== 'unavailable'
      ) {
        this.#refresh({ response: event.response, stream_id: event.stream_id });
        return;
      }
      if (
        !isResponseOutputEvent(event) ||
        this.#current?.phase === 'unavailable' ||
        this.#current?.phase === 'terminal'
      ) {
        return;
      }
      const outputEvent = structuredClone(event);
      ResponsesWebSocketAccumulator.#validateOutputEvent(outputEvent);
      this.#addOutput(outputEvent);
    } catch (error) {
      this.#current = {
        phase: 'unavailable',
        error: error instanceof Error ? error : new OpenAIError('Invalid Responses WebSocket output event'),
      };
    }
  }
}
