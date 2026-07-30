import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  OAuthError,
  SubjectTokenProviderError,
} from 'openai/core/error';
import { CursorPage } from 'openai/core/pagination';

class IdempotentOpenAI extends OpenAI {
  protected override idempotencyHeader = 'Idempotency-Key';

  createIdempotencyKey() {
    return this.defaultIdempotencyKey();
  }
}

function jsonResponse(value: unknown = {}, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('OpenAI client request behavior', () => {
  test('supports PUT requests through the public method helper', async () => {
    const fetch = jest.fn(async () => jsonResponse({ updated: true }));
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
    const fetch = jest.fn(async () => jsonResponse({ data: [{ id: 'item_123' }], has_more: false }));
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
      const fetch = jest
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
    const parseDate = jest.spyOn(Date, 'parse').mockReturnValue(Date.now() + 5);
    const fetch = jest
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
    [new Error('network unavailable'), APIConnectionError],
    [new Error('connection timed out'), APIConnectionTimeoutError],
    [new OAuthError(401, { error: 'invalid_client' }, new Headers()), OAuthError],
    [new SubjectTokenProviderError('identity unavailable', 'test'), SubjectTokenProviderError],
  ] as const)('preserves the appropriate error class when fetching fails', async (failure, ExpectedError) => {
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: jest.fn(async () => {
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
    const fetch = jest.fn();
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
