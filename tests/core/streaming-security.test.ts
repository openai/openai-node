import { afterEach, vi } from 'vitest';

import { OpenAIError } from 'openai/core/error';
import { Stream, _iterSSEMessages } from 'openai/core/streaming';

const encoder = new TextEncoder();

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
}

function responseForChunks(chunks: Uint8Array[]) {
  let nextChunk = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[nextChunk];
    nextChunk += 1;

    if (chunk) {
      controller.enqueue(chunk);
    } else {
      controller.close();
    }
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });

  return { response: new Response(body), body, cancel, pull };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('server-sent event framing limits', () => {
  test('rejects one oversized chunk before copying it and cancels its upstream reader', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '32');

    const oversized = encoder.encode(`data: ${'secret'.repeat(16)}\n\n`);
    const { response, body, cancel } = responseForChunks([oversized]);
    const controller = new AbortController();
    const copy = vi.spyOn(Uint8Array.prototype, 'set');

    await expect(_iterSSEMessages(response, controller).next()).rejects.toThrow(
      'Server-sent event exceeded the maximum size of 32 bytes',
    );

    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(copy.mock.calls.every(([bytes]) => bytes.length <= 32)).toBe(true);
  });

  test('stops a delimiter-free event fragmented into many tiny chunks', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '32');

    const bytes = encoder.encode(`data: ${'x'.repeat(80)}\n\n`);
    const { response, body, cancel, pull } = responseForChunks(
      Array.from(bytes, (byte) => Uint8Array.of(byte)),
    );
    const controller = new AbortController();

    await expect(_iterSSEMessages(response, controller).next()).rejects.toThrow(OpenAIError);

    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(pull.mock.calls.length).toBeLessThanOrEqual(33);
  });

  test('surfaces framing overflows through the public response stream', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '40');

    const oversized = encoder.encode(`data: {"value":"${'x'.repeat(80)}"}\n\n`);
    const { response, cancel } = responseForChunks([oversized]);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    await expect(collect(stream)).rejects.toThrow('maximum size of 40 bytes');
    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('accepts an aggregate chunk larger than the limit when its individual frames fit', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '18');

    const aggregate = encoder.encode('data: first\n\ndata: second\n\ndata: third\n\n');
    const { response, cancel } = responseForChunks([aggregate]);

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'first' },
      { event: null, data: 'second' },
      { event: null, data: 'third' },
    ]);
    expect(cancel).not.toHaveBeenCalled();
  });

  test('accepts a complete frame exactly at the configured byte limit', async () => {
    const frame = encoder.encode('data: exact-boundary\n\n');
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', String(frame.byteLength));

    const { response } = responseForChunks([frame]);

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'exact-boundary' },
    ]);
  });

  test('keeps the SSE limit independent from the configured NDJSON line limit', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '64');
    vi.stubEnv('OPENAI_MAX_NDJSON_LINE_BYTES', '8');

    const { response } = responseForChunks([encoder.encode('data: independent frame limit\n\n')]);

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'independent frame limit' },
    ]);
  });

  test('encodes oversized string chunks in bounded segments before rejecting them', async () => {
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', '32');

    const cancel = vi.fn();
    const body = new ReadableStream<string>(
      {
        start(controller) {
          controller.enqueue(`data: ${'😀'.repeat(40)}\n\n`);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const controller = new AbortController();

    await expect(_iterSSEMessages({ body } as unknown as Response, controller).next()).rejects.toThrow(
      'maximum size of 32 bytes',
    );

    expect(encode).toHaveBeenCalled();
    expect(encode.mock.calls.every(([value]) => (value?.length ?? 0) <= 9)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
  });

  test('preserves surrogate pairs when bounded text segments split an SSE frame', async () => {
    const frame = 'data: 😀😀😀\n\n';
    vi.stubEnv('OPENAI_MAX_SSE_EVENT_BYTES', String(encoder.encode(frame).byteLength));

    const body = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(frame);
        controller.close();
      },
    });

    await expect(
      collect(_iterSSEMessages({ body } as unknown as Response, new AbortController())),
    ).resolves.toMatchObject([{ event: null, data: '😀😀😀' }]);
  });
});
