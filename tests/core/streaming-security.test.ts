import { afterEach, vi } from 'vitest';

import { Stream } from 'openai/core/streaming';
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
    expect(denied).not.toHaveBeenCalled();
  });

  test('decodes the public NDJSON stream after Deno environment permission is revoked', async () => {
    const { body } = responseForChunks([encoder.encode('{"value":"safe"}\n')]);
    const denied = vi.fn(() => inaccessibleEnvironment('NotCapable'));
    const stream = Stream.fromReadableStream<{ value: string }>(body, new AbortController());
    const values = withDenoEnvironment(denied, () => collect(stream));

    await expect(values).resolves.toEqual([{ value: 'safe' }]);
    expect(denied).not.toHaveBeenCalled();
  });
});
