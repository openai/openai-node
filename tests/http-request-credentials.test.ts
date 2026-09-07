/* oxlint-disable max-classes-per-file -- Compare forwarding, legacy, and header-mutating subclasses with distinct hook contracts. */
import { vi } from 'vitest';
import OpenAI, { AzureOpenAI, BedrockOpenAI } from 'openai';
import type { ClientOptions } from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { RequestCredentialContext } from 'openai/internal/request-credentials';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const clients = ['OpenAI', 'Azure', 'Bedrock'] as const;

function clientFor(
  name: (typeof clients)[number],
  apiKey: NonNullable<ClientOptions['apiKey']>,
  fetch: Fetch,
) {
  const options = { baseURL: 'https://synthetic.example/v1', fetch, maxRetries: 1 };
  if (name === 'Azure') {
    return new AzureOpenAI({
      ...options,
      apiVersion: '2024-10-01-preview',
      ...(typeof apiKey === 'function' ? { azureADTokenProvider: apiKey } : { apiKey }),
    });
  }
  if (name === 'Bedrock') {
    return new BedrockOpenAI({
      ...options,
      ...(typeof apiKey === 'function' ? { bedrockTokenProvider: apiKey } : { apiKey }),
    });
  }
  return new OpenAI({ ...options, apiKey });
}

function rotatingProvider() {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    return `synthetic-token-${calls}`;
  });
}

function recordRequests(response: (headers: Headers) => Response = () => Response.json({ data: [] })) {
  const sent: Headers[] = [];
  const fetch = vi.fn<Fetch>(async (_url, init) => {
    const headers = new Headers(init?.headers);
    sent.push(headers);
    return response(headers);
  });
  return { fetch, sent };
}

function tokens(sent: Headers[]) {
  return sent.map((headers) => headers.get('authorization'));
}

beforeEach(() => {
  for (const name of ['AZURE_OPENAI_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK']) {
    // Explicit undefined removes inherited provider credentials.
    // oxlint-disable-next-line unicorn/no-useless-undefined
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(clients)('%s HTTP request credentials', (name) => {
  test('keeps simultaneous provider results with their initiating public requests', async () => {
    const { fetch, sent } = recordRequests();
    const provider = rotatingProvider();
    const client = clientFor(name, provider, fetch);

    await Promise.all([client.models.list(), client.models.list()]);

    expect(tokens(sent)).toEqual(['Bearer synthetic-token-1', 'Bearer synthetic-token-2']);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(client.apiKey).toBe('synthetic-token-2');
  });

  test('keeps request association when pending providers resolve in reverse order', async () => {
    const { fetch, sent } = recordRequests();
    const resolvers: ((token: string) => void)[] = [];
    const provider = vi.fn(
      () =>
        // eslint-disable-next-line promise/avoid-new -- Control provider settlement order to reproduce the race.
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const client = clientFor(name, provider, fetch);
    const first = client.models.list({ headers: { 'x-synthetic-request': 'first' } });
    const second = client.models.list({ headers: { 'x-synthetic-request': 'second' } });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    const [resolveFirst, resolveSecond] = resolvers;
    if (!resolveFirst || !resolveSecond) {
      throw new Error('Expected both providers to start');
    }

    resolveSecond('synthetic-token-2');
    resolveFirst('synthetic-token-1');
    await Promise.all([first, second]);

    expect(
      Object.fromEntries(
        sent.map((headers) => [headers.get('x-synthetic-request'), headers.get('authorization')]),
      ),
    ).toEqual({
      first: 'Bearer synthetic-token-1',
      second: 'Bearer synthetic-token-2',
    });
  });

  test('refreshes credentials for each retry without borrowing another request token', async () => {
    const { fetch, sent } = recordRequests((headers) =>
      headers.get('x-synthetic-request') === 'retry' && headers.get('x-stainless-retry-count') === '0'
        ? Response.json(
            { error: { message: 'synthetic retry' } },
            { status: 503, headers: { 'retry-after-ms': '0' } },
          )
        : Response.json({ data: [] }),
    );
    const provider = rotatingProvider();
    const client = clientFor(name, provider, fetch);

    await Promise.all([
      client.models.list({ headers: { 'x-synthetic-request': 'retry' } }),
      client.models.list({ headers: { 'x-synthetic-request': 'other' } }),
    ]);

    expect(
      sent.map((headers) => [
        headers.get('x-synthetic-request'),
        headers.get('x-stainless-retry-count'),
        headers.get('authorization'),
      ]),
    ).toEqual([
      ['retry', '0', 'Bearer synthetic-token-1'],
      ['other', '0', 'Bearer synthetic-token-2'],
      ['retry', '1', 'Bearer synthetic-token-3'],
    ]);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  test('isolates streamed response authentication through complete stream consumption', async () => {
    const { fetch, sent } = recordRequests(
      () =>
        new Response(
          'event: response.completed\ndata: {"type":"response.completed","response":{"id":"synthetic-response","output":[]}}\n\n',
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );
    const provider = rotatingProvider();
    const client = clientFor(name, provider, fetch);
    const streams = await Promise.all([
      client.responses.create({ model: 'synthetic-model', input: 'first', stream: true }),
      client.responses.create({ model: 'synthetic-model', input: 'second', stream: true }),
    ]);
    await Promise.all(
      streams.map(async (stream) => {
        const events = [];
        for await (const event of stream) {
          events.push(event.type);
        }
        expect(events).toEqual(['response.completed']);
      }),
    );

    expect(tokens(sent)).toEqual(['Bearer synthetic-token-1', 'Bearer synthetic-token-2']);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  test('preserves static authentication and direct request construction', async () => {
    const { fetch, sent } = recordRequests();
    const client = clientFor(name, 'synthetic-static-key', fetch);
    const built = await client.buildRequest({ method: 'get', path: '/models' });
    await client.models.list();

    const header = name === 'Azure' ? 'api-key' : 'authorization';
    const expected = name === 'Azure' ? 'synthetic-static-key' : 'Bearer synthetic-static-key';
    expect(built.req.headers.get(header)).toBe(expected);
    expect(sent[0]?.get(header)).toBe(expected);
  });
});

type BuildSettings = NonNullable<Parameters<OpenAI['buildRequest']>[1]>;
interface Security {
  bearerAuth?: boolean;
  adminAPIKeyAuth?: boolean;
}

class ForwardingClient extends OpenAI {
  readonly seenOptions: FinalRequestOptions[] = [];
  readonly contexts: (RequestCredentialContext | undefined)[] = [];
  reenter = false;
  resolveAgain = false;

  protected override async prepareOptions(
    options: FinalRequestOptions,
    context?: RequestCredentialContext,
  ): Promise<void> {
    this.seenOptions.push(options);
    this.contexts.push(context);
    await super.prepareOptions(options, context);
    if (this.reenter) {
      this.reenter = false;
      await this.request(options);
    }
  }

  override async buildRequest(options: FinalRequestOptions, settings: BuildSettings = {}) {
    this.seenOptions.push(options);
    if (this.resolveAgain) {
      this.resolveAgain = false;
      await this._callApiKey();
    }
    return super.buildRequest(options, settings);
  }

  protected override async authHeaders(
    options: FinalRequestOptions,
    security?: Security,
    context?: RequestCredentialContext,
  ): Promise<NullableHeaders | undefined> {
    this.seenOptions.push(options);
    await Promise.resolve();
    return super.authHeaders(options, security, context);
  }

  protected override async bearerAuth(
    options: FinalRequestOptions,
    context?: RequestCredentialContext,
  ): Promise<NullableHeaders | undefined> {
    this.seenOptions.push(options);
    await Promise.resolve();
    return super.bearerAuth(options, context);
  }
}

describe('HTTP credential hook compatibility', () => {
  test.each([false, true])(
    'isolates reused raw options while forwarding every hook (promised: %s)',
    async (promised) => {
      const { fetch, sent } = recordRequests();
      const provider = rotatingProvider();
      const client = new ForwardingClient({ apiKey: provider, fetch });
      const shared: FinalRequestOptions = { method: 'get', path: '/models' };
      const options = promised ? Promise.resolve(shared) : shared;

      await Promise.all([client.request(options), client.request(options)]);

      expect(tokens(sent)).toEqual(['Bearer synthetic-token-1', 'Bearer synthetic-token-2']);
      expect(client.seenOptions).toHaveLength(8);
      expect(client.seenOptions.every((seen) => seen === shared)).toBe(true);
      expect(client.contexts[0]).toBeDefined();
      expect(client.contexts[0]).not.toBe(client.contexts[1]);
      expect(shared).toEqual({ method: 'get', path: '/models' });
    },
  );

  test('allows a guarded reentrant request using the exact same options object', async () => {
    const { fetch, sent } = recordRequests();
    const client = new ForwardingClient({ apiKey: rotatingProvider(), fetch });
    client.reenter = true;
    const shared: FinalRequestOptions = { method: 'get', path: '/models' };

    await client.request(shared);

    expect(tokens(sent)).toEqual(['Bearer synthetic-token-2', 'Bearer synthetic-token-1']);
    expect(client.seenOptions.every((seen) => seen === shared)).toBe(true);
  });

  test('retains its captured credential when a hook explicitly resolves another key', async () => {
    const { fetch, sent } = recordRequests();
    const provider = rotatingProvider();
    const client = new ForwardingClient({ apiKey: provider, fetch });
    client.resolveAgain = true;

    await client.models.list();

    expect(tokens(sent)).toEqual(['Bearer synthetic-token-1']);
    expect(client.apiKey).toBe('synthetic-token-2');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  test('isolates credentials replaced by a forwarding preparation hook', async () => {
    class ReplacementClient extends OpenAI {
      protected override async prepareOptions(
        options: FinalRequestOptions,
        context?: RequestCredentialContext,
      ): Promise<void> {
        await super.prepareOptions(options, context);
        if (typeof context?.apiKey !== 'string') {
          throw new TypeError('Expected a request credential');
        }
        context.apiKey = `${context.apiKey}-replacement`;
        this.apiKey = 'synthetic-shared-key';
        await Promise.resolve();
      }
    }
    const { fetch, sent } = recordRequests();
    const provider = rotatingProvider();
    const client = new ReplacementClient({ apiKey: provider, fetch });

    await Promise.all([client.models.list(), client.models.list()]);

    expect(tokens(sent)).toEqual([
      'Bearer synthetic-token-1-replacement',
      'Bearer synthetic-token-2-replacement',
    ]);
    expect(client.apiKey).toBe('synthetic-shared-key');
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe.each(['OpenAI', 'Azure'] as const)('%s explicit Authorization headers', (name) => {
  test.each([
    {
      label: 'default',
      defaultValue: 'Bearer synthetic-default',
      requestValue: undefined,
      expected: 'Bearer synthetic-default',
    },
    {
      label: 'request',
      defaultValue: 'Bearer synthetic-default',
      requestValue: 'Bearer synthetic-request',
      expected: 'Bearer synthetic-request',
    },
    { label: 'null request', defaultValue: 'Bearer synthetic-default', requestValue: null, expected: null },
    { label: 'null default', defaultValue: null, requestValue: undefined, expected: null },
    {
      label: 'request over null default',
      defaultValue: null,
      requestValue: 'Bearer synthetic-request',
      expected: 'Bearer synthetic-request',
    },
    { label: 'empty request', defaultValue: 'Bearer synthetic-default', requestValue: '', expected: '' },
  ])(
    'preserves $label precedence over a function credential',
    async ({ defaultValue, requestValue, expected }) => {
      const { fetch, sent } = recordRequests();
      const provider = rotatingProvider();
      const client = clientFor(name, provider, fetch).withOptions({
        defaultHeaders: { Authorization: defaultValue },
      });

      const request = client.models.list(
        requestValue === undefined ? {} : { headers: { Authorization: requestValue } },
      );
      if (expected === '') {
        await expect(request).rejects.toThrow('Could not resolve authentication method');
        expect(fetch).not.toHaveBeenCalled();
      } else {
        await request;
        expect(sent[0]?.get('authorization')).toBe(expected);
      }
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
});

test.each(clients)('%s rejects a failed provider without affecting another request', async (name) => {
  const { fetch, sent } = recordRequests();
  const provider = vi.fn(async () => 'synthetic-valid-token').mockResolvedValueOnce('');
  const client = clientFor(name, provider, fetch);

  const results = await Promise.allSettled([client.models.list(), client.models.list()]);

  expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
  expect(tokens(sent)).toEqual(['Bearer synthetic-valid-token']);
  expect(provider).toHaveBeenCalledTimes(2);
});

test('isolates legacy Bedrock admin-route credentials', async () => {
  const { fetch, sent } = recordRequests();
  const provider = rotatingProvider();
  const client = new BedrockOpenAI({
    baseURL: 'https://synthetic.example/v1',
    bedrockTokenProvider: provider,
    fetch,
  });

  await Promise.all([client.admin.organization.invites.list(), client.admin.organization.invites.list()]);

  expect(tokens(sent)).toEqual(['Bearer synthetic-token-1', 'Bearer synthetic-token-2']);
  expect(provider).toHaveBeenCalledTimes(2);
});

test('preserves credential getter validation before HTTP dispatch', async () => {
  const { fetch } = recordRequests();
  const client = clientFor('Bedrock', async () => 'synthetic-invalid\ncredential', fetch);

  await expect(client.models.list()).rejects.toThrow(
    'Bedrock bearer credential contains an invalid HTTP header value.',
  );
  expect(fetch).not.toHaveBeenCalled();
});

class LegacyClient extends OpenAI {
  readonly hooks: string[] = [];

  protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    this.hooks.push('prepareOptions');
    await super.prepareOptions(options);
    this.apiKey = 'synthetic-legacy-key';
  }

  override async buildRequest(options: FinalRequestOptions, settings: BuildSettings = {}) {
    this.hooks.push('buildRequest');
    return super.buildRequest(options, settings);
  }

  protected override async authHeaders(
    options: FinalRequestOptions,
    security?: Security,
  ): Promise<NullableHeaders | undefined> {
    this.hooks.push('authHeaders');
    return super.authHeaders(options, security);
  }

  protected override async bearerAuth(options: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    this.hooks.push('bearerAuth');
    return super.bearerAuth(options);
  }
}

test('retains the behavior of legacy overrides that omit credential context', async () => {
  const { fetch, sent } = recordRequests();
  const provider = rotatingProvider();
  const client = new LegacyClient({ apiKey: provider, fetch });

  await client.models.list();

  expect(tokens(sent)).toEqual(['Bearer synthetic-legacy-key']);
  expect(client.hooks).toEqual(['prepareOptions', 'buildRequest', 'authHeaders', 'bearerAuth']);
  expect(provider).toHaveBeenCalledTimes(1);
});

describe.each([
  {
    name: 'OpenAI',
    Base: class extends OpenAI {
      constructor(provider: () => Promise<string>, fetch: Fetch) {
        super({ apiKey: provider, fetch });
      }
    },
  },
  {
    name: 'Azure',
    Base: class extends AzureOpenAI {
      constructor(provider: () => Promise<string>, fetch: Fetch) {
        super({
          baseURL: 'https://synthetic.example/v1',
          apiVersion: '2024-10-01-preview',
          azureADTokenProvider: provider,
          fetch,
        });
      }
    },
  },
  {
    name: 'Bedrock',
    Base: class extends BedrockOpenAI {
      constructor(provider: () => Promise<string>, fetch: Fetch) {
        super({ baseURL: 'https://synthetic.example/v1', bedrockTokenProvider: provider, fetch });
      }
    },
  },
])('$name preparation credential changes', ({ Base }) => {
  test.each(['legacy', 'forwarded', 'transformed'] as const)('%s context contract', async (mode) => {
    class PreparationClient extends Base {
      protected override async prepareOptions(
        options: FinalRequestOptions,
        context?: RequestCredentialContext,
      ): Promise<void> {
        await super.prepareOptions(options, mode === 'legacy' ? undefined : context);
        this.apiKey = 'synthetic-shared-replacement';
        if (mode === 'transformed') {
          if (context?.apiKey === undefined) {
            throw new Error('Expected a captured provider credential');
          }
          context.apiKey = `${context.apiKey}-prepared`;
        }
      }
    }
    const { fetch, sent } = recordRequests();
    const provider = rotatingProvider();
    const client = new PreparationClient(provider, fetch);

    if (mode === 'legacy') {
      await client.models.list();
      expect(tokens(sent)).toEqual(['Bearer synthetic-shared-replacement']);
      expect(provider).toHaveBeenCalledTimes(1);
    } else {
      await Promise.all([client.models.list(), client.models.list()]);
      const suffix = mode === 'transformed' ? '-prepared' : '';
      expect(tokens(sent)).toEqual([
        `Bearer synthetic-token-1${suffix}`,
        `Bearer synthetic-token-2${suffix}`,
      ]);
      expect(provider).toHaveBeenCalledTimes(2);
    }
    expect(client.apiKey).toBe('synthetic-shared-replacement');
  });
});

test('preserves a legacy credential resolver that does not capture its result', async () => {
  const { fetch, sent } = recordRequests();
  const client = new OpenAI({ apiKey: 'synthetic-static-key', fetch });
  const hook = vi.spyOn(client, '_callApiKey').mockImplementation(async () => {
    client.apiKey = 'synthetic-legacy-provider-key';
    return true;
  });

  await client.models.list();

  expect(tokens(sent)).toEqual(['Bearer synthetic-legacy-provider-key']);
  expect(hook).toHaveBeenCalledTimes(1);
});

test('preserves static-key changes in forwarding preparation hooks and final request headers', async () => {
  class HeaderClient extends OpenAI {
    protected override async prepareOptions(
      options: FinalRequestOptions,
      context?: RequestCredentialContext,
    ): Promise<void> {
      await super.prepareOptions(options, context);
      this.apiKey = 'synthetic-static-replacement';
    }

    protected override async prepareRequest(
      request: RequestInit,
      context: { url: string; options: FinalRequestOptions },
    ): Promise<void> {
      expect(new Headers(request.headers).get('authorization')).toBe('Bearer synthetic-static-replacement');
      request.headers = new Headers({ Authorization: 'Bearer synthetic-request-hook' });
      await super.prepareRequest(request, context);
    }
  }
  const { fetch, sent } = recordRequests();
  const client = new HeaderClient({ apiKey: 'synthetic-static-key', fetch });

  await client.models.list();

  expect(tokens(sent)).toEqual(['Bearer synthetic-request-hook']);
});
