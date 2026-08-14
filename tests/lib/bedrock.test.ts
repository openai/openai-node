import { vi } from 'vitest';
import { BedrockOpenAI, NotFoundError, OpenAIError } from 'openai';
import type { BedrockClientOptions } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

const RESPONSE_BODY = {
  id: 'resp_123',
  object: 'response',
  created_at: 0,
  status: 'completed',
  background: false,
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  model: 'gpt-4o',
  output: [],
  parallel_tool_calls: true,
  previous_response_id: null,
  prompt_cache_key: null,
  reasoning: { effort: null, summary: null },
  safety_identifier: null,
  service_tier: 'default',
  store: true,
  temperature: 1,
  text: { format: { type: 'text' }, verbosity: 'medium' },
  tool_choice: 'auto',
  tools: [],
  top_logprobs: 0,
  top_p: 1,
  truncation: 'disabled',
  usage: {
    input_tokens: 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 0,
  },
  user: null,
  metadata: {},
};
const COMPACTED_RESPONSE_BODY = {
  id: 'resp_123',
  created_at: 0,
  object: 'response.compaction',
  output: [],
  usage: RESPONSE_BODY.usage,
};
const INPUT_ITEMS_BODY = {
  object: 'list',
  data: [],
  first_id: 'item_123',
  last_id: 'item_123',
  has_more: false,
};
const INPUT_TOKENS_BODY = {
  object: 'response.input_tokens',
  input_tokens: 1,
};

function jsonResponse(body: unknown = RESPONSE_BODY): Response {
  return new globalThis.Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseStreamSSE(): string {
  return [
    `event: response.created\ndata: ${JSON.stringify({
      type: 'response.created',
      sequence_number: 0,
      response: RESPONSE_BODY,
    })}`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      sequence_number: 1,
      response: RESPONSE_BODY,
    })}`,
    '',
  ].join('\n\n');
}

describe('instantiate bedrock client', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = undefined;
    process.env['AWS_BEDROCK_BASE_URL'] = undefined;
    process.env['AWS_REGION'] = undefined;
    process.env['AWS_DEFAULT_REGION'] = undefined;
  });

  afterEach(() => {
    process.env = env;
  });

  test('derives base URL from region', () => {
    const options: BedrockClientOptions = { awsRegion: 'us-east-1', apiKey: 'token' };
    const client = new BedrockOpenAI(options);
    expect(client.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
  });

  test('uses Bedrock config precedence', () => {
    process.env['AWS_BEDROCK_BASE_URL'] = 'https://env.example.com/openai/v1';
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'env token';
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_DEFAULT_REGION'] = 'us-west-2';

    const client = new BedrockOpenAI({
      baseURL: 'https://explicit.example.com/openai/v1/responses',
      apiKey: 'explicit token',
    });
    expect(client.baseURL).toBe('https://explicit.example.com/openai/v1');
    expect(client.apiKey).toBe('explicit token');
  });

  test('uses Bedrock region precedence', () => {
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_DEFAULT_REGION'] = 'us-west-2';

    const explicitRegionClient = new BedrockOpenAI({ awsRegion: 'eu-west-1', apiKey: 'token' });
    const awsRegionClient = new BedrockOpenAI({ apiKey: 'token' });
    process.env['AWS_REGION'] = undefined;
    const defaultRegionClient = new BedrockOpenAI({ apiKey: 'token' });

    expect(explicitRegionClient.baseURL).toBe('https://bedrock-mantle.eu-west-1.api.aws/openai/v1');
    expect(awsRegionClient.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
    expect(defaultRegionClient.baseURL).toBe('https://bedrock-mantle.us-west-2.api.aws/openai/v1');
  });

  test('normalizes Responses URL', () => {
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1/responses',
      apiKey: 'token',
    });
    expect(client.baseURL).toBe('https://example.com/openai/v1');
  });

  test('uses Bedrock env vars', () => {
    process.env['AWS_BEDROCK_BASE_URL'] = 'https://example.com/openai/v1';
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'bedrock token';
    const client = new BedrockOpenAI();
    expect(client.baseURL).toBe('https://example.com/openai/v1');
    expect(client.apiKey).toBe('bedrock token');
  });

  test('does not use OPENAI_API_KEY', () => {
    process.env['OPENAI_API_KEY'] = 'openai token';
    process.env['AWS_REGION'] = 'us-west-2';
    expect(() => new BedrockOpenAI()).toThrow(/AWS_BEARER_TOKEN_BEDROCK/);
  });

  test('requires endpoint configuration', () => {
    expect(() => new BedrockOpenAI({ apiKey: 'token' })).toThrow(/baseURL/);
  });

  test('rejects static token and provider together', () => {
    expect(
      () =>
        new BedrockOpenAI({
          baseURL: 'https://example.com/openai/v1',
          apiKey: 'token',
          bedrockTokenProvider: async () => 'provider token',
        }),
    ).toThrow(/mutually exclusive/);
  });

  test('requires refreshable tokens to use provider option', () => {
    expect(
      () =>
        new BedrockOpenAI({
          baseURL: 'https://example.com/openai/v1',
          apiKey: (async () => 'provider token') as unknown as string,
        }),
    ).toThrow(/bedrockTokenProvider/);
  });

  test('refreshes token provider before retries', async () => {
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      const status = authorizationHeaders.length === 1 ? 500 : 200;
      return new globalThis.Response(
        JSON.stringify(status === 500 ? { error: 'server error' } : RESPONSE_BODY),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };
    const tokens = ['first', 'second'];
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      bedrockTokenProvider: async () => tokens.shift()!,
      fetch,
      maxRetries: 1,
    });

    await client.responses.create({ model: 'gpt-4o', input: 'hello', background: true });

    expect(authorizationHeaders).toEqual(['Bearer first', 'Bearer second']);
  });

  test('preserves token provider across withOptions', async () => {
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      bedrockTokenProvider: async () => 'provider token',
      fetch,
    });

    await client.withOptions({ timeout: 1 }).responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(authorizationHeaders).toEqual(['Bearer provider token']);
  });

  describe('request origin containment', () => {
    const configuredBaseURL = 'https://bedrock.example.com/openai/v1';

    test('keeps the base URL enumerable without allowing its origin guard to be replaced', () => {
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, apiKey: 'bedrock-token' });
      const descriptor = Object.getOwnPropertyDescriptor(client, 'baseURL');

      expect(descriptor).toMatchObject({ configurable: false, enumerable: true });
      expect(descriptor?.get).toEqual(expect.any(Function));
      expect(descriptor?.set).toEqual(expect.any(Function));
      expect(Object.keys(client)).toContain('baseURL');
      expect(() =>
        Object.defineProperty(client, 'baseURL', { value: 'https://attacker.example/openai/v1' }),
      ).toThrow(TypeError);
      expect(Reflect.deleteProperty(client, 'baseURL')).toBe(false);
      expect(client.baseURL).toBe(configuredBaseURL);
    });

    test.each([
      ['a different hostname', 'https://attacker.example/openai/v1'],
      ['an HTTP downgrade', 'http://bedrock.example.com/openai/v1'],
      ['a different effective port', 'https://bedrock.example.com:8443/openai/v1'],
    ] as const)('rejects a base URL change to %s before resolving credentials', (_case, baseURL) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });

      expect(() => {
        client.baseURL = baseURL;
      }).toThrow(/request origin/i);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects malformed base URL changes without replacing the trusted endpoint', () => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider });

      expect(() => {
        client.baseURL = 'not a valid URL';
      }).toThrow(TypeError);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
    });

    test.each([
      [
        'a normalized HTTPS hostname, default port, and Responses suffix',
        'https://BEDROCK.EXAMPLE.COM:443/openai/v1/responses',
        'https://BEDROCK.EXAMPLE.COM:443/custom/v2',
        'https://bedrock.example.com/custom/v2/models',
      ],
      [
        'a normalized HTTP hostname and default port',
        'http://CUSTOM.BEDROCK.EXAMPLE:80/openai/v1',
        'http://CUSTOM.BEDROCK.EXAMPLE:80/custom/v2',
        'http://custom.bedrock.example/custom/v2/models',
      ],
      [
        'the same custom HTTPS port',
        'https://LOCAL.BEDROCK.EXAMPLE:8443/openai/v1',
        'https://LOCAL.BEDROCK.EXAMPLE:8443/custom/v2',
        'https://local.bedrock.example:8443/custom/v2/models',
      ],
    ] as const)('allows a base URL change with %s', async (_case, baseURL, nextBaseURL, expectedURL) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL, bedrockTokenProvider, fetch });

      client.baseURL = nextBaseURL;
      expect(client.baseURL).toBe(nextBaseURL);

      await client.request({ method: 'get', path: '/models' });

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]![0])).toBe(expectedURL);
    });

    test.each([
      ['a static bearer token', false],
      ['a rotating bearer token', true],
    ] as const)('rejects cross-origin resource requests before using %s', async (_mode, rotating) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const requestHeaders = new Headers({ 'x-request-only': 'preserved' });
      const client = new BedrockOpenAI({
        baseURL: configuredBaseURL,
        ...(rotating ? { bedrockTokenProvider } : { apiKey: 'static-bedrock-secret' }),
        fetch,
      });

      await expect(
        client.responses.create(
          { model: 'gpt-4o', input: 'hello' },
          { path: 'https://attacker.example/exfiltrate?secret=never-log', headers: requestHeaders },
        ),
      ).rejects.toThrow(/request origin/i);

      expect(fetch).not.toHaveBeenCalled();
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect([...requestHeaders.entries()]).toEqual([['x-request-only', 'preserved']]);
      if (rotating) {
        expect(client.apiKey).toBeNull();
      }
    });

    test.each([
      ['a different hostname', 'https://attacker.example/exfiltrate'],
      ['an HTTP downgrade', 'http://bedrock.example.com/exfiltrate'],
      ['a different effective port', 'https://bedrock.example.com:8443/exfiltrate'],
    ] as const)('rejects %s before resolving rotating credentials', async (_case, requestURL) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });

      await expect(client.request({ method: 'get', path: requestURL })).rejects.toThrow(/request origin/i);

      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    test.each([
      ['a file base URL and opaque data request', 'file:///trusted/openai/v1', 'data:text/plain,stolen'],
      ['an opaque data base URL and file request', 'data:text/plain,configured', 'file:///tmp/stolen'],
      [
        'a blob request with the trusted embedded HTTPS origin',
        configuredBaseURL,
        'blob:https://bedrock.example.com/01234567-89ab-cdef-0123-456789abcdef',
      ],
      [
        'a blob base URL with a matching HTTPS request origin',
        'blob:https://bedrock.example.com/01234567-89ab-cdef-0123-456789abcdef',
        'https://bedrock.example.com/openai/v1/models',
      ],
    ] as const)(
      'rejects %s before resolving rotating credentials or sending',
      async (_case, baseURL, requestURL) => {
        const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
        const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
        const client = new BedrockOpenAI({ baseURL, bedrockTokenProvider, fetch });

        await expect(client.request({ method: 'get', path: requestURL })).rejects.toThrow(/request origin/i);

        expect(bedrockTokenProvider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    test.each([
      ['the Responses resource', false, false],
      ['an admin-only security route', true, false],
      ['a cloned Responses client', false, true],
      ['a cloned admin-only security route', true, true],
    ] as const)(
      'rejects cross-origin paths for %s before resolving credentials',
      async (_case, admin, clone) => {
        const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
        const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
        const original = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });
        const client = clone ? original.withOptions({ timeout: 1000 }) : original;
        const path = 'https://attacker.example/exfiltrate';

        const request = admin
          ? client.admin.organization.invites.list({}, { path })
          : client.responses.create({ model: 'gpt-4o', input: 'hello' }, { path });

        await expect(request).rejects.toThrow(/request origin/i);
        expect(bedrockTokenProvider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    test('does not expose attacker paths or query values in the origin rejection', async () => {
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({
        baseURL: configuredBaseURL,
        apiKey: 'static-bedrock-secret',
        fetch,
      });

      const rejection = await client
        .request({
          method: 'get',
          path: 'https://attacker.example/private/exfiltrate?secret=never-log-this-query',
        })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(OpenAIError);
      const message = (rejection as Error).message;
      expect(message).toContain('https://attacker.example');
      expect(message).toContain('https://bedrock.example.com');
      expect(message).not.toContain('/private/exfiltrate');
      expect(message).not.toContain('/openai/v1');
      expect(message).not.toContain('never-log-this-query');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects a cross-origin defaultBaseURL before resolving credentials', async () => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({
        baseURL: 'https://api.openai.com/v1',
        bedrockTokenProvider,
        fetch,
      });

      await expect(
        client.responses.create(
          { model: 'gpt-4o', input: 'hello' },
          { defaultBaseURL: 'https://attacker.example/exfiltrate' },
        ),
      ).rejects.toThrow(/request origin/i);

      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    test.each([
      [
        'a relative request',
        'https://bedrock.example.com/openai/v1',
        '/models',
        'https://bedrock.example.com/openai/v1/models',
      ],
      [
        'a same-origin absolute request outside the base path',
        'https://bedrock.example.com/openai/v1',
        'https://bedrock.example.com/custom/models?limit=1',
        'https://bedrock.example.com/custom/models?limit=1',
      ],
      [
        'a case-normalized HTTPS hostname and default port',
        'https://BEDROCK.EXAMPLE.COM:443/openai/v1',
        'https://bedrock.example.com:443/custom/models',
        'https://bedrock.example.com/custom/models',
      ],
      [
        'a case-normalized HTTP hostname and default port',
        'http://CUSTOM.BEDROCK.EXAMPLE:80/openai/v1',
        'http://custom.bedrock.example:80/custom/models',
        'http://custom.bedrock.example/custom/models',
      ],
      [
        'an arbitrary custom host and nondefault port',
        'https://LOCAL.BEDROCK.EXAMPLE:8443/openai/v1',
        'https://local.bedrock.example:8443/custom/models',
        'https://local.bedrock.example:8443/custom/models',
      ],
      [
        'an arbitrary loopback HTTP endpoint',
        'http://127.0.0.1:8080/custom/v1',
        '/models',
        'http://127.0.0.1:8080/custom/v1/models',
      ],
    ] as const)('allows %s', async (_case, baseURL, path, expectedURL) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL, bedrockTokenProvider, fetch });

      await client.request({ method: 'get', path });

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe(expectedURL);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rotating-bedrock-token');
    });

    test('allows a same-origin defaultBaseURL for the SDK-default endpoint', async () => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({
        baseURL: 'https://api.openai.com/v1',
        bedrockTokenProvider,
        fetch,
      });

      await client.request({
        method: 'get',
        path: '/models',
        defaultBaseURL: 'https://API.OPENAI.COM:443/custom/v2',
      });

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]![0])).toBe('https://api.openai.com/custom/v2/models');
    });

    test('uses the reconfigured withOptions base URL as the clone trust boundary', async () => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const original = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });
      const clone = original.withOptions({ baseURL: 'https://clone.example:8443/openai/v1' });

      expect(clone.baseURL).toBe('https://clone.example:8443/openai/v1');
      expect(() => {
        clone.baseURL = configuredBaseURL;
      }).toThrow(/request origin/i);
      expect(() => {
        original.baseURL = clone.baseURL;
      }).toThrow(/request origin/i);

      await expect(
        clone.request({ method: 'get', path: 'https://bedrock.example.com/exfiltrate' }),
      ).rejects.toThrow(/request origin/i);
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();

      await clone.request({ method: 'get', path: 'https://CLONE.EXAMPLE:8443/custom/models' });
      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]![0])).toBe('https://clone.example:8443/custom/models');

      await original.request({ method: 'get', path: '/models' });
      expect(bedrockTokenProvider).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[1]![0])).toBe('https://bedrock.example.com/openai/v1/models');
    });

    test.each([
      ['the original client', false],
      ['a cloned client', true],
    ] as const)('rejects a mutated base URL on %s before resolving credentials', async (_case, cloned) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const original = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });
      const client = cloned ? original.withOptions({ timeout: 1000 }) : original;

      expect(() => {
        client.baseURL = 'https://attacker.example/openai/v1';
      }).toThrow(/request origin/i);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects a base URL mutation attempted while a token provider is running', async () => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-token');
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });
      bedrockTokenProvider.mockImplementationOnce(async () => {
        client.baseURL = 'https://attacker.example/openai/v1';
        return 'rotating-bedrock-token';
      });

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(/request origin/i);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    });

    test.each([
      ['the request path', 'path'],
      ['the request default base URL', 'defaultBaseURL'],
    ] as const)('rejects cross-origin mutations to %s during token resolution', async (_case, mutation) => {
      const options: { method: 'get'; path: string; defaultBaseURL?: string } = {
        method: 'get',
        path: '/models',
      };
      const bedrockTokenProvider = vi.fn(async () => {
        if (mutation === 'path') {
          options.path = 'https://attacker.example/exfiltrate';
        } else {
          options.defaultBaseURL = 'https://attacker.example/openai/v1';
        }
        return 'rotating-bedrock-token';
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({
        baseURL: mutation === 'defaultBaseURL' ? 'https://api.openai.com/v1' : configuredBaseURL,
        bedrockTokenProvider,
        fetch,
      });

      await expect(client.request(options)).rejects.toThrow(/request origin/i);

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects a path getter that changes the final request origin after preparation', async () => {
      const options: { method: 'get'; path: string } = { method: 'get', path: '/models' };
      let pathReads = 0;
      Object.defineProperty(options, 'path', {
        enumerable: true,
        get() {
          pathReads += 1;
          return pathReads <= 2 ? '/models' : 'https://attacker.example/exfiltrate';
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, apiKey: 'bedrock-token', fetch });

      await expect(client.request(options)).rejects.toThrow(/request origin/i);

      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects a request path mutated in a later token-provider microtask', async () => {
      const options: { method: 'get'; path: string } = { method: 'get', path: '/models' };
      let pendingMicrotasks = 4;
      const mutateAfterPendingMicrotasks = (): void => {
        pendingMicrotasks -= 1;
        if (pendingMicrotasks === 0) {
          options.path = 'https://attacker.example/exfiltrate';
          return;
        }
        queueMicrotask(mutateAfterPendingMicrotasks);
      };
      const bedrockTokenProvider = vi.fn(async () => {
        queueMicrotask(mutateAfterPendingMicrotasks);
        return 'rotating-bedrock-token';
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider, fetch });

      await expect(client.request(options)).rejects.toThrow(/request origin/i);

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  test('passes non-Responses resources through', async () => {
    const requests: string[] = [];
    const fetch = async (url: RequestInfo): Promise<Response> => {
      requests.push(new URL(url.toString()).pathname);
      return new globalThis.Response(
        JSON.stringify({ error: { message: 'AWS does not support chat completions here' } }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_chat' },
        },
      );
    };
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      apiKey: 'token',
      fetch,
    });

    await expect(client.chat.completions.create({ model: 'gpt-4o', messages: [] })).rejects.toMatchObject({
      message: expect.stringContaining('AWS does not support chat completions here'),
      requestID: 'req_chat',
    } satisfies Partial<NotFoundError>);
    expect(requests).toEqual(['/openai/v1/chat/completions']);
  });

  test('passes Responses features through', async () => {
    const requestBodies: unknown[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      requestBodies.push(JSON.parse(init?.body?.toString() ?? '{}'));
      return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      apiKey: 'token',
      fetch,
    });

    await client.responses.create({
      model: 'gpt-4o',
      input: 'hello',
      tools: [{ type: 'web_search_preview' }],
    });

    expect(requestBodies).toEqual([
      expect.objectContaining({
        tools: [{ type: 'web_search_preview' }],
      }),
    ]);
  });

  test('passes admin security routes through with Bedrock auth', async () => {
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return new globalThis.Response(
        JSON.stringify({ error: { message: 'AWS does not support organization invites here' } }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_admin' },
        },
      );
    };
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      apiKey: 'token',
      fetch,
    });

    await expect(client.admin.organization.invites.list()).rejects.toMatchObject({
      message: expect.stringContaining('AWS does not support organization invites here'),
      requestID: 'req_admin',
    } satisfies Partial<NotFoundError>);
    expect(authorizationHeaders).toEqual(['Bearer token']);
  });

  test('refreshes token provider for admin security routes', async () => {
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      const status = authorizationHeaders.length === 1 ? 500 : 404;
      return new globalThis.Response(
        JSON.stringify(
          status === 500
            ? { error: 'server error' }
            : { error: { message: 'AWS does not support organization invites here' } },
        ),
        {
          status,
          headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_admin' },
        },
      );
    };
    const tokens = ['first', 'second'];
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      bedrockTokenProvider: async () => tokens.shift()!,
      fetch,
      maxRetries: 1,
    });

    await expect(client.admin.organization.invites.list()).rejects.toThrow(NotFoundError);
    expect(authorizationHeaders).toEqual(['Bearer first', 'Bearer second']);
  });

  test('allows Responses HTTP methods and wrappers', async () => {
    const requests: string[] = [];
    const fetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
      const requestURL = new URL(url.toString());
      requests.push(`${init?.method} ${requestURL.pathname}`);

      let body: unknown = RESPONSE_BODY;
      if (requestURL.pathname === '/openai/v1/responses/compact') {
        body = COMPACTED_RESPONSE_BODY;
      } else if (requestURL.pathname === '/openai/v1/responses/input_tokens') {
        body = INPUT_TOKENS_BODY;
      } else if (requestURL.pathname === '/openai/v1/responses/resp_123/input_items') {
        body = INPUT_ITEMS_BODY;
      }

      return new globalThis.Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      apiKey: 'token',
      fetch,
    });

    await client.responses.create({ model: 'gpt-4o', input: 'hello', background: true });
    await client.responses.retrieve('resp_123');
    await client.responses.retrieve('resp_123', { starting_after: 1, stream: true });
    await client.responses.retrieve('resp_123', { stream: true });
    await client.responses.cancel('resp_123');
    await client.responses.compact({ model: 'gpt-4o' });
    await client.responses.inputItems.list('resp_123');
    await client.responses.inputTokens.count({ model: 'gpt-4o', input: 'hello' });

    const rawResponse = await client.responses.create({ model: 'gpt-4o', input: 'hello' }).asResponse();
    expect(rawResponse.status).toBe(200);
    const { data, response } = await client.responses
      .create({ model: 'gpt-4o', input: 'hello' })
      .withResponse();
    expect(data.id).toBe('resp_123');
    expect(response.status).toBe(200);

    expect(requests).toEqual([
      'POST /openai/v1/responses',
      'GET /openai/v1/responses/resp_123',
      'GET /openai/v1/responses/resp_123',
      'GET /openai/v1/responses/resp_123',
      'POST /openai/v1/responses/resp_123/cancel',
      'POST /openai/v1/responses/compact',
      'GET /openai/v1/responses/resp_123/input_items',
      'POST /openai/v1/responses/input_tokens',
      'POST /openai/v1/responses',
      'POST /openai/v1/responses',
    ]);
  });

  test('allows Responses SSE and stream wrapper', async () => {
    const fetch = async (): Promise<Response> =>
      new globalThis.Response(responseStreamSSE(), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      apiKey: 'token',
      fetch,
    });

    const events: string[] = [];
    for await (const event of await client.responses.create({
      model: 'gpt-4o',
      input: 'hello',
      stream: true,
    })) {
      events.push(event.type);
    }
    expect(events).toEqual(['response.created', 'response.completed']);

    const finalResponse = await client.responses
      .stream({
        model: 'gpt-4o',
        input: 'hello',
      })
      .finalResponse();
    expect(finalResponse.id).toBe('resp_123');
    expect(finalResponse.output_text).toBe('');
  });
});
