import { MalformedJSON, partialParse } from '../_vendor/partial-json-parser/parser';
import {
  APIUserAbortError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
  OpenAIError,
} from '../error';
import type OpenAI from '../index';
import { observeJSONRequestBody, type RequestOptions } from '../internal/request-options';
import type { ReadableStream } from '../internal/shim-types';
import { uuid4 } from '../internal/utils/uuid';
import { hasOwn } from '../internal/utils/values';
import {
  hasAutoParseableInput,
  isAutoParsableTool,
  isChatCompletionFunctionTool,
  isParseableResponseFormat,
  maybeParseChatCompletion,
  parseResponseFormatContent,
  shouldParseToolCall,
} from '../lib/parser';
import type { ChatCompletionFunctionTool, ParsedChatCompletion } from '../resources/chat/completions';
import type {
  ChatCompletionAudio,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionRole,
  ChatCompletionTokenLogprob,
} from '../resources/chat/completions/completions';
import { Stream } from '../streaming';
import { AbstractChatCompletionRunner } from './AbstractChatCompletionRunner';
import type { AbstractChatCompletionRunnerEvents } from './AbstractChatCompletionRunner';

function parseStructuredStreamingJSON(content: string): unknown {
  try {
    return partialParse(content);
  } catch (error) {
    if (error instanceof MalformedJSON || error instanceof SyntaxError) {
      return parseResponseFormatContent({ type: 'json_schema', $parseRaw: undefined }, content);
    }

    throw error;
  }
}

/** An incremental assistant-text event and its accumulated state. */
export interface ContentDeltaEvent {
  /** The new text received in this chunk. */
  delta: string;
  /** All assistant text received for this choice, including `delta`. */
  snapshot: string;
  /** The partially parsed structured output when an auto-parseable response format is supplied. */
  parsed: unknown | null;
}

/** The completed assistant-text content and its fully parsed structured value. */
export interface ContentDoneEvent<ParsedT = null> {
  /** The complete assistant text for the finished choice. */
  content: string;
  /** The fully parsed structured output, or `null` when no parser was supplied. */
  parsed: ParsedT | null;
}

/** An incremental refusal-text event and its accumulated state. */
export interface RefusalDeltaEvent {
  /** The new refusal text received in this chunk. */
  delta: string;
  /** All refusal text received for this choice, including `delta`. */
  snapshot: string;
}

/** The complete refusal text emitted when the refusal finishes. */
export interface RefusalDoneEvent {
  /** The model's complete refusal message. */
  refusal: string;
}

/** An incremental function-tool argument event and its accumulated JSON state. */
export interface FunctionToolCallArgumentsDeltaEvent {
  /** The name of the function being called. */
  name: string;

  /** The position of this tool call within the assistant message. */
  index: number;

  /** The complete argument JSON received so far, including `arguments_delta`. */
  arguments: string;

  /** The partially parsed arguments when the matching tool supports parsing. */
  parsed_arguments: unknown;

  /** The new argument JSON fragment received in this chunk. */
  arguments_delta: string;
}

/** The final raw and parsed arguments for a completed function-tool call. */
export interface FunctionToolCallArgumentsDoneEvent {
  /** The name of the function being called. */
  name: string;

  /** The position of this tool call within the assistant message. */
  index: number;

  /** The complete JSON argument string produced for the tool call. */
  arguments: string;

  /** The fully parsed arguments when the matching tool supports parsing. */
  parsed_arguments: unknown;
}

/** Newly received assistant-content token probabilities and their accumulated snapshot. */
export interface LogProbsContentDeltaEvent {
  /** Token probabilities received in the current chunk. */
  content: ChatCompletionTokenLogprob[];
  /** All assistant-content token probabilities received for this choice. */
  snapshot: ChatCompletionTokenLogprob[];
}

/** The complete assistant-content token probabilities for a finished choice. */
export interface LogProbsContentDoneEvent {
  /** Every assistant-content token probability produced for this choice. */
  content: ChatCompletionTokenLogprob[];
}

/** Newly received refusal-token probabilities and their accumulated snapshot. */
export interface LogProbsRefusalDeltaEvent {
  /** Refusal-token probabilities received in the current chunk. */
  refusal: ChatCompletionTokenLogprob[];
  /** All refusal-token probabilities received for this choice. */
  snapshot: ChatCompletionTokenLogprob[];
}

/** The complete refusal-token probabilities for a finished choice. */
export interface LogProbsRefusalDoneEvent {
  /** Every refusal-token probability produced for this choice. */
  refusal: ChatCompletionTokenLogprob[];
}

/** Event listeners supported by a streamed Chat Completions helper. */
export interface ChatCompletionStreamEvents<ParsedT = null> extends AbstractChatCompletionRunnerEvents {
  /** Called with each new text fragment and the complete text accumulated so far. */
  content: (contentDelta: string, contentSnapshot: string) => void;
  /** Called with each raw API chunk and its accumulated chat-completion snapshot. */
  chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;

  /** Called when assistant text arrives, including any partially parsed output. */
  'content.delta': (props: ContentDeltaEvent) => void;
  /** Called once the assistant text is complete and can be fully parsed. */
  'content.done': (props: ContentDoneEvent<ParsedT>) => void;

  /** Called when another fragment of a model refusal arrives. */
  'refusal.delta': (props: RefusalDeltaEvent) => void;
  /** Called once the model's complete refusal is available. */
  'refusal.done': (props: RefusalDoneEvent) => void;

  /** Called when another JSON argument fragment arrives for a function tool. */
  'tool_calls.function.arguments.delta': (props: FunctionToolCallArgumentsDeltaEvent) => void;
  /** Called once a function tool's complete arguments are available. */
  'tool_calls.function.arguments.done': (props: FunctionToolCallArgumentsDoneEvent) => void;

  /** Called when assistant-content token probabilities arrive. */
  'logprobs.content.delta': (props: LogProbsContentDeltaEvent) => void;
  /** Called once all assistant-content token probabilities are available. */
  'logprobs.content.done': (props: LogProbsContentDoneEvent) => void;

  /** Called when refusal-token probabilities arrive. */
  'logprobs.refusal.delta': (props: LogProbsRefusalDeltaEvent) => void;
  /** Called once all refusal-token probabilities are available. */
  'logprobs.refusal.done': (props: LogProbsRefusalDoneEvent) => void;
}

/** Chat completion request parameters accepted by the streaming convenience helper. */
export type ChatCompletionStreamParams = Omit<ChatCompletionCreateParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** A conversation message embedded in a serialized chat completion stream. */
type ChatCompletionReadableStreamMessage = {
  /** Identifies this readable-stream item as a serialized conversation message. */
  type: 'message';
  /** The conversation message to restore while replaying the serialized stream. */
  message: ChatCompletionMessageParam;
  /** Tool-call identifiers to restore on the preceding assistant completion. */
  tool_call_ids?: string[];
};

// Keep message records readable as empty chunks by older SDKs. Their finalizer
// overwrites `object`, so the encoded payload does not leak into completions.
const CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX = 'chat.completion.chunk.message:';

/** A serialized conversation message disguised as a backwards-compatible empty completion chunk. */
type ChatCompletionReadableStreamMessageChunk = Pick<ChatCompletionChunk, 'id' | 'created' | 'model'> & {
  /** Empty choices keep the encoded message compatible with older completion-stream readers. */
  choices: [];
  /** Reserved object prefix followed by the JSON-encoded conversation-message payload. */
  object: `${typeof CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX}${string}`;
};

/** A raw completion chunk or serialized message preserved in a transportable stream. */
export type ChatCompletionReadableStreamItem =
  | ChatCompletionChunk
  | ChatCompletionReadableStreamMessage
  | ChatCompletionReadableStreamMessageChunk;

/** Encodes a tool-result message as a backwards-compatible, empty completion chunk. */
export function makeChatCompletionReadableStreamMessageChunk(
  chunk: ChatCompletionChunk,
  message: ChatCompletionMessageParam,
  toolCallIds?: string[],
): ChatCompletionReadableStreamMessageChunk {
  const payload: ChatCompletionReadableStreamMessage = {
    type: 'message',
    message,
    ...(toolCallIds ? { tool_call_ids: toolCallIds } : {}),
  };

  return {
    id: chunk.id,
    choices: [],
    created: chunk.created,
    model: chunk.model,
    object: `${CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX}${JSON.stringify(payload)}`,
  };
}

function isChatCompletionReadableStreamMessage(
  item: ChatCompletionReadableStreamItem,
): item is ChatCompletionReadableStreamMessage | ChatCompletionReadableStreamMessageChunk {
  return (
    ('type' in item && item.type === 'message' && 'message' in item) ||
    ('object' in item &&
      typeof item.object === 'string' &&
      item.object.startsWith(CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX))
  );
}

function getChatCompletionReadableStreamMessage(
  item: ChatCompletionReadableStreamMessage | ChatCompletionReadableStreamMessageChunk,
): ChatCompletionReadableStreamMessage {
  if ('type' in item) {
    return item;
  }

  return JSON.parse(
    item.object.slice(CHAT_COMPLETION_READABLE_STREAM_MESSAGE_PREFIX.length),
  ) as ChatCompletionReadableStreamMessage;
}

/**
 * A tool call snapshot while it is still being accumulated from stream chunks.
 *
 * Every property is optional because the deltas that make up a tool call arrive
 * across chunks; once they have all been accumulated the entry satisfies
 * {@link ChatCompletionSnapshot.Choice.Message.ToolCall}.
 */
type PartialToolCallSnapshot = {
  id?: string;
  type?: ChatCompletionSnapshot.Choice.Message.ToolCall['type'];
  function?: ChatCompletionSnapshot.Choice.Message.ToolCall.Function;
  custom?: ChatCompletionSnapshot.Choice.Message.ToolCall.CustomToolCall.Custom;
};

interface ChoiceEventState {
  content_done: boolean;
  content_parse_state: PartialJSONParseState | undefined;
  refusal_done: boolean;
  logprobs_content_done: boolean;
  logprobs_refusal_done: boolean;
  current_tool_call_index: number | null;
  done_tool_calls: Set<number>;
  tool_call_parse_states: Map<number, PartialJSONParseState>;
  tool_call_identities: Map<number, ToolCallIdentity>;
}

interface CapturedToolCallDeltaFrame {
  readonly index: number;
  readonly arguments_delta: string;
}

interface CapturedChoiceToolCallFrames {
  readonly index: number;
  readonly tool_calls: readonly CapturedToolCallDeltaFrame[];
}

interface ValidatedChoiceSnapshot {
  message: ChatCompletionSnapshot.Choice.Message;
  content: string | null | undefined;
  refusal: string | null | undefined;
  toolCallCollection: ChatCompletionSnapshot.Choice.Message.ToolCall[] | undefined;
  toolCalls: ReadonlyMap<number, ValidatedToolCallSnapshot>;
}

interface ValidatedToolCallSnapshot {
  tool: ChatCompletionSnapshot.Choice.Message.ToolCall;
  function: ChatCompletionSnapshot.Choice.Message.ToolCall.Function;
  type: 'function';
  name: string;
  arguments: string;
}

interface ToolCallIdentity {
  type: 'function';
  name: string;
  parseable: boolean;
}

interface PartialJSONParseState {
  bytes: number;
  depth: number;
  fragments: number;
  work: number;
  escaped: boolean;
  has_non_whitespace: boolean;
  in_string: boolean;
  last_parsed_bytes: number;
  pending_high_surrogate: boolean;
}

interface PartialJSONParseBudget {
  bytes: number;
  fragments: number;
  work: number;
}

// The Chat Completions schema limits n to 128. Replayed streams do not retain
// request parameters, so apply that choice limit independently and use the same
// conservative ceiling to prevent sparse tool-call arrays from growing unbounded.
const MAX_STREAM_CHOICES = 128;
const MAX_STREAM_TOOL_CALLS = 128;
const MAX_PARTIAL_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PARTIAL_JSON_FRAGMENTS = 65_536;
const MAX_PARTIAL_JSON_DEPTH = 128;
const MAX_PARTIAL_JSON_PARSE_WORK = 64 * 1024 * 1024;
const EAGER_PARTIAL_JSON_BYTES = 1024;

function createPartialJSONParseState(): PartialJSONParseState {
  return {
    bytes: 0,
    depth: 0,
    fragments: 0,
    work: 0,
    escaped: false,
    has_non_whitespace: false,
    in_string: false,
    last_parsed_bytes: 0,
    pending_high_surrogate: false,
  };
}

function recordPartialJSONFragment(
  state: PartialJSONParseState,
  budget: PartialJSONParseBudget,
  fragment: string,
  validationWorkBudget?: PartialJSONParseBudget,
): boolean {
  if (budget.fragments >= MAX_PARTIAL_JSON_FRAGMENTS) {
    throw new OpenAIError('Chat completion stream exceeded its structured JSON fragment limit');
  }

  let bytes = 0;
  let { depth, escaped, has_non_whitespace: hasNonWhitespace, in_string: inString } = state;
  let completed = false;
  let firstCharacter = true;

  for (const character of fragment) {
    const previousBytes = bytes;
    const codePoint = character.codePointAt(0)!;
    if (firstCharacter && state.pending_high_surrogate && codePoint >= 0xdc_00 && codePoint <= 0xdf_ff) {
      bytes += 1;
    } else if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7_ff) {
      bytes += 2;
    } else if (codePoint <= 0xff_ff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
    firstCharacter = false;
    if (budget.bytes + bytes > MAX_PARTIAL_JSON_BYTES) {
      throw new OpenAIError('Chat completion stream exceeded its structured JSON byte limit');
    }
    if (validationWorkBudget && validationWorkBudget.work + bytes > MAX_PARTIAL_JSON_PARSE_WORK) {
      validationWorkBudget.work += previousBytes;
      throw new OpenAIError('Chat completion stream exceeded its structured JSON parse-work limit');
    }

    if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t') {
      hasNonWhitespace = true;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        completed ||= depth === 0;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_PARTIAL_JSON_DEPTH) {
        throw new OpenAIError('Chat completion stream exceeded its structured JSON nesting depth limit');
      }
    } else if ((character === '}' || character === ']') && depth > 0) {
      depth -= 1;
      completed ||= depth === 0;
    }
  }

  state.bytes += bytes;
  state.fragments += 1;
  state.depth = depth;
  state.escaped = escaped;
  state.has_non_whitespace = hasNonWhitespace;
  state.in_string = inString;
  if (fragment.length > 0) {
    const finalCodeUnit = fragment.codePointAt(fragment.length - 1) ?? 0;
    state.pending_high_surrogate = finalCodeUnit >= 0xd8_00 && finalCodeUnit <= 0xdb_ff;
  }
  budget.bytes += bytes;
  budget.fragments += 1;
  if (validationWorkBudget) {
    validationWorkBudget.work += bytes;
  }

  if (!hasNonWhitespace || bytes === 0) {
    return false;
  }

  const minimumGrowth = Math.max(EAGER_PARTIAL_JSON_BYTES, Math.floor(state.last_parsed_bytes / 2));
  if (
    state.bytes > EAGER_PARTIAL_JSON_BYTES &&
    !completed &&
    state.bytes - state.last_parsed_bytes < minimumGrowth
  ) {
    return false;
  }

  return true;
}

function reservePartialJSONParse(state: PartialJSONParseState, budget: PartialJSONParseBudget): boolean {
  if (budget.work + state.bytes > MAX_PARTIAL_JSON_PARSE_WORK) {
    return false;
  }

  budget.work += state.bytes;
  state.work += state.bytes;
  state.last_parsed_bytes = state.bytes;
  return true;
}

function captureStructuredJSONSnapshot(
  snapshot: object,
  property: 'content' | 'arguments' | 'refusal',
): string | null | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, property);
  if (!descriptor) {
    let prototype = Object.getPrototypeOf(snapshot) as object | null;
    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_PARTIAL_JSON_DEPTH || Object.getOwnPropertyDescriptor(prototype, property)) {
        throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return undefined;
  }
  if (
    !('value' in descriptor) ||
    (typeof descriptor.value !== 'string' && descriptor.value !== null && descriptor.value !== undefined)
  ) {
    throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
  }

  return descriptor.value as string | null | undefined;
}

function captureStructuredMessageSnapshot(
  choice: ChatCompletionSnapshot.Choice,
): ChatCompletionSnapshot.Choice.Message {
  const descriptor = Object.getOwnPropertyDescriptor(choice, 'message');
  if (
    !descriptor ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'object' ||
    descriptor.value === null
  ) {
    throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
  }

  return descriptor.value as ChatCompletionSnapshot.Choice.Message;
}

function captureSnapshotArray<Item>(
  snapshot: object,
  property: 'choices' | 'tool_calls',
  maximum: number,
  kind: 'choice' | 'tool-call',
): Item[] | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(snapshot, property);
  if (!descriptor) {
    let prototype = Object.getPrototypeOf(snapshot) as object | null;
    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_PARTIAL_JSON_DEPTH || Object.getOwnPropertyDescriptor(prototype, property)) {
        throw new OpenAIError(`Chat completion stream contains an unsafe snapshot ${kind} collection`);
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return undefined;
  }
  if (!('value' in descriptor) || !Array.isArray(descriptor.value)) {
    throw new OpenAIError(`Chat completion stream contains an unsafe snapshot ${kind} collection`);
  }

  const length = Object.getOwnPropertyDescriptor(descriptor.value, 'length');
  if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value > maximum) {
    throw new OpenAIError(`Chat completion stream exceeded its snapshot ${kind} limit`);
  }

  return descriptor.value as Item[];
}

function captureSnapshotArrayItem<Item>(array: Item[], index: number): Item | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(array, index);
  if (!descriptor) {
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
  }

  return descriptor.value as Item;
}

function mapCapturedSnapshotArray<Item, Mapped>(
  array: Item[],
  maximum: number,
  kind: 'choice' | 'tool-call',
  map: (item: Item, index: number) => Mapped,
): Mapped[] {
  const descriptor = Object.getOwnPropertyDescriptor(array, 'length');
  const length: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum) {
    throw new OpenAIError(`Chat completion stream exceeded its snapshot ${kind} limit`);
  }

  const mapped: Mapped[] = [];
  mapped.length = length;
  for (let index = 0; index < length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(array, index);
    if (!item) {
      continue;
    }
    if (!('value' in item)) {
      throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
    }
    mapped[index] = map(item.value as Item, index);
  }

  return mapped;
}

function validateStructuredJSONSnapshot(
  value: string,
  budget?: PartialJSONParseBudget,
  validationWorkBudget?: PartialJSONParseBudget,
): string {
  const state = createPartialJSONParseState();
  const parseBudget = budget ?? { bytes: 0, fragments: 0, work: 0 };
  recordPartialJSONFragment(state, parseBudget, value, validationWorkBudget);
  if (!reservePartialJSONParse(state, parseBudget)) {
    throw new OpenAIError('Chat completion stream exceeded its structured JSON parse-work limit');
  }

  return value;
}

function ownFunctionToolIdentity(
  toolCall: PartialToolCallSnapshot,
): Pick<ToolCallIdentity, 'type' | 'name'> | undefined {
  const type = Object.getOwnPropertyDescriptor(toolCall, 'type');
  const fn = Object.getOwnPropertyDescriptor(toolCall, 'function');
  if (!type || !('value' in type) || type.value !== 'function' || !fn || !('value' in fn)) {
    return undefined;
  }
  if (typeof fn.value !== 'object' || fn.value === null) {
    return undefined;
  }

  const name = Object.getOwnPropertyDescriptor(fn.value, 'name');
  if (!name || !('value' in name) || typeof name.value !== 'string' || name.value.length === 0) {
    return undefined;
  }

  return { type: 'function', name: name.value };
}

function assertBoundToolCallIdentity(toolCall: PartialToolCallSnapshot, identity: ToolCallIdentity): void {
  const current = ownFunctionToolIdentity(toolCall);
  if (!current || current.name !== identity.name || current.type !== identity.type) {
    throw new OpenAIError('Chat completion stream contains a changed tool call identity');
  }
}

function assignOwnProperties<T extends object>(target: T, source: object): T {
  if (Object.prototype.propertyIsEnumerable.call(source, '__proto__') && !hasOwn(target, '__proto__')) {
    Object.defineProperty(target, '__proto__', {
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return Object.assign(target, source);
}

function cloneParserConfigObject<Value extends object>(
  value: Value,
  stableFields: readonly PropertyKey[] = [],
): Value {
  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(value);
  for (const field of stableFields) {
    const descriptor = descriptors[field];
    if (!descriptor && !(field in value)) {
      continue;
    }

    descriptors[field] = {
      value: descriptor && 'value' in descriptor ? descriptor.value : Reflect.get(value, field, value),
      enumerable: descriptor?.enumerable ?? false,
      configurable: descriptor?.configurable ?? true,
      writable: descriptor && 'writable' in descriptor ? descriptor.writable : false,
    };
  }

  return Object.create(Object.getPrototypeOf(value), descriptors) as Value;
}

function snapshotChatCompletionParserParams(params: ChatCompletionCreateParams): ChatCompletionCreateParams {
  const snapshot = cloneParserConfigObject(params);

  if (params.tools) {
    const stableTools: NonNullable<ChatCompletionCreateParams['tools']> = [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(params.tools, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
    const toolCount =
      typeof length === 'number' && Number.isSafeInteger(length) && length >= 0
        ? Math.min(length, MAX_STREAM_TOOL_CALLS)
        : 0;

    for (let index = 0; index < toolCount; index += 1) {
      const item = Object.getOwnPropertyDescriptor(params.tools, String(index));
      if (!item || !('value' in item)) {
        stableTools.length = index + 1;
        continue;
      }

      const tool = item.value as NonNullable<ChatCompletionCreateParams['tools']>[number];
      const stableTool = cloneParserConfigObject(tool, [
        'type',
        '$brand',
        '$parseRaw',
        '$callback',
        'function',
      ]);
      const descriptors = Object.getOwnPropertyDescriptors(stableTool);

      if (isChatCompletionFunctionTool(stableTool)) {
        const descriptor = descriptors.function;
        descriptors.function = {
          ...(descriptor && 'value' in descriptor
            ? descriptor
            : { configurable: true, enumerable: true, writable: true }),
          value: cloneParserConfigObject(stableTool.function, ['name', 'strict']),
        };
      }

      stableTools[index] = Object.create(Object.getPrototypeOf(tool), descriptors) as typeof tool;
    }
    snapshot.tools = stableTools;
  }

  if (params.response_format) {
    snapshot.response_format = cloneParserConfigObject(params.response_format, [
      'type',
      '$brand',
      '$parseRaw',
    ]);
  }

  return snapshot;
}

type ChatCompletionInputTool = NonNullable<ChatCompletionCreateParams['tools']>[number];
type ChatCompletionResponseFormat = NonNullable<ChatCompletionCreateParams['response_format']>;

interface SerializedFunctionParserConfig {
  source: ChatCompletionInputTool | undefined;
  schemaMatches: boolean;
  name?: string;
  strict?: boolean;
}

interface SerializedToolParserConfig {
  source: ChatCompletionInputTool | undefined;
  type?: string;
  function?: SerializedFunctionParserConfig;
}

interface SerializedResponseParserConfig {
  source: ChatCompletionResponseFormat | undefined;
  schemaMatches: boolean;
  type?: string;
}

interface SerializedParserSchemaBudget {
  nodes: number;
  bytes: number;
}

const MAX_SERIALIZED_PARSER_SCHEMA_NODES = 4096;
const stringifyParserSchemaValue = JSON.stringify;
const MAX_SERIALIZED_PARSER_SCHEMA_BYTES = 1024 * 1024;
const MAX_SERIALIZED_PARSER_SCHEMA_DEPTH = 64;
const OMITTED_SERIALIZED_PARSER_VALUE = Symbol('omitted serialized parser value');
const UNSAFE_SERIALIZED_PARSER_VALUE = Symbol('unsafe serialized parser value');

type CanonicalSerializedParserValue =
  | string
  | typeof OMITTED_SERIALIZED_PARSER_VALUE
  | typeof UNSAFE_SERIALIZED_PARSER_VALUE;

function canonicalSerializedParserSchema(
  value: unknown,
  budget: SerializedParserSchemaBudget,
): string | undefined {
  const ancestors = new WeakSet<object>();

  const charge = (bytes: number): boolean => {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      budget.bytes + bytes > MAX_SERIALIZED_PARSER_SCHEMA_BYTES
    ) {
      return false;
    }
    budget.bytes += bytes;
    return true;
  };

  const visit = (current: unknown, depth: number): CanonicalSerializedParserValue => {
    if (depth > MAX_SERIALIZED_PARSER_SCHEMA_DEPTH || budget.nodes >= MAX_SERIALIZED_PARSER_SCHEMA_NODES) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    budget.nodes += 1;

    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
      return OMITTED_SERIALIZED_PARSER_VALUE;
    }
    if (typeof current === 'bigint') {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      const serialized = stringifyParserSchemaValue(current);
      return typeof serialized === 'string' && charge(serialized.length)
        ? serialized
        : UNSAFE_SERIALIZED_PARSER_VALUE;
    }
    if (typeof current === 'string') {
      if (!charge(current.length * 6 + 2)) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      return stringifyParserSchemaValue(current);
    }
    if (typeof current !== 'object' || ancestors.has(current)) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }

    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current) as object | null;
    if (
      (array && prototype !== Array.prototype) ||
      (!array && prototype !== null && prototype !== Object.prototype)
    ) {
      return UNSAFE_SERIALIZED_PARSER_VALUE;
    }

    for (
      let owner: object | null = current;
      owner !== null;
      owner = Object.getPrototypeOf(owner) as object | null
    ) {
      const serializer = Object.getOwnPropertyDescriptor(owner, 'toJSON');
      if (!serializer) {
        continue;
      }
      if (!('value' in serializer) || typeof serializer.value === 'function') {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }
      break;
    }

    ancestors.add(current);
    try {
      if (!charge(2)) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }

      if (array) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(current, 'length');
        const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
        if (
          typeof length !== 'number' ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > MAX_SERIALIZED_PARSER_SCHEMA_NODES - budget.nodes
        ) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }

        const items: string[] = [];
        for (let index = 0; index < length; index += 1) {
          const key = String(index);
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor) {
            if (
              Object.getOwnPropertyDescriptor(Array.prototype, key) ||
              Object.getOwnPropertyDescriptor(Object.prototype, key)
            ) {
              return UNSAFE_SERIALIZED_PARSER_VALUE;
            }
            budget.nodes += 1;
            if (!charge(4)) {
              return UNSAFE_SERIALIZED_PARSER_VALUE;
            }
            items.push('null');
            continue;
          }
          if (!('value' in descriptor)) {
            return UNSAFE_SERIALIZED_PARSER_VALUE;
          }

          const item = visit(descriptor.value, depth + 1);
          if (item === UNSAFE_SERIALIZED_PARSER_VALUE) {
            return item;
          }
          items.push(item === OMITTED_SERIALIZED_PARSER_VALUE ? 'null' : item);
        }
        return `[${items.join(',')}]`;
      }

      const keys = Reflect.ownKeys(current);
      if (keys.length > MAX_SERIALIZED_PARSER_SCHEMA_NODES - budget.nodes) {
        return UNSAFE_SERIALIZED_PARSER_VALUE;
      }

      const entries: [string, unknown][] = [];
      for (const key of keys) {
        if (typeof key !== 'string') {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        if (!descriptor.enumerable) {
          continue;
        }
        if (!('value' in descriptor)) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        entries.push([key, descriptor.value]);
      }
      entries.sort(([left], [right]) => {
        if (left === right) {
          return 0;
        }
        return left < right ? -1 : 1;
      });

      const fields: string[] = [];
      for (const [key, entry] of entries) {
        const normalized = visit(entry, depth + 1);
        if (normalized === UNSAFE_SERIALIZED_PARSER_VALUE) {
          return normalized;
        }
        if (normalized === OMITTED_SERIALIZED_PARSER_VALUE) {
          continue;
        }
        if (!charge(key.length * 6 + 3)) {
          return UNSAFE_SERIALIZED_PARSER_VALUE;
        }
        fields.push(`${stringifyParserSchemaValue(key)}:${normalized}`);
      }
      return `{${fields.join(',')}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  try {
    const normalized = visit(value, 0);
    return typeof normalized === 'string' ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function rememberSerializedParserSchema(
  signatures: WeakMap<object, string>,
  source: object,
  holder: object,
  key: string,
): void {
  const parser = Object.getOwnPropertyDescriptor(source, '$parseRaw');
  const schema = Object.getOwnPropertyDescriptor(holder, key);
  if (
    !parser ||
    !('value' in parser) ||
    typeof parser.value !== 'function' ||
    !schema ||
    !('value' in schema)
  ) {
    return;
  }

  const normalized = canonicalSerializedParserSchema(schema.value, { nodes: 0, bytes: 0 });
  if (normalized !== undefined) {
    signatures.set(source, normalized);
  }
}

function hasMatchingSerializedParserSchema(
  signatures: WeakMap<object, string>,
  source: object | undefined,
  holder: object,
  key: string,
  value: unknown,
): boolean {
  const expected = source && signatures.get(source);
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  return (
    expected !== undefined &&
    descriptor !== undefined &&
    'value' in descriptor &&
    canonicalSerializedParserSchema(value, { nodes: 0, bytes: 0 }) === expected
  );
}

function serializedParserDescriptor(
  descriptor: PropertyDescriptor | undefined,
  value: unknown,
): PropertyDescriptor {
  return descriptor && 'value' in descriptor
    ? { ...descriptor, value }
    : { configurable: true, enumerable: true, writable: true, value };
}

function shadowSerializedParserMetadata(
  descriptors: PropertyDescriptorMap,
  source: object,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor && !(field in source)) {
      continue;
    }
    descriptors[field] =
      descriptor && 'value' in descriptor
        ? { ...descriptor, value: undefined }
        : {
            configurable: descriptor?.configurable ?? true,
            enumerable: descriptor?.enumerable ?? false,
            writable: false,
            value: undefined,
          };
  }
}

function snapshotSerializedParserTool(serialized: SerializedToolParserConfig): ChatCompletionInputTool {
  const source =
    serialized.source ??
    ({
      type: serialized.type,
      ...(serialized.type === 'function' ? { function: {} } : {}),
    } as ChatCompletionInputTool);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  descriptors.type = serializedParserDescriptor(descriptors.type, serialized.type);

  if (serialized.type !== 'function' || !serialized.function) {
    if (descriptors.function) {
      descriptors.function = serializedParserDescriptor(descriptors.function, undefined);
    }
    shadowSerializedParserMetadata(descriptors, source, ['$brand', '$parseRaw', '$callback']);
    return Object.create(Object.getPrototypeOf(source), descriptors) as ChatCompletionInputTool;
  }

  const descriptor = descriptors.function;
  const original =
    descriptor && 'value' in descriptor && typeof descriptor.value === 'object' && descriptor.value !== null
      ? (descriptor.value as object)
      : {};
  const functionDescriptors = Object.getOwnPropertyDescriptors(original);
  functionDescriptors['name'] = serializedParserDescriptor(
    functionDescriptors['name'],
    serialized.function.name,
  );
  functionDescriptors['strict'] = serializedParserDescriptor(
    functionDescriptors['strict'],
    serialized.function.strict,
  );
  descriptors.function = serializedParserDescriptor(
    descriptor,
    Object.create(Object.getPrototypeOf(original), functionDescriptors),
  );
  if (!serialized.function.schemaMatches) {
    shadowSerializedParserMetadata(descriptors, source, ['$brand', '$parseRaw', '$callback']);
  }

  return Object.create(Object.getPrototypeOf(source), descriptors) as ChatCompletionInputTool;
}

function snapshotSerializedResponseFormat(
  serialized: SerializedResponseParserConfig,
): ChatCompletionResponseFormat {
  const source = serialized.source ?? ({ type: serialized.type } as ChatCompletionResponseFormat);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  descriptors.type = serializedParserDescriptor(descriptors.type, serialized.type);
  if (serialized.type !== 'json_schema' || !serialized.source || !serialized.schemaMatches) {
    shadowSerializedParserMetadata(descriptors, source, ['$brand', '$parseRaw']);
  }
  return Object.create(Object.getPrototypeOf(source), descriptors) as ChatCompletionResponseFormat;
}

function ownSerializedParserObject(holder: object, key: string): object | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  if (!descriptor || !('value' in descriptor)) {
    return undefined;
  }
  const { value } = descriptor;
  return typeof value === 'object' && value !== null ? value : undefined;
}

function observeSerializedChatCompletionParserParams(
  body: ChatCompletionCreateParams,
  initial: ChatCompletionCreateParams,
  update: (params: ChatCompletionCreateParams) => void,
): () => void {
  const originalToolOwners = new WeakMap<object, ChatCompletionInputTool>();
  const originalSchemaSignatures = new WeakMap<object, string>();
  // At most 128 tools plus one response format each receive an independent
  // 4,096-node/1 MiB source and wire allowance (129 MiB maximum per pass).
  if (body.tools) {
    for (let index = 0; index < body.tools.length && index < MAX_STREAM_TOOL_CALLS; index += 1) {
      const owner = ownSerializedParserObject(body.tools, String(index));
      const source = initial.tools?.[index];
      if (owner && source) {
        originalToolOwners.set(owner, source);
        const originalFunction = ownSerializedParserObject(source, 'function');
        if (originalFunction) {
          rememberSerializedParserSchema(originalSchemaSignatures, source, originalFunction, 'parameters');
        }
      }
    }
  }
  if (initial.response_format) {
    rememberSerializedParserSchema(
      originalSchemaSignatures,
      initial.response_format,
      initial.response_format,
      'json_schema',
    );
  }
  let root: object | undefined;
  let tools: object | undefined;
  let responseFormat: object | undefined;
  let responseFrame: SerializedResponseParserConfig | undefined;
  let frames: (SerializedToolParserConfig | undefined)[] = [];
  let toolFrames = new WeakMap<object, SerializedToolParserConfig>();
  let actualToolOwners = new Map<number, object | undefined>();
  let functionFrames = new WeakMap<object, SerializedFunctionParserConfig>();

  return observeJSONRequestBody(body, {
    value(holder, key, value) {
      if (!root && key === '' && typeof value === 'object' && value !== null) {
        root = value;
        tools = undefined;
        responseFormat = undefined;
        responseFrame = undefined;
        frames = [];
        toolFrames = new WeakMap();
        actualToolOwners = new Map();
        functionFrames = new WeakMap();
        return;
      }

      if (holder === root && key === 'response_format') {
        if (typeof value === 'object' && value !== null) {
          responseFormat = value;
          const owner = ownSerializedParserObject(holder, key);
          responseFrame = {
            source: owner === body.response_format ? initial.response_format : undefined,
            schemaMatches: false,
          };
        }
        return;
      }

      if (holder === root && key === 'tools') {
        if (Array.isArray(value)) {
          tools = new Proxy(value, {
            get(target, property) {
              const actual = Reflect.get(target, property, target) as unknown;
              if (typeof property === 'string') {
                const index = Number(property);
                if (
                  Number.isSafeInteger(index) &&
                  index >= 0 &&
                  index < MAX_STREAM_TOOL_CALLS &&
                  String(index) === property
                ) {
                  actualToolOwners.set(
                    index,
                    typeof actual === 'object' && actual !== null ? actual : undefined,
                  );
                }
              }
              return actual;
            },
          });
          return tools;
        }
        return;
      }

      if (holder === tools) {
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= MAX_STREAM_TOOL_CALLS ||
          typeof value !== 'object' ||
          value === null
        ) {
          return;
        }
        const owner = actualToolOwners.get(index);
        const source = owner ? originalToolOwners.get(owner) : undefined;
        const frame: SerializedToolParserConfig = { source };
        frames[index] = frame;
        toolFrames.set(value, frame);
        return;
      }

      const tool = toolFrames.get(holder);
      if (tool) {
        if (key === 'type' && typeof value === 'string') {
          tool.type = value;
        } else if (key === 'function' && typeof value === 'object' && value !== null) {
          const fn: SerializedFunctionParserConfig = { source: tool.source, schemaMatches: false };
          tool.function = fn;
          functionFrames.set(value, fn);
        }
        return;
      }

      if (holder === responseFormat && responseFrame) {
        if (key === 'type' && typeof value === 'string') {
          responseFrame.type = value;
        } else if (key === 'json_schema') {
          responseFrame.schemaMatches = hasMatchingSerializedParserSchema(
            originalSchemaSignatures,
            responseFrame.source,
            holder,
            key,
            value,
          );
        }
        return;
      }

      const fn = functionFrames.get(holder);
      if (fn) {
        if (key === 'name' && typeof value === 'string') {
          fn.name = value;
        } else if (key === 'strict' && typeof value === 'boolean') {
          fn.strict = value;
        } else if (key === 'parameters') {
          fn.schemaMatches = hasMatchingSerializedParserSchema(
            originalSchemaSignatures,
            fn.source,
            holder,
            key,
            value,
          );
        }
      }
      return undefined;
    },
    complete() {
      if (!root) {
        return;
      }
      const snapshot = cloneParserConfigObject(initial);
      if (tools) {
        const serializedTools: ChatCompletionInputTool[] = [];
        for (let index = 0; index < frames.length; index += 1) {
          const frame = frames[index];
          if (frame) {
            serializedTools[index] = snapshotSerializedParserTool(frame);
          }
        }
        snapshot.tools = serializedTools;
      } else {
        delete snapshot.tools;
      }
      if (responseFrame) {
        snapshot.response_format = snapshotSerializedResponseFormat(responseFrame);
      } else {
        delete snapshot.response_format;
      }
      update(snapshot);
      root = undefined;
      tools = undefined;
      responseFormat = undefined;
      responseFrame = undefined;
      frames = [];
      toolFrames = new WeakMap();
      actualToolOwners = new Map();
      functionFrames = new WeakMap();
    },
  });
}

/** Streams chat completion chunks while accumulating snapshots, parsed output, and events. */
export class ChatCompletionStream<ParsedT = null>
  extends AbstractChatCompletionRunner<ChatCompletionStreamEvents<ParsedT>, ParsedT>
  implements AsyncIterable<ChatCompletionChunk>
{
  #params: ChatCompletionCreateParams | null;
  #audioDoneChoiceIndexes: Set<number>;
  #choiceEventStates: ChoiceEventState[];
  #currentChatCompletionSnapshot: ChatCompletionSnapshot | undefined;
  #hasAutoParseableTool: boolean;
  #partialJSONParseBudget: PartialJSONParseBudget;

  /** Creates an unstarted stream, retaining request parameters for structured-output parsing. */
  constructor(params: ChatCompletionCreateParams | null) {
    super();
    this.#params = params;
    this.#audioDoneChoiceIndexes = new Set();
    this.#choiceEventStates = [];
    this.#hasAutoParseableTool = false;
    const tools = params?.tools;
    const lengthDescriptor = tools && Object.getOwnPropertyDescriptor(tools, 'length');
    const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (tools && typeof length === 'number' && Number.isSafeInteger(length) && length >= 0) {
      for (let index = 0; index < Math.min(length, MAX_STREAM_TOOL_CALLS); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(tools, String(index));
        if (!descriptor || !('value' in descriptor)) {
          continue;
        }
        const tool = descriptor.value as ChatCompletionInputTool;
        if (
          isChatCompletionFunctionTool(tool) &&
          (isAutoParsableTool(tool) || tool.function.strict === true)
        ) {
          this.#hasAutoParseableTool = true;
          break;
        }
      }
    }
    this.#partialJSONParseBudget = { bytes: 0, fragments: 0, work: 0 };
  }

  /** The latest accumulated completion, or `undefined` before a chunk arrives or after finalization. */
  get currentChatCompletionSnapshot(): ChatCompletionSnapshot | undefined {
    return this.#currentChatCompletionSnapshot;
  }

  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Original input messages are not included in the serialized stream. Tool-result
   * messages explicitly serialized by a streaming tool runner are replayed.
   */
  static fromReadableStream(stream: ReadableStream): ChatCompletionStream<null> {
    const runner = new ChatCompletionStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  /** Starts a streaming chat completion request and returns its event-driven helper. */
  static createChatCompletion<ParsedT>(
    client: OpenAI,
    params: ChatCompletionStreamParams,
    options?: RequestOptions,
  ): ChatCompletionStream<ParsedT> {
    const runner = new ChatCompletionStream<ParsedT>(params as ChatCompletionCreateParamsStreaming);
    runner._run(() =>
      runner._runChatCompletion(
        client,
        { ...params, stream: true },
        { ...options, __metadata: { ...options?.__metadata, helperMethod: 'stream' } },
      ),
    );
    return runner;
  }

  #beginRequest() {
    if (this.ended) {
      return;
    }
    this.#audioDoneChoiceIndexes = new Set();
    this.#currentChatCompletionSnapshot = undefined;
    this.#partialJSONParseBudget = { bytes: 0, fragments: 0, work: 0 };
  }

  #getChoiceEventState(choice: ChatCompletionSnapshot.Choice): ChoiceEventState {
    let state = this.#choiceEventStates[choice.index];
    if (state) {
      return state;
    }

    state = {
      content_done: false,
      content_parse_state: undefined,
      refusal_done: false,
      logprobs_content_done: false,
      logprobs_refusal_done: false,
      done_tool_calls: new Set(),
      current_tool_call_index: null,
      tool_call_parse_states: new Map(),
      tool_call_identities: new Map(),
    };
    this.#choiceEventStates[choice.index] = state;
    return state;
  }

  #addChunk(this: ChatCompletionStream<ParsedT>, chunk: ChatCompletionChunk) {
    if (this.ended) {
      return;
    }

    const capturedChoiceFrames = new WeakMap<object, CapturedChoiceToolCallFrames>();
    const completion = this.#accumulateChatCompletion(chunk, capturedChoiceFrames);
    this._emit('chunk', chunk, completion);

    for (const choice of chunk.choices) {
      const capturedChoice = capturedChoiceFrames.get(choice);
      const choiceSnapshot = completion.choices[capturedChoice?.index ?? choice.index]!;
      const capturedToolCalls = capturedChoice?.tool_calls ?? [];
      const { delta } = choice;
      const structuredResponse = isParseableResponseFormat(this.#params?.response_format);
      const boundedSnapshot = structuredResponse || this.#hasAutoParseableTool;
      const messageSnapshot = boundedSnapshot
        ? captureStructuredMessageSnapshot(choiceSnapshot)
        : choiceSnapshot.message;
      const refusal = boundedSnapshot
        ? captureStructuredJSONSnapshot(messageSnapshot, 'refusal')
        : messageSnapshot.refusal;
      const parseableContent = !refusal && structuredResponse;
      const messageContent = parseableContent
        ? captureStructuredJSONSnapshot(messageSnapshot, 'content')
        : messageSnapshot.content;

      if (delta?.content != null && messageSnapshot.role === 'assistant' && messageContent) {
        this._emit('content', delta.content, messageContent);
        this._emit('content.delta', {
          delta: delta.content,
          snapshot: messageContent,
          parsed: messageSnapshot.parsed,
        });
      }

      if (delta?.refusal != null && messageSnapshot.role === 'assistant' && refusal) {
        this._emit('refusal.delta', {
          delta: delta.refusal,
          snapshot: refusal,
        });
      }

      if (choice.logprobs?.content != null && messageSnapshot.role === 'assistant') {
        this._emit('logprobs.content.delta', {
          content: choice.logprobs?.content,
          snapshot: choiceSnapshot.logprobs?.content ?? [],
        });
      }

      if (choice.logprobs?.refusal != null && messageSnapshot.role === 'assistant') {
        this._emit('logprobs.refusal.delta', {
          refusal: choice.logprobs?.refusal,
          snapshot: choiceSnapshot.logprobs?.refusal ?? [],
        });
      }

      const state = this.#getChoiceEventState(choiceSnapshot);

      if (choiceSnapshot.finish_reason) {
        this.#emitContentDoneEvents(choiceSnapshot);

        if (state.current_tool_call_index != null) {
          this.#emitToolCallDoneEvent(choiceSnapshot, state.current_tool_call_index);
        }
      }

      for (const toolCall of capturedToolCalls) {
        if (state.current_tool_call_index !== toolCall.index) {
          this.#emitContentDoneEvents(choiceSnapshot);

          // new tool call started, the previous one is done
          if (state.current_tool_call_index != null) {
            this.#emitToolCallDoneEvent(choiceSnapshot, state.current_tool_call_index);
          }
        }

        state.current_tool_call_index = toolCall.index;
      }

      for (const toolCallDelta of capturedToolCalls) {
        const toolCallSnapshot = messageSnapshot.tool_calls?.[toolCallDelta.index];
        if (!toolCallSnapshot?.type) {
          continue;
        }

        if (toolCallSnapshot.type === 'function') {
          const boundIdentity = state.tool_call_identities.get(toolCallDelta.index);
          let argumentsSnapshot: string;
          if (boundIdentity?.parseable) {
            const capturedArguments = captureStructuredJSONSnapshot(toolCallSnapshot.function, 'arguments');
            if (typeof capturedArguments !== 'string') {
              throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
            }
            argumentsSnapshot = capturedArguments;
          } else {
            argumentsSnapshot = toolCallSnapshot.function.arguments;
          }
          this._emit('tool_calls.function.arguments.delta', {
            name: toolCallSnapshot.function.name,
            index: toolCallDelta.index,
            arguments: argumentsSnapshot,
            parsed_arguments: toolCallSnapshot.function.parsed_arguments,
            arguments_delta: toolCallDelta.arguments_delta,
          });
        } else if (toolCallSnapshot.type !== 'custom') {
          assertNever(toolCallSnapshot);
        }
      }
    }
  }

  #emitToolCallDoneEvent(choiceSnapshot: ChatCompletionSnapshot.Choice, toolCallIndex: number) {
    const state = this.#getChoiceEventState(choiceSnapshot);
    if (state.done_tool_calls.has(toolCallIndex)) {
      // we've already fired the done event
      return;
    }

    const messageSnapshot = this.#hasAutoParseableTool
      ? captureStructuredMessageSnapshot(choiceSnapshot)
      : choiceSnapshot.message;
    const toolCallSnapshot = messageSnapshot.tool_calls?.[toolCallIndex];
    if (!toolCallSnapshot) {
      throw new Error('no tool call snapshot');
    }
    const boundIdentity = state.tool_call_identities.get(toolCallIndex);
    if (boundIdentity) {
      assertBoundToolCallIdentity(toolCallSnapshot, boundIdentity);
    }

    if (!toolCallSnapshot.type) {
      throw new Error('tool call snapshot missing `type`');
    }

    if (toolCallSnapshot.type === 'function') {
      const inputTool = this.#params?.tools?.find(
        (tool) => isChatCompletionFunctionTool(tool) && tool.function.name === toolCallSnapshot.function.name,
      ) as ChatCompletionFunctionTool | undefined; // TS doesn't narrow based on isChatCompletionTool

      let parsedArguments: unknown = null;
      const parseable = isAutoParsableTool(inputTool) || inputTool?.function.strict === true;
      let argumentsSnapshot: string;
      if (parseable) {
        if (this.#currentChatCompletionSnapshot) {
          this.#validateStructuredSnapshots(this.#currentChatCompletionSnapshot);
        }
        const capturedArguments = captureStructuredJSONSnapshot(toolCallSnapshot.function, 'arguments');
        if (typeof capturedArguments !== 'string') {
          throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
        }
        argumentsSnapshot = capturedArguments;
      } else {
        argumentsSnapshot = toolCallSnapshot.function.arguments;
      }
      if (isAutoParsableTool(inputTool)) {
        parsedArguments = inputTool.$parseRaw(validateStructuredJSONSnapshot(argumentsSnapshot));
      } else if (inputTool?.function.strict) {
        parsedArguments = parseResponseFormatContent(
          { type: 'json_schema', $parseRaw: undefined },
          validateStructuredJSONSnapshot(argumentsSnapshot),
        );
      }

      this._emit('tool_calls.function.arguments.done', {
        name: toolCallSnapshot.function.name,
        index: toolCallIndex,
        arguments: argumentsSnapshot,
        parsed_arguments: parsedArguments,
      });
    } else if (toolCallSnapshot.type !== 'custom') {
      assertNever(toolCallSnapshot);
    }
  }

  #emitContentDoneEvents(choiceSnapshot: ChatCompletionSnapshot.Choice) {
    const state = this.#getChoiceEventState(choiceSnapshot);
    const structuredResponse = isParseableResponseFormat(this.#params?.response_format);
    const boundedSnapshot = structuredResponse || this.#hasAutoParseableTool;
    const messageSnapshot = boundedSnapshot
      ? captureStructuredMessageSnapshot(choiceSnapshot)
      : choiceSnapshot.message;
    const refusal = boundedSnapshot
      ? captureStructuredJSONSnapshot(messageSnapshot, 'refusal')
      : messageSnapshot.refusal;
    const parseableContent = !refusal && structuredResponse;
    const content = parseableContent
      ? captureStructuredJSONSnapshot(messageSnapshot, 'content')
      : messageSnapshot.content;

    if (
      content != null &&
      (content !== '' ||
        (!refusal && !messageSnapshot.tool_calls?.length && !messageSnapshot.function_call)) &&
      !state.content_done
    ) {
      if (parseableContent && this.#currentChatCompletionSnapshot) {
        this.#validateStructuredSnapshots(this.#currentChatCompletionSnapshot);
      }
      state.content_done = true;

      this._emit('content.done', {
        content,
        parsed: refusal
          ? null
          : parseResponseFormatContent<ParsedT>(
              this.#params?.response_format,
              parseableContent ? validateStructuredJSONSnapshot(content) : content,
            ),
      });
    }

    if (refusal && !state.refusal_done) {
      state.refusal_done = true;

      this._emit('refusal.done', { refusal });
    }

    if (choiceSnapshot.logprobs?.content && !state.logprobs_content_done) {
      state.logprobs_content_done = true;

      this._emit('logprobs.content.done', { content: choiceSnapshot.logprobs.content });
    }

    if (choiceSnapshot.logprobs?.refusal && !state.logprobs_refusal_done) {
      state.logprobs_refusal_done = true;

      this._emit('logprobs.refusal.done', { refusal: choiceSnapshot.logprobs.refusal });
    }
  }

  #validateStructuredSnapshots(
    snapshot: ChatCompletionSnapshot,
  ): WeakMap<ChatCompletionSnapshot.Choice, ValidatedChoiceSnapshot> {
    const finalJSONBudget: PartialJSONParseBudget = { bytes: 0, fragments: 0, work: 0 };
    const parseableContent = isParseableResponseFormat(this.#params?.response_format);
    const validatedMessages = new WeakMap<ChatCompletionSnapshot.Choice, ValidatedChoiceSnapshot>();
    const choices = captureSnapshotArray<ChatCompletionSnapshot.Choice>(
      snapshot,
      'choices',
      MAX_STREAM_CHOICES,
      'choice',
    );
    if (!choices) {
      throw new OpenAIError('Chat completion stream contains an unsafe snapshot choice collection');
    }
    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
      const choice = captureSnapshotArrayItem(choices, choiceIndex);
      if (!choice) {
        continue;
      }
      const message = captureStructuredMessageSnapshot(choice);
      const refusal = captureStructuredJSONSnapshot(message, 'refusal');
      const content = captureStructuredJSONSnapshot(message, 'content');
      const validatedTools = new Map<number, ValidatedToolCallSnapshot>();
      const toolCalls = captureSnapshotArray<ChatCompletionSnapshot.Choice.Message.ToolCall>(
        message,
        'tool_calls',
        MAX_STREAM_TOOL_CALLS,
        'tool-call',
      );
      validatedMessages.set(
        choice,
        Object.freeze({
          message,
          content,
          refusal,
          toolCallCollection: toolCalls,
          toolCalls: validatedTools,
        }),
      );
      const state = this.#choiceEventStates[choice.index];
      if (parseableContent && !refusal && typeof content === 'string') {
        validateStructuredJSONSnapshot(content, finalJSONBudget, this.#partialJSONParseBudget);
      }
      for (const [index, identity] of state?.tool_call_identities ?? []) {
        const toolCall = toolCalls && captureSnapshotArrayItem(toolCalls, index);
        if (!toolCall) {
          throw new OpenAIError('Chat completion stream contains a changed tool call identity');
        }
        assertBoundToolCallIdentity(toolCall, identity);
      }
      if (!this.#hasAutoParseableTool) {
        continue;
      }
      for (let toolCallIndex = 0; toolCallIndex < (toolCalls?.length ?? 0); toolCallIndex += 1) {
        const toolCall = captureSnapshotArrayItem(toolCalls!, toolCallIndex);
        if (!toolCall) {
          continue;
        }
        const identity = ownFunctionToolIdentity(toolCall);
        if (!identity) {
          const type = Object.getOwnPropertyDescriptor(toolCall, 'type');
          if (type && !('value' in type)) {
            throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
          }
          if (type?.value !== 'function') {
            continue;
          }
          const fn = Object.getOwnPropertyDescriptor(toolCall, 'function');
          if (fn && !('value' in fn)) {
            throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
          }
          if (fn && typeof fn.value === 'object' && fn.value !== null) {
            const name = Object.getOwnPropertyDescriptor(fn.value, 'name');
            if (name && !('value' in name)) {
              throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
            }
          }
          continue;
        }
        if (
          !shouldParseToolCall(this.#params, {
            type: identity.type,
            function: { name: identity.name },
          })
        ) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(toolCall, 'function');
        if (!descriptor || !('value' in descriptor)) {
          throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
        }
        const fn = descriptor.value as ChatCompletionSnapshot.Choice.Message.ToolCall.Function;
        const argumentsSnapshot = captureStructuredJSONSnapshot(fn, 'arguments');
        if (typeof argumentsSnapshot !== 'string') {
          throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
        }
        validateStructuredJSONSnapshot(argumentsSnapshot, finalJSONBudget, this.#partialJSONParseBudget);
        validatedTools.set(
          toolCallIndex,
          Object.freeze({
            tool: toolCall,
            function: fn,
            type: identity.type,
            name: identity.name,
            arguments: argumentsSnapshot,
          }),
        );
      }
    }
    return validatedMessages;
  }

  #endRequest(): ParsedChatCompletion<ParsedT> {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = this.#currentChatCompletionSnapshot;
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any chunks`);
    }
    const validatedMessages = this.#validateStructuredSnapshots(snapshot);
    const audioDoneChoiceIndexes = this.#audioDoneChoiceIndexes;
    this.#audioDoneChoiceIndexes = new Set();
    this.#currentChatCompletionSnapshot = undefined;
    this.#choiceEventStates = [];
    return finalizeChatCompletion(snapshot, this.#params, audioDoneChoiceIndexes, validatedMessages);
  }

  protected override async _createChatCompletion(
    client: OpenAI,
    params: ChatCompletionCreateParams,
    options?: RequestOptions,
  ): Promise<ParsedChatCompletion<ParsedT>> {
    this._listenForAbort(options?.signal);
    const requestParams = { ...params, stream: true as const };
    this.#params = requestParams;
    this.#beginRequest();

    const parserParams = snapshotChatCompletionParserParams(requestParams);
    this.#params = parserParams;
    this.#hasAutoParseableTool =
      parserParams.tools?.some(
        (tool) =>
          isChatCompletionFunctionTool(tool) && (isAutoParsableTool(tool) || tool.function.strict === true),
      ) ?? false;
    const stopObserving =
      requestParams.tools || requestParams.response_format
        ? observeSerializedChatCompletionParserParams(requestParams, parserParams, (serialized) => {
            this.#params = serialized;
            this.#hasAutoParseableTool =
              serialized.tools?.some(
                (tool) =>
                  isChatCompletionFunctionTool(tool) &&
                  (isAutoParsableTool(tool) || tool.function.strict === true),
              ) ?? false;
          })
        : undefined;
    const stream = await client.chat.completions
      .create(requestParams, {
        ...options,
        signal: this.controller.signal,
      })
      .finally(stopObserving);
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
    options?: RequestOptions,
  ): Promise<ChatCompletion> {
    this._listenForAbort(options?.signal);
    this.#beginRequest();
    this._connected();
    const stream = Stream.fromReadableStream<ChatCompletionReadableStreamItem>(
      readableStream,
      this.controller,
    );
    let chatId;
    for await (const item of stream) {
      if (isChatCompletionReadableStreamMessage(item)) {
        const message = getChatCompletionReadableStreamMessage(item);
        if (this.#currentChatCompletionSnapshot) {
          const toolCalls = this.#currentChatCompletionSnapshot.choices[0]?.message.tool_calls;
          for (const [index, id] of message.tool_call_ids?.entries() ?? []) {
            const toolCall = toolCalls?.[index];
            if (toolCall && id) {
              toolCall.id = id;
            }
          }

          this._addChatCompletion(this.#endRequest());
          chatId = undefined;
        }
        this._addMessage(message.message);
        continue;
      }

      const chunk = item;

      if (chatId && chunk.id && chatId !== chunk.id) {
        // A new request has been made.
        this._addChatCompletion(this.#endRequest());
      }

      this.#addChunk(chunk);
      if (chunk.id) {
        chatId = chunk.id;
      }
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    if (this.#currentChatCompletionSnapshot) {
      return this._addChatCompletion(this.#endRequest());
    }
    const lastChatCompletion = this._chatCompletions[this._chatCompletions.length - 1];
    if (lastChatCompletion) {
      return lastChatCompletion;
    }
    throw new OpenAIError(`request ended without sending any chunks`);
  }

  #accumulateChatCompletion(
    chunk: ChatCompletionChunk,
    capturedChoiceFrames: WeakMap<object, CapturedChoiceToolCallFrames>,
  ): ChatCompletionSnapshot {
    let snapshot = this.#currentChatCompletionSnapshot;
    const { choices, obfuscation: _obfuscation, ...rest } = chunk;
    if (!snapshot) {
      const newSnapshot: ChatCompletionSnapshot = {
        ...rest,
        choices: [],
      };
      this.#currentChatCompletionSnapshot = newSnapshot;
      snapshot = newSnapshot;
    } else if (chunk.id) {
      assignOwnProperties(snapshot, rest);
    }

    const requestedChoiceCount = this.#params?.n;
    const maxChoices =
      typeof requestedChoiceCount === 'number' &&
      Number.isSafeInteger(requestedChoiceCount) &&
      requestedChoiceCount > 0
        ? Math.min(requestedChoiceCount, MAX_STREAM_CHOICES)
        : MAX_STREAM_CHOICES;

    for (const chunkChoice of chunk.choices) {
      const { delta, finish_reason, index, logprobs = null, ...other } = chunkChoice;
      const capturedToolCalls: CapturedToolCallDeltaFrame[] = [];
      capturedChoiceFrames.set(chunkChoice, Object.freeze({ index, tool_calls: capturedToolCalls }));
      if (!Number.isSafeInteger(index) || index < 0 || index >= maxChoices) {
        throw new OpenAIError(`Chat completion stream contains an invalid choice index: ${index}`);
      }

      let choice = snapshot.choices[index];
      if (!choice) {
        const newChoice = { finish_reason, index, message: {}, logprobs: null, ...other };
        snapshot.choices[index] = newChoice;
        choice = newChoice;
      }
      if (isParseableResponseFormat(this.#params?.response_format) || this.#hasAutoParseableTool) {
        captureStructuredJSONSnapshot(captureStructuredMessageSnapshot(choice), 'refusal');
      }

      if (logprobs) {
        if (choice.logprobs) {
          const { content, refusal, ...rest } = logprobs;
          assertIsEmpty(rest);
          assignOwnProperties(choice.logprobs, rest);

          if (content) {
            choice.logprobs.content ??= [];
            choice.logprobs.content.push(...content);
          }

          if (refusal) {
            choice.logprobs.refusal ??= [];
            choice.logprobs.refusal.push(...refusal);
          }
        } else {
          choice.logprobs = { ...logprobs };

          if (logprobs.content) {
            choice.logprobs.content = [...logprobs.content];
          }

          if (logprobs.refusal) {
            choice.logprobs.refusal = [...logprobs.refusal];
          }
        }
      }

      if (finish_reason) {
        choice.finish_reason = finish_reason;

        if (this.#params && hasAutoParseableInput(this.#params)) {
          if (finish_reason === 'length') {
            throw new LengthFinishReasonError();
          }

          if (finish_reason === 'content_filter') {
            throw new ContentFilterFinishReasonError();
          }
        }
      }

      assignOwnProperties(choice, other);

      if (!delta) {
        Object.freeze(capturedToolCalls);
        continue;
      } // Shouldn't happen; just in case.

      this.#audioDoneChoiceIndexes.delete(index);
      const { audio, content, refusal, function_call, role, ...capturedDeltaFields } =
        delta as typeof delta & {
          audio?: Partial<ChatCompletionAudio> | null;
        };
      const { tool_calls: capturedToolCallDelta, ...rest } = capturedDeltaFields;
      const tool_calls = hasOwn(capturedDeltaFields, 'tool_calls') ? capturedToolCallDelta : delta.tool_calls;
      assertIsEmpty(rest);
      assignOwnProperties(choice.message, rest);
      if (
        audio?.expires_at != null &&
        audio.id == null &&
        audio.data == null &&
        audio.transcript == null &&
        content == null &&
        refusal == null &&
        function_call == null &&
        role == null &&
        tool_calls == null &&
        Object.keys(rest).length === 0
      ) {
        this.#audioDoneChoiceIndexes.add(index);
      }

      if (refusal) {
        choice.message.refusal = (choice.message.refusal || '') + refusal;
      }

      if (role) {
        choice.message.role = role;
      }
      if (audio) {
        const audioSnapshot = (choice.message.audio ??= {});
        if (audio.id != null) {
          audioSnapshot.id = audio.id;
        }
        if (audio.data != null) {
          audioSnapshot.data = (audioSnapshot.data ?? '') + audio.data;
        }
        if (audio.transcript != null) {
          audioSnapshot.transcript = (audioSnapshot.transcript ?? '') + audio.transcript;
        }
        if (audio.expires_at != null) {
          audioSnapshot.expires_at = audio.expires_at;
        }
      }
      if (function_call) {
        if (choice.message.function_call) {
          if (function_call.name) {
            choice.message.function_call.name = function_call.name;
          }
          if (function_call.arguments) {
            choice.message.function_call.arguments ??= '';
            choice.message.function_call.arguments += function_call.arguments;
          }
        } else {
          choice.message.function_call = function_call;
        }
      }
      if (content != null) {
        if (!choice.message.refusal && isParseableResponseFormat(this.#params?.response_format)) {
          const eventState = this.#getChoiceEventState(choice);
          const parseState = (eventState.content_parse_state ??= createPartialJSONParseState());
          const shouldParse = recordPartialJSONFragment(parseState, this.#partialJSONParseBudget, content);
          choice.message.content = (captureStructuredJSONSnapshot(choice.message, 'content') || '') + content;

          // The partial parser does not accept whitespace-only input. Once output
          // grows, coalesce prefix reparses while preserving every raw snapshot.
          if (!parseState.has_non_whitespace) {
            choice.message.parsed = null;
          } else if (shouldParse && reservePartialJSONParse(parseState, this.#partialJSONParseBudget)) {
            this.#validateStructuredSnapshots(snapshot);
            choice.message.parsed = parseStructuredStreamingJSON(
              validateStructuredJSONSnapshot(choice.message.content),
            );
          } else if (content.length > 0) {
            choice.message.parsed = null;
          }
        } else {
          choice.message.content = (choice.message.content || '') + content;
        }
      }

      if (tool_calls) {
        // Tool calls are built up across chunks, so while the stream is in progress the
        // entries are only partially filled in; they match `ChatCompletionSnapshot.Choice.Message.ToolCall`
        // once every delta for them has been accumulated.
        const toolCallSnapshots = (choice.message.tool_calls ??= []) as PartialToolCallSnapshot[];

        for (const toolCallDelta of tool_calls) {
          const { index, id, type, function: fn, custom, ...rest } = toolCallDelta;
          if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_STREAM_TOOL_CALLS) {
            throw new OpenAIError(`Chat completion stream contains an invalid tool call index: ${index}`);
          }
          let argumentsDelta = '';

          const tool_call = (toolCallSnapshots[index] ??= {});
          const functionName = fn?.name;
          const eventState = this.#hasAutoParseableTool ? this.#getChoiceEventState(choice) : undefined;
          let boundIdentity = eventState?.tool_call_identities.get(index);
          if (boundIdentity) {
            assertBoundToolCallIdentity(tool_call, boundIdentity);
            if (
              (type !== undefined && type !== boundIdentity.type) ||
              (functionName !== undefined && functionName !== boundIdentity.name)
            ) {
              throw new OpenAIError('Chat completion stream contains a changed tool call identity');
            }
          }

          assignOwnProperties(tool_call, rest);
          if (id) {
            tool_call.id = id;
          }
          if (type) {
            tool_call.type = type;
          }
          if (custom) {
            const customSnapshot = (tool_call.custom ??= { name: custom.name ?? '', input: '' });
            if (custom.name) {
              customSnapshot.name = custom.name;
            }
            if (custom.input) {
              customSnapshot.input += custom.input;
            }
          }
          if (fn) {
            const functionSnapshot = (tool_call.function ??= { name: functionName ?? '', arguments: '' });
            if (functionName) {
              functionSnapshot.name = functionName;
            }
            if (eventState && !boundIdentity) {
              const identity = ownFunctionToolIdentity(tool_call);
              const configuredTool =
                identity &&
                this.#params?.tools?.find(
                  (tool) => isChatCompletionFunctionTool(tool) && tool.function.name === identity.name,
                );
              if (identity) {
                boundIdentity = {
                  ...identity,
                  parseable:
                    configuredTool !== undefined &&
                    shouldParseToolCall(this.#params, {
                      type: identity.type,
                      function: { name: identity.name },
                    }),
                };
                eventState.tool_call_identities.set(index, boundIdentity);
                if (!boundIdentity.parseable) {
                  const provisionalState = eventState.tool_call_parse_states.get(index);
                  if (provisionalState) {
                    this.#partialJSONParseBudget.bytes -= provisionalState.bytes;
                    this.#partialJSONParseBudget.fragments -= provisionalState.fragments;
                    this.#partialJSONParseBudget.work -= provisionalState.work;
                    eventState.tool_call_parse_states.delete(index);
                  }
                }
              }
            }
            const argumentFragment = fn.arguments;
            if (argumentFragment != null) {
              argumentsDelta = argumentFragment;
              if (eventState && boundIdentity?.parseable !== false) {
                let parseState = eventState.tool_call_parse_states.get(index);
                if (!parseState) {
                  parseState = createPartialJSONParseState();
                  eventState.tool_call_parse_states.set(index, parseState);
                }

                const shouldParse = recordPartialJSONFragment(
                  parseState,
                  this.#partialJSONParseBudget,
                  argumentFragment,
                );
                const previousArguments = captureStructuredJSONSnapshot(functionSnapshot, 'arguments');
                if (typeof previousArguments !== 'string') {
                  throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
                }
                functionSnapshot.arguments = previousArguments + argumentFragment;
                if (
                  shouldParse &&
                  boundIdentity?.parseable === true &&
                  reservePartialJSONParse(parseState, this.#partialJSONParseBudget)
                ) {
                  this.#validateStructuredSnapshots(snapshot);
                  functionSnapshot.parsed_arguments = parseStructuredStreamingJSON(
                    validateStructuredJSONSnapshot(functionSnapshot.arguments),
                  );
                } else if (argumentFragment.length > 0 && hasOwn(functionSnapshot, 'parsed_arguments')) {
                  functionSnapshot.parsed_arguments = undefined;
                }
              } else {
                functionSnapshot.arguments += argumentFragment;
              }
            }
          }
          capturedToolCalls.push(Object.freeze({ index, arguments_delta: argumentsDelta }));
        }
      }
      Object.freeze(capturedToolCalls);
    }
    return snapshot;
  }

  /** Iterates over raw API chunks; stopping iteration early aborts the underlying request. */
  [Symbol.asyncIterator](this: ChatCompletionStream<ParsedT>): AsyncIterator<ChatCompletionChunk> {
    return this._createIterator<ChatCompletionChunk>(
      (push) => {
        const onChunk = (chunk: ChatCompletionChunk) => push(chunk);
        this.on('chunk', onChunk);
        return () => this.off('chunk', onChunk);
      },
      { onReturn: () => this.abort() },
    );
  }

  /** Serializes raw completion chunks into a readable stream for transfer to another runtime. */
  toReadableStream(): ReadableStream {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}

function finalizeChatCompletion<ParsedT>(
  snapshot: ChatCompletionSnapshot,
  params: ChatCompletionCreateParams | null,
  audioDoneChoiceIndexes: ReadonlySet<number>,
  validatedMessages: WeakMap<ChatCompletionSnapshot.Choice, ValidatedChoiceSnapshot>,
): ParsedChatCompletion<ParsedT> {
  const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
  const completion: ChatCompletion = {
    ...rest,
    id,
    choices: mapCapturedSnapshotArray(
      choices,
      MAX_STREAM_CHOICES,
      'choice',
      (choice): ChatCompletion.Choice => {
        const validated = validatedMessages.get(choice);
        if (!validated) {
          throw new OpenAIError('Chat completion stream contains an unsafe structured JSON snapshot');
        }
        const stableChoice = new Proxy(choice, {
          get(target, property, receiver) {
            return property === 'message' ? validated.message : Reflect.get(target, property, receiver);
          },
        });
        const { message: sourceMessage, finish_reason, index, logprobs, ...choiceRest } = stableChoice;
        const message = new Proxy(sourceMessage, {
          get(target, property, receiver) {
            if (property === 'content') {
              return validated.content;
            }
            if (property === 'refusal') {
              return validated.refusal;
            }
            if (property === 'tool_calls') {
              return validated.toolCallCollection;
            }
            return Reflect.get(target, property, receiver);
          },
        });
        const { content = null, function_call, tool_calls, audio, ...messageRest } = message;
        // Audio streams can end with an expires_at-only chunk after the
        // generated audio, without a separate finish_reason.
        const finishReason =
          finish_reason ?? (audioDoneChoiceIndexes.has(index) && isCompleteAudio(audio) ? 'stop' : null);
        if (!finishReason) {
          throw new OpenAIError(`missing finish_reason for choice ${index}`);
        }

        const audioResponse = audio ? { audio: audio as ChatCompletionAudio } : {};
        const role = message.role as 'assistant'; // this is what we expect; in theory it could be different which would make our types a slight lie but would be fine.
        if (!role) {
          throw new OpenAIError(`missing role for choice ${index}`);
        }

        if (function_call) {
          const { arguments: args, name } = function_call;
          if (args == null) {
            throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
          }

          if (!name) {
            throw new OpenAIError(`missing function_call.name for choice ${index}`);
          }

          return {
            ...choiceRest,
            message: {
              ...audioResponse,
              content,
              function_call: { arguments: args, name },
              role,
              refusal: message.refusal ?? null,
            },
            finish_reason: finishReason,
            index,
            logprobs,
          };
        }

        if (tool_calls) {
          return {
            ...choiceRest,
            index,
            finish_reason: finishReason,
            logprobs,
            message: {
              ...messageRest,
              ...audioResponse,
              role,
              content,
              refusal: message.refusal ?? null,
              tool_calls: mapCapturedSnapshotArray(
                tool_calls,
                MAX_STREAM_TOOL_CALLS,
                'tool-call',
                (tool_call, i): ChatCompletionMessageToolCall => {
                  const captured = validated.toolCalls.get(i);
                  if (!captured) {
                    const identity = ownFunctionToolIdentity(tool_call);
                    if (
                      identity &&
                      shouldParseToolCall(params, {
                        type: identity.type,
                        function: { name: identity.name },
                      })
                    ) {
                      throw new OpenAIError(
                        'Chat completion stream contains an unsafe structured JSON snapshot',
                      );
                    }
                  }
                  if (captured && captured.tool !== tool_call) {
                    throw new OpenAIError('Chat completion stream contains a changed tool call identity');
                  }
                  const stableFunction =
                    captured &&
                    new Proxy(captured.function, {
                      get(target, property, receiver) {
                        if (property === 'arguments') {
                          return captured.arguments;
                        }
                        if (property === 'name') {
                          return captured.name;
                        }
                        return Reflect.get(target, property, receiver);
                      },
                    });
                  const stableTool =
                    captured && stableFunction
                      ? new Proxy(tool_call, {
                          get(target, property, receiver) {
                            if (property === 'type') {
                              return captured.type;
                            }
                            if (property === 'function') {
                              return stableFunction;
                            }
                            return Reflect.get(target, property, receiver);
                          },
                        })
                      : tool_call;
                  if (stableTool.type == null) {
                    throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].type`);
                  }

                  if (stableTool.type === 'custom') {
                    const { custom, type, id, ...toolRest } = stableTool;
                    const { input = '', name, ...customRest } = custom || {};
                    if (name == null) {
                      throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].custom.name`);
                    }
                    return {
                      ...toolRest,
                      id: id || `call_${uuid4()}`,
                      type,
                      custom: { ...customRest, name, input },
                    };
                  }

                  const { function: fn, type, id, ...toolRest } = stableTool;
                  const { arguments: args, name, ...fnRest } = fn || {};
                  if (name == null) {
                    throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name`);
                  }
                  if (args == null) {
                    throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments`);
                  }

                  return {
                    ...toolRest,
                    id: id || `call_${uuid4()}`,
                    type,
                    function: { ...fnRest, name, arguments: args },
                  };
                },
              ),
            },
          };
        }
        return {
          ...choiceRest,
          message: { ...messageRest, ...audioResponse, content, role, refusal: message.refusal ?? null },
          finish_reason: finishReason,
          index,
          logprobs,
        };
      },
    ),
    created,
    model,
    object: 'chat.completion',
    ...(system_fingerprint ? { system_fingerprint } : {}),
  };

  return maybeParseChatCompletion(completion, params);
}

function isCompleteAudio(
  audio: Partial<ChatCompletionAudio> | null | undefined,
): audio is ChatCompletionAudio {
  return audio?.id != null && audio.data != null && audio.transcript != null && audio.expires_at != null;
}

/**
 * The chat completion accumulated from every streamed chunk received so far.
 * Fields within each choice can remain incomplete until generation finishes.
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
  choices: ChatCompletionSnapshot.Choice[];

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created.
   */
  created: number;

  /**
   * The model generating the completion.
   */
  model: string;

  // Note we do not include an "object" type on the snapshot,
  // because the object is not a valid "chat.completion" until finalized.
  // object: 'chat.completion';

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   *
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;
}

/** Nested shapes used by an in-progress chat completion snapshot. */
export namespace ChatCompletionSnapshot {
  /** One in-progress assistant choice and the metadata accumulated for it. */
  export interface Choice {
    /**
     * The assistant message accumulated from streamed model response deltas.
     */
    message: Choice.Message;

    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, `tool_calls` if
     * the model called a tool, or the deprecated `function_call` value.
     */
    finish_reason: ChatCompletion.Choice['finish_reason'] | null;

    /**
     * Log probability information for the choice.
     */
    logprobs: ChatCompletion.Choice.Logprobs | null;

    /**
     * The index of the choice in the list of choices.
     */
    index: number;
  }

  /** Nested message shapes belonging to an in-progress completion choice. */
  export namespace Choice {
    /**
     * The assistant message accumulated from streamed response deltas.
     */
    export interface Message {
      /**
       * The assistant text accumulated for this message so far.
       */
      content?: string | null;

      /** Audio fields received so far; individual fields can remain absent until generation finishes. */
      audio?: Partial<ChatCompletionAudio> | null;

      /** The model's refusal text accumulated so far, when the request is refused. */
      refusal?: string | null;

      /** A best-effort partial parse of structured assistant content. */
      parsed?: unknown | null;

      /**
       * The name and arguments of a function that should be called, as generated by the
       * model.
       */
      function_call?: Message.FunctionCall;

      /** Function and custom tool calls accumulated so far; inputs may still be incomplete. */
      tool_calls?: Message.ToolCall[];

      /**
       * The role of the author of this message.
       */
      role?: ChatCompletionRole;
    }

    /** Nested tool-call shapes belonging to an in-progress assistant message. */
    export namespace Message {
      /** A function or custom tool call accumulated incrementally from streamed chunks. */
      export type ToolCall = ToolCall.FunctionToolCall | ToolCall.CustomToolCall;

      /** Function and custom details nested under an in-progress tool call. */
      export namespace ToolCall {
        /** A function-tool call whose name, identifier, and arguments are streamed incrementally. */
        export interface FunctionToolCall {
          /**
           * The ID of the tool call.
           */
          id: string;

          /** The function name and the complete or partial JSON arguments received so far. */
          function: ToolCall.Function;

          /**
           * The type of the tool.
           */
          type: 'function';
        }

        /** The name and incrementally accumulated arguments of a function-tool call. */
        export interface Function {
          /**
           * The arguments to call the function with, as generated by the model in JSON
           * format. Note that the model does not always generate valid JSON, and may
           * hallucinate parameters not defined by your function schema. Validate the
           * arguments in your code before calling your function.
           */
          arguments: string;

          /** A best-effort partial parse of `arguments` for strict or auto-parseable tools. */
          parsed_arguments?: unknown;

          /**
           * The name of the function to call.
           */
          name: string;
        }

        /** A custom-tool call whose name, identifier, and input are streamed incrementally. */
        export interface CustomToolCall {
          /**
           * The ID of the tool call.
           */
          id: string;

          /** The custom-tool name and complete or partial input received so far. */
          custom: CustomToolCall.Custom;

          /**
           * The type of the tool.
           */
          type: 'custom';
        }

        /** Custom-tool details nested under an in-progress tool call. */
        export namespace CustomToolCall {
          /** The name and incrementally accumulated input of a custom-tool call. */
          export interface Custom {
            /** The name of the custom tool to call. */
            name: string;

            /** The custom tool's complete or partial free-form input. */
            input: string;
          }
        }
      }

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

type AssertIsEmpty<T extends object> = keyof T extends never ? T : never;

/**
 * Ensures the given argument is an empty object, useful for
 * asserting that all known properties on an object have been
 * destructured.
 */
function assertIsEmpty<T extends object>(obj: AssertIsEmpty<T>): asserts obj is AssertIsEmpty<T> {
  void obj;
}

function assertNever(_x: never) {
  return _x;
}
