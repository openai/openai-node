/* oxlint-disable eslint/max-classes-per-file -- Separate subclasses exercise independent protected-hook contracts. */
import { vi } from 'vitest';
import OpenAI, { AzureOpenAI, BedrockOpenAI } from 'openai';
import type { ClientOptions } from 'openai';
import type { FinalRequestOptions } from 'openai/internal/request-options';

interface CredentialResponse {
  authorization: string | null;
}

function echoAuthorization() {
  return vi.fn<NonNullable<ClientOptions['fetch']>>(async (_url, init) =>
    Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe.each(['OpenAI', 'Azure AD', 'legacy Bedrock'] as const)('%s HTTP credentials', (surface) => {
  function create(apiKey: string | (() => Promise<string>)) {
    const options = { fetch: echoAuthorization(), maxRetries: 0 };
    if (surface === 'Azure AD') {
      // Explicit undefined removes any inherited Azure credential.
      // oxlint-disable-next-line unicorn/no-useless-undefined
      vi.stubEnv('AZURE_OPENAI_API_KEY', undefined);
      return new AzureOpenAI({
        ...options,
        baseURL: 'https://azure.example/openai',
        apiVersion: '2024-10-01-preview',
        ...(typeof apiKey === 'function' ? { azureADTokenProvider: apiKey } : { apiKey }),
      });
    }
    if (surface === 'legacy Bedrock') {
      return new BedrockOpenAI({
        ...options,
        baseURL: 'https://bedrock.example/openai/v1',
        ...(typeof apiKey === 'function' ? { bedrockTokenProvider: apiKey } : { apiKey }),
      });
    }
    return new OpenAI({ ...options, apiKey });
  }

  test('keeps simultaneously resolved credentials with their requests', async () => {
    let calls = 0;
    const client = create(async () => {
      calls += 1;
      return `synthetic-token-${calls}`;
    });
    const responses = await Promise.all([
      client.get<CredentialResponse>('/first'),
      client.get<CredentialResponse>('/second'),
    ]);
    expect(responses.map(({ authorization }) => authorization)).toEqual([
      'Bearer synthetic-token-1',
      'Bearer synthetic-token-2',
    ]);
    expect(calls).toBe(2);
    expect(client.apiKey).toBe('synthetic-token-2');
  });

  test('preserves an explicit request authorization header', async () => {
    const client = create(async () => 'synthetic-provider-token');
    await expect(
      client.get<CredentialResponse>('/items', {
        headers: { Authorization: 'Bearer synthetic-explicit-token' },
      }),
    ).resolves.toEqual({ authorization: 'Bearer synthetic-explicit-token' });
  });

  test('keeps credentials with their requests when providers resolve in reverse order', async () => {
    const resolutions: ((value: string) => void)[] = [];
    const client = create(
      () =>
        // oxlint-disable-next-line promise/avoid-new -- The test controls the order of provider settlement.
        new Promise<string>((resolve) => {
          resolutions.push(resolve);
        }),
    );
    const first = client.get<CredentialResponse>('/first');
    const second = client.get<CredentialResponse>('/second');
    await vi.waitFor(() => expect(resolutions).toHaveLength(2));
    const [resolveFirst, resolveSecond] = resolutions;
    if (!resolveFirst || !resolveSecond) {
      throw new Error('Expected both credential providers to start');
    }
    resolveSecond('synthetic-second');
    resolveFirst('synthetic-first');

    expect(await Promise.all([first, second])).toEqual([
      { authorization: 'Bearer synthetic-first' },
      { authorization: 'Bearer synthetic-second' },
    ]);
    expect(client.apiKey).toBe('synthetic-first');
  });
});

test.each(['forward', 'omit', 'reconstruct'] as const)(
  'isolates requests sharing options when an asynchronous cloning builder uses %s props',
  async (mode) => {
    class CloningClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        await Promise.resolve();
        if (mode === 'omit') {
          return super.buildRequest({ ...args[0] });
        }
        return super.buildRequest(
          { ...args[0] },
          mode === 'forward' ? { ...args[1] } : { retryCount: args[1]?.retryCount ?? 0 },
        );
      }
    }
    let calls = 0;
    const client = new CloningClient({
      apiKey: async () => {
        calls += 1;
        return `synthetic-token-${calls}`;
      },
      fetch: echoAuthorization(),
      maxRetries: 0,
    });
    const options: FinalRequestOptions = { method: 'get', path: '/items' };
    const responses = await Promise.all([
      client.request<CredentialResponse>(options),
      client.request<CredentialResponse>(options),
    ]);
    expect(responses.map(({ authorization }) => authorization)).toEqual([
      'Bearer synthetic-token-1',
      'Bearer synthetic-token-2',
    ]);
    expect(calls).toBe(2);
  },
);

test('constructs authentication after a custom builder rewrites the request path', async () => {
  class RewritingClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      return super.buildRequest({ ...args[0], path: '/rewritten' }, args[1]);
    }

    protected override async authHeaders(
      options: FinalRequestOptions,
      schemes?: FinalRequestOptions['__security'],
    ) {
      const headers = await super.authHeaders(options, schemes);
      headers?.values.set('X-Synthetic-Signed-Path', options.path);
      return headers;
    }
  }
  const apiKey = vi.fn(async () => 'synthetic-key');
  const fetch = vi.fn<NonNullable<ClientOptions['fetch']>>(async (url, init) =>
    Response.json({
      path: new URL(String(url)).pathname,
      signedPath: new Headers(init?.headers).get('X-Synthetic-Signed-Path'),
    }),
  );
  const client = new RewritingClient({ apiKey, fetch, baseURL: 'https://example.test' });
  await expect(client.get('/original')).resolves.toEqual({ path: '/rewritten', signedPath: '/rewritten' });
  expect(apiKey).toHaveBeenCalledTimes(1);
});

test('constructs Azure authentication after deployment routing on every retry', async () => {
  const paths: string[] = [];
  class AzureSigningClient extends AzureOpenAI {
    protected override async authHeaders(
      options: FinalRequestOptions,
      schemes?: FinalRequestOptions['__security'],
    ) {
      paths.push(options.path);
      return super.authHeaders(options, schemes);
    }
  }
  // Explicit undefined removes any inherited Azure credential.
  // oxlint-disable-next-line unicorn/no-useless-undefined
  vi.stubEnv('AZURE_OPENAI_API_KEY', undefined);
  const azureADTokenProvider = vi.fn(async () => 'synthetic-token');
  const fetch = echoAuthorization().mockResolvedValueOnce(
    Response.json({}, { status: 429, headers: { 'retry-after-ms': '0' } }),
  );
  const client = new AzureSigningClient({
    endpoint: 'https://azure.example',
    apiVersion: '2024-10-01-preview',
    azureADTokenProvider,
    fetch,
    maxRetries: 1,
  });
  await client.post('/chat/completions', { body: { model: 'synthetic-model' } });
  expect(paths).toEqual([
    '/deployments/synthetic-model/chat/completions',
    '/deployments/synthetic-model/chat/completions',
  ]);
  expect(azureADTokenProvider).toHaveBeenCalledTimes(2);
});

test('uses authentication schemes selected by the request builder', async () => {
  class AdminBuilderClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      return super.buildRequest({ ...args[0], __security: { adminAPIKeyAuth: true } }, args[1]);
    }
  }
  const apiKey = vi.fn(async () => 'synthetic-unused');
  const client = new AdminBuilderClient({
    apiKey,
    adminAPIKey: 'synthetic-admin',
    fetch: echoAuthorization(),
  });
  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-admin' });
  expect(apiKey).not.toHaveBeenCalled();
});

test('lets replacement builders resolve authentication explicitly, including retries and failures', async () => {
  const builtWith: (string | null)[] = [];
  class CustomBuilderClient extends OpenAI {
    override async buildRequest(options: FinalRequestOptions) {
      const authentication = await this.authHeaders(options, options.__security ?? { bearerAuth: true });
      const headers = authentication?.values ?? new Headers();
      builtWith.push(headers.get('authorization'));
      return {
        req: { method: options.method, headers },
        url: this.buildURL(options.path, null),
        timeout: this.timeout,
      };
    }
  }
  const failure = new Error('synthetic provider failure');
  const apiKey = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('synthetic-first')
    .mockResolvedValueOnce('synthetic-retry')
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce('synthetic-next');
  const fetch = echoAuthorization().mockResolvedValueOnce(
    Response.json({}, { status: 429, headers: { 'retry-after-ms': '0' } }),
  );
  const client = new CustomBuilderClient({ apiKey, fetch, maxRetries: 1 });

  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-retry' });
  await expect(client.get('/items')).rejects.toMatchObject({ cause: failure });
  expect(builtWith).toEqual(['Bearer synthetic-first', 'Bearer synthetic-retry']);
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-next' });
  expect(builtWith).toEqual(['Bearer synthetic-first', 'Bearer synthetic-retry', 'Bearer synthetic-next']);
  expect(apiKey).toHaveBeenCalledTimes(4);
});

test('refreshes the provider exactly once per HTTP retry attempt', async () => {
  let calls = 0;
  const apiKey = vi.fn(async () => {
    calls += 1;
    return `synthetic-token-${calls}`;
  });
  const fetch = echoAuthorization().mockResolvedValueOnce(
    Response.json({}, { status: 429, headers: { 'retry-after-ms': '0' } }),
  );
  const client = new OpenAI({ apiKey, fetch, maxRetries: 1 });

  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-token-2' });
  expect(apiKey).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'))).toEqual([
    'Bearer synthetic-token-1',
    'Bearer synthetic-token-2',
  ]);
});

test('sends nothing after a provider failure and resolves a fresh key on the next request', async () => {
  const failure = new Error('synthetic provider failure');
  const apiKey = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue('synthetic-key');
  const fetch = echoAuthorization();
  const client = new OpenAI({ apiKey, fetch, maxRetries: 1 });

  await expect(client.get('/items')).rejects.toMatchObject({ cause: failure });
  expect(apiKey).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-key' });
  expect(apiKey).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('observes static key changes and preserves explicit null authentication', async () => {
  const client = new OpenAI({ apiKey: 'synthetic-first', fetch: echoAuthorization() });
  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-first' });
  client.apiKey = 'synthetic-second';
  await expect(client.get('/items')).resolves.toEqual({ authorization: 'Bearer synthetic-second' });
  client.apiKey = null;
  await expect(client.get('/items', { headers: { Authorization: null } })).resolves.toEqual({
    authorization: null,
  });
});

test('leaves an async iterable body untouched when credential resolution fails', async () => {
  let started = false;
  let closed = false;
  async function* chunks() {
    started = true;
    try {
      yield new TextEncoder().encode('first');
      yield new TextEncoder().encode('second');
    } finally {
      closed = true;
    }
  }
  const body = chunks();
  const apiKey = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('synthetic provider failure'))
    .mockResolvedValue('synthetic-key');
  const fetch = vi.fn<NonNullable<ClientOptions['fetch']>>(async (_url, init) =>
    Response.json({ body: await new Response(init?.body).text() }),
  );
  const client = new OpenAI({ apiKey, fetch, maxRetries: 0 });

  await expect(client.post('/items', { body })).rejects.toThrow('synthetic provider failure');
  expect(started).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.post('/items', { body })).resolves.toEqual({ body: 'firstsecond' });
  expect(closed).toBe(true);
});

test.each([
  [{}, 'Bearer synthetic-default'],
  [{ Authorization: 'Bearer synthetic-explicit' }, 'Bearer synthetic-explicit'],
  [{ Authorization: null }, null],
] as const)('preserves default and request header precedence for %j', async (headers, authorization) => {
  const apiKey = vi.fn(async () => 'synthetic-provider');
  const client = new OpenAI({
    apiKey,
    fetch: echoAuthorization(),
    defaultHeaders: { Authorization: 'Bearer synthetic-default' },
  });
  await expect(client.get('/items', { headers })).resolves.toEqual({ authorization });
  expect(apiKey).toHaveBeenCalledTimes(1);
});

test('preserves async preparation mutations, options identity, and forwarding authentication hooks', async () => {
  const observed: FinalRequestOptions[] = [];
  const apiKey = vi.fn(async () => 'synthetic-provider');
  class HookClient extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      expect(apiKey).not.toHaveBeenCalled();
      observed.push(options);
      options.body = { prepared: true };
      options.headers = { 'X-Synthetic-Prepared': 'yes' };
    }

    protected override async authHeaders(
      options: FinalRequestOptions,
      schemes?: FinalRequestOptions['__security'],
    ) {
      await Promise.resolve();
      observed.push(options);
      const headers = await super.authHeaders(options, schemes);
      await Promise.resolve();
      return headers;
    }
  }
  const fetch = echoAuthorization();
  const client = new HookClient({ apiKey, fetch });
  const options: FinalRequestOptions = { method: 'post', path: '/items', body: { prepared: false } };
  await expect(client.request(options)).resolves.toEqual({ authorization: 'Bearer synthetic-provider' });
  expect(observed).toHaveLength(2);
  expect(observed.every((value) => value === options)).toBe(true);
  expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"prepared":true}');
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-synthetic-prepared')).toBe('yes');
  expect(apiKey).toHaveBeenCalledTimes(1);
});

test('resolves callback credentials during direct buildRequest without fetching', async () => {
  const apiKey = vi.fn(async () => 'synthetic-direct');
  const fetch = echoAuthorization();
  const client = new OpenAI({ apiKey, fetch });
  expect(apiKey).not.toHaveBeenCalled();
  const { req } = await client.buildRequest({ method: 'get', path: '/items' });
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
  expect(apiKey).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('does not resolve the ordinary API-key provider for an OpenAI admin-only route', async () => {
  const apiKey = vi.fn(async () => 'synthetic-unused');
  const client = new OpenAI({ apiKey, adminAPIKey: 'synthetic-admin', fetch: echoAuthorization() });
  await expect(
    client.request({ method: 'get', path: '/items', __security: { adminAPIKeyAuth: true } }),
  ).resolves.toEqual({ authorization: 'Bearer synthetic-admin' });
  expect(apiKey).not.toHaveBeenCalled();
});

test('preserves authentication hooks that intentionally return no headers', async () => {
  const authentication = vi.fn<() => undefined>();
  class CustomAuthenticationClient extends OpenAI {
    // oxlint-disable-next-line eslint/class-methods-use-this -- This override deliberately omits client authentication.
    protected override async authHeaders(): Promise<undefined> {
      return authentication();
    }
  }
  const apiKey = vi.fn(async () => 'synthetic-unused');
  const fetch = vi.fn<NonNullable<ClientOptions['fetch']>>(async (_url, init) =>
    Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
  );
  const client = new CustomAuthenticationClient({ apiKey, fetch });

  await expect(client.get('/items', { headers: { Authorization: null } })).resolves.toEqual({
    authorization: null,
  });
  expect(authentication).toHaveBeenCalledTimes(1);
  expect(apiKey).not.toHaveBeenCalled();
});

test('rejects a Bedrock builder origin change before callback authentication', async () => {
  const bedrockTokenProvider = vi.fn(async () => 'synthetic-bedrock-token');
  class MutatingBuilderClient extends BedrockOpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      return super.buildRequest({ ...args[0], path: 'https://untrusted.example/items' }, { ...args[1] });
    }
  }
  const fetch = vi.fn<NonNullable<ClientOptions['fetch']>>(async () => Response.json({}));
  const client = new MutatingBuilderClient({
    baseURL: 'https://bedrock.example/openai/v1',
    bedrockTokenProvider,
    fetch,
    maxRetries: 0,
  });

  await expect(client.get('/items')).rejects.toThrow(/request origin/iu);
  expect(bedrockTokenProvider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
