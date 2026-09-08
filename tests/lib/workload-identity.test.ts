import { vi } from 'vitest';
import OpenAI, { OAuthError, SubjectTokenProviderError } from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';

const originalFetch = global.fetch;

const createTestWorkloadIdentity = () => ({
  identityProviderId: 'test-identity-provider-id',
  serviceAccountId: 'test-service-account-id',
  provider: {
    tokenType: 'jwt' as const,
    getToken: async () => 'subject-token',
  },
});

const createTestClientOptions = () => ({
  workloadIdentity: createTestWorkloadIdentity(),
  organization: 'test-org-id',
  project: 'test-project-id',
});

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

    await client.models.list();

    expect(apiRequestHeaders).toBeDefined();
    expect(apiRequestHeaders!.get('Authorization')).toBe('Bearer exchanged-access-token');
  });

  test.each([
    ['default null', { Authorization: null }, undefined, null],
    ['default empty', { Authorization: '' }, undefined, ''],
    ['request null', undefined, { Authorization: null }, null],
    ['request empty', undefined, { Authorization: '' }, ''],
    ['request null over default', { Authorization: 'Bearer default' }, { aUtHoRiZaTiOn: null }, null],
    ['request empty over default', { Authorization: 'Bearer default' }, { authorization: '' }, ''],
    ['default replacement', { Authorization: 'Bearer replacement' }, undefined, 'Bearer replacement'],
    [
      'request replacement',
      { Authorization: null },
      { Authorization: 'Bearer replacement' },
      'Bearer replacement',
    ],
    ['default undefined', { Authorization: undefined }, undefined, 'Bearer exchanged-access-token'],
    [
      'request undefined',
      { Authorization: 'Bearer default' },
      { Authorization: undefined },
      'Bearer default',
    ],
    ['native empty', undefined, new Headers({ Authorization: '' }), ''],
    [
      'workload placeholder',
      undefined,
      { Authorization: 'Bearer workload-identity-auth' },
      'Bearer exchanged-access-token',
    ],
  ] as const)('preserves merged Authorization: %s', async (_name, defaultHeaders, headers, expected) => {
    const authorizations: (string | null)[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString() === 'https://auth.openai.com/oauth/token') {
        return Response.json({
          access_token: 'exchanged-access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (url.toString() === 'https://api.openai.com/v1/models') {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      }
      throw new Error('Unexpected request');
    }) as typeof fetch;

    const client = new OpenAI({ ...createTestClientOptions(), defaultHeaders });
    await client.get('/models', { headers });
    // Repeat with the credential cache populated by the first request.
    await client.get('/models', { headers });

    expect(authorizations).toEqual([expected, expected]);
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

  test('handles 401 response by invalidating token and retrying', async () => {
    let apiCallCount = 0;
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
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        apiCallCount++;
        if (apiCallCount === 1) {
          return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
        }
        return Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    const result = await client.models.list();

    expect(result).toBeDefined();
    expect(apiCallCount).toBe(2);
    expect(tokenExchangeCallCount).toBe(2);
  });

  test('only retries once for 401 errors', async () => {
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

      if (urlStr.includes('/models')) {
        apiCallCount++;
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(client.models.list()).rejects.toThrow();

    expect(apiCallCount).toBe(2);
    expect(tokenExchangeCallCount).toBe(2);
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
