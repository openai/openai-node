import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';

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
