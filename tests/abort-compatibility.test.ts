import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { vi } from 'vitest';
import { compiledFixture } from './utils/compiled-fixtures';

import OpenAI, { APIConnectionError, APIUserAbortError } from 'openai';
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

describe('fallback caller abort subscriptions', () => {
  const nativeAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');

  afterEach(() => {
    if (nativeAny) {
      Object.defineProperty(AbortSignal, 'any', nativeAny);
    }
  });

  test.each(['missing composition', 'delegating override', 'compatible signal'])(
    'bounds listeners across completed requests with %s',
    async (mode) => {
      if (mode === 'missing composition') {
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
      }
      class DelegatingClient extends OpenAI {
        override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          return super.fetchWithTimeout(...args);
        }
      }
      const caller = new AbortController();
      const signal =
        mode === 'compatible signal'
          ? new Proxy(caller.signal, {
              getPrototypeOf: () => null,
              get(target, property) {
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            })
          : caller.signal;
      const Client = mode === 'delegating override' ? DelegatingClient : OpenAI;
      const client = new Client({ apiKey: 'test-key', fetch: async () => Response.json({ parsed: true }) });

      try {
        for (let index = 0; index < 5; index += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Reuse the signal only after each request completes.
          await expect(client.get('/items', { signal })).resolves.toEqual({ parsed: true });
          expect(getEventListeners(caller.signal, 'abort')).toHaveLength(1);
        }
      } finally {
        caller.abort();
      }
      expect(getEventListeners(caller.signal, 'abort')).toEqual([]);
    },
  );

  test('removes the subscription immediately when fetching rejects', async () => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    const caller = new AbortController();
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () => {
        throw new Error('connection failed');
      },
    });

    await expect(client.get('/items', { signal: caller.signal })).rejects.toBeInstanceOf(APIConnectionError);
    expect(getEventListeners(caller.signal, 'abort')).toEqual([]);
  });

  test('keeps custom body methods abortable when the response has no readable body', async () => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    const caller = new AbortController();
    const response = new Response(null, { status: 204 });
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        const signal = init?.signal;
        if (!signal) {
          throw new Error('Expected a request signal');
        }
        Object.defineProperty(response, 'text', { value: () => delay(100, 'read completed', { signal }) });
        return response;
      },
    });

    await expect(client.get('/items', { signal: caller.signal }).asResponse()).resolves.toBe(response);
    const reading = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    await reading;
  });

  test.each(['json', 'binary', 'sse'])(
    'preserves cancellation after headers for %s responses',
    async (mode) => {
      Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
      const caller = new AbortController();
      let originalResponse: Response | undefined;
      const client = new OpenAI({
        apiKey: 'test-key',
        maxRetries: 0,
        fetch: async (_url, init) => {
          const signal = init?.signal;
          if (!signal) {
            throw new Error('Expected a request signal');
          }
          originalResponse = new Response(
            new ReadableStream({
              start(body) {
                signal.addEventListener('abort', () => body.error(signal.reason), { once: true });
              },
            }),
            { headers: { 'content-type': mode === 'sse' ? 'text/event-stream' : 'application/json' } },
          );
          return originalResponse;
        },
      });
      const pending = client.get('/items', {
        signal: caller.signal,
        ...(mode === 'sse' ? { stream: true } : {}),
        ...(mode === 'binary' ? { __binaryResponse: true } : {}),
      });
      const response = await pending.asResponse();
      expect(response).toBe(originalResponse);
      expect(response.bodyUsed).toBe(false);
      expect(response.body?.locked).toBe(false);

      if (mode === 'sse') {
        const stream = (await pending) as Stream<unknown>;
        const reading = stream[Symbol.asyncIterator]().next();
        caller.abort(new Error('caller cancellation'));
        await expect(reading).resolves.toMatchObject({ done: true });
      } else {
        if (mode === 'binary') {
          expect(await pending).toBe(response);
        }
        const reading = mode === 'binary' ? response.text() : Promise.resolve(pending);
        const rejected = expect(reading).rejects.toBeInstanceOf(Error);
        caller.abort(new Error('caller cancellation'));
        await rejected;
      }
      expect(getEventListeners(caller.signal, 'abort')).toEqual([]);
    },
  );

  test('collects completed subscriptions while keeping raw and cloned body readers abortable', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        '-e',
        `
        const assert = require('node:assert/strict');
        const { getEventListeners } = require('node:events');
        const { setImmediate: nextTurn } = require('node:timers/promises');
        const OpenAI = require(process.argv[1]).default;
        AbortSignal.any = undefined;
        const deadline = setTimeout(() => { throw new Error('abort lifecycle did not finish'); }, 5000);
        async function collect() {
          for (let index = 0; index < 20; index++) { await nextTurn(); global.gc(); }
          await nextTurn();
        }
        (async () => {
          const caller = new AbortController();
          const client = new OpenAI({ apiKey: 'test-key', fetch: async () => Response.json({ ok: true }) });
          for (let index = 0; index < 20; index++) await client.get('/items', { signal: caller.signal });
          assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
          await collect();
          assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
          const retained = await client.get('/items', { signal: caller.signal }).asResponse();
          await retained.json();
          await collect();
          assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
          assert.equal(retained.bodyUsed, true);
          caller.abort();
          for (const clone of [false, true]) {
            const caller = new AbortController();
            let original;
            const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch: async (_url, init) => {
              let body;
              original = new Response(new ReadableStream({ start(controller) { body = controller; } }));
              init.signal.addEventListener('abort', () => body.error(new DOMException('cancelled', 'AbortError')), { once: true });
              return original;
            } });
            let response = await client.get('/items', { signal: caller.signal }).asResponse();
            assert.equal(response, original);
            assert.equal(response.bodyUsed, false);
            assert.equal(response.body.locked, false);
            const reader = (clone ? response.clone() : response).body.getReader();
            response = original = null;
            await collect();
            const reading = assert.rejects(reader.read(), { name: 'AbortError' });
            caller.abort();
            await reading;
            reader.releaseLock();
          }
          clearTimeout(deadline);
        })().catch(error => { console.error(error); process.exitCode = 1; clearTimeout(deadline); });
        `,
        compiledFixture('src/index.ts'),
      ],
      { encoding: 'utf-8', timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('keeps the existing fallback in runtimes without weak references', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
        const assert = require('node:assert/strict');
        const { getEventListeners } = require('node:events');
        const NativeResponse = Response;
        AbortSignal.any = globalThis.WeakRef = globalThis.FinalizationRegistry = undefined;
        const OpenAI = require(process.argv[1]).default;
        (async () => {
          const caller = new AbortController();
          const client = new OpenAI({ apiKey: 'test-key', fetch: async () => NativeResponse.json({ ok: true }) });
          for (let index = 0; index < 3; index++) await client.get('/items', { signal: caller.signal });
          assert.equal(getEventListeners(caller.signal, 'abort').length, 3);
          caller.abort();
          assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
        })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
        compiledFixture('src/index.ts'),
      ],
      { encoding: 'utf-8', timeout: 5000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
