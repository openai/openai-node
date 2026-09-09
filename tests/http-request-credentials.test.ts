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

test.each([
  { kind: 'OpenAI', hook: 'authHeaders' },
  { kind: 'OpenAI', hook: 'bearerAuth' },
  { kind: 'Azure', hook: 'authHeaders' },
  { kind: 'Azure', hook: 'bearerAuth' },
] as const)('honors an initial null assignment in a direct $kind $hook hook', async ({ kind, hook }) => {
  class NullOpenAI extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      if (hook === 'authHeaders') {
        this.apiKey = null;
      }
      return super.authHeaders(options);
    }

    protected override async bearerAuth(options: FinalRequestOptions) {
      if (hook === 'bearerAuth') {
        this.apiKey = null;
      }
      return super.bearerAuth(options);
    }
  }
  class NullAzure extends AzureOpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      if (hook === 'authHeaders') {
        this.apiKey = null;
      }
      return super.authHeaders(options);
    }

    protected override async bearerAuth(options: FinalRequestOptions) {
      if (hook === 'bearerAuth') {
        this.apiKey = null;
      }
      return super.bearerAuth(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const options = { baseURL: 'https://credentials.example/v1', adminAPIKey: null, fetch };
  const client =
    kind === 'Azure'
      ? new NullAzure({ ...options, azureADTokenProvider: provider, apiVersion: '2024-10-01-preview' })
      : new NullOpenAI({ ...options, apiKey: provider });

  await expect(
    client.buildRequest({ method: 'get', path: '/items', __security: { bearerAuth: true } }),
  ).rejects.toThrow('Could not resolve authentication method.');

  expect(client.apiKey).toBeNull();
  expect(provider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('honors an initial null assignment through the Bedrock credential accessor', async () => {
  class NullBedrock extends BedrockOpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      this.apiKey = null;
      return super.authHeaders(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new NullBedrock({
    baseURL: 'https://credentials.example/v1',
    bedrockTokenProvider: provider,
    fetch,
  });

  await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
    'Could not resolve authentication method.',
  );

  expect(client.apiKey).toBeNull();
  expect(provider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('observes null writes after a subclass initializes its own apiKey field', async () => {
  class NullCredentials extends OpenAI {
    override apiKey: string | null = null;

    protected override async authHeaders(options: FinalRequestOptions) {
      this.apiKey = null;
      return super.authHeaders(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const client = new NullCredentials({ apiKey: provider, adminAPIKey: null });

  await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
    'Could not resolve authentication method.',
  );

  expect(provider).not.toHaveBeenCalled();
  expect(client.apiKey).toBeNull();
});

test('preserves a custom credential accessor while observing null writes across direct builds', async () => {
  class NullCredentials extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      this.apiKey = null;
      return super.authHeaders(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const client = new NullCredentials({ apiKey: provider, adminAPIKey: null });
  let value: string | null = null;
  const getter = vi.fn(() => value);
  const setter = vi.fn(function setter(this: OpenAI, nextValue: string | null) {
    expect(this).toBe(client);
    value = nextValue;
  });
  Object.defineProperty(client, 'apiKey', {
    configurable: true,
    enumerable: true,
    get: getter,
    set: setter,
  });

  await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
    'Could not resolve authentication method.',
  );
  expect(setter).toHaveBeenCalledTimes(1);
  await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
    'Could not resolve authentication method.',
  );

  expect(setter).toHaveBeenCalledTimes(2);
  expect(getter).toHaveBeenCalled();
  expect(Object.getOwnPropertyDescriptor(client, 'apiKey')?.get).toBe(getter);
  expect(provider).not.toHaveBeenCalled();
  expect(client.apiKey).toBeNull();
});

test.each(['authHeaders', 'bearerAuth'] as const)(
  'observes null writes through a prototype accessor in a direct %s hook',
  async (hook) => {
    class PrototypeCredentials extends OpenAI {}
    class NullCredentials extends PrototypeCredentials {
      protected override async authHeaders(options: FinalRequestOptions) {
        if (hook === 'authHeaders') {
          this.apiKey = null;
        }
        return super.authHeaders(options);
      }

      protected override async bearerAuth(options: FinalRequestOptions) {
        if (hook === 'bearerAuth') {
          this.apiKey = null;
        }
        return super.bearerAuth(options);
      }
    }
    const values = new WeakMap<OpenAI, string | null>();
    const getter = function getter(this: OpenAI) {
      return values.get(this) ?? null;
    };
    const setter = vi.fn(function setter(this: OpenAI, value: string | null) {
      values.set(this, value);
    });
    Object.defineProperty(PrototypeCredentials.prototype, 'apiKey', {
      get: getter,
      set: setter,
      configurable: true,
      enumerable: false,
    });
    const original = Object.getOwnPropertyDescriptor(PrototypeCredentials.prototype, 'apiKey');
    const provider = vi.fn(async () => 'synthetic-provider');
    const client = new NullCredentials({ apiKey: provider, adminAPIKey: null });
    const sibling = new NullCredentials({ apiKey: provider, adminAPIKey: null });
    Reflect.deleteProperty(client, 'apiKey');
    Reflect.deleteProperty(sibling, 'apiKey');
    values.set(sibling, 'synthetic-sibling');
    setter.mockClear();

    await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
      'Could not resolve authentication method.',
    );
    await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toThrow(
      'Could not resolve authentication method.',
    );

    expect(provider).not.toHaveBeenCalled();
    expect(setter).toHaveBeenCalledTimes(2);
    expect(setter.mock.contexts).toEqual([client, client]);
    expect(Object.getOwnPropertyDescriptor(client, 'apiKey')?.get).toBe(getter);
    expect(Object.getOwnPropertyDescriptor(PrototypeCredentials.prototype, 'apiKey')).toEqual(original);
    expect(Object.getOwnPropertyDescriptor(sibling, 'apiKey')).toBeUndefined();
    expect(sibling.apiKey).toBe('synthetic-sibling');
  },
);

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

test.each(clients)(
  '%s rejects overlapping direct builds with shared options and a pending authentication hook',
  async (kind) => {
    let signalEntered!: () => void;
    let signalRelease!: () => void;
    // oxlint-disable promise/avoid-new -- Pause the first build after it has obtained authentication headers.
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    // oxlint-enable promise/avoid-new
    const seenOptions: FinalRequestOptions[] = [];
    async function afterAuthentication(options: FinalRequestOptions) {
      seenOptions.push(options);
      if (seenOptions.length === 1) {
        signalEntered();
        await release;
      }
    }
    class PausedOpenAI extends OpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        const headers = await super.authHeaders(options, options.__security);
        await afterAuthentication(options);
        return headers;
      }
    }
    class PausedAzure extends AzureOpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        const headers = await super.authHeaders(options, options.__security);
        await afterAuthentication(options);
        return headers;
      }
    }
    class PausedBedrock extends BedrockOpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        const headers = await super.authHeaders(options, options.__security);
        await afterAuthentication(options);
        return headers;
      }
    }
    const provider = vi.fn<() => Promise<string>>().mockResolvedValueOnce('synthetic-first');
    const fetch = mockFetch();
    const clientOptions = { baseURL: 'https://credentials.example/v1', fetch };
    let client: OpenAI;
    if (kind === 'Azure') {
      client = new PausedAzure({
        ...clientOptions,
        azureADTokenProvider: provider,
        apiVersion: '2024-10-01-preview',
      });
    } else if (kind === 'Bedrock' || kind === 'Bedrock admin') {
      client = new PausedBedrock({ ...clientOptions, bedrockTokenProvider: provider });
    } else {
      client = new PausedOpenAI({ ...clientOptions, apiKey: provider, adminAPIKey: null });
    }
    const options: FinalRequestOptions = { method: 'get', path: '/items', __security: securityFor(kind) };

    const first = client.buildRequest(options);
    await entered;
    try {
      await expect(client.buildRequest(options)).rejects.toThrow(
        'overlapping requests that share the same options object',
      );
    } finally {
      signalRelease();
    }
    const built = await first;
    await fetch(built.url, built.req);

    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]).toBe(options);
    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
      'Bearer synthetic-first',
    ]);
    expect(provider).toHaveBeenCalledTimes(1);

    provider.mockResolvedValueOnce('synthetic-second');
    const subsequent = await client.buildRequest(options);
    expect(subsequent.req.headers.get('authorization')).toBe('Bearer synthetic-second');
    expect(provider).toHaveBeenCalledTimes(2);
    expect(seenOptions[1]).toBe(options);
  },
);

test('retires direct-build credentials when authHeaders rejects after delegation', async () => {
  class RejectedHeaders extends OpenAI {
    calls = 0;

    protected override async authHeaders(options: FinalRequestOptions) {
      const headers = await super.authHeaders(options);
      this.calls += 1;
      if (this.calls === 1) {
        throw new Error('synthetic post-authentication failure');
      }
      return headers;
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-failed-build')
    .mockResolvedValueOnce('synthetic-subsequent-build');
  const client = new RejectedHeaders({ apiKey: provider, fetch: mockFetch() });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  await expect(client.buildRequest(options)).rejects.toThrow('synthetic post-authentication failure');
  const { req } = await client.buildRequest(options);

  expect(req.headers.get('authorization')).toBe('Bearer synthetic-subsequent-build');
  expect(provider).toHaveBeenCalledTimes(2);
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

test.each(clients.flatMap((kind) => ['HTTP', 'direct'].map((mode) => ({ kind, mode }))))(
  '$kind $mode ignores unrelated subclass credential helpers',
  async ({ kind, mode }) => {
    const unrelatedHelper = vi.fn(async (_options: FinalRequestOptions) => {
      throw new Error('synthetic unrelated subclass helper');
    });
    class CustomOpenAI extends OpenAI {
      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async prepareAPIKey(options: FinalRequestOptions): Promise<void> {
        await unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async resolvedAPIKey(options: FinalRequestOptions): Promise<string | null> {
        return unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK request validation.
      protected validateOptionsBeforePreparation(options: FinalRequestOptions): void {
        throw new Error(`synthetic unrelated validation helper for ${options.path}`);
      }
    }
    class CustomAzureOpenAI extends AzureOpenAI {
      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async prepareAPIKey(options: FinalRequestOptions): Promise<void> {
        await unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async resolvedAPIKey(options: FinalRequestOptions): Promise<string | null> {
        return unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK request validation.
      protected validateOptionsBeforePreparation(options: FinalRequestOptions): void {
        throw new Error(`synthetic unrelated validation helper for ${options.path}`);
      }
    }
    class CustomBedrockOpenAI extends BedrockOpenAI {
      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async prepareAPIKey(options: FinalRequestOptions): Promise<void> {
        await unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK authentication.
      protected async resolvedAPIKey(options: FinalRequestOptions): Promise<string | null> {
        return unrelatedHelper(options);
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must remain independent of SDK request validation.
      protected validateOptionsBeforePreparation(options: FinalRequestOptions): void {
        throw new Error(`synthetic unrelated validation helper for ${options.path}`);
      }
    }
    const provider = vi.fn(async () => 'synthetic-provider');
    const fetch = mockFetch();
    const options = { baseURL: 'https://credentials.example/v1', fetch, maxRetries: 0 };
    let client: OpenAI;
    if (kind === 'Azure') {
      client = new CustomAzureOpenAI({
        ...options,
        azureADTokenProvider: provider,
        apiVersion: '2024-10-01-preview',
      });
    } else if (kind === 'OpenAI') {
      client = new CustomOpenAI({ ...options, apiKey: provider, adminAPIKey: null });
    } else {
      client = new CustomBedrockOpenAI({ ...options, bedrockTokenProvider: provider });
    }

    if (mode === 'HTTP') {
      await expect(client.get('/items', { __security: securityFor(kind) })).resolves.toEqual({ ok: true });
      expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-provider');
    } else {
      const { req } = await client.buildRequest({
        method: 'get',
        path: '/items',
        __security: securityFor(kind),
      });
      expect(req.headers.get('authorization')).toBe('Bearer synthetic-provider');
      expect(fetch).not.toHaveBeenCalled();
    }

    expect(unrelatedHelper).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
  },
);

test.each(['Azure', 'Bedrock'] as const)(
  '%s construction ignores unrelated subclass credential-hook registration',
  async (kind) => {
    const unrelatedRegistration = vi.fn((_hooks: unknown[]) => {
      throw new Error('synthetic unrelated registration helper');
    });
    class CustomAzureOpenAI extends AzureOpenAI {
      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must not be invoked by the base constructor.
      protected markCredentialHooksSafe(...hooks: unknown[]): void {
        unrelatedRegistration(hooks);
      }
    }
    class CustomBedrockOpenAI extends BedrockOpenAI {
      // oxlint-disable-next-line eslint/class-methods-use-this -- An existing instance helper must not be invoked by the base constructor.
      protected markCredentialHooksSafe(...hooks: unknown[]): void {
        unrelatedRegistration(hooks);
      }
    }
    const provider = vi.fn(async () => 'synthetic-provider');
    const fetch = mockFetch();
    const options = { baseURL: 'https://credentials.example/v1', fetch, maxRetries: 0 };
    const client =
      kind === 'Azure'
        ? new CustomAzureOpenAI({
            ...options,
            azureADTokenProvider: provider,
            apiVersion: '2024-10-01-preview',
          })
        : new CustomBedrockOpenAI({ ...options, bedrockTokenProvider: provider });

    await expect(client.get('/items')).resolves.toEqual({ ok: true });

    expect(unrelatedRegistration).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-provider');
  },
);

test('supports _callApiKey overrides returning concurrent credentials without mutating apiKey', async () => {
  class CustomCredentials extends OpenAI {
    resolutions = 0;

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

test('preserves transformed provider credentials across concurrent requests', async () => {
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new OpenAI({ apiKey: provider, fetch });
  let currentAPIKey: string | null = null;
  Object.defineProperty(client, 'apiKey', {
    get() {
      return currentAPIKey === null ? null : `transformed-${currentAPIKey}`;
    },
    set(value: string | null) {
      currentAPIKey = value;
    },
  });

  await Promise.all([client.get('/first'), client.get('/second')]);

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer transformed-synthetic-first',
    'Bearer transformed-synthetic-second',
  ]);
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

test('preserves post-prepare static keys through transparent _callApiKey overrides', async () => {
  class PreparedCredentials extends OpenAI {
    override async _callApiKey(capture?: (apiKey: string | null) => void) {
      return super._callApiKey((apiKey) => capture?.(apiKey));
    }

    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      this.apiKey = 'synthetic-selected-by-prepare';
    }
  }
  const fetch = mockFetch();
  const client = new PreparedCredentials({ apiKey: 'synthetic-static', fetch });

  await client.get('/items');

  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-selected-by-prepare');
});

test('rejects ambiguous shared-options authentication before sending another request credential', async () => {
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
  await expect(client.request(options)).rejects.toThrow(
    'overlapping requests that share the same options object',
  );
  signalRelease();
  await first;

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-first',
  ]);
});

test('keeps repeated authentication delegation bound after rejecting shared-options overlap', async () => {
  let releaseFirst!: () => void;
  let signalFirstEntered!: () => void;
  // oxlint-disable promise/avoid-new -- This gate overlaps another request between delegations.
  const firstEntered = new Promise<void>((resolve) => {
    signalFirstEntered = resolve;
  });
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  // oxlint-enable promise/avoid-new
  class RepeatedHeaders extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      await super.authHeaders(options);
      signalFirstEntered();
      await firstRelease;
      return super.authHeaders(options);
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new RepeatedHeaders({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  const first = client.request(options);
  await firstEntered;
  await expect(client.request(options)).rejects.toThrow(
    'overlapping requests that share the same options object',
  );
  releaseFirst();
  await first;

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-first',
  ]);
});

test('keeps an active build credential while a shared-options request pauses after preparation', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  let finishFirst!: () => void;
  let signalFirstEntered!: () => void;
  let signalFirstDelegated!: () => void;
  let signalSecondPrepared!: () => void;
  // oxlint-disable promise/avoid-new -- These gates enforce the preparation/build overlap.
  const firstEntered = new Promise<void>((resolve) => {
    signalFirstEntered = resolve;
  });
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstDelegated = new Promise<void>((resolve) => {
    signalFirstDelegated = resolve;
  });
  const firstFinish = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const secondPrepared = new Promise<void>((resolve) => {
    signalSecondPrepared = resolve;
  });
  const secondRelease = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  // oxlint-enable promise/avoid-new
  class PausedPreparation extends OpenAI {
    preparations = 0;
    authentications = 0;

    protected override async prepareOptions(options: FinalRequestOptions) {
      this.preparations += 1;
      await super.prepareOptions(options);
      if (this.preparations === 2) {
        signalSecondPrepared();
        await secondRelease;
      }
    }

    protected override async authHeaders(options: FinalRequestOptions) {
      this.authentications += 1;
      if (this.authentications === 1) {
        signalFirstEntered();
        await firstRelease;
        const headers = await super.authHeaders(options);
        signalFirstDelegated();
        await firstFinish;
        return headers;
      }
      return super.authHeaders(options);
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-second');
  const fetch = mockFetch();
  const client = new PausedPreparation({ apiKey: provider, fetch, maxRetries: 0 });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  const first = client.request(options);
  await firstEntered;
  const second = client.request(options);
  await secondPrepared;
  releaseFirst();
  await firstDelegated;
  releaseSecond();
  await expect(second).rejects.toThrow('overlapping requests that share the same options object');
  finishFirst();
  await first;

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-first',
  ]);
});

test.each([{}, { adminAPIKeyAuth: true }])(
  'allows shared-options direct builds when a custom bearer hook is unused by security %o',
  async (security) => {
    let bearerCalls = 0;
    class UnusedBearerHook extends OpenAI {
      protected override async bearerAuth(options: FinalRequestOptions) {
        bearerCalls += 1;
        return super.bearerAuth(options);
      }
    }
    const client = new UnusedBearerHook({ apiKey: 'synthetic-api', adminAPIKey: 'synthetic-admin' });
    const options: FinalRequestOptions = {
      method: 'get',
      path: '/items',
      __security: security,
      headers: { authorization: security.adminAPIKeyAuth ? undefined : null },
    };

    const [first, second] = await Promise.all([client.buildRequest(options), client.buildRequest(options)]);

    expect(first.req.headers.get('authorization')).toBe(
      security.adminAPIKeyAuth ? 'Bearer synthetic-admin' : null,
    );
    expect(second.req.headers.get('authorization')).toBe(
      security.adminAPIKeyAuth ? 'Bearer synthetic-admin' : null,
    );
    expect(bearerCalls).toBe(0);
  },
);

test('Bedrock request preparation does not rebuild a stateful URL', async () => {
  class StatefulBedrock extends BedrockOpenAI {
    buildURLCalls = 0;

    override buildURL(
      path: string,
      query: Record<string, unknown> | null | undefined,
      defaultBaseURL?: string | undefined,
    ): string {
      this.buildURLCalls += 1;
      if (this.buildURLCalls > 2) {
        throw new Error('synthetic exhausted route');
      }
      return super.buildURL(path, query, defaultBaseURL);
    }
  }
  const client = new StatefulBedrock({
    baseURL: 'https://credentials.example/v1',
    bedrockTokenProvider: async () => 'synthetic-provider',
    fetch: mockFetch(),
  });

  await expect(client.get('/items')).resolves.toEqual({ ok: true });
  expect(client.buildURLCalls).toBe(2);
});

describe.each(['request', 'direct build'] as const)('%s post-delegation credentials', (entrypoint) => {
  test.each(['transform', 'clear', 'explicit capture'] as const)(
    'preserves a _callApiKey override that uses %s',
    async (behavior) => {
      class PostDelegationCredentials extends OpenAI {
        override async _callApiKey(capture?: (apiKey: string | null) => void) {
          const result = await super._callApiKey(capture);
          if (behavior === 'explicit capture') {
            capture?.('synthetic-explicit');
          }
          this.apiKey = behavior === 'clear' ? null : 'synthetic-transformed';
          return result;
        }
      }
      const provider = vi.fn(async () => 'synthetic-provider');
      const fetch = mockFetch();
      const client = new PostDelegationCredentials({ apiKey: provider, adminAPIKey: null, fetch });
      const getHeaders = async () => {
        if (entrypoint === 'request') {
          await client.get('/items');
          return sentHeaders(fetch)[0];
        }
        const built = await client.buildRequest({ method: 'get', path: '/items' });
        return built.req.headers;
      };

      if (behavior === 'clear') {
        await expect(getHeaders()).rejects.toThrow('Could not resolve authentication method.');
        expect(fetch).not.toHaveBeenCalled();
      } else {
        const headers = await getHeaders();
        expect(headers?.get('authorization')).toBe(
          behavior === 'explicit capture' ? 'Bearer synthetic-explicit' : 'Bearer synthetic-transformed',
        );
      }
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  test('keeps concurrent credentials through transparent _callApiKey forwarding', async () => {
    class DelegatingCredentials extends OpenAI {
      override async _callApiKey(capture?: (apiKey: string | null) => void) {
        const result = await super._callApiKey(capture);
        return result;
      }
    }
    const provider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('synthetic-first')
      .mockResolvedValueOnce('synthetic-second');
    const fetch = mockFetch();
    const client = new DelegatingCredentials({ apiKey: provider, fetch });
    let headers: Headers[];
    if (entrypoint === 'request') {
      await Promise.all([client.get('/first'), client.get('/second')]);
      headers = sentHeaders(fetch);
    } else {
      const built = await Promise.all([
        client.buildRequest({ method: 'get', path: '/first' }),
        client.buildRequest({ method: 'get', path: '/second' }),
      ]);
      headers = built.map(({ req }) => req.headers);
    }

    expect(provider).toHaveBeenCalledTimes(2);
    expect(headers.map((value) => value.get('authorization'))).toEqual([
      'Bearer synthetic-first',
      'Bearer synthetic-second',
    ]);
  });
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

test('preserves credentials supplied by prepareOptions without delegation', async () => {
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

test('preserves a preparation hook key after another request resolves its credential', async () => {
  class PreparedCredentials extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      if (options.path === '/outer') {
        await this.get('/inner');
        this.apiKey = 'synthetic-prepared';
      }
    }
  }
  const provider = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-outer')
    .mockResolvedValueOnce('synthetic-inner');
  const fetch = mockFetch();
  const client = new PreparedCredentials({ apiKey: provider, fetch });

  await client.get('/outer');

  expect(provider).toHaveBeenCalledTimes(2);
  expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
    'Bearer synthetic-inner',
    'Bearer synthetic-prepared',
  ]);
});

test.each(['static', 'function'] as const)(
  'preserves %s key updates in authentication hooks',
  async (kind) => {
    class HeaderCredentials extends OpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        this.apiKey = 'synthetic-header-hook';
        return super.authHeaders(options);
      }
    }
    const fetch = mockFetch();
    const client = new HeaderCredentials({
      apiKey: kind === 'static' ? 'synthetic-initial' : async () => 'synthetic-provider',
      fetch,
    });

    await client.get('/items');

    expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-header-hook');
  },
);

test.each(['static', 'function'] as const)('preserves %s key updates in buildURL overrides', async (kind) => {
  class RoutingClient extends OpenAI {
    override buildURL(
      path: string,
      query: Record<string, unknown> | null | undefined,
      defaultBaseURL?: string,
    ) {
      this.apiKey = 'synthetic-routing-hook';
      return super.buildURL(path, query, defaultBaseURL);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new RoutingClient({
    apiKey: kind === 'static' ? 'synthetic-static' : provider,
    fetch,
  });

  await client.get('/items');

  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-routing-hook');
  expect(provider).toHaveBeenCalledTimes(kind === 'static' ? 0 : 1);
});

test.each(['success', 'preparation failure', 'build failure', 'request hook failure'] as const)(
  'retires prepared credentials after %s',
  async (outcome) => {
    class PreparedCredentials extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        await super.prepareOptions(options);
        if (outcome === 'preparation failure') {
          throw new Error('synthetic preparation failure');
        }
      }

      protected override async prepareRequest(
        request: RequestInit,
        context: { url: string; options: FinalRequestOptions },
      ) {
        await super.prepareRequest(request, context);
        if (outcome === 'request hook failure') {
          throw new Error('synthetic request hook failure');
        }
      }
    }
    let resolutions = 0;
    const provider = vi.fn(async () => {
      resolutions += 1;
      return `synthetic-${resolutions}`;
    });
    const client = new PreparedCredentials({ apiKey: provider, fetch: mockFetch() });
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/items',
      body: {
        toJSON() {
          if (outcome === 'build failure') {
            throw new Error('synthetic build failure');
          }
          return { synthetic: true };
        },
      },
    };

    await (outcome === 'success'
      ? client.request(options)
      : expect(client.request(options)).rejects.toThrow(`synthetic ${outcome}`));
    delete options.body;
    const { req } = await client.buildRequest(options);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(req.headers.get('authorization')).toBe('Bearer synthetic-2');
  },
);

test('preserves authentication delegated from prepareRequest without resolving twice', async () => {
  class PreparedRequest extends OpenAI {
    protected override async prepareRequest(
      request: RequestInit,
      context: { url: string; options: FinalRequestOptions },
    ) {
      const authentication = await this.authHeaders(context.options);
      if (authentication) {
        request.headers = authentication.values;
      }
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new PreparedRequest({ apiKey: provider, fetch });

  await client.get('/items');

  expect(provider).toHaveBeenCalledTimes(1);
  expect(sentHeaders(fetch)[0]?.get('authorization')).toBe('Bearer synthetic-provider');
});

test('keeps preparation alive while a nested request builds with the same options', async () => {
  class NestedRequest extends OpenAI {
    builds = 0;

    override async buildRequest(options: FinalRequestOptions) {
      this.builds += 1;
      if (this.builds === 1) {
        await this.request(options);
      }
      return super.buildRequest(options);
    }
  }
  const provider = vi.fn(async () => 'synthetic-provider');
  const fetch = mockFetch();
  const client = new NestedRequest({ apiKey: provider, fetch });
  const options: FinalRequestOptions = { method: 'get', path: '/items' };

  await client.request(options);

  expect(provider).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  await client.buildRequest(options);
  expect(provider).toHaveBeenCalledTimes(3);
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

function preparationGate() {
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- Gates select the order of asynchronous hook delegation.
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('delayed credential preparation', () => {
  test.each([true, false])('handles pre-delegation overlap with shared options: %s', async (shared) => {
    const entered = [preparationGate(), preparationGate()] as const;
    const releases = [preparationGate(), preparationGate()] as const;
    const seenOptions: FinalRequestOptions[] = [];
    class DelayedPreparation extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        const index = seenOptions.push(options) - 1;
        if (index === 0 || index === 1) {
          entered[index].release();
          await releases[index].promise;
        }
        return super.prepareOptions(options);
      }
    }
    const provider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('synthetic-first')
      .mockResolvedValueOnce('synthetic-second')
      .mockResolvedValueOnce('synthetic-third');
    const fetch = mockFetch();
    const client = new DelayedPreparation({ apiKey: provider, fetch, maxRetries: 0 });
    const options: FinalRequestOptions = { method: 'get', path: '/items' };
    const secondOptions = shared ? options : { ...options };

    const first = client.request(options);
    await entered[0].promise;
    const second = client.request(secondOptions);
    await entered[1].promise;
    releases[0].release();
    try {
      if (shared) {
        await expect(first).rejects.toThrow('overlapping requests that share the same options object');
        expect(provider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } else {
        await first;
        expect(provider).toHaveBeenCalledTimes(1);
      }
    } finally {
      releases[1].release();
      await second;
    }
    await client.request(options);

    expect(seenOptions[0]).toBe(options);
    expect(seenOptions[1]).toBe(secondOptions);
    expect(provider).toHaveBeenCalledTimes(shared ? 2 : 3);
    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual(
      shared
        ? ['Bearer synthetic-first', 'Bearer synthetic-second']
        : ['Bearer synthetic-first', 'Bearer synthetic-second', 'Bearer synthetic-third'],
    );
  });

  test('preserves shared-options captures when preparation delegates synchronously', async () => {
    class DelegatingPreparation extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        await super.prepareOptions(options);
      }
    }
    const provider = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('synthetic-first')
      .mockResolvedValueOnce('synthetic-second');
    const fetch = mockFetch();
    const client = new DelegatingPreparation({ apiKey: provider, fetch, maxRetries: 0 });
    const options: FinalRequestOptions = { method: 'get', path: '/items' };

    await Promise.all([client.request(options), client.request(options)]);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(sentHeaders(fetch).map((headers) => headers.get('authorization'))).toEqual([
      'Bearer synthetic-first',
      'Bearer synthetic-second',
    ]);
  });
});
