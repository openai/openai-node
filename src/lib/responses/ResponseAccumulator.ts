import {
  type Response,
  type ResponseOutputText,
  type ResponseStreamEvent,
} from '../../resources/responses/responses';
import { OpenAIError } from '../../error';
import { addOutputText } from '../ResponsesParser';

type ResponseKeepAliveEvent = {
  type: 'keepalive';
  sequence_number: number;
};

/**
 * Applies a streaming event to a response snapshot.
 *
 * Always use the returned snapshot. Incremental events update the supplied snapshot
 * in place, while response lifecycle events return a detached replacement. Event
 * payloads are cloned, so retaining or replaying the raw events is safe.
 */
export function accumulateResponse(
  event: ResponseStreamEvent | ResponseKeepAliveEvent,
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
      snapshot.output.push(structuredClone(event.item));
      if (event.item.type === 'message') {
        addOutputText(snapshot);
      }
      break;
    }
    case 'response.output_item.done': {
      getOutput(snapshot, event.output_index);
      snapshot.output[event.output_index] = structuredClone(event.item);
      if (event.item.type === 'message') {
        addOutputText(snapshot);
      }
      break;
    }
    case 'response.content_part.added': {
      const output = getOutput(snapshot, event.output_index);
      const type = output.type;
      const part = event.part;
      if (type === 'message' && part.type !== 'reasoning_text') {
        output.content.push(structuredClone(part));
        if (part.type === 'output_text') {
          addOutputText(snapshot);
        }
      } else if (type === 'reasoning' && part.type === 'reasoning_text') {
        if (!output.content) {
          output.content = [];
        }
        output.content.push(structuredClone(part));
      }
      break;
    }
    case 'response.content_part.done': {
      const output = getOutput(snapshot, event.output_index);
      const part = event.part;
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        getContent(output.content, event.content_index);
        output.content[event.content_index] = structuredClone(part);
        if (part.type === 'output_text') {
          addOutputText(snapshot);
        }
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

function cloneResponse(response: Response): Response {
  const snapshot = structuredClone(response);
  if (!Object.getOwnPropertyDescriptor(snapshot, 'output_text') || snapshot.output_text == null) {
    addOutputText(snapshot);
  }
  return snapshot;
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
