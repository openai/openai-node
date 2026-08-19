import { afterEach, vi } from 'vitest';

import { OpenAIError } from 'openai/core/error';
import { Stream, _iterSSEMessages } from 'openai/core/streaming';
import { LineDecoder } from 'openai/internal/decoders/line';
import { readEnv } from 'openai/internal/utils/env';

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

function withDenoEnvironment<T>(get: (name: string) => string | undefined, run: () => T): T {
  const originalProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const originalDeno = Object.getOwnPropertyDescriptor(globalThis, 'Deno');

  try {
    Object.defineProperty(globalThis, 'Deno', { configurable: true, value: { env: { get } } });
    Object.defineProperty(globalThis, 'process', { configurable: true, value: undefined });
    return run();
  } finally {
    if (originalProcess) {
      Object.defineProperty(globalThis, 'process', originalProcess);
    } else {
      Reflect.deleteProperty(globalThis, 'process');
    }
    if (originalDeno) {
      Object.defineProperty(globalThis, 'Deno', originalDeno);
    } else {
      Reflect.deleteProperty(globalThis, 'Deno');
    }
  }
}

function inaccessibleEnvironment(name: string): never {
  const error = new Error('Environment access has been denied or revoked.');
  error.name = name;
  throw error;
}

describe('streaming without environment permissions', () => {
  test.each(['PermissionDenied', 'NotCapable'])(
    'treats a revoked Deno %s permission as an absent environment variable',
    (errorName) => {
      let permitted = true;
      const values = withDenoEnvironment(
        () => (permitted ? '  configured  ' : inaccessibleEnvironment(errorName)),
        () => {
          const configured = readEnv('OPENAI_MAX_SSE_EVENT_BYTES');
          permitted = false;
          return [configured, readEnv('OPENAI_MAX_SSE_EVENT_BYTES')];
        },
      );

      expect(values).toEqual(['configured', undefined]);
    },
  );

  test('treats an inaccessible process.env getter as absent', () => {
    const originalProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
    let configured: string | undefined;

    try {
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        value: {
          get env() {
            return inaccessibleEnvironment('PermissionDenied');
          },
        },
      });
      configured = readEnv('OPENAI_MAX_NDJSON_LINE_BYTES');
    } finally {
      if (originalProcess) {
        Object.defineProperty(globalThis, 'process', originalProcess);
      } else {
        Reflect.deleteProperty(globalThis, 'process');
      }
    }

    expect(configured).toBeUndefined();
  });

  test('decodes the public SSE stream after Deno environment permission is revoked', async () => {
    const { response } = responseForChunks([encoder.encode('data: {"value":"safe"}\n\n')]);
    const denied = vi.fn(() => inaccessibleEnvironment('PermissionDenied'));
    const stream = Stream.fromSSEResponse<{ value: string }>(response, new AbortController());
    const values = withDenoEnvironment(denied, () => collect(stream));

    await expect(values).resolves.toEqual([{ value: 'safe' }]);
    expect(denied).toHaveBeenCalledWith('OPENAI_MAX_SSE_EVENT_BYTES');
  });

  test('decodes the public NDJSON stream after Deno environment permission is revoked', async () => {
    const { body } = responseForChunks([encoder.encode('{"value":"safe"}\n')]);
    const denied = vi.fn(() => inaccessibleEnvironment('NotCapable'));
    const stream = Stream.fromReadableStream<{ value: string }>(body, new AbortController());
    const values = withDenoEnvironment(denied, () => collect(stream));

    await expect(values).resolves.toEqual([{ value: 'safe' }]);
    expect(denied).toHaveBeenCalledWith('OPENAI_MAX_NDJSON_LINE_BYTES');
  });

  test('retains the secure default SSE frame limit when Deno denies environment access', async () => {
    const { response, cancel } = responseForChunks([new Uint8Array(8 * 1024 * 1024 + 1)]);
    const denied = vi.fn(() => inaccessibleEnvironment('PermissionDenied'));
    const stream = Stream.fromSSEResponse(response, new AbortController());
    const values = withDenoEnvironment(denied, () => collect(stream));

    await expect(values).rejects.toThrow(/8388608.*bytes/iu);
    expect(denied).toHaveBeenCalledWith('OPENAI_MAX_SSE_EVENT_BYTES');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('retains the secure default line limit when Deno denies environment access', () => {
    const decoder = withDenoEnvironment(
      () => inaccessibleEnvironment('PermissionDenied'),
      () => new LineDecoder(),
    );

    expect(() => decoder.decode(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(/8388608.*bytes/iu);
  });

  test('preserves valid permitted Deno overrides and rejects oversized lines', () => {
    const decoder = withDenoEnvironment(
      () => '  4  ',
      () => new LineDecoder(),
    );

    expect(decoder.decode(encoder.encode('four\n'))).toEqual(['four']);
    expect(() => decoder.decode('large')).toThrow(/line.*4.*bytes/iu);
  });
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
