import { type Response, type ResponseStreamEvent } from '../../resources/responses/responses';
import { OpenAIError } from '../../error';

export function accumulateResponse(event: ResponseStreamEvent, snapshot?: Response): Response {
  if (!snapshot) {
    if (event.type !== 'response.created') {
      throw new OpenAIError(
        `When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`,
      );
    }
    return event.response;
  }

  switch (event.type) {
    case 'response.output_item.added': {
      snapshot.output.push(event.item);
      break;
    }
    case 'response.content_part.added': {
      const output = snapshot.output[event.output_index];
      if (!output) {
        throw new OpenAIError(`missing output at index ${event.output_index}`);
      }
      const type = output.type;
      const part = event.part;
      if (type === 'message' && part.type !== 'reasoning_text') {
        output.content.push(part);
      } else if (type === 'reasoning' && part.type === 'reasoning_text') {
        if (!output.content) {
          output.content = [];
        }
        output.content.push(part);
      }
      break;
    }
    case 'response.output_text.delta': {
      const output = snapshot.output[event.output_index];
      if (!output) {
        throw new OpenAIError(`missing output at index ${event.output_index}`);
      }
      if (output.type === 'message') {
        const content = output.content[event.content_index];
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        content.text += event.delta;
      }
      break;
    }
    case 'response.function_call_arguments.delta': {
      const output = snapshot.output[event.output_index];
      if (!output) {
        throw new OpenAIError(`missing output at index ${event.output_index}`);
      }
      if (output.type === 'function_call') {
        output.arguments += event.delta;
      }
      break;
    }
    case 'response.reasoning_text.delta': {
      const output = snapshot.output[event.output_index];
      if (!output) {
        throw new OpenAIError(`missing output at index ${event.output_index}`);
      }
      if (output.type === 'reasoning') {
        const content = output.content?.[event.content_index];
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        if (content.type !== 'reasoning_text') {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text += event.delta;
      }
      break;
    }
    case 'response.completed': {
      snapshot = event.response;
      break;
    }
  }

  return snapshot;
}
