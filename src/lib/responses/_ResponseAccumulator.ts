import type { Response, ResponseOutputText, ResponseStreamEvent } from '../../resources/responses/responses';
import { OpenAIError } from '../../error';
import { hasOwn } from '../../internal/utils';
import { addOutputText } from '../ResponsesParser';

type ResponseAccumulatorContext = {
  canonicalSnapshot: Response | undefined;
  outputTextLengths: WeakMap<Response['output'][number], number>;
};

export function createResponseContext(): ResponseAccumulatorContext {
  return { canonicalSnapshot: undefined, outputTextLengths: new WeakMap() };
}

export function accumulateResponseWithContext(
  event: ResponseStreamEvent | { type: 'keepalive'; sequence_number: number },
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

  switch (event.type) {
    case 'response.output_item.added': {
      validateArrayAppend(snapshot.output, event.output_index, 'output');
      const output = structuredClone(event.item);
      if (output.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output.push(output);
      const text = getOutputText(context, output);
      if (text) {
        snapshot.output_text += text;
      }
      break;
    }
    case 'response.output_item.done': {
      const output = getOutput(snapshot, event.output_index);
      const previousText = getOutputText(context, output);
      const replacement = structuredClone(event.item);
      if (output.type === 'message' || replacement.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output[event.output_index] = replacement;
      updateOutputText(
        context,
        snapshot,
        event.output_index,
        previousText,
        getOutputText(context, replacement),
      );
      break;
    }
    case 'response.content_part.added': {
      const output = getOutput(snapshot, event.output_index);
      const type = output.type;
      const part = event.part;
      if (type === 'message' && part.type !== 'reasoning_text') {
        validateArrayAppend(output.content, event.content_index, 'content');
        const content = structuredClone(part);
        if (content.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content.push(content);
        if (content.type === 'output_text') {
          updateCachedOutputTextLength(context, output, '', content.text);
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
      break;
    }
    case 'response.content_part.done': {
      const output = getOutput(snapshot, event.output_index);
      const part = event.part;
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        const content = getContent(output.content, event.content_index);
        const previousText = content.type === 'output_text' ? content.text : '';
        const replacement = structuredClone(part);
        if (content.type === 'output_text' || replacement.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content[event.content_index] = replacement;
        const nextText = replacement.type === 'output_text' ? replacement.text : '';
        updateCachedOutputTextLength(context, output, previousText, nextText);
        updateOutputText(context, snapshot, event.output_index, previousText, nextText, event.content_index);
      } else if (output.type === 'reasoning' && part.type === 'reasoning_text') {
        const content = output.content;
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        getContent(content, event.content_index);
        content[event.content_index] = structuredClone(part);
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
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = previousText + event.delta;
        updateCachedOutputTextLength(context, output, previousText, content.text);
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
      break;
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
        updateCachedOutputTextLength(context, output, previousText, event.text);
        updateOutputText(
          context,
          snapshot,
          event.output_index,
          previousText,
          event.text,
          event.content_index,
        );
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
        validateArrayIndex(content.annotations, event.annotation_index, 'annotation', true);
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
        validateArrayAppend(output.summary, event.summary_index, 'content');
        output.summary.push(structuredClone(event.part));
      }
      break;
    }
    case 'response.reasoning_summary_part.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        getContent(output.summary, event.summary_index);
        output.summary[event.summary_index] = structuredClone(event.part);
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
      snapshot = cloneResponse(context, event.response);
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

function cloneResponse(context: ResponseAccumulatorContext, response: Response): Response {
  context.canonicalSnapshot = undefined;
  context.outputTextLengths = new WeakMap();
  const snapshot = structuredClone(response);
  if (!Object.getOwnPropertyDescriptor(snapshot, 'output_text') || snapshot.output_text == null) {
    addOutputText(snapshot);
    context.canonicalSnapshot = snapshot;
  } else if (snapshot.output.length === 0 && snapshot.output_text === '') {
    context.canonicalSnapshot = snapshot;
  }
  return snapshot;
}

function ensureCanonicalOutputText(context: ResponseAccumulatorContext, snapshot: Response): void {
  if (context.canonicalSnapshot === snapshot) {
    return;
  }

  let text = '';
  for (const output of snapshot.output) {
    text += getOutputText(context, output);
  }
  if (snapshot.output_text !== text) {
    snapshot.output_text = text;
  }
  context.canonicalSnapshot = snapshot;
}

function getOutputText(context: ResponseAccumulatorContext, output: Response['output'][number]): string {
  if (output.type !== 'message') {
    return '';
  }

  let text = '';
  for (const content of output.content) {
    if (content.type === 'output_text') {
      text += content.text;
    }
  }
  context.outputTextLengths.set(output, text.length);
  return text;
}

function updateCachedOutputTextLength(
  context: ResponseAccumulatorContext,
  output: Response['output'][number],
  previousText: string,
  nextText: string,
): void {
  const length = context.outputTextLengths.get(output);
  if (length !== undefined) {
    context.outputTextLengths.set(output, length - previousText.length + nextText.length);
  }
}

function updateOutputText(
  context: ResponseAccumulatorContext,
  snapshot: Response,
  outputIndex: number,
  previousText: string,
  nextText: string,
  contentIndex?: number,
): void {
  if (previousText === nextText) {
    return;
  }

  const output = snapshot.output[outputIndex];
  if (
    outputIndex === snapshot.output.length - 1 &&
    (contentIndex === undefined || (output?.type === 'message' && contentIndex === output.content.length - 1))
  ) {
    replaceOutputTextSuffix(snapshot, previousText, nextText);
    return;
  }

  let precedingContentLength = 0;
  let followingContentLength = 0;
  if (contentIndex !== undefined && output?.type === 'message') {
    if (contentIndex < output.content.length - contentIndex - 1) {
      for (let index = 0; index < contentIndex; index += 1) {
        const precedingContent = output.content[index];
        if (precedingContent?.type === 'output_text') {
          precedingContentLength += precedingContent.text.length;
        }
      }
      const outputTextLength = context.outputTextLengths.get(output) ?? getOutputText(context, output).length;
      followingContentLength = outputTextLength - precedingContentLength - nextText.length;
    } else {
      for (let index = contentIndex + 1; index < output.content.length; index += 1) {
        const followingContent = output.content[index];
        if (followingContent?.type === 'output_text') {
          followingContentLength += followingContent.text.length;
        }
      }
      const outputTextLength = context.outputTextLengths.get(output) ?? getOutputText(context, output).length;
      precedingContentLength = outputTextLength - followingContentLength - nextText.length;
    }
  }

  let offset: number;
  if (outputIndex <= snapshot.output.length - outputIndex - 1) {
    offset = precedingContentLength;
    for (let index = 0; index < outputIndex; index += 1) {
      const precedingOutput = snapshot.output[index];
      if (precedingOutput?.type === 'message') {
        offset +=
          context.outputTextLengths.get(precedingOutput) ?? getOutputText(context, precedingOutput).length;
      }
    }
  } else {
    let followingTextLength = followingContentLength;
    for (let index = outputIndex + 1; index < snapshot.output.length; index += 1) {
      const followingOutput = snapshot.output[index];
      if (followingOutput?.type === 'message') {
        followingTextLength +=
          context.outputTextLengths.get(followingOutput) ?? getOutputText(context, followingOutput).length;
      }
    }
    if (followingTextLength === 0) {
      replaceOutputTextSuffix(snapshot, previousText, nextText);
      return;
    }
    offset = snapshot.output_text.length - followingTextLength - previousText.length;
  }

  snapshot.output_text =
    snapshot.output_text.slice(0, offset) +
    nextText +
    snapshot.output_text.slice(offset + previousText.length);
}

function replaceOutputTextSuffix(snapshot: Response, previousText: string, nextText: string): void {
  if (previousText.length === 0) {
    snapshot.output_text += nextText;
    return;
  }

  snapshot.output_text =
    snapshot.output_text.slice(0, snapshot.output_text.length - previousText.length) + nextText;
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

function validateArrayIndex(
  collection: readonly unknown[],
  index: number,
  kind: 'output' | 'content' | 'annotation',
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

function assertNever(value: never): never {
  throw new OpenAIError(`Unhandled response stream event: ${JSON.stringify(value)}`);
}
