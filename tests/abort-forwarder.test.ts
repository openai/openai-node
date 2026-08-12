import { vi } from 'vitest';
import { getEventListeners } from 'node:events';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import type { Fetch, RequestInfo } from 'openai/internal/builtin-types';

/** Regression coverage for caller-signal retention across request and response lifetimes. */
function makeClient(fetch: Fetch, options: { maxRetries?: number } = {}) {
  return new OpenAI({
    baseURL: 'http://localhost:5000/',
    apiKey: 'My API Key',
    adminAPIKey: 'My Admin API Key',
    maxRetries: options.maxRetries ?? 0,
    fetch,
  });
}

const jsonResponse = () => Response.json({ ok: true });

function bodyFailingOnAbort(signal: AbortSignal, onAbort: (reason: unknown) => unknown) {
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
      signal.addEventListener('abort', () => controller.error(onAbort(signal.reason)), { once: true });
    },
  });

  return {
    body,
    feed(chunk: string) {
      bodyController.enqueue(new TextEncoder().encode(chunk));
    },
  };
}

function deferred<Value>() {
  return (
    Promise as PromiseConstructor & {
      withResolvers: <Result>() => {
        promise: Promise<Result>;
        resolve: (value: Result | PromiseLike<Result>) => void;
        reject: (reason?: unknown) => void;
      };
    }
  ).withResolvers<Value>();
}

describe('caller AbortSignal handling', () => {
  test('leaves no listener on a timeout signal after a request', async () => {
    const client = makeClient(async () => jsonResponse());
    const signal = AbortSignal.timeout(30_000);

    await client.get('/foo', { signal });

    // Deno keeps a timeout timer referenced while its signal has listeners.
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  test('does not accumulate listeners when one signal is reused', async () => {
    const client = makeClient(async () => jsonResponse());
    const controller = new AbortController();

    await Promise.all(Array.from({ length: 12 }, () => client.get('/foo', { signal: controller.signal })));

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('does not retain caller listeners across HTTP retries', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'retry this request' } },
          { status: 500, headers: { 'retry-after-ms': '0' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse());
    const client = makeClient(fetch, { maxRetries: 1 });
    const controller = new AbortController();

    await expect(client.get('/foo', { signal: controller.signal })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('does not retain caller listeners when parsing a response fails', async () => {
    const client = makeClient(
      async () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
    );
    const controller = new AbortController();

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toBeInstanceOf(SyntaxError);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('does not compose a signal for requests without caller cancellation', async () => {
    const compose = vi.spyOn(AbortSignal, 'any');

    try {
      await expect(makeClient(async () => jsonResponse()).get('/foo')).resolves.toEqual({ ok: true });
      expect(compose).not.toHaveBeenCalled();
    } finally {
      compose.mockRestore();
    }
  });

  test('caller abort before the request rejects with APIUserAbortError', async () => {
    const fetch = vi.fn<Fetch>(async () => jsonResponse());
    const client = makeClient(fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrow(APIUserAbortError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('classifies the SDK timeout independently of the caller signal', async () => {
    let requestSignal: AbortSignal | undefined;
    const client = makeClient((_url, init) => {
      requestSignal = init?.signal ?? undefined;
      const pending = deferred<Response>();
      requestSignal?.addEventListener('abort', () => pending.reject(requestSignal?.reason), { once: true });
      return pending.promise;
    });
    const caller = new AbortController();

    await expect(client.get('/foo', { signal: caller.signal, timeout: 1 })).rejects.toThrow(
      APIConnectionTimeoutError,
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
  });

  test('caller abort reaches the fetch after headers arrive', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    });
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url, init) => {
      observed = init?.signal ?? undefined;
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const controller = new AbortController();
    const response = await client.get('/foo', { signal: controller.signal }).asResponse();

    expect(observed?.aborted).toBe(false);
    controller.abort();
    expect(observed?.aborted).toBe(true);

    bodyController.close();
    await response.text();
  });

  test('preserves the caller abort reason when callers own the raw response body', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('The fetch request did not receive an abort signal');
      }

      observed = signal;
      const { body } = bodyFailingOnAbort(signal, (reason) => reason);
      return new Response(body, { headers: { 'content-type': 'application/octet-stream' } });
    });
    const controller = new AbortController();
    const response = await client.get('/foo', { signal: controller.signal }).asResponse();
    const reading = response.text();
    const reason = new DOMException('The operation was timed out.', 'TimeoutError');

    controller.abort(reason);

    await expect(reading).rejects.toBe(reason);
    expect(observed?.reason).toBe(reason);
  });

  test('the request signal records a caller abort', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url, init) => {
      observed = init?.signal ?? undefined;
      return jsonResponse();
    });
    const external = new AbortController();
    const internal = new AbortController();

    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    expect(observed).toBe(internal.signal);
    external.abort();
    expect(internal.signal.aborted).toBe(true);
  });

  test('the request controller still aborts the fetch on its own', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url, init) => {
      observed = init?.signal ?? undefined;
      return jsonResponse();
    });
    const external = new AbortController();
    const internal = new AbortController();

    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    internal.abort();
    expect(observed?.aborted).toBe(true);
    expect(external.signal.aborted).toBe(false);
  });

  /** SSE body that fails with `onAbort(reason)` once the request signal aborts. */
  function sseClientFailingOnAbort(onAbort: (reason: unknown) => unknown) {
    let feedChunk!: (chunk: string) => void;
    const client = makeClient(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('The SSE request did not receive an abort signal');
      }

      const { body, feed } = bodyFailingOnAbort(signal, onAbort);
      feedChunk = feed;
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });

    return { client, feed: (chunk: string) => feedChunk(chunk) };
  }

  test('an SSE stream ends cleanly when the caller aborts with a non-AbortError reason', async () => {
    const { client, feed } = sseClientFailingOnAbort((reason) => reason);
    const caller = new AbortController();
    const stream = (await client.post('/foo', { body: {}, stream: true, signal: caller.signal })) as {
      controller: AbortController;
      [Symbol.asyncIterator]: () => AsyncIterator<{ n: number }>;
    };
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();

    feed('data: {"n":1}\n\n');
    await expect(first).resolves.toEqual({ value: { n: 1 }, done: false });

    const next = iterator.next();
    caller.abort(new DOMException('The operation was timed out.', 'TimeoutError'));

    await expect(next).resolves.toEqual({ value: undefined, done: true });
    expect(stream.controller.signal.aborted).toBe(true);
  });

  test('an SSE stream still reports a failure unrelated to the abort', async () => {
    const { client, feed } = sseClientFailingOnAbort(() => new Error('connection reset'));
    const caller = new AbortController();
    const stream = (await client.post('/foo', { body: {}, stream: true, signal: caller.signal })) as {
      [Symbol.asyncIterator]: () => AsyncIterator<{ n: number }>;
    };
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();

    feed('data: {"n":1}\n\n');
    await expect(first).resolves.toEqual({ value: { n: 1 }, done: false });

    const next = iterator.next();
    caller.abort();

    await expect(next).rejects.toThrow('connection reset');
  });

  test('a caller abort mid-body is reported as an AbortError', async () => {
    const reading = deferred<boolean>();
    const client = makeClient(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('The body request did not receive an abort signal');
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok"'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
        pull() {
          reading.resolve(true);
        },
      });

      return new Response(body, { headers: { 'content-type': 'application/json' } });
    });
    const caller = new AbortController();
    const request = client.get('/foo', { signal: caller.signal });
    const parsed = expect(request).rejects.toMatchObject({ name: 'AbortError' });

    await reading.promise;
    caller.abort(new DOMException('The operation was timed out.', 'TimeoutError'));

    await parsed;
  });

  test('a body read that fails on its own keeps its error', async () => {
    const client = makeClient(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('connection reset'));
        },
      });

      return new Response(body, { headers: { 'content-type': 'application/json' } });
    });

    await expect(client.get('/foo', { signal: new AbortController().signal })).rejects.toThrow(
      'connection reset',
    );
  });

  test('a body read that fails for its own reason after an abort keeps its error', async () => {
    const reading = deferred<boolean>();
    const client = makeClient(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('The body request did not receive an abort signal');
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok"'));
          signal.addEventListener('abort', () => controller.error(new Error('connection reset')), {
            once: true,
          });
        },
        pull() {
          reading.resolve(true);
        },
      });

      return new Response(body, { headers: { 'content-type': 'application/json' } });
    });
    const caller = new AbortController();
    const request = client.get('/foo', { signal: caller.signal });
    const parsed = expect(request).rejects.toThrow('connection reset');

    await reading.promise;
    caller.abort();

    await parsed;
  });

  test('composes with the signal a prepareRequest hook installed, not the original', async () => {
    const replacement = new AbortController();
    let requestSignal: AbortSignal | undefined;

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return jsonResponse();
      },
    });
    const hooks = client as unknown as { prepareRequest: (request: RequestInit) => Promise<void> };
    hooks.prepareRequest = async (request) => {
      request.signal = replacement.signal;
    };
    const original = new AbortController();

    await client.get('/foo', { signal: original.signal });

    original.abort();
    expect(requestSignal?.aborted).toBe(false);
    replacement.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  test('honors a caller signal replaced by a fetchWithAuth override', async () => {
    const replacement = new AbortController();
    let requestSignal: AbortSignal | undefined;

    class Subclass extends OpenAI {
      protected override async fetchWithAuth(
        url: RequestInfo,
        init: RequestInit,
        timeout: number,
        controller: AbortController,
        security?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ): Promise<Response> {
        return super.fetchWithAuth(
          url,
          { ...init, signal: replacement.signal },
          timeout,
          controller,
          security,
        );
      }
    }

    const client = new Subclass({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return jsonResponse();
      },
    });
    const original = new AbortController();

    await client.get('/foo', { signal: original.signal });

    original.abort();
    expect(requestSignal?.aborted).toBe(false);
    replacement.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  test('does not redefine the signal of a controller it was handed', async () => {
    const client = makeClient(async () => jsonResponse());
    const caller = new AbortController();
    const foreign = new AbortController();
    const retained = foreign.signal;

    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: caller.signal }, 30_000, foreign);

    expect(foreign.signal).toBe(retained);
    caller.abort();
    expect(retained.aborted).toBe(true);
  });

  test('leaves the response untouched', async () => {
    const client = makeClient(async () => jsonResponse());
    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );
    const { body } = response;
    if (!body) {
      throw new Error('The JSON response unexpectedly has no body');
    }

    expect(Object.keys(response)).toEqual([]);
    expect(Object.getOwnPropertyNames(body)).toEqual([]);
    const reader = body.getReader({ mode: 'byob' });
    const { value } = await reader.read(new Uint8Array(32));
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');
  });

  test('forwards aborts with a listener when AbortSignal.any is unavailable', async () => {
    const compose = vi.spyOn(AbortSignal, 'any');

    try {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: undefined });
      let observed: AbortSignal | undefined;
      const client = makeClient(async (_url, init) => {
        observed = init?.signal ?? undefined;
        return jsonResponse();
      });
      const external = new AbortController();
      const internal = new AbortController();

      await client.fetchWithTimeout(
        'http://localhost:5000/foo',
        { signal: external.signal },
        30_000,
        internal,
      );

      expect(observed).toBe(internal.signal);
      external.abort();
      expect(internal.signal.aborted).toBe(true);
    } finally {
      compose.mockRestore();
    }
  });

  test('forwards aborts with a listener when the caller signal is not composable', async () => {
    let forward: (() => void) | undefined;
    const polyfilled = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => {
        forward = listener;
      },
      removeEventListener: () => {
        forward = undefined;
      },
    } as unknown as AbortSignal;
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url, init) => {
      observed = init?.signal ?? undefined;
      return jsonResponse();
    });
    const internal = new AbortController();

    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: polyfilled }, 30_000, internal);

    expect(observed).toBe(internal.signal);
    if (!forward) {
      throw new Error('The polyfilled abort signal did not receive a listener');
    }
    forward();
    expect(internal.signal.aborted).toBe(true);
  });

  test('removes the fallback listener when the fetch itself fails', async () => {
    const compose = vi.spyOn(AbortSignal, 'any');

    try {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: undefined });
      const client = makeClient(async () => {
        throw new Error('connection failed');
      });
      const external = new AbortController();
      const internal = new AbortController();

      await expect(
        client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal),
      ).rejects.toThrow('connection failed');

      expect(getEventListeners(external.signal, 'abort')).toHaveLength(0);
    } finally {
      compose.mockRestore();
    }
  });
});
