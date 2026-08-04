import {
  type Response,
  type ResponseOutputItem,
  type ResponseOutputRefusal,
  type ResponseOutputText,
  type ResponseReasoningItem,
  type ResponseStreamEvent,
} from '../../resources/responses/responses';
import { OpenAIError } from '../../error';
import { addOutputText } from '../ResponsesParser';

type ResponseKeepAliveEvent = {
  type: 'keepalive';
  sequence_number: number;
};

/** Makes `K` optional on every member of `T`. */
type Incremental<T, K extends PropertyKey> = T extends unknown ?
  Omit<T, K> & { [P in Extract<keyof T, K>]?: T[P] }
: never;

/** Replaces the type of `K` with `V` on every member of `T`. */
type WithPayload<T, K extends PropertyKey, V> = T extends unknown ?
  Omit<T, K> & { [P in Extract<keyof T, K>]: V }
: never;

type OutputItemOfType<T extends ResponseOutputItem['type']> = Extract<ResponseOutputItem, { type: T }>;

type StreamEventOfType<T extends ResponseStreamEvent['type']> = Extract<ResponseStreamEvent, { type: T }>;

type IncrementalMessageContent = Incremental<ResponseOutputText | ResponseOutputRefusal, 'text' | 'refusal'>;

type IncrementalReasoningContent = Incremental<ResponseReasoningItem.Content, 'text'>;

/** A content part that may arrive before its text or refusal has streamed in. */
export type IncrementalContentPart = IncrementalMessageContent | IncrementalReasoningContent;

/** A reasoning summary part that may arrive before its text has streamed in. */
export type IncrementalSummaryPart = Incremental<ResponseReasoningItem.Summary, 'text'>;

/** An output item that may arrive before the string fields its deltas append to exist. */
export type IncrementalOutputItem =
  | (Omit<OutputItemOfType<'message'>, 'content'> & { content: Array<IncrementalMessageContent> })
  | (Omit<OutputItemOfType<'reasoning'>, 'summary' | 'content'> & {
      summary: Array<IncrementalSummaryPart>;
      content?: Array<IncrementalReasoningContent>;
    })
  | Incremental<OutputItemOfType<'function_call' | 'mcp_call'>, 'arguments'>
  | Incremental<OutputItemOfType<'custom_tool_call'>, 'input'>
  | Incremental<OutputItemOfType<'code_interpreter_call'>, 'code'>
  | Exclude<
      ResponseOutputItem,
      OutputItemOfType<
        'message' | 'reasoning' | 'function_call' | 'mcp_call' | 'custom_tool_call' | 'code_interpreter_call'
      >
    >;

/** A response whose output items may still be incremental. */
export type IncrementalResponse = Omit<Response, 'output'> & { output: Array<IncrementalOutputItem> };

/**
 * The wire shape of the events that carry items and parts into the snapshot.
 *
 * The server emits these events while the model is still producing the response, so an
 * item or part can arrive before the string field that its `*.delta` events append to
 * exists. `ResponseStreamEvent` describes those payloads with the completed shapes, where
 * the same fields are required, so the observed payloads are unrepresentable there.
 *
 * {@link accumulateResponse} normalizes the incremental shape once, as it enters the
 * snapshot, which is what lets every snapshot it returns satisfy the `Response` contract
 * and lets the delta handlers stay plain appends.
 */
export type IncrementalResponseStreamEvent =
  | WithPayload<
      StreamEventOfType<'response.output_item.added' | 'response.output_item.done'>,
      'item',
      IncrementalOutputItem
    >
  | WithPayload<
      StreamEventOfType<'response.content_part.added' | 'response.content_part.done'>,
      'part',
      IncrementalContentPart
    >
  | WithPayload<
      StreamEventOfType<'response.reasoning_summary_part.added' | 'response.reasoning_summary_part.done'>,
      'part',
      IncrementalSummaryPart
    >
  | WithPayload<
      StreamEventOfType<
        | 'response.created'
        | 'response.queued'
        | 'response.in_progress'
        | 'response.completed'
        | 'response.failed'
        | 'response.incomplete'
      >,
      'response',
      IncrementalResponse
    >;

/**
 * Applies a streaming event to a response snapshot.
 *
 * Always use the returned snapshot. Incremental events update the supplied snapshot
 * in place, while response lifecycle events return a detached replacement. Event
 * payloads are cloned, so retaining or replaying the raw events is safe.
 *
 * Items and parts are normalized as they enter the snapshot, so the returned snapshot
 * satisfies the `Response` contract even when no delta has arrived yet. See
 * {@link IncrementalResponseStreamEvent}.
 */
export function accumulateResponse(
  event: ResponseStreamEvent | IncrementalResponseStreamEvent | ResponseKeepAliveEvent,
  snapshot?: Response,
): Response {
  if (!snapshot) {
    if (event.type !== 'response.created') {
      throw new OpenAIError(
        `When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`,
      );
    }
    return cloneResponse(event.response);
  }

  switch (event.type) {
    case 'response.output_item.added': {
      snapshot.output.push(normalizeOutputItem(structuredClone(event.item)));
      if (event.item.type === 'message') {
        addOutputText(snapshot);
      }
      break;
    }
    case 'response.output_item.done': {
      getOutput(snapshot, event.output_index);
      snapshot.output[event.output_index] = normalizeOutputItem(structuredClone(event.item));
      if (event.item.type === 'message') {
        addOutputText(snapshot);
      }
      break;
    }
    case 'response.content_part.added': {
      const output = getOutput(snapshot, event.output_index);
      const type = output.type;
      const part = normalizeContentPart(structuredClone(event.part));
      if (type === 'message' && part.type !== 'reasoning_text') {
        output.content.push(part);
        if (part.type === 'output_text') {
          addOutputText(snapshot);
        }
      } else if (type === 'reasoning' && part.type === 'reasoning_text') {
        if (!output.content) {
          output.content = [];
        }
        output.content.push(part);
      }
      break;
    }
    case 'response.content_part.done': {
      const output = getOutput(snapshot, event.output_index);
      const part = normalizeContentPart(structuredClone(event.part));
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        getContent(output.content, event.content_index);
        output.content[event.content_index] = part;
        if (part.type === 'output_text') {
          addOutputText(snapshot);
        }
      } else if (output.type === 'reasoning' && part.type === 'reasoning_text') {
        const content = output.content;
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        getContent(content, event.content_index);
        content[event.content_index] = part;
      }
      break;
    }
    case 'response.output_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        content.text += event.delta;
        snapshot.output_text += event.delta;
      }
      break;
    }
    case 'response.output_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        content.text = event.text;
        addOutputText(snapshot);
      }
      break;
    }
    case 'response.output_text.annotation.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        content.annotations[event.annotation_index] = structuredClone(
          event.annotation,
        ) as ResponseOutputText['annotations'][number];
      }
      break;
    }
    case 'response.refusal.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'refusal') {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal += event.delta;
      }
      break;
    }
    case 'response.refusal.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'refusal') {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal = event.refusal;
      }
      break;
    }
    case 'response.function_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments += event.delta;
      }
      break;
    }
    case 'response.function_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments = event.arguments;
      }
      break;
    }
    case 'response.reasoning_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'reasoning_text') {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text += event.delta;
      }
      break;
    }
    case 'response.reasoning_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'reasoning_text') {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text = event.text;
      }
      break;
    }
    case 'response.reasoning_summary_part.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        output.summary.push(normalizeSummaryPart(structuredClone(event.part)));
      }
      break;
    }
    case 'response.reasoning_summary_part.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        getContent(output.summary, event.summary_index);
        output.summary[event.summary_index] = normalizeSummaryPart(structuredClone(event.part));
      }
      break;
    }
    case 'response.reasoning_summary_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text += event.delta;
      }
      break;
    }
    case 'response.reasoning_summary_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text = event.text;
      }
      break;
    }
    case 'response.custom_tool_call_input.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input += event.delta;
      }
      break;
    }
    case 'response.custom_tool_call_input.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input = event.input;
      }
      break;
    }
    case 'response.mcp_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments += event.delta;
      }
      break;
    }
    case 'response.mcp_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments = event.arguments;
      }
      break;
    }
    case 'response.code_interpreter_call_code.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = (output.code ?? '') + event.delta;
      }
      break;
    }
    case 'response.code_interpreter_call_code.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = event.code;
      }
      break;
    }
    case 'response.code_interpreter_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'in_progress';
      }
      break;
    }
    case 'response.code_interpreter_call.interpreting': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'interpreting';
      }
      break;
    }
    case 'response.code_interpreter_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'completed';
      }
      break;
    }
    case 'response.file_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'in_progress';
      }
      break;
    }
    case 'response.file_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'searching';
      }
      break;
    }
    case 'response.file_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'completed';
      }
      break;
    }
    case 'response.web_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'in_progress';
      }
      break;
    }
    case 'response.web_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'searching';
      }
      break;
    }
    case 'response.web_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'completed';
      }
      break;
    }
    case 'response.image_generation_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'in_progress';
      }
      break;
    }
    case 'response.image_generation_call.generating': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'generating';
      }
      break;
    }
    case 'response.image_generation_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'completed';
      }
      break;
    }
    case 'response.mcp_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'in_progress';
      }
      break;
    }
    case 'response.mcp_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'completed';
      }
      break;
    }
    case 'response.mcp_call.failed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'failed';
      }
      break;
    }
    case 'response.created':
    case 'response.queued':
    case 'response.in_progress':
    case 'response.completed':
    case 'response.failed':
    case 'response.incomplete': {
      snapshot = cloneResponse(event.response);
      break;
    }
    case 'response.audio.delta':
    case 'response.audio.done':
    case 'response.audio.transcript.delta':
    case 'response.audio.transcript.done':
    case 'response.image_generation_call.partial_image':
    case 'response.mcp_list_tools.in_progress':
    case 'response.mcp_list_tools.completed':
    case 'response.mcp_list_tools.failed':
    case 'keepalive':
    case 'error': {
      // These events do not contain state represented by the Response object.
      break;
    }
    default: {
      assertNever(event);
    }
  }

  return snapshot;
}

function cloneResponse(response: IncrementalResponse): Response {
  const snapshot = structuredClone(response) as Response;
  snapshot.output = snapshot.output.map(normalizeOutputItem);
  if (!Object.getOwnPropertyDescriptor(snapshot, 'output_text') || snapshot.output_text == null) {
    addOutputText(snapshot);
  }
  return snapshot;
}

/**
 * Fills in the string fields that `*.delta` events append to, so an item taken from the
 * wire satisfies its `ResponseOutputItem` contract before any delta arrives.
 *
 * The item is normalized in place; callers pass a clone they own.
 */
function normalizeOutputItem(item: IncrementalOutputItem): ResponseOutputItem {
  switch (item.type) {
    case 'message': {
      item.content?.forEach(normalizeContentPart);
      break;
    }
    case 'reasoning': {
      item.summary?.forEach(normalizeSummaryPart);
      item.content?.forEach(normalizeContentPart);
      break;
    }
    case 'function_call':
    case 'mcp_call': {
      item.arguments ??= '';
      break;
    }
    case 'custom_tool_call': {
      item.input ??= '';
      break;
    }
    case 'code_interpreter_call': {
      // `code` is `string | null` by contract, where `null` means "not available", so an
      // omitted `code` normalizes to `null` and its delta handler keeps a nullish default.
      item.code ??= null;
      break;
    }
  }
  return item as ResponseOutputItem;
}

/** @see {@link normalizeOutputItem} */
function normalizeContentPart(
  part: IncrementalContentPart,
): ResponseOutputText | ResponseOutputRefusal | ResponseReasoningItem.Content {
  if (part.type === 'refusal') {
    part.refusal ??= '';
  } else {
    part.text ??= '';
  }
  return part as ResponseOutputText | ResponseOutputRefusal | ResponseReasoningItem.Content;
}

/** @see {@link normalizeOutputItem} */
function normalizeSummaryPart(part: IncrementalSummaryPart): ResponseReasoningItem.Summary {
  part.text ??= '';
  return part as ResponseReasoningItem.Summary;
}

function getOutput(snapshot: Response, outputIndex: number): Response['output'][number] {
  const output = snapshot.output[outputIndex];
  if (!output) {
    throw new OpenAIError(`missing output at index ${outputIndex}`);
  }
  return output;
}

function getContent<T>(content: Array<T>, contentIndex: number): T {
  const part = content[contentIndex];
  if (!part) {
    throw new OpenAIError(`missing content at index ${contentIndex}`);
  }
  return part;
}

function assertNever(value: never): never {
  throw new OpenAIError(`Unhandled response stream event: ${JSON.stringify(value)}`);
}
