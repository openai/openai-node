import { vi } from 'vitest';
import OpenAI from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants';

type Event = Record<string, any>;

function readableEvents(events: Event[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(events.map((event) => encoder.encode(`${JSON.stringify(event)}\n`)));
}

export function assistantStream(events: Event[]): AssistantStream {
  return AssistantStream.fromReadableStream(readableEvents(events));
}

export function completedRun(id = 'run_123') {
  return { event: 'thread.run.completed', data: { id, status: 'completed' } };
}

export function publicAssistantStream(events: Event[]): AssistantStream {
  const client = new OpenAI({
    apiKey: 'sk-synthetic-assistant-stream-key',
    fetch: async () =>
      new Response(
        events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    maxRetries: 0,
  });

  return client.beta.threads.runs.stream('thread_123', { assistant_id: 'assistant_123' });
}

export function unencodedAssistantStream(events: Event[]): AssistantStream {
  const controller = new AbortController();
  return AssistantStream.createAssistantStream(
    'thread_123',
    {
      create: vi.fn().mockResolvedValue({
        controller,
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event as AssistantStreamEvent;
          }
        },
      }),
    } as any,
    { assistant_id: 'assistant_123' },
  );
}

export function runStep(id: string, toolID = 'call_trusted', args = '{"to":"trusted"}') {
  return {
    id,
    status: 'in_progress',
    step_details: {
      type: 'tool_calls' as const,
      tool_calls: [
        { index: 0, type: 'function' as const, id: toolID, function: { name: 'transfer', arguments: args } },
      ],
    },
  };
}

export function toolCallDelta(id: string) {
  return {
    event: 'thread.run.step.delta',
    data: {
      id,
      delta: {
        step_details: {
          type: 'tool_calls',
          tool_calls: [{ index: 0, function: { arguments: ' updated' } }],
        },
      },
    },
  };
}
