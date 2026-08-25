import { afterEach, vi } from 'vitest';
import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { LineDecoder } from 'openai/internal/decoders/line';

const encoder = new TextEncoder();

function packedBody(prefix: string) {
  const tail = 'data: {"unused":true}\n\n'.repeat(100_000);
  const bytes = encoder.encode(prefix + tail);
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(bytes);
      },
      pull() {
        throw new Error('Read beyond the packed transport chunk');
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { body, cancel };
}

afterEach(() => vi.restoreAllMocks());

test('does not decode packed SSE records ahead of the consumer', async () => {
  const first = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n';
  const { body, cancel } = packedBody(first);
  const decode = vi.spyOn(LineDecoder.prototype, 'decode');
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  });
  const stream = await client.responses.create({ model: 'gpt-5.6-luna', input: 'Hello', stream: true });
  const iterator = stream[Symbol.asyncIterator]();

  try {
    await expect(iterator.next()).resolves.toMatchObject({ value: { delta: 'hello' }, done: false });
    expect(decode).toHaveBeenCalledTimes(1);
    const chunk = decode.mock.calls[0]?.[0];
    expect(chunk instanceof Uint8Array ? chunk.byteLength : null).toBe(encoder.encode(first).byteLength);
  } finally {
    await iterator.return?.();
  }

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

test('does not decode the packed tail after the completion sentinel', async () => {
  const first = 'data: {"id":1}\n\n';
  const done = 'data: [DONE]\n\n';
  const { body, cancel } = packedBody(first + done);
  const decode = vi.spyOn(LineDecoder.prototype, 'decode');
  const controller = new AbortController();
  const iterator = Stream.fromSSEResponse(new Response(body), controller)[Symbol.asyncIterator]();

  try {
    await expect(iterator.next()).resolves.toEqual({ value: { id: 1 }, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(
      decode.mock.calls.map(([chunk]) => (chunk instanceof Uint8Array ? chunk.byteLength : null)),
    ).toEqual([encoder.encode(first).byteLength, encoder.encode(done).byteLength]);
  } finally {
    await iterator.return?.();
  }

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
  expect(controller.signal.aborted).toBe(false);
});
