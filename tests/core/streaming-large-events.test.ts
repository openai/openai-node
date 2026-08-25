import { afterEach, vi } from 'vitest';
import OpenAI from 'openai';
import { Stream, _iterSSEMessages } from 'openai/core/streaming';

const encoder = new TextEncoder();
const MiB = 1024 * 1024;

// Streaming must accept complete API events, including base64 images and final
// Responses snapshots. These are contract tests: do not replace their payloads
// with a lowered configurable limit or make them depend on a live API call.

function readable(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}

function clientFor(event: object): OpenAI {
  const bytes = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  return new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () => new Response(readable(bytes), { headers: { 'content-type': 'text/event-stream' } }),
  });
}

afterEach(() => vi.unstubAllEnvs());

test('delivers a large image through the public image streaming API', async () => {
  const image = 'A'.repeat(28 * MiB);
  const event = { type: 'image_generation.completed', b64_json: image };
  const stream = await clientFor(event).images.generate({
    model: 'gpt-image-2',
    prompt: 'A detailed landscape',
    stream: true,
  });
  const events = await collect(stream);
  expect(events).toHaveLength(1);
  expect(events[0]).toEqual(event);
});

test('delivers a complete Responses result larger than the former event limit', async () => {
  const text = 'x'.repeat(8 * MiB + 1);
  const event = { type: 'response.output_text.done', text };
  const stream = await clientFor(event).responses.create({
    model: 'gpt-5.6-luna',
    input: 'Hello',
    stream: true,
  });
  expect(await collect(stream)).toEqual([event]);
});

test('delivers a large image in the final Responses snapshot', async () => {
  const event = {
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output: [
        { type: 'image_generation_call', id: 'ig_test', status: 'completed', result: 'A'.repeat(28 * MiB) },
      ],
    },
  };
  const stream = await clientFor(event).responses.create({
    model: 'gpt-5.6-luna',
    input: 'Draw a landscape',
    stream: true,
  });
  expect(await collect(stream)).toEqual([event]);
});

test('delivers large Chat Completions streaming data', async () => {
  const event = {
    id: 'chatcmpl_test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'x'.repeat(8 * MiB + 1) }, finish_reason: null }],
  };
  const stream = await clientFor(event).chat.completions.create({
    model: 'gpt-5.6-luna',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  });
  expect(await collect(stream)).toEqual([event]);
});

test('does not replace the former cap with a larger fixed SSE cap', async () => {
  const bytes = encoder.encode(`data: ${'x'.repeat(64 * MiB + 1)}\n\n`);
  const events = await collect(_iterSSEMessages(new Response(readable(bytes)), new AbortController()));
  expect(events).toHaveLength(1);
  expect(events[0]?.data.length).toBe(64 * MiB + 1);
});

test('round-trips large NDJSON records without an environment override', async () => {
  vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '16');
  vi.stubEnv('OPENAI_MAX_NDJSON_LINE_BYTES', '16');
  const value = { text: 'x'.repeat(8 * MiB + 1) };
  const source = new Stream(async function* values() {
    yield value;
  }, new AbortController());
  expect(await collect(Stream.fromReadableStream(source.toReadableStream(), new AbortController()))).toEqual([
    value,
  ]);
  expect(
    await collect(
      await clientFor({ type: 'response.output_text.done', text: 'long enough' }).responses.create({
        model: 'gpt-5.6-luna',
        input: 'Hello',
        stream: true,
      }),
    ),
  ).toHaveLength(1);
});
