import { getEventListeners } from 'node:events';
import { vi } from 'vitest';

import OpenAI, { APIUserAbortError } from 'openai';
import { Stream } from 'openai/core/streaming';
import { defaultParseResponse } from 'openai/internal/parse';

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}

function parseResponse(response: Response, controller: AbortController): Promise<unknown> {
  return defaultParseResponse(new OpenAI({ apiKey: 'test-key' }), {
    response,
    options: { method: 'get', path: '/items' },
    controller,
    requestLogID: 'abort-compatibility-test',
    retryOfRequestLogID: undefined,
    startTime: Date.now(),
  });
}

describe('abort compatibility for server-sent event streams', () => {
  test.each([
    ['a timeout', () => new DOMException('The operation timed out', 'TimeoutError')],
    ['a custom error', () => new Error('The caller cancelled the request')],
  ])('finishes quietly when the response body rejects with %s abort reason', async (_name, makeReason) => {
    const controller = new AbortController();
    const reason = makeReason();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(body) {
          controller.abort(reason);
          body.error(reason);
        },
      }),
    );

    await expect(collect(Stream.fromSSEResponse(response, controller))).resolves.toEqual([]);
    expect(controller.signal.reason).toBe(reason);
  });

  test('preserves unrelated response errors racing with an abort', async () => {
    const controller = new AbortController();
    const reason = new Error('The caller cancelled the request');
    const bodyFailure = new Error('The response connection was reset');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(body) {
          controller.abort(reason);
          body.error(bodyFailure);
        },
      }),
    );

    await expect(collect(Stream.fromSSEResponse(response, controller))).rejects.toBe(bodyFailure);
    expect(controller.signal.reason).toBe(reason);
  });
});

describe('abort compatibility while parsing response bodies', () => {
  test.each(['application/json', 'text/plain'])(
    'normalizes the exact composed abort reason while reading a %s body',
    async (contentType) => {
      const controller = new AbortController();
      const reason = new DOMException('The operation timed out', 'TimeoutError');
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull(body) {
            controller.abort(reason);
            body.error(reason);
          },
        }),
        { headers: { 'content-type': contentType } },
      );

      await expect(parseResponse(response, controller)).rejects.toMatchObject({
        name: 'AbortError',
        message: 'This operation was aborted',
      });
    },
  );

  test('preserves an existing AbortError instance', async () => {
    const controller = new AbortController();
    const reason = new DOMException('The request was cancelled', 'AbortError');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(body) {
          controller.abort(reason);
          body.error(reason);
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );

    await expect(parseResponse(response, controller)).rejects.toBe(reason);
  });

  test('preserves unrelated response errors racing with an abort', async () => {
    const controller = new AbortController();
    const reason = new Error('The caller cancelled the request');
    const bodyFailure = new Error('The response connection was reset');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(body) {
          controller.abort(reason);
          body.error(bodyFailure);
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );

    await expect(parseResponse(response, controller)).rejects.toBe(bodyFailure);
  });

  test('keeps caller cancellation during a client response read as APIUserAbortError', async () => {
    const caller = new AbortController();
    const reason = new Error('The caller cancelled the request');
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(body) {
                caller.abort(reason);
                body.error(reason);
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch });

    await expect(client.get('/items', { signal: caller.signal })).rejects.toBeInstanceOf(APIUserAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('does not retain caller abort listeners after a response is parsed', async () => {
    const caller = new AbortController();
    const fetch = vi.fn(async () => Response.json({ parsed: true }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await expect(client.get('/items', { signal: caller.signal })).resolves.toEqual({ parsed: true });
    expect(getEventListeners(caller.signal, 'abort')).toEqual([]);
  });
});
