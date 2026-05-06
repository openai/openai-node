#!/usr/bin/env -S npm run tsn -T

import assert from 'node:assert/strict';

type ResponseLike = {
  output_text?: string;
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

type StreamEventLike = {
  type?: string;
  delta?: string;
  item_id?: string;
  response?: unknown;
};

function responseText(response: ResponseLike): string {
  if (response.output_text) return response.output_text;

  return (response.output ?? [])
    .map((item) => {
      if (item.type !== 'message') return '';
      return (item.content ?? []).map((part) => part.text ?? '').join('');
    })
    .join('');
}

function toolCalls(response: ResponseLike): Array<{ name: string | undefined; arguments: Record<string, unknown> }> {
  return (response.output ?? [])
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      name: item.name,
      arguments: item.arguments ? JSON.parse(item.arguments) : {},
    }));
}

function collectStream(events: StreamEventLike[]): { text: string; completed: boolean; toolArguments: Record<string, unknown>[] } {
  let text = '';
  let completed = false;
  const buffers = new Map<string, string>();

  for (const event of events) {
    if (event.type === 'response.output_text.delta') text += event.delta ?? '';
    if (event.type === 'response.function_call_arguments.delta') {
      const key = event.item_id ?? 'default';
      buffers.set(key, `${buffers.get(key) ?? ''}${event.delta ?? ''}`);
    }
    if (event.type === 'response.completed') completed = true;
  }

  return {
    text,
    completed,
    toolArguments: [...buffers.values()].map((value) => JSON.parse(value)),
  };
}

const response = {
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: 'Refunds are available within 30 days.' }],
    },
    {
      type: 'function_call',
      name: 'search_docs',
      arguments: JSON.stringify({ query: 'refund policy' }),
    },
  ],
};

assert.match(responseText(response), /30 days/);
assert.deepEqual(toolCalls(response)[0], { name: 'search_docs', arguments: { query: 'refund policy' } });

const stream = collectStream([
  { type: 'response.output_text.delta', delta: 'Hello' },
  { type: 'response.output_text.delta', delta: ' world' },
  { type: 'response.function_call_arguments.delta', item_id: 'call_1', delta: '{"query"' },
  { type: 'response.function_call_arguments.delta', item_id: 'call_1', delta: ':"refund"}' },
  { type: 'response.completed', response: { id: 'resp_123' } },
]);

assert.equal(stream.text, 'Hello world');
assert.equal(stream.completed, true);
assert.deepEqual(stream.toolArguments[0], { query: 'refund' });

console.log('Responses testing example passed.');
