import { vi } from 'vitest';

import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  OAuthError,
  SubjectTokenProviderError,
} from 'openai/core/error';
import { CursorPage } from 'openai/core/pagination';
import { createProvider } from 'openai/internal/provider';

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

async function observe(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
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

  test.each(['caller', 'prepared'] as const)(
    'rejects promptly when the %s signal aborts during retry backoff',
    async (abortedSignal) => {
      vi.useFakeTimers();
      const reason = new Error(`stop ${abortedSignal} request`);
      const callerController = new AbortController();
      const preparedController = new AbortController();
      const fetch = vi.fn(async () =>
        jsonResponse(
          { error: { message: 'rate limited' } },
          { status: 429, headers: { 'retry-after-ms': '60000' } },
        ),
      );
      const client = new OpenAI({
        provider: createProvider({
          configure: () => ({
            name: 'test-provider',
            baseURL: 'https://api.openai.com/v1',
            prepareRequest(request) {
              request.signal = preparedController.signal;
            },
          }),
        }),
        maxRetries: 1,
        fetch,
      });
      const request = client.get('/items', {
        signal: callerController.signal,
      });
      const observed = observe(request);

      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const controller = abortedSignal === 'caller' ? callerController : preparedController;
        controller.abort(reason);
        await vi.advanceTimersByTimeAsync(0);

        const waiting = Symbol('request still waiting for retry delay');
        const result = await Promise.race([observed, Promise.resolve(waiting)]);
        expect(result).not.toBe(waiting);
        expect(result).toBeInstanceOf(APIUserAbortError);
        expect(result).toMatchObject({ cause: reason });
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        await vi.runAllTimersAsync();
        await observed;
        vi.useRealTimers();
      }
    },
  );

  test('retries a response body timeout without treating it as a user abort', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const preparedController = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new ReadableStream(), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const client = new OpenAI({
      provider: createProvider({
        configure: () => ({
          name: 'test-provider',
          baseURL: 'https://api.openai.com/v1',
          prepareRequest(request) {
            request.signal = preparedController.signal;
          },
        }),
      }),
      maxRetries: 1,
      timeout: 10,
      fetch,
    });
    const request = client.get('/items');

    try {
      await expect(request).resolves.toEqual({ recovered: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
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
