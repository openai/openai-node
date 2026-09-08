/* oxlint-disable eslint/max-classes-per-file -- Separate subclass fixtures cover delegation and custom credential resolution. */
import { vi } from 'vitest';

import OpenAI, { AzureOpenAI, BedrockOpenAI, OpenAIError } from 'openai';
import type { ClientOptions } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const clients = ['OpenAI', 'Azure', 'Bedrock', 'Bedrock admin'] as const;
type ClientKind = (typeof clients)[number];

function clientFor(
  kind: ClientKind,
  apiKey: string | (() => Promise<string>),
  overrides: Pick<ClientOptions, 'fetch' | 'defaultHeaders' | 'maxRetries'>,
): OpenAI {
  const options = {
    baseURL: 'https://credentials.example/v1',
    maxRetries: 0,
    logLevel: 'off' as const,
    ...overrides,
  };
  if (kind === 'Azure') {
    return new AzureOpenAI({
      ...options,
      apiVersion: '2024-10-01-preview',
      ...(typeof apiKey === 'function' ? { azureADTokenProvider: apiKey } : { apiKey }),
    });
  }
  if (kind === 'Bedrock' || kind === 'Bedrock admin') {
    return new BedrockOpenAI({
      ...options,
      ...(typeof apiKey === 'function' ? { bedrockTokenProvider: apiKey } : { apiKey }),
    });
  }
  return new OpenAI({ ...options, apiKey, adminAPIKey: null });
}

function securityFor(kind: ClientKind) {
  return kind === 'Bedrock admin' ? { adminAPIKeyAuth: true } : { bearerAuth: true };
}

function mockFetch() {
  return vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
}

function sentHeaders(fetch: ReturnType<typeof mockFetch>) {
  return fetch.mock.calls.map(([, init]) => new Headers(init?.headers));
}

beforeEach(() => {
  vi.stubEnv('AZURE_OPENAI_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(clients)('%s HTTP credentials', (kind) => {
  test('uses each callback result for its own concurrent request', async () => {
    const provider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('synthetic-first')
      .mockResolvedValueOnce('synthetic-second');
    const fetch = mockFetch();
    const client = clientFor(kind, provider, { fetch });

    await Promise.all([
      client.get('/first', { __security: securityFor(kind) }),
      client.get('/second', { __security: securityFor(kind) }),
    ]);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/v1/first',
      '/v1/second',
    ]);
    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
      'Bearer synthetic-first',
      'Bearer synthetic-second',
    ]);
    expect(client.apiKey).toBe('synthetic-second');
  });

  test('resolves a fresh callback result once per retry attempt', async () => {
    const provider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('synthetic-initial')
      .mockResolvedValueOnce('synthetic-retry');
    const fetch = mockFetch().mockResolvedValueOnce(
      Response.json({ error: { message: 'retry' } }, { status: 429, headers: { 'retry-after-ms': '0' } }),
    );
    const client = clientFor(kind, provider, { fetch, maxRetries: 1 });

    await expect(client.get('/items', { __security: securityFor(kind) })).resolves.toEqual({ ok: true });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
      'Bearer synthetic-initial',
      'Bearer synthetic-retry',
    ]);
    expect(sentHeaders(fetch).map((headers) => headers.get('x-stainless-retry-count'))).toEqual(['0', '1']);
  });

  test('resolves callbacks in direct buildRequest calls', async () => {
    const provider = vi.fn(async () => 'synthetic-direct');
    const fetch = mockFetch();
    const client = clientFor(kind, provider, { fetch });

    const { req } = await client.buildRequest({
      method: 'get',
      path: '/items',
      __security: securityFor(kind),
    });

    expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves updates to a static apiKey between requests', async () => {
    const fetch = mockFetch();
    const client = clientFor(kind, 'synthetic-original', { fetch });

    await client.get('/items', { __security: securityFor(kind) });
    client.apiKey = 'synthetic-updated';
    await client.get('/items', { __security: securityFor(kind) });

    const header = kind === 'Azure' ? 'api-key' : 'authorization';
    const prefix = kind === 'Azure' ? '' : 'Bearer ';
    expect(sentHeaders(fetch).map((headers) => headers.get(header))).toEqual([
      `${prefix}synthetic-original`,
      `${prefix}synthetic-updated`,
    ]);
  });

  test('preserves default, request, and explicit null authorization precedence', async () => {
    const provider = vi.fn(async () => 'synthetic-provider');
    const fetch = mockFetch();
    const client = clientFor(kind, provider, {
      fetch,
      defaultHeaders: { Authorization: 'Bearer synthetic-default' },
    });

    await client.get('/items', { __security: securityFor(kind) });
    await client.get('/items', {
      __security: securityFor(kind),
      headers: { Authorization: 'Bearer synthetic-request' },
    });
    await client.get('/items', {
      __security: securityFor(kind),
      headers: { Authorization: null },
    });

    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
      'Bearer synthetic-default',
      'Bearer synthetic-request',
      null,
    ]);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  test.each([
    {
      name: 'an empty result',
      provider: async () => '',
      message: "Expected 'apiKey' function argument to return a string",
    },
    {
      name: 'a provider error',
      provider: async () => {
        throw new Error('synthetic provider failure');
      },
      message: "Failed to get token from 'apiKey' function",
    },
  ])('rejects $name without dispatch', async ({ provider, message }) => {
    const fetch = mockFetch();
    const client = clientFor(kind, provider, { fetch });

    await expect(client.get('/items', { __security: securityFor(kind) })).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['empty', 'rejected'] as const)(
    'releases an upload iterator after a %s credential without waiting for cleanup',
    async (failure) => {
      const provider = vi.fn(async () => {
        if (failure === 'rejected') {
          throw new Error('synthetic provider failure');
        }
        return '';
      });
      // oxlint-disable-next-line promise/avoid-new -- Pending iterator cleanup must not delay the authentication failure.
      const release = vi.fn(() => new Promise<IteratorResult<Uint8Array>>(() => {}));
      const body = {
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({ done: false, value: new Uint8Array([1]) }),
            return: release,
          };
        },
      };
      const fetch = mockFetch();
      const client = clientFor(kind, provider, { fetch });

      await expect(client.post('/items', { body, __security: securityFor(kind) })).rejects.toThrow(
        failure === 'rejected'
          ? "Failed to get token from 'apiKey' function"
          : "Expected 'apiKey' function argument to return a string",
      );

      expect(release).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

test('preserves the credential failure when upload cleanup throws during a direct build', async () => {
  const failure = new OpenAIError('synthetic provider failure');
  const release = vi.fn(() => {
    throw new Error('synthetic cleanup failure');
  });
  const body = {
    [Symbol.iterator]() {
      return this;
    },
    next: () => ({ done: false, value: new Uint8Array([1]) }),
    return: release,
  };
  const client = new OpenAI({
    apiKey: async () => {
      throw failure;
    },
  });

  await expect(client.buildRequest({ method: 'post', path: '/items', body })).rejects.toBe(failure);
  expect(release).toHaveBeenCalledTimes(1);
});

test('preserves one-argument delegating hooks and resolves credentials after options and body preparation', async () => {
  const events: string[] = [];
  class HookedOpenAI extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      events.push('prepare');
      options.headers = { 'x-prepared': 'yes' };
      await super.prepareOptions(options);
      events.push('prepared');
    }

    override async buildRequest(options: FinalRequestOptions) {
      events.push('build');
      return super.buildRequest(options);
    }

    protected override async authHeaders(options: FinalRequestOptions) {
      events.push('auth');
      const headers = await super.authHeaders(options);
      headers?.values.set('x-auth-hook', 'yes');
      return headers;
    }
  }
  const provider = vi.fn(async () => {
    events.push('credential');
    return 'synthetic-hook';
  });
  const fetch = mockFetch();
  const client = new HookedOpenAI({ apiKey: provider, adminAPIKey: null, fetch });

  await client.post('/items', {
    body: {
      toJSON() {
        events.push('body');
        return { synthetic: true };
      },
    },
  });

  expect(events).toEqual(['prepare', 'prepared', 'build', 'body', 'auth', 'credential']);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-hook');
  expect(sentHeaders(fetch)[0]?.get('x-prepared')).toBe('yes');
  expect(sentHeaders(fetch)[0]?.get('x-auth-hook')).toBe('yes');
  expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"synthetic":true}');
});

test('uses a Bedrock callback once when both security schemes are requested', async () => {
  const provider = vi.fn(async () => 'synthetic-bedrock');
  const fetch = mockFetch();
  const client = clientFor('Bedrock', provider, { fetch });

  await client.get('/items', { __security: { bearerAuth: true, adminAPIKeyAuth: true } });

  expect(provider).toHaveBeenCalledTimes(1);
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-bedrock');
});

test('supports resolver overrides returning concurrent credentials without mutating apiKey', async () => {
  class CustomCredentials extends OpenAI {
    resolutions = 0;

    protected override async resolveAPIKey() {
      this.resolutions += 1;
      return `synthetic-resolved-${this.resolutions}`;
    }
  }
  const fetch = mockFetch();
  const client = new CustomCredentials({ apiKey: 'synthetic-configured', fetch });

  await Promise.all([client.get('/first'), client.get('/second')]);

  expect(client.resolutions).toBe(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-resolved-1',
    'Bearer synthetic-resolved-2',
  ]);
  expect(client.apiKey).toBe('synthetic-configured');
});

test('does not resolve the OpenAI callback for admin-only requests', async () => {
  const provider = vi.fn(async () => {
    throw new Error('unused synthetic provider');
  });
  const fetch = mockFetch();
  const client = new OpenAI({ apiKey: provider, adminAPIKey: 'synthetic-admin', fetch });

  await client.get('/organization/projects', { __security: { adminAPIKeyAuth: true } });

  expect(provider).not.toHaveBeenCalled();
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-admin');
});
