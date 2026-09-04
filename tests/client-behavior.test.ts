import { vi } from 'vitest';
import { Readable } from 'node:stream';

import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  InternalServerError,
  OAuthError,
  RateLimitError,
  SubjectTokenProviderError,
} from 'openai/core/error';
import type { APIError } from 'openai/core/error';
import { CursorPage } from 'openai/core/pagination';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { sleep } from 'openai/internal/utils/sleep';

class IdempotentOpenAI extends OpenAI {
  protected override idempotencyHeader = 'Idempotency-Key';

  createIdempotencyKey() {
    return this.defaultIdempotencyKey();
  }
}

function jsonResponse(value: unknown = {}, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('OpenAI client request behavior', () => {
  test('supports PUT requests through the public method helper', async () => {
    const fetch = vi.fn(async () => jsonResponse({ updated: true }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await expect(client.put('/items/123', { body: { enabled: true } })).resolves.toEqual({ updated: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/items/123',
      expect.objectContaining({ method: 'PUT', body: '{"enabled":true}' }),
    );
  });

  test('generates unique idempotency keys and preserves explicitly supplied keys', async () => {
    const client = new IdempotentOpenAI({ apiKey: 'test-key' });

    expect(client.createIdempotencyKey()).toMatch(/^stainless-node-retry-[\da-f-]{36}$/);
    const generated = await client.buildRequest({ method: 'post', path: '/items' });
    const explicit = await client.buildRequest({
      method: 'post',
      path: '/items',
      idempotencyKey: 'caller-provided',
    });
    const readOnly = await client.buildRequest({ method: 'get', path: '/items' });

    expect(generated.req.headers.get('idempotency-key')).toMatch(/^stainless-node-retry-/);
    expect(explicit.req.headers.get('idempotency-key')).toBe('caller-provided');
    expect(readOnly.req.headers.has('idempotency-key')).toBe(false);
  });

  test('resolves asynchronous pagination request options before fetching', async () => {
    const fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'item_123' }], has_more: false }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const page = await client.getAPIList(
      '/items',
      CursorPage<{ id: string }>,
      Promise.resolve({ query: { limit: 3 } }),
    );

    expect(page.data).toEqual([{ id: 'item_123' }]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/items?limit=3',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('preserves timeout errors when a custom fetch returns headers after its deadline', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelBody }), {
      status: 503,
      headers: { 'retry-after': '90' },
    });
    const fetch = vi.fn(async () => {
      await sleep(110);
      return response;
    });
    const client = new OpenAI({ apiKey: 'test-key', fetch, timeout: 100 });
    try {
      const result = Promise.allSettled([
        client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal }),
      ]);
      await vi.runAllTimersAsync();
      const [outcome] = await result;
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(APIConnectionTimeoutError);
      }
      expect(caller.signal.aborted).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cancelBody).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(['caller', 'hook'] as const)(
    'preserves %s cancellation with a request hook and custom fetchWithTimeout',
    async (source) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const hook = new AbortController();
      const reason = new Error('Canceled during the terminal body read.');
      const cancelBody = vi.fn();
      const response = new Response(new ReadableStream({ cancel: cancelBody }), {
        status: 503,
        headers: { 'retry-after': '90' },
      });
      const client = new OpenAI({ apiKey: 'test-key', timeout: 100 });
      Object.assign(client, {
        async prepareRequest(request: RequestInit): Promise<void> {
          request.signal = hook.signal;
        },
      });
      const fetch = vi.spyOn(client, 'fetchWithTimeout').mockResolvedValue(response);
      const startedAt = Date.now();
      try {
        const result = Promise.allSettled([
          client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal }),
        ]);
        setTimeout(() => (source === 'caller' ? caller : hook).abort(reason), 10);
        await vi.runAllTimersAsync();
        const [outcome] = await result;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(APIUserAbortError);
          expect(outcome.reason).toMatchObject({ cause: reason });
        }
        expect(Date.now() - startedAt).toBe(10);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(cancelBody).toHaveBeenCalledTimes(1);
        expect(response.body?.locked).toBe(false);
      } finally {
        fetch.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  test.each([
    [408, {}, true],
    [409, {}, true],
    [429, {}, true],
    [500, {}, true],
    [400, { 'x-should-retry': 'true' }, true],
    [500, { 'x-should-retry': 'false' }, false],
    [400, {}, false],
  ])(
    'retries HTTP status %i according to explicit headers and defaults',
    async (status, headers, retries) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { error: { message: 'request failed' } },
            {
              status,
              headers: { ...headers, 'retry-after-ms': '0' },
            },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ recovered: true }));
      const client = new OpenAI({ apiKey: 'test-key', maxRetries: 1, fetch });

      if (retries) {
        await expect(client.get('/items')).resolves.toEqual({ recovered: true });
        expect(fetch).toHaveBeenCalledTimes(2);
      } else {
        await expect(client.get('/items')).rejects.toMatchObject({ status });
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    },
  );

  test('honors HTTP-date retry-after headers', async () => {
    const parseDate = vi.spyOn(Date, 'parse').mockReturnValue(Date.now() + 5);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'rate limited' } },
          { status: 429, headers: { 'retry-after': new Date(0).toUTCString() } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 1, fetch });

    try {
      await expect(client.get('/items')).resolves.toEqual({ recovered: true });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(parseDate).toHaveBeenCalled();
    } finally {
      parseDate.mockRestore();
    }
  });

  test.each([
    [429, 'rate_limit_error', 'slow_down', RateLimitError],
    [503, 'service_unavailable_error', 'server_is_overloaded', InternalServerError],
  ] as const)(
    'preserves HTTP %i errors when Retry-After exceeds the supported wait',
    async (status, type, code, ErrorClass) => {
      vi.useFakeTimers();
      const startedAt = Date.now();
      const body = { message: 'Retry later.', type, code, param: null };
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            { error: body },
            { status, headers: { 'retry-after': '90', 'x-request-id': 'req_retry_after' } },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'unexpected_retry' }));
      const client = new OpenAI({ apiKey: 'test-key', fetch });

      try {
        const result = Promise.allSettled([
          client.responses.create({ model: 'test-model', input: 'Hello.' }),
        ]);
        await vi.runAllTimersAsync();
        const [outcome] = await result;
        if (outcome.status !== 'rejected') {
          throw new Error('Expected the original status error.');
        }
        const error = outcome.reason;
        expect(error).toBeInstanceOf(ErrorClass);
        expect(error).toMatchObject({ status, type, code, error: body, requestID: 'req_retry_after' });
        expect(error.headers.get('retry-after')).toBe('90');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(Date.now()).toBe(startedAt);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test('prefers retry-after-ms over retry-after even when retry-after-ms is zero', async () => {
    const parseDate = vi.spyOn(Date, 'parse');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'rate limited' } },
          {
            status: 429,
            headers: {
              'retry-after-ms': '0',
              'retry-after': new Date(0).toUTCString(),
            },
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 1, fetch });

    try {
      await expect(client.get('/items')).resolves.toEqual({ recovered: true });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(parseDate).not.toHaveBeenCalled();
    } finally {
      parseDate.mockRestore();
    }
  });

  test.each([429, 503])(
    'preserves cancellation while reading an over-limit HTTP %i error',
    async (status) => {
      const controller = new AbortController();
      const reason = new Error('Caller canceled the request.');
      const response = new Response(
        new ReadableStream(
          {
            pull(stream) {
              controller.abort(reason);
              stream.error(reason);
            },
          },
          { highWaterMark: 0 },
        ),
        { status, headers: { 'retry-after': '90' } },
      );
      const fetch = vi.fn(async () => response);
      const client = new OpenAI({ apiKey: 'test-key', fetch });

      const request = client.responses.create(
        { model: 'test-model', input: 'Hello.' },
        { signal: controller.signal },
      );
      await expect(request).rejects.toBeInstanceOf(APIUserAbortError);
      await expect(request).rejects.toMatchObject({ cause: reason });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(response.bodyUsed).toBe(true);
    },
  );

  test.each([429, 503])(
    'times out a stalled over-limit HTTP %i error body without retrying',
    async (status) => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        await sleep(40);
        return new Response(
          new ReadableStream({
            start(stream) {
              requestSignal?.addEventListener('abort', () => stream.error(requestSignal?.reason), {
                once: true,
              });
            },
          }),
          { status, headers: { 'retry-after': '90' } },
        );
      });
      const client = new OpenAI({ apiKey: 'test-key', fetch, timeout: 100 });
      try {
        const result = Promise.allSettled([
          client.responses.create({ model: 'test-model', input: 'Hello.' }),
        ]);
        await vi.advanceTimersByTimeAsync(99);
        expect(requestSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(requestSignal?.aborted).toBe(true);
        const [outcome] = await result;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(APIConnectionTimeoutError);
        }
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test.each([429, 503])(
    'preserves caller cancellation when a request hook replaces the signal for HTTP %i',
    async (status) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new Error('Caller canceled the request after headers.');
      const hook = new AbortController();
      let requestSignal: AbortSignal | undefined;
      const fetch = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream({
            start(stream) {
              requestSignal?.addEventListener('abort', () => stream.error(requestSignal?.reason), {
                once: true,
              });
            },
          }),
          { status, headers: { 'retry-after': '90' } },
        );
      });
      const client = new OpenAI({ apiKey: 'test-key', fetch, timeout: 1200 });
      Object.assign(client, {
        async prepareRequest(request: RequestInit): Promise<void> {
          request.signal = hook.signal;
        },
      });

      try {
        const result = Promise.allSettled([
          client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal }),
        ]);
        await vi.advanceTimersByTimeAsync(20);
        caller.abort(reason);
        await vi.advanceTimersByTimeAsync(0);
        expect(requestSignal?.aborted).toBe(true);
        const [outcome] = await result;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(APIUserAbortError);
          expect(outcome.reason).toMatchObject({ cause: reason });
        }
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test.each([
    ['seconds at the limit', { 'retry-after': '60' }, 60_000, true],
    ['seconds above the limit', { 'retry-after': '61' }, 0, false],
    ['finite seconds overflow', { 'retry-after': `2${'0'.repeat(307)}` }, 0, false],
    ['numeric seconds overflow', { 'retry-after': '9'.repeat(309) }, 0, false],
    ['numeric milliseconds overflow', { 'retry-after-ms': '9'.repeat(309) }, 0, false],
    ['exponent overflow', { 'retry-after': '1e999' }, 0, false],
    ['milliseconds at the limit', { 'retry-after-ms': '60000' }, 60_000, true],
    ['milliseconds above the limit', { 'retry-after-ms': '60001' }, 0, false],
    ['date at the limit', { 'retry-after': 'Thu, 03 Sep 2026 12:01:00 GMT' }, 60_000, true],
    ['date above the limit', { 'retry-after': 'Thu, 03 Sep 2026 12:01:01 GMT' }, 0, false],
    ['long milliseconds take precedence', { 'retry-after-ms': '90000', 'retry-after': '1' }, 0, false],
    ['zero milliseconds take precedence', { 'retry-after-ms': '0', 'retry-after': '90' }, 0, true],
    ['explicit retry cannot exceed the limit', { 'retry-after': '90', 'x-should-retry': 'true' }, 0, false],
    ['explicit retry opt-out', { 'retry-after': '1', 'x-should-retry': 'false' }, 0, false],
    ['invalid hint uses backoff', { 'retry-after': 'invalid' }, 500, true],
    ['malformed seconds use backoff', { 'retry-after': '61garbage' }, 500, true],
    ['malformed milliseconds use backoff', { 'retry-after-ms': '60001ms' }, 500, true],
    ['hexadecimal seconds use backoff', { 'retry-after': '0x100' }, 500, true],
    ['binary seconds use backoff', { 'retry-after': '0b1000000' }, 500, true],
    ['octal milliseconds use backoff', { 'retry-after-ms': '0o200000' }, 500, true],
    [
      'malformed milliseconds fall back to seconds',
      { 'retry-after-ms': '60001ms', 'retry-after': '0.25' },
      250,
      true,
    ],
    ['nonfinite hint uses backoff', { 'retry-after-ms': 'Infinity', 'retry-after': '90' }, 500, true],
    ['nonfinite seconds use backoff', { 'retry-after': '+Infinity' }, 500, true],
    ['negative overflow uses backoff', { 'retry-after-ms': `-${'9'.repeat(309)}` }, 500, true],
    ['negative hint uses backoff', { 'retry-after': '-1' }, 500, true],
    ['missing hint uses backoff', {}, 500, true],
  ] as const)('schedules retries correctly: %s', async (_name, headers, elapsedMillis, retried) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const startedAt = Date.now();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Retry later.' } }, { status: 503, headers }))
      .mockResolvedValueOnce(jsonResponse({ id: 'recovered' }));
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 1, fetch });

    try {
      const result = Promise.allSettled([client.responses.create({ model: 'test-model', input: 'Hello.' })]);
      await vi.runAllTimersAsync();
      const [outcome] = await result;
      expect(outcome.status).toBe(retried ? 'fulfilled' : 'rejected');
      if (outcome.status === 'fulfilled') {
        expect(outcome.value).toMatchObject({ id: 'recovered' });
      } else {
        expect(outcome.reason).toBeInstanceOf(InternalServerError);
      }
      expect(fetch).toHaveBeenCalledTimes(retried ? 2 : 1);
      expect(Date.now() - startedAt).toBe(elapsedMillis);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test.each(
    [429, 503].flatMap((status) =>
      [0, 1].flatMap((maxRetries) =>
        (['timeout', 'abort', 'complete'] as const).map((cause) => ({ status, maxRetries, cause })),
      ),
    ),
  )(
    'bounds exhausted HTTP $status error reads with $maxRetries retries on $cause',
    async ({ status, maxRetries, cause }) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new Error('Caller canceled the exhausted request.');
      const responseError = { message: 'Retry later.', code: 'test_error', type: 'test_error' };
      const cancelBody = vi.fn();
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            streamController = stream;
            if (cause === 'complete') {
              stream.enqueue(new TextEncoder().encode(JSON.stringify({ error: responseError })));
              stream.close();
            }
          },
          cancel: cancelBody,
        }),
        { status, headers: { 'retry-after': '0.01', 'x-request-id': 'exhausted-request' } },
      );
      const fetch = vi.fn(async () => {
        await sleep(40);
        return fetch.mock.calls.length <= maxRetries
          ? jsonResponse({ error: responseError }, { status, headers: { 'retry-after': '0.01' } })
          : response;
      });
      const client = new OpenAI({ apiKey: 'test-key', fetch, maxRetries, timeout: 100 });
      let settled = false;
      let failure: unknown;
      const request = (async () => {
        try {
          await client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal });
        } catch (error) {
          failure = error;
        } finally {
          settled = true;
        }
      })();

      try {
        // Each previous attempt spends 40ms receiving headers and 10ms waiting to retry.
        await vi.advanceTimersByTimeAsync(maxRetries * 50 + 50);
        if (cause === 'abort') {
          caller.abort(reason);
        }
        await vi.advanceTimersByTimeAsync(49);
        if (cause === 'timeout') {
          expect(settled).toBe(false);
        }
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(maxRetries + 1);
        if (cause === 'complete') {
          expect(failure).toBeInstanceOf(status === 429 ? RateLimitError : InternalServerError);
          expect(failure).toMatchObject({ status, error: responseError, requestID: 'exhausted-request' });
          expect((failure as APIError).headers?.get('retry-after')).toBe('0.01');
        } else {
          expect(failure).toBeInstanceOf(cause === 'abort' ? APIUserAbortError : APIConnectionTimeoutError);
          if (cause === 'abort') {
            expect(failure).toMatchObject({ cause: reason });
          }
          expect(cancelBody).toHaveBeenCalledTimes(1);
          expect(response.body?.locked).toBe(false);
        }
      } finally {
        if (!settled) {
          streamController?.close();
        }
        await request;
        vi.useRealTimers();
      }
    },
  );

  test.each(['timeout', 'abort'] as const)('cancels the owned terminal error reader on %s', async (cause) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelBody }), {
      status: 503,
      headers: { 'retry-after': '90' },
    });
    const fetch = vi.fn(async () => response);
    const client = new OpenAI({ apiKey: 'test-key', fetch, timeout: 100 });
    try {
      const result = Promise.allSettled([
        client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal }),
      ]);
      await vi.advanceTimersByTimeAsync(10);
      if (cause === 'abort') {
        caller.abort();
      }
      await vi.advanceTimersByTimeAsync(90);
      const [outcome] = await result;
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(
          cause === 'abort' ? APIUserAbortError : APIConnectionTimeoutError,
        );
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cancelBody).toHaveBeenCalledTimes(1);
      expect(response.body?.locked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('preserves UTF-8 error text split across terminal response chunks', async () => {
    const message = 'Try again later 🌍';
    const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify({ error: { message } })}`);
    const response = new Response(
      new ReadableStream({
        start(stream) {
          for (const byte of bytes) {
            stream.enqueue(Uint8Array.of(byte));
          }
          stream.close();
        },
      }),
      { status: 503, headers: { 'retry-after': '90' } },
    );
    const client = new OpenAI({ apiKey: 'test-key', fetch: async () => response });
    await expect(client.responses.create({ model: 'test-model', input: 'Hello.' })).rejects.toMatchObject({
      status: 503,
      error: { message },
    });
    expect(response.body?.locked).toBe(false);
  });

  test.each(['complete', 'timeout', 'abort'] as const)(
    'preserves custom-fetch Node readable error bodies on %s',
    async (cause) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const error = { message: 'Retry later.', code: 'server_overloaded', type: 'server_error' };
      const body =
        cause === 'complete'
          ? Readable.from([Buffer.from(JSON.stringify({ error }))])
          : new Readable({ read() {} });
      const response = new Response(null, { status: 503, headers: { 'retry-after': '90' } });
      Object.defineProperty(response, 'body', { value: body });
      // Custom fetch implementations consume Node readable bodies in response.text().
      vi.spyOn(response, 'text').mockImplementation(async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf-8');
      });
      const fetch = vi.fn(async () => response);
      const client = new OpenAI({ apiKey: 'test-key', fetch, timeout: 100 });
      try {
        const result = Promise.allSettled([
          client.responses.create({ model: 'test-model', input: 'Hello.' }, { signal: caller.signal }),
        ]);
        await vi.advanceTimersByTimeAsync(10);
        if (cause === 'abort') {
          caller.abort();
        }
        await vi.advanceTimersByTimeAsync(90);
        const [outcome] = await result;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          if (cause === 'complete') {
            expect(outcome.reason).toBeInstanceOf(InternalServerError);
            expect(outcome.reason).toMatchObject({ status: 503, error, code: error.code, type: error.type });
          } else {
            expect(outcome.reason).toBeInstanceOf(
              cause === 'abort' ? APIUserAbortError : APIConnectionTimeoutError,
            );
          }
        }
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(body.destroyed).toBe(true);
      } finally {
        body.destroy();
        vi.useRealTimers();
      }
    },
  );

  test.each([
    [new Error('network unavailable'), APIConnectionError],
    [new Error('connection timed out'), APIConnectionTimeoutError],
    [new OAuthError(401, { error: 'invalid_client' }, new Headers()), OAuthError],
    [new SubjectTokenProviderError('identity unavailable', 'test'), SubjectTokenProviderError],
  ] as const)('preserves the appropriate error class when fetching fails', async (failure, ExpectedError) => {
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(client.get('/items')).rejects.toBeInstanceOf(ExpectedError);
  });

  test('reports failures and invalid values returned by asynchronous API-key providers', async () => {
    const failing = new OpenAI({
      apiKey: async () => {
        throw new Error('provider unavailable');
      },
    });
    const invalid = new OpenAI({ apiKey: async () => '' });

    await expect(failing._callApiKey()).rejects.toThrow("Failed to get token from 'apiKey' function");
    await expect(invalid._callApiKey()).rejects.toThrow(
      "Expected 'apiKey' function argument to return a string",
    );
  });

  test('rejects already-aborted requests before making network calls', async () => {
    const fetch = vi.fn();
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/items', { signal: controller.signal })).rejects.toThrow('Request was aborted');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('encodes URL-encoded request objects with the configured content type', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const { req } = await client.buildRequest({
      method: 'post',
      path: '/items',
      body: { search: 'hello world', limit: 2 },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(req.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(req.body).toBe('search=hello%20world&limit=2');
  });
});

describe('JSON response parsing', () => {
  test.each([
    'application/json; charset=utf-8',
    'Application/JSON',
    'APPLICATION/JSON; Charset=UTF-8',
    'application/vnd.openai+JSON',
    'Application/Vnd.OpenAI+Json; profile="CaseSensitive"',
  ])('parses %s without changing response accessors or headers', async (contentType) => {
    const body = { id: 'model_123', object: 'model', created: 1, owned_by: 'synthetic' };
    const response = Response.json(body, {
      headers: { 'content-type': contentType, 'x-request-id': 'req_123' },
    });
    const fetch = vi.fn(async () => response);
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const promise = client.models.retrieve('model_123');
    const rawResponse = await promise.asResponse();

    expect(rawResponse).toBe(response);
    expect(rawResponse.bodyUsed).toBe(false);
    expect(rawResponse.headers.get('content-type')).toBe(contentType);
    const parsed = await promise;
    expect(parsed).toEqual(body);
    expect(parsed._request_id).toBe('req_123');
    expect(Object.keys(parsed)).not.toContain('_request_id');
    const dataAndResponse = await promise.withResponse();
    expect(dataAndResponse.data).toBe(parsed);
    expect(dataAndResponse.response).toBe(response);
    expect(dataAndResponse.request_id).toBe('req_123');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('preserves paginated items from a mixed-case JSON response', async () => {
    const data = [{ id: 'model_123', object: 'model', created: 1, owned_by: 'synthetic' }];
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async () =>
        Response.json(
          { object: 'list', data },
          {
            headers: { 'content-type': 'Application/JSON' },
          },
        ),
    });
    const page = await client.models.list();

    expect(page.data).toEqual(data);
    expect(page.object).toBe('list');
  });

  test.each([
    ['application/json', undefined],
    ['application/json; charset=utf-8', undefined],
    ['application/vnd.openai+json', undefined],
    ['Application/JSON', undefined],
    ['application/json', '0'],
  ])('accepts an empty %s response with content-length %s', async (contentType, contentLength) => {
    const response = new Response('', {
      headers: {
        'content-type': contentType,
        ...(contentLength === undefined ? {} : { 'content-length': contentLength }),
      },
    });
    const fetch = vi.fn(async () => response);
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await expect(client.realtime.calls.hangup('call_123')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/calls/call_123/hangup',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('accepts an empty streaming JSON response without a content-length header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } });
    const client = new OpenAI({ apiKey: 'test-key', fetch: vi.fn(async () => response) });

    expect(response.body).not.toBeNull();
    expect(response.headers.has('content-length')).toBe(false);
    await expect(client.realtime.calls.hangup('call_123')).resolves.toBeUndefined();
  });

  test('accepts a genuinely bodyless JSON response without a content-length header', async () => {
    const response = new Response(null, { headers: { 'content-type': 'application/json' } });
    const client = new OpenAI({ apiKey: 'test-key', fetch: vi.fn(async () => response) });

    expect(response.body).toBeNull();
    expect(response.headers.has('content-length')).toBe(false);
    await expect(client.realtime.calls.hangup('call_123')).resolves.toBeUndefined();
  });

  test.each([
    ['object', '{"id":"response_123","deleted":true}', { id: 'response_123', deleted: true }],
    ['array', '[1,2]', [1, 2]],
    ['string', '"value"', 'value'],
    ['number', '0', 0],
    ['boolean', 'false', false],
    ['null', 'null', null],
  ])('preserves nonempty JSON %s values', async (_description, body, expected) => {
    const response = new Response(body, {
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
    });
    const client = new OpenAI({ apiKey: 'test-key', fetch: vi.fn(async () => response) });

    const parsed = await client.get('/items');

    expect(parsed).toEqual(expected);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      expect(parsed).toMatchObject({ _request_id: 'req_123' });
    }
  });

  test.each(['{invalid', '   ', '\n\t'])('rejects malformed nonempty JSON: %j', async (body) => {
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0, fetch: vi.fn(async () => response) });

    await expect(client.get('/items')).rejects.toBeInstanceOf(SyntaxError);
  });

  test('rejects malformed JSON with a mixed-case media type', async () => {
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async () => new Response('{invalid', { headers: { 'content-type': 'Application/JSON' } }),
    });

    await expect(client.models.retrieve('model_123')).rejects.toBeInstanceOf(SyntaxError);
  });

  test('preserves the null result for genuine HTTP 204 responses', async () => {
    const response = new Response(null, { status: 204 });
    const client = new OpenAI({ apiKey: 'test-key', fetch: vi.fn(async () => response) });

    await expect(client.get('/items')).resolves.toBeNull();
  });
});
