import type { Response, ResponseOutputText, ResponseStreamEvent } from '../../resources/responses/responses';
import type { ResponseAccumulatorContext } from './canonical-output-text';
import { OpenAIError } from '../../error';
import { hasOwn } from '../utils';
import {
  cloneResponse,
  createCanonicalResponseContext,
  ensureCanonicalOutputText,
  getOutputText,
  updateCachedOutputTextLength,
  updateOutputText,
} from './canonical-output-text';

interface ResponseKeepAliveEvent {
  type: 'keepalive';
  sequence_number: number;
}

type ResponseAccumulatorEvent = ResponseStreamEvent | ResponseKeepAliveEvent;
type ResponseOutputItemEvent = Extract<
  ResponseAccumulatorEvent,
  { type: 'response.output_item.added' | 'response.output_item.done' }
>;
type ResponseContentPartAddedEvent = Extract<
  ResponseAccumulatorEvent,
  { type: 'response.content_part.added' }
>;
type ResponseContentPartDoneEvent = Extract<ResponseAccumulatorEvent, { type: 'response.content_part.done' }>;
type ResponseOutputTextEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.output_text.delta'
      | 'response.output_text.done'
      | 'response.output_text.annotation.added';
  }
>;
type ResponseRefusalAndArgumentsEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.refusal.delta'
      | 'response.refusal.done'
      | 'response.function_call_arguments.delta'
      | 'response.function_call_arguments.done'
      | 'response.custom_tool_call_input.delta'
      | 'response.custom_tool_call_input.done'
      | 'response.mcp_call_arguments.delta'
      | 'response.mcp_call_arguments.done';
  }
>;
type ResponseShellEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.shell_call_command.added'
      | 'response.shell_call_command.delta'
      | 'response.shell_call_command.done'
      | 'response.shell_call_output_content.delta'
      | 'response.shell_call_output_content.done';
  }
>;
type ResponseReasoningEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.reasoning_text.delta'
      | 'response.reasoning_text.done'
      | 'response.reasoning_summary_part.added'
      | 'response.reasoning_summary_part.done'
      | 'response.reasoning_summary_text.delta'
      | 'response.reasoning_summary_text.done';
  }
>;
type ResponseCodeInterpreterEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.code_interpreter_call_code.delta'
      | 'response.code_interpreter_call_code.done'
      | 'response.code_interpreter_call.in_progress'
      | 'response.code_interpreter_call.interpreting'
      | 'response.code_interpreter_call.completed';
  }
>;
type ResponseSearchStatusEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.file_search_call.in_progress'
      | 'response.file_search_call.searching'
      | 'response.file_search_call.completed'
      | 'response.web_search_call.in_progress'
      | 'response.web_search_call.searching'
      | 'response.web_search_call.completed';
  }
>;
type ResponseImageAndMcpStatusEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.image_generation_call.in_progress'
      | 'response.image_generation_call.generating'
      | 'response.image_generation_call.completed'
      | 'response.mcp_call.in_progress'
      | 'response.mcp_call.completed'
      | 'response.mcp_call.failed';
  }
>;
type ResponseLifecycleEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.created'
      | 'response.queued'
      | 'response.in_progress'
      | 'response.completed'
      | 'response.failed'
      | 'response.incomplete';
  }
>;
type ResponseIgnoredEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.audio.delta'
      | 'response.audio.done'
      | 'response.audio.transcript.delta'
      | 'response.audio.transcript.done'
      | 'response.image_generation_call.partial_image'
      | 'response.mcp_list_tools.in_progress'
      | 'response.mcp_list_tools.completed'
      | 'response.mcp_list_tools.failed'
      | 'keepalive'
      | 'error';
  }
>;

function validateArrayIndex(
  collection: readonly unknown[],
  index: number,
  kind: 'output' | 'content' | 'annotation' | 'command',
  allowAppend = false,
): void {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > collection.length ||
    (index === collection.length ? !allowAppend || index in collection : !hasOwn(collection, index))
  ) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
}

function validateArrayAppend(
  collection: readonly unknown[],
  index: number,
  kind: 'output' | 'content',
): void {
  if (index !== collection.length) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
  validateArrayIndex(collection, index, kind, true);
}

function getOutput(snapshot: Response, outputIndex: number): Response['output'][number] {
  validateArrayIndex(snapshot.output, outputIndex, 'output');
  const output = snapshot.output[outputIndex];
  if (!output) {
    throw new OpenAIError(`missing output at index ${outputIndex}`);
  }
  return output;
}

function getContent<T>(content: T[], contentIndex: number): T {
  validateArrayIndex(content, contentIndex, 'content');
  const part = content[contentIndex];
  if (!part) {
    throw new OpenAIError(`missing content at index ${contentIndex}`);
  }
  return part;
}

function getShellOutputContent(
  snapshot: Response,
  output: Extract<Response['output'][number], { type: 'shell_call_output' }>,
  commandIndex: number,
): (typeof output.output)[number] {
  const shellCall = snapshot.output.find(
    (item): item is Extract<Response['output'][number], { type: 'shell_call' }> =>
      item.type === 'shell_call' && item.call_id === output.call_id,
  );

  if (shellCall) {
    validateArrayIndex(shellCall.action.commands, commandIndex, 'command');
  } else {
    validateArrayIndex(output.output, commandIndex, 'content', true);
  }

  while (output.output.length <= commandIndex) {
    output.output.push({
      stdout: '',
      stderr: '',
      outcome: { type: 'exit', exit_code: 0 },
    });
  }

  return getContent(output.output, commandIndex);
}

function assertNever(value: never): never {
  throw new OpenAIError(`Unhandled response stream event: ${JSON.stringify(value)}`);
}

function accumulateOutputItemEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseOutputItemEvent {
  switch (event.type) {
    case 'response.output_item.added': {
      validateArrayAppend(snapshot.output, event.output_index, 'output');
      const output = structuredClone(event.item);
      if (output.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output.push(output);
      const text = getOutputText(context, output);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.append(text.length);
      }
      if (text) {
        snapshot.output_text += text;
      }
      return true;
    }
    case 'response.output_item.done': {
      const output = getOutput(snapshot, event.output_index);
      const previousText = getOutputText(context, output);
      const replacement = structuredClone(event.item);
      if (output.type === 'message' || replacement.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output[event.output_index] = replacement;
      const nextText = getOutputText(context, replacement);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.update(event.output_index, nextText.length);
      }
      updateOutputText(context, snapshot, event.output_index, previousText, nextText);
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateContentPartAddedEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseContentPartAddedEvent {
  switch (event.type) {
    case 'response.content_part.added': {
      const output = getOutput(snapshot, event.output_index);
      const { type } = output;
      const { part } = event;
      if (type === 'message' && part.type !== 'reasoning_text') {
        validateArrayAppend(output.content, event.content_index, 'content');
        const content = structuredClone(part);
        if (content.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content.push(content);
        if (content.type === 'output_text') {
          updateCachedOutputTextLength(context, output, event.output_index, '', content.text);
          updateOutputText(context, snapshot, event.output_index, '', content.text, event.content_index);
        }
      } else if (type === 'reasoning' && part.type === 'reasoning_text') {
        const content = output.content ?? [];
        validateArrayAppend(content, event.content_index, 'content');
        if (!output.content) {
          output.content = content;
        }
        content.push(structuredClone(part));
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateContentPartDoneEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseContentPartDoneEvent {
  switch (event.type) {
    case 'response.content_part.done': {
      const output = getOutput(snapshot, event.output_index);
      const { part } = event;
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        const content = getContent(output.content, event.content_index);
        const previousText = content.type === 'output_text' ? content.text : '';
        const replacement = structuredClone(part);
        if (content.type === 'output_text' || replacement.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content[event.content_index] = replacement;
        const nextText = replacement.type === 'output_text' ? replacement.text : '';
        updateCachedOutputTextLength(context, output, event.output_index, previousText, nextText);
        updateOutputText(context, snapshot, event.output_index, previousText, nextText, event.content_index);
      } else if (output.type === 'reasoning' && part.type === 'reasoning_text') {
        const { content } = output;
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        getContent(content, event.content_index);
        content[event.content_index] = structuredClone(part);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateOutputTextEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseOutputTextEvent {
  switch (event.type) {
    case 'response.output_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = previousText + event.delta;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, content.text);
        if (
          event.output_index === snapshot.output.length - 1 &&
          event.content_index === output.content.length - 1
        ) {
          snapshot.output_text += event.delta;
        } else {
          updateOutputText(
            context,
            snapshot,
            event.output_index,
            previousText,
            content.text,
            event.content_index,
          );
        }
      }
      return true;
    }
    case 'response.output_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = event.text;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, event.text);
        updateOutputText(
          context,
          snapshot,
          event.output_index,
          previousText,
          event.text,
          event.content_index,
        );
      }
      return true;
    }
    case 'response.output_text.annotation.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        validateArrayIndex(content.annotations, event.annotation_index, 'annotation', true);
        content.annotations[event.annotation_index] = structuredClone(
          event.annotation,
        ) as ResponseOutputText['annotations'][number];
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateRefusalAndArgumentsEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseRefusalAndArgumentsEvent {
  switch (event.type) {
    case 'response.refusal.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'refusal') {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal += event.delta;
      }
      return true;
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
      return true;
    }
    case 'response.function_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments += event.delta;
      }
      return true;
    }
    case 'response.function_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments = event.arguments;
      }
      return true;
    }
    case 'response.custom_tool_call_input.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input += event.delta;
      }
      return true;
    }
    case 'response.custom_tool_call_input.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input = event.input;
      }
      return true;
    }
    case 'response.mcp_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments += event.delta;
      }
      return true;
    }
    case 'response.mcp_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments = event.arguments;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateShellEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseShellEvent {
  switch (event.type) {
    case 'response.shell_call_command.added':
    case 'response.shell_call_command.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call') {
        const allowAppend = event.type === 'response.shell_call_command.added';
        validateArrayIndex(output.action.commands, event.command_index, 'command', allowAppend);
        output.action.commands[event.command_index] = event.command;
      }
      return true;
    }
    case 'response.shell_call_command.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call') {
        validateArrayIndex(output.action.commands, event.command_index, 'command');
        output.action.commands[event.command_index] += event.delta;
      }
      return true;
    }
    case 'response.shell_call_output_content.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call_output') {
        const content = getShellOutputContent(snapshot, output, event.command_index);
        content.stdout += event.delta.stdout ?? '';
        content.stderr += event.delta.stderr ?? '';
      }
      return true;
    }
    case 'response.shell_call_output_content.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call_output') {
        const content = getContent(event.output, 0);
        getShellOutputContent(snapshot, output, event.command_index);
        output.output[event.command_index] = structuredClone(content);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateReasoningEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseReasoningEvent {
  switch (event.type) {
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
      return true;
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
      return true;
    }
    case 'response.reasoning_summary_part.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        validateArrayAppend(output.summary, event.summary_index, 'content');
        output.summary.push(structuredClone(event.part));
      }
      return true;
    }
    case 'response.reasoning_summary_part.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        getContent(output.summary, event.summary_index);
        output.summary[event.summary_index] = structuredClone(event.part);
      }
      return true;
    }
    case 'response.reasoning_summary_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text += event.delta;
      }
      return true;
    }
    case 'response.reasoning_summary_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text = event.text;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateCodeInterpreterEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseCodeInterpreterEvent {
  switch (event.type) {
    case 'response.code_interpreter_call_code.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = (output.code ?? '') + event.delta;
      }
      return true;
    }
    case 'response.code_interpreter_call_code.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = event.code;
      }
      return true;
    }
    case 'response.code_interpreter_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.code_interpreter_call.interpreting': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'interpreting';
      }
      return true;
    }
    case 'response.code_interpreter_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'completed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateSearchStatusEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseSearchStatusEvent {
  switch (event.type) {
    case 'response.file_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.file_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'searching';
      }
      return true;
    }
    case 'response.file_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.web_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.web_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'searching';
      }
      return true;
    }
    case 'response.web_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'completed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateImageAndMcpStatusEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseImageAndMcpStatusEvent {
  switch (event.type) {
    case 'response.image_generation_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.image_generation_call.generating': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'generating';
      }
      return true;
    }
    case 'response.image_generation_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.mcp_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.mcp_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.mcp_call.failed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'failed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function isResponseLifecycleEvent(event: ResponseAccumulatorEvent): event is ResponseLifecycleEvent {
  switch (event.type) {
    case 'response.created':
    case 'response.queued':
    case 'response.in_progress':
    case 'response.completed':
    case 'response.failed':
    case 'response.incomplete': {
      return true;
    }
    default: {
      return false;
    }
  }
}

function isIgnoredResponseEvent(event: ResponseAccumulatorEvent): event is ResponseIgnoredEvent {
  switch (event.type) {
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
      return true;
    }
    default: {
      return false;
    }
  }
}

export function createResponseContext(): ResponseAccumulatorContext {
  return createCanonicalResponseContext();
}

export function accumulateResponseWithContext(
  event: ResponseAccumulatorEvent,
  snapshot: Response | undefined,
  context: ResponseAccumulatorContext,
): Response {
  if (!snapshot) {
    if (event.type !== 'response.created') {
      throw new OpenAIError(
        `When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`,
      );
    }
    return cloneResponse(context, event.response);
  }

  if (accumulateOutputItemEvent(event, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartAddedEvent(event, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartDoneEvent(event, snapshot, context)) {
    return snapshot;
  }
  if (accumulateOutputTextEvent(event, snapshot, context)) {
    return snapshot;
  }
  if (accumulateRefusalAndArgumentsEvent(event, snapshot)) {
    return snapshot;
  }
  if (accumulateShellEvent(event, snapshot)) {
    return snapshot;
  }
  if (accumulateReasoningEvent(event, snapshot)) {
    return snapshot;
  }
  if (accumulateCodeInterpreterEvent(event, snapshot)) {
    return snapshot;
  }
  if (accumulateSearchStatusEvent(event, snapshot)) {
    return snapshot;
  }
  if (accumulateImageAndMcpStatusEvent(event, snapshot)) {
    return snapshot;
  }

  if (isResponseLifecycleEvent(event)) {
    return cloneResponse(context, event.response);
  }
  if (isIgnoredResponseEvent(event)) {
    return snapshot;
  }
  return assertNever(event);
}
