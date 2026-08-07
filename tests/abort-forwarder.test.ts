import { getEventListeners } from 'node:events';

import OpenAI, { APIUserAbortError } from 'openai';
import { Stream } from 'openai/core/streaming';

/**
 * Regressions for #1811: a request made with a caller signal must not leave that
 * signal holding a reference to the request. Kept out of the Stainless-generated
 * `tests/index.test.ts` projection.
 */

function makeClient(fetchImpl: typeof fetch | (() => Promise<Response>)) {
  return new OpenAI({
    baseURL: 'http://localhost:5000/',
    apiKey: 'My API Key',
    adminAPIKey: 'My Admin API Key',
    maxRetries: 0,
    fetch: fetchImpl as any,
  });
}

const jsonResponse = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

describe('caller AbortSignal handling', () => {
  test('leaves no listener on the caller signal after a request (#1811)', async () => {
    const client = makeClient(async () => jsonResponse());

    const signal = AbortSignal.timeout(30_000);
    await client.get('/foo', { signal });

    // A listener here keeps Deno's timeout timer referenced, so the process
    // cannot exit until the timeout fires.
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  test('does not accumulate listeners when one signal is reused', async () => {
    const client = makeClient(async () => jsonResponse());

    const controller = new AbortController();
    for (let i = 0; i < 5; i++) {
      await client.get('/foo', { signal: controller.signal });
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('caller abort before the request rejects with APIUserAbortError', async () => {
    const client = makeClient(async () => jsonResponse());

    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrow(APIUserAbortError);
  });

  test('caller abort reaches the fetch after headers arrive', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    });

    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });

    const controller = new AbortController();
    const response = await client.get('/foo', { signal: controller.signal }).asResponse();

    // Body still streaming: the request must remain abortable.
    expect(observed!.aborted).toBe(false);
    controller.abort();
    expect(observed!.aborted).toBe(true);

    bodyController.close();
    await response.text().catch(() => {});
  });

  test('the request signal records a caller abort', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const external = new AbortController();
    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    // `Stream` and the streaming helpers decide between cancellation and failure
    // by reading the request controller, so it has to see the caller's abort.
    expect(observed).toBe(internal.signal);
    external.abort();
    expect(internal.signal.aborted).toBe(true);
  });

  test('the request controller still aborts the fetch on its own', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const external = new AbortController();
    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    // `stream.controller.abort()` is the documented escape hatch for raw streams.
    internal.abort();
    expect(observed!.aborted).toBe(true);
    expect(external.signal.aborted).toBe(false);
  });

  /** SSE body that fails with `onAbort(reason)` once the request signal aborts. */
  function sseClientFailingOnAbort(onAbort: (reason: unknown) => unknown) {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const client = makeClient(async (_url: any, init: any) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
          signal.addEventListener('abort', () => streamController.error(onAbort(signal.reason)), {
            once: true,
          });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    return { client, feed: (chunk: string) => bodyController.enqueue(new TextEncoder().encode(chunk)) };
  }

  test('an SSE stream ends cleanly when the caller aborts with a non-AbortError reason', async () => {
    // What fetch does: reads reject with whatever the signal aborted with.
    const { client, feed } = sseClientFailingOnAbort((reason) => reason);

    const caller = new AbortController();
    const stream = await client.post('/foo', { body: {}, stream: true, signal: caller.signal });

    const chunks: unknown[] = [];
    const iterating = (async () => {
      for await (const chunk of stream as any) chunks.push(chunk);
    })();

    feed('data: {"n":1}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // `AbortSignal.timeout()` aborts with a TimeoutError, and a caller may abort
    // with any reason at all; neither is an AbortError.
    caller.abort(new DOMException('The operation was timed out.', 'TimeoutError'));

    await expect(iterating).resolves.toBeUndefined();
    expect(chunks).toEqual([{ n: 1 }]);
    expect((stream as any).controller.signal.aborted).toBe(true);
  });

  test('an SSE stream still reports a failure unrelated to the abort', async () => {
    // The abort lands, but the body fails for its own reason — that error is a
    // real transport failure and must not be swallowed as a cancellation.
    const { client, feed } = sseClientFailingOnAbort(() => new Error('connection reset'));

    const caller = new AbortController();
    const stream = await client.post('/foo', { body: {}, stream: true, signal: caller.signal });

    const iterating = (async () => {
      for await (const _chunk of stream as any) {
        /* drain */
      }
    })();

    feed('data: {"n":1}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    caller.abort();

    await expect(iterating).rejects.toThrow('connection reset');
  });

  test('a caller abort mid-body is reported as an AbortError', async () => {
    const client = makeClient(async (_url: any, init: any) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"ok"'));
          signal.addEventListener('abort', () => streamController.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });

    const caller = new AbortController();
    const request = client.get('/foo', { signal: caller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Callers classify cancellation by AbortError, so the reason the caller
    // aborted with must not reach them in its place.
    caller.abort(new DOMException('The operation was timed out.', 'TimeoutError'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a body read that fails on its own keeps its error', async () => {
    const client = makeClient(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.error(new Error('connection reset'));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });

    await expect(client.get('/foo', { signal: new AbortController().signal })).rejects.toThrow(
      'connection reset',
    );
  });

  test('a body read that fails for its own reason after an abort keeps its error', async () => {
    const client = makeClient(async (_url: any, init: any) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"ok"'));
          // The abort lands, but the body fails for an unrelated reason — the
          // race a custom fetch can produce. The real error has to survive.
          signal.addEventListener('abort', () => streamController.error(new Error('connection reset')), {
            once: true,
          });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });

    const caller = new AbortController();
    const request = client.get('/foo', { signal: caller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    caller.abort();
    await expect(request).rejects.toThrow('connection reset');
  });

  test('composes with the signal a prepareRequest hook installed, not the original', async () => {
    const replacement = new AbortController();
    let requestSignal!: AbortSignal;

    class Subclass extends OpenAI {
      protected override async prepareRequest(req: RequestInit) {
        // A hook replacing the signal makes its replacement authoritative.
        req.signal = replacement.signal;
      }
    }

    const client = new Subclass({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      maxRetries: 0,
      fetch: (async (_url: any, init: any) => {
        requestSignal = init.signal;
        return jsonResponse();
      }) as any,
    });

    const original = new AbortController();
    await client.get('/foo', { signal: original.signal });

    original.abort();
    expect(requestSignal.aborted).toBe(false);

    replacement.abort();
    expect(requestSignal.aborted).toBe(true);
  });

  test('does not redefine the signal of a controller it was handed', async () => {
    const client = makeClient(async () => jsonResponse());

    const caller = new AbortController();
    const foreign = new AbortController();
    // A caller of the public method, or a fetchWithAuth override, may already
    // hold this signal; it has to stay the one that aborts.
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

    // Nothing about the body is wrapped or patched, so identity, byte-stream
    // reads, and own-property shape all stay exactly as the runtime produced them.
    expect(Object.keys(response)).toEqual([]);
    expect(Object.getOwnPropertyNames(response.body!)).toEqual([]);
    const reader = response.body!.getReader({ mode: 'byob' });
    const { value } = await reader.read(new Uint8Array(32));
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');
  });

  test('forwards aborts with a listener when AbortSignal.any is unavailable', async () => {
    const original = (AbortSignal as any).any;
    try {
      (AbortSignal as any).any = undefined;

      let observed: AbortSignal | undefined;
      const client = makeClient(async (_url: any, init: any) => {
        observed = init.signal;
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
      (AbortSignal as any).any = original;
    }
  });

  test('forwards aborts with a listener when the caller signal is not composable', async () => {
    // Polyfilled signals (e.g. the `abort-controller` package) are rejected by
    // native AbortSignal.any.
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
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: polyfilled }, 30_000, internal);

    expect(observed).toBe(internal.signal);
    forward!();
    expect(internal.signal.aborted).toBe(true);
  });

  test('removes the fallback listener when the fetch itself fails', async () => {
    const original = (AbortSignal as any).any;
    try {
      (AbortSignal as any).any = undefined;

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
      (AbortSignal as any).any = original;
    }
  });
});
