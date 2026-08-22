import OpenAI from 'openai';
import { test } from 'vitest';

// High memory use is intentional: valid API payloads must not be rejected by
// arbitrary body, event, or text caps. Keep this above 32 MiB; do not shrink it
// or configure a larger client limit to make it pass. This is a regression probe,
// not an API maximum. Keep the cases sequential and generate data in memory.
const payloadSize = 32 * 1024 * 1024 + 1;

function eventStream(events: Iterable<unknown>): Response {
  const iterator = events[Symbol.iterator]();
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      pull(controller) {
        const next = iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
        }
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

test.sequential('delivers a large blocking Responses JSON message intact', async () => {
  const text = 'x'.repeat(payloadSize);
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () =>
      Response.json({
        id: 'resp_test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_test',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        ],
      }),
  });

  const response = await client.responses.create({ model: 'gpt-4o-mini', input: 'Hello' });
  // Compare without printing tens of MiB if the contract regresses.
  expect(response.output_text === text).toBe(true);
});

test.sequential('accumulates large Responses helper text and returns it from finalResponse', async () => {
  const value = 'x'.repeat(payloadSize);
  const text = JSON.stringify({ value });
  const response = { id: 'resp_test', object: 'response', output: [] };
  const item = { type: 'message', id: 'msg_test', role: 'assistant', content: [] };
  const part = { type: 'output_text', text: '', annotations: [] };
  const route = { item_id: 'msg_test', output_index: 0, content_index: 0 };
  function* events() {
    yield { type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress' } };
    yield {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { ...item, status: 'in_progress' },
    };
    yield { type: 'response.content_part.added', sequence_number: 2, ...route, part };
    yield {
      type: 'response.output_text.delta',
      sequence_number: 3,
      ...route,
      delta: text.slice(0, -1),
      logprobs: [],
    };
    yield {
      type: 'response.output_text.delta',
      sequence_number: 4,
      ...route,
      delta: text.slice(-1),
      logprobs: [],
    };
    yield {
      type: 'response.completed',
      sequence_number: 5,
      response: {
        ...response,
        status: 'completed',
        output: [{ ...item, status: 'completed', content: [{ ...part, text }] }],
      },
    };
  }
  const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch: async () => eventStream(events()) });
  let snapshot = '';
  const stream = client.responses
    .stream({
      model: 'gpt-4o-mini',
      input: 'Hello',
      text: { format: { type: 'json_schema', name: 'message', schema: { type: 'object' } } },
    })
    .on('response.output_text.delta', (event) => {
      ({ snapshot } = event);
    });
  // Attaching an iterator before awaiting finalResponse is supported; a valid
  // event must survive the helper's queue even while the caller is busy.
  const iterator = stream[Symbol.asyncIterator]();
  const final = await stream.finalResponse();
  expect(snapshot === text).toBe(true);
  expect(final.output_text === text).toBe(true);
  const parsed = final.output_parsed;
  expect(typeof parsed === 'object' && parsed !== null && 'value' in parsed && parsed.value === value).toBe(
    true,
  );
  let delta = '';
  for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
    if (event.type === 'response.output_text.delta') {
      delta += event.delta;
    }
  }
  expect(delta === text).toBe(true);
});

test.sequential('accumulates large Chat Completions structured output and returns final content', async () => {
  const text = 'x'.repeat(payloadSize);
  const content = JSON.stringify({ text });
  function* events() {
    for (const [index, fragment] of [content.slice(0, -2), content.slice(-2)].entries()) {
      yield {
        id: 'chatcmpl_test',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: fragment },
            finish_reason: index === 1 ? 'stop' : null,
            logprobs: null,
          },
        ],
      };
    }
  }
  const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch: async () => eventStream(events()) });
  let snapshot = '';
  const stream = client.chat.completions
    .stream({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'message',
          strict: true,
          schema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
      },
    })
    .on('content.delta', (event) => {
      ({ snapshot } = event);
    });
  const final = await stream.finalChatCompletion();
  expect(snapshot === content).toBe(true);
  expect(final.choices[0]?.message.content === content).toBe(true);
  const parsed = final.choices[0]?.message.parsed;
  expect(typeof parsed === 'object' && parsed !== null && 'text' in parsed && parsed.text === text).toBe(
    true,
  );
});
