import { vi } from 'vitest';
import OpenAI, { OAuthError, SubjectTokenProviderError } from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createTestWorkloadIdentity } from './workload-identity-fixtures';

const originalFetch = global.fetch;

describe('OpenAI with Workload Identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test('initializes with workloadIdentity', () => {
    const client = new OpenAI(createTestClientOptions());

    expect(client).toBeDefined();
  });

  test('apiKey and workloadIdentity are mutually exclusive at runtime', () => {
    expect(
      () =>
        new OpenAI({
          apiKey: 'my-api-key',
          workloadIdentity: createTestWorkloadIdentity(),
          organization: 'test-org-id',
          project: 'test-project-id',
        }),
    ).toThrow(/mutually exclusive/);
  });

  test('requires at least one credential source', () => {
    expect(() => new OpenAI({})).toThrow(/Missing credentials/);
  });

  test('allows client initialization with adminAPIKey only', () => {
    expect(() => new OpenAI({ apiKey: null, adminAPIKey: 'my-admin-api-key' })).not.toThrow();
  });

  test('injects Authorization header with workload identity token', async () => {
    let apiRequestHeaders: Headers | undefined;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return Response.json(
          {
            access_token: 'exchanged-access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        apiRequestHeaders = new Headers(init?.headers);
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    const { req } = await client.buildRequest({ path: '/models', method: 'get' });
    expect(req.headers.get('Authorization')).toBe('Bearer exchanged-access-token');
    await client.models.list();

    expect(apiRequestHeaders).toBeDefined();
    expect(apiRequestHeaders!.get('Authorization')).toBe('Bearer exchanged-access-token');
  });

  test('does not satisfy admin-only auth with workload identity', async () => {
    global.fetch = vi.fn(async () => new Response('Unexpected request', { status: 500 })) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(
      client
        .request({
          path: '/organization/projects',
          method: 'get',
          __security: { adminAPIKeyAuth: true },
        })
        .asResponse(),
    ).rejects.toThrow(/Could not resolve authentication method/);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    { defaults: undefined, request: undefined, expected: 'Bearer exchanged-access-token' },
    { defaults: undefined, request: null, expected: null },
    { defaults: null, request: undefined, expected: null },
    { defaults: undefined, request: '', expected: '' },
    { defaults: '', request: undefined, expected: '' },
    { defaults: undefined, request: 'Bearer replacement', expected: 'Bearer replacement' },
    {
      defaults: undefined,
      request: 'Bearer workload-identity-auth',
      expected: 'Bearer exchanged-access-token',
    },
    { defaults: 'Bearer replacement', request: null, expected: null },
    { defaults: null, request: 'Bearer replacement', expected: 'Bearer replacement' },
  ])('preserves Authorization overrides: %j', async ({ defaults, request, expected }) => {
    const headers: Headers[] = [];
    const needsToken = expected === 'Bearer exchanged-access-token';
    const identity = createTestWorkloadIdentity();
    const getToken = vi.fn(async () => {
      if (!needsToken) {
        throw new Error('Unused subject token provider is unavailable');
      }
      return 'subject-token';
    });
    identity.provider.getToken = getToken;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().endsWith('/oauth/token')) {
        return Response.json({
          access_token: 'exchanged-access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      expect(url.toString()).toBe('https://public.example/file');
      headers.push(new Headers(init?.headers));
      return Response.json({ ok: true });
    }) as typeof fetch;
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      defaultHeaders: { Authorization: defaults },
    });

    await client.get('https://public.example/file', { headers: { Authorization: request } });

    expect(headers).toHaveLength(1);
    expect(headers[0]?.get('Authorization')).toBe(expected);
    expect(getToken).toHaveBeenCalledTimes(needsToken ? 1 : 0);
    expect(global.fetch).toHaveBeenCalledTimes(needsToken ? 2 : 1);
  });

  test.each([
    { defaults: undefined, request: null, expected: null },
    { defaults: null, request: undefined, expected: null },
    { defaults: undefined, request: '', expected: '' },
    { defaults: '', request: undefined, expected: '' },
    { defaults: undefined, request: 'Bearer replacement', expected: 'Bearer replacement' },
    { defaults: 'Bearer replacement', request: undefined, expected: 'Bearer replacement' },
  ])('does not refresh or replay an overridden 401 POST: %j', async ({ defaults, request, expected }) => {
    const headers: Headers[] = [];
    let exchanges = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().endsWith('/oauth/token')) {
        exchanges++;
        return Response.json({
          access_token: 'exchanged-access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      headers.push(new Headers(init?.headers));
      return init?.method === 'POST'
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    }) as typeof fetch;
    const defaultHeaders: { Authorization: string | null | undefined } = { Authorization: undefined };
    const client = new OpenAI({ ...createTestClientOptions(), defaultHeaders, maxRetries: 0 });

    await client.models.list();
    defaultHeaders.Authorization = defaults;
    await expect(
      client.post('https://public.example/file', {
        headers: { Authorization: request },
        body: { value: 'test' },
      }),
    ).rejects.toMatchObject({ status: 401 });
    defaultHeaders.Authorization = undefined;
    await client.models.list();

    expect(headers.map((value) => value.get('Authorization'))).toEqual([
      'Bearer exchanged-access-token',
      expected,
      'Bearer exchanged-access-token',
    ]);
    expect(exchanges).toBe(1);
  });

  test('reuses cached token across multiple requests', async () => {
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return Response.json(
          {
            access_token: 'exchanged-access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await client.models.list();
    await client.models.list();
    await client.models.list();

    expect(tokenExchangeCallCount).toBe(1);
  });

  test('does not retry 401 errors with streaming request body', async () => {
    let apiCallCount = 0;
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/files')) {
        apiCallCount++;
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    async function* streamGenerator() {
      yield new TextEncoder().encode('test data chunk 1');
      yield new TextEncoder().encode('test data chunk 2');
    }

    await expect(
      client.post('/files', {
        body: streamGenerator(),
      }),
    ).rejects.toThrow();

    expect(apiCallCount).toBe(1);
    expect(tokenExchangeCallCount).toBe(1);
  });

  test('propagates SubjectTokenProviderError', async () => {
    const client = new OpenAI({
      workloadIdentity: {
        identityProviderId: 'test-identity-provider-id',
        serviceAccountId: 'test-service-account-id',
        provider: {
          tokenType: 'jwt',
          getToken: async () => {
            throw new SubjectTokenProviderError('Failed to get token', 'test-provider');
          },
        },
      },
      organization: 'test-org-id',
      project: 'test-project-id',
    });

    await expect(client.models.list()).rejects.toThrow(SubjectTokenProviderError);
  });

  test('propagates OAuthError on token exchange failure', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return Response.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid subject token',
          },
          { status: 400 },
        );
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(client.models.list()).rejects.toThrow(OAuthError);
  });

  test('refreshes expired tokens automatically', async () => {
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return Response.json(
          {
            access_token: `access-token-${tokenExchangeCallCount}`,
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 1,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await client.models.list();

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await client.models.list();

    expect(tokenExchangeCallCount).toBe(2);
  });

  test('withOptions preserves workloadIdentity', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    const newClient = client.withOptions({ timeout: 5000 });

    await newClient.models.list();

    expect(fetch).toHaveBeenCalled();
  });

  test('works with custom subject token provider', async () => {
    let customProviderCallCount = 0;

    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI({
      workloadIdentity: {
        identityProviderId: 'test-identity-provider-id',
        serviceAccountId: 'test-service-account-id',
        provider: {
          tokenType: 'jwt',
          getToken: async () => {
            customProviderCallCount++;
            return `custom-token-${customProviderCallCount}`;
          },
        },
      },
      organization: 'test-org-id',
      project: 'test-project-id',
    });

    await client.models.list();

    expect(customProviderCallCount).toBe(1);
  });

  test('uses client fetch for token exchange', async () => {
    const globalFetchSpy = vi.fn(originalFetch as any);
    global.fetch = globalFetchSpy as typeof fetch;

    const clientFetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI({ ...createTestClientOptions(), fetch: clientFetch });
    await client.models.list();

    expect(clientFetch).toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
