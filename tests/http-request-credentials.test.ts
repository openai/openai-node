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
    'rejects a %s credential before starting an upload iterator',
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

      expect(release).not.toHaveBeenCalled();
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

test('preserves one-argument delegating hooks and resolves credentials through options preparation', async () => {
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

  expect(events).toEqual(['prepare', 'credential', 'prepared', 'build', 'body', 'auth']);
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

test('supports _callApiKey overrides returning concurrent credentials without mutating apiKey', async () => {
  class CustomCredentials extends OpenAI {
    resolutions = 0;

    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
    }

    override async _callApiKey(capture?: (apiKey: string | null) => void) {
      this.resolutions += 1;
      capture?.(`synthetic-resolved-${this.resolutions}`);
      return true;
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

test('treats transformed base callbacks as request-local credential captures', async () => {
  class TransformedCredentials extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
    }

    override async _callApiKey(capture?: (apiKey: string | null) => void) {
      return super._callApiKey((apiKey) => {
        this.apiKey = `transformed-${apiKey}`;
        capture?.(this.apiKey);
      });
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new TransformedCredentials({ apiKey: provider, fetch });

  await Promise.all([client.get('/first'), client.get('/second')]);

  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer transformed-synthetic-first',
    'Bearer transformed-synthetic-second',
  ]);
});

test('keeps prepared credentials through overlapping async hooks sharing options', async () => {
  let signalEntered!: () => void;
  let signalRelease!: () => void;
  // oxlint-disable promise/avoid-new -- These gates enforce the shared-options overlap.
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    signalRelease = resolve;
  });
  // oxlint-enable promise/avoid-new
  class PausedHeaders extends OpenAI {
    calls = 0;

    protected override async authHeaders(options: FinalRequestOptions) {
      this.calls += 1;
      if (this.calls === 1) {
        signalEntered();
        await release;
      }
      return super.authHeaders(options);
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new PausedHeaders({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  const first = client.request(options);
  await entered;
  await client.request(options);
  signalRelease();
  await first;

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-second',
    'Bearer synthetic-first',
  ]);
});

test('preserves apiKey assignments after delegated prepareOptions', async () => {
  class PreparedCredentials extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      this.apiKey = `synthetic-prepared-${options.path}`;
    }
  }
  const fetch = mockFetch();
  const client = new PreparedCredentials({ apiKey: async () => 'synthetic-provider', fetch });

  await client.get('/items');

  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-prepared-/items');
});

test('preserves concurrent post-super prepareOptions assignments', async () => {
  let signalFirstPrepared!: () => void;
  let signalSecondPrepared!: () => void;
  let signalFirstFetched!: () => void;
  // oxlint-disable promise/avoid-new -- Each gate controls an intentional hook interleaving.
  const firstPrepared = new Promise<void>((resolve) => {
    signalFirstPrepared = resolve;
  });
  const secondPrepared = new Promise<void>((resolve) => {
    signalSecondPrepared = resolve;
  });
  const firstFetched = new Promise<void>((resolve) => {
    signalFirstFetched = resolve;
  });
  // oxlint-enable promise/avoid-new
  class PreparedCredentials extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      if (options.path === '/first') {
        signalFirstPrepared();
        await secondPrepared;
      } else {
        signalSecondPrepared();
        await firstFetched;
      }
      this.apiKey = `synthetic-prepared-${options.path}`;
    }
  }
  const fetch = vi.fn(async (url: RequestInfo, _init?: RequestInit) => {
    if (new URL(String(url)).pathname.endsWith('/first')) {
      signalFirstFetched();
    }
    return Response.json({ ok: true });
  });
  const client = new PreparedCredentials({ apiKey: async () => 'synthetic-provider', fetch });

  const first = client.get('/first');
  await firstPrepared;
  const second = client.get('/second');
  await Promise.all([first, second]);

  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-prepared-/first',
    'Bearer synthetic-prepared-/second',
  ]);
});

test('preserves nondelegating prepareOptions credential assignments', async () => {
  class PreparedCredentials extends OpenAI {
    protected override async prepareOptions() {
      this.apiKey = 'synthetic-prepared';
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new PreparedCredentials({ apiKey: provider, fetch });

  await client.get('/items');

  expect(provider).not.toHaveBeenCalled();
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-prepared');
});

test('preserves credential assignments made by a delegating authHeaders hook', async () => {
  class HeaderCredentials extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      this.apiKey = 'synthetic-auth-hook';
      return super.authHeaders(options);
    }
  }
  const fetch = mockFetch();
  const client = new HeaderCredentials({ apiKey: async () => 'synthetic-provider', fetch });

  await client.get('/items');

  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-auth-hook');
});

test('preserves authHeaders credential assignments in a direct build', async () => {
  class HeaderCredentials extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      this.apiKey = 'synthetic-auth-hook';
      return super.authHeaders(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const client = new HeaderCredentials({ apiKey: provider });

  const { req } = await client.buildRequest({ method: 'get', path: '/items' });

  expect(provider).not.toHaveBeenCalled();
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-auth-hook');
});

test('reuses a prepared credential through a delegating buildRequest clone', async () => {
  class ClonedOptions extends OpenAI {
    override async buildRequest(
      options: FinalRequestOptions,
      properties?: Parameters<OpenAI['buildRequest']>[1],
    ) {
      return super.buildRequest({ ...options }, properties);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new ClonedOptions({ apiKey: provider, fetch });

  await client.get('/items');

  expect(provider).toHaveBeenCalledTimes(1);
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-provider');
});

test('resolves a direct credential through a transparent buildRequest override', async () => {
  class DelegatingBuild extends OpenAI {
    override async buildRequest(options: FinalRequestOptions) {
      return super.buildRequest(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const client = new DelegatingBuild({ apiKey: provider });

  const { req } = await client.buildRequest({ method: 'get', path: '/items' });

  expect(provider).toHaveBeenCalledTimes(1);
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-provider');
});

test('does not transfer a prepared credential through a build delegated to another client', async () => {
  const backend = new OpenAI({ apiKey: 'synthetic-backend' });
  class DelegatingBuild extends OpenAI {
    // oxlint-disable-next-line eslint/class-methods-use-this -- This fixture deliberately delegates to another client.
    override async buildRequest(options: FinalRequestOptions) {
      return backend.buildRequest(options);
    }
  }
  const fetch = mockFetch();
  const client = new DelegatingBuild({ apiKey: 'synthetic-frontend', fetch });

  await client.get('/items');

  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-backend');
});

test('isolates cloned builds when request proxies reject private metadata', async () => {
  class ClonedOptions extends OpenAI {
    override async buildRequest(
      options: FinalRequestOptions,
      properties?: Parameters<OpenAI['buildRequest']>[1],
    ) {
      return super.buildRequest({ ...options }, properties);
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new ClonedOptions({ apiKey: provider, fetch });
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- This helper is local to the proxy scenario.
  const options = (path: string) =>
    new Proxy<FinalRequestOptions>(
      { method: 'get', path },
      {
        defineProperty(target, property, attributes) {
          return typeof property === 'symbol' ? false : Reflect.defineProperty(target, property, attributes);
        },
      },
    );

  await Promise.all([client.request(options('/first')), client.request(options('/second'))]);

  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-first',
    'Bearer synthetic-second',
  ]);
});

test('retires prepared credentials after a request before a direct build', async () => {
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-request')
    .mockResolvedValueOnce('synthetic-direct');
  const fetch = mockFetch();
  const client = new OpenAI({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  await client.request(options);
  const { req } = await client.buildRequest(options);

  expect(provider).toHaveBeenCalledTimes(2);
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
});

test('serializes credential preparation for concurrent calls sharing one options object', async () => {
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new OpenAI({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  await Promise.all([client.request(options), client.request(options)]);

  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-first',
    'Bearer synthetic-second',
  ]);
});

test('allows a prepareOptions hook to await a nested request with the same options', async () => {
  class ReentrantPreparation extends OpenAI {
    nested = false;

    protected override async prepareOptions(options: FinalRequestOptions) {
      if (!this.nested) {
        this.nested = true;
        await this.request(options);
      }
      await super.prepareOptions(options);
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-nested')
    .mockResolvedValueOnce('synthetic-outer');
  const fetch = mockFetch();
  const client = new ReentrantPreparation({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  await client.request(options);

  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-nested',
    'Bearer synthetic-outer',
  ]);
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
