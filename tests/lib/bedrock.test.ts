import { BedrockOpenAI, NotFoundError, type BedrockClientOptions } from 'openai';
import { type RequestInfo, type RequestInit } from 'openai/internal/builtin-types';
import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

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
    jest.resetModules();
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
    const client = new BedrockOpenAI();
    expect(client.apiKey).toBeNull();
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

  test('rejects an empty explicit bearer token', () => {
    expect(
      () =>
        new BedrockOpenAI({
          baseURL: 'https://example.com/openai/v1',
          apiKey: '',
        }),
    ).toThrow(/must not be empty/);
  });

  test('rejects bearer and AWS credentials together', () => {
    expect(
      () =>
        new BedrockOpenAI({
          baseURL: 'https://example.com/openai/v1',
          apiKey: 'token',
          awsAccessKeyId: 'access key',
          awsSecretAccessKey: 'secret key',
        }),
    ).toThrow(/mutually exclusive/);
  });

  test('rejects partial explicit AWS credentials', () => {
    expect(
      () =>
        new BedrockOpenAI({
          baseURL: 'https://example.com/openai/v1',
          awsRegion: 'us-east-1',
          awsAccessKeyId: 'access key',
        }),
    ).toThrow(/must be provided together/);
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

  test('uses AWS token discovery and bearer signer for ambient bearer', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'ambient token';
    process.env['AWS_REGION'] = 'us-east-1';
    const client = new BedrockOpenAI({
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ambient token');
        return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    client.apiKey = 'mutated cached token';

    await client.responses.create({ model: 'gpt-4o', input: 'hello' });
  });

  test('preserves ambient bearer mode when withOptions changes routing', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'first token';
    process.env['AWS_REGION'] = 'us-east-1';
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new BedrockOpenAI({ fetch });

    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    const copiedClient = client.withOptions({ baseURL: 'https://example.com/openai/v1' });
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'refreshed token';
    await copiedClient.responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(authorizationHeaders).toEqual(['Bearer refreshed token']);
  });

  test('explicit AWS credentials override ambient bearer', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'ambient token';
    const requests: Headers[] = [];
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'access key',
      awsSecretAccessKey: 'secret key',
      awsSessionToken: 'session token',
      fetch: async (_url, init) => {
        requests.push(new Headers(init?.headers));
        return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await client.responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(requests[0]!.get('authorization')).toContain('AWS4-HMAC-SHA256 Credential=access key/');
    expect(requests[0]!.get('authorization')).toContain('SignedHeaders=');
    expect(requests[0]!.get('authorization')).toMatch(/SignedHeaders=[^,]*\bhost\b/);
    expect(requests[0]!.get('host')).toBe('example.com');
    expect(requests[0]!.get('x-amz-security-token')).toBe('session token');
  });

  test('signs the uppercase HTTP method transmitted by fetch', async () => {
    let signatureMatches = false;
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'access key',
      awsSecretAccessKey: 'secret key',
      fetch: async (url, init) => {
        const parsedURL = new URL(String(url));
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const actualAuthorization = headers['authorization'];
        delete headers['authorization'];
        const amzDate = headers['x-amz-date']!;
        const signingDate = new Date(
          amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
        );
        const expected = await new SignatureV4({
          credentials: { accessKeyId: 'access key', secretAccessKey: 'secret key' },
          region: 'us-east-1',
          service: 'bedrock-mantle',
          sha256: Hash.bind(null, 'sha256'),
        }).sign(
          new HttpRequest({
            protocol: parsedURL.protocol,
            hostname: parsedURL.hostname,
            method: init?.method?.toUpperCase() ?? 'GET',
            path: parsedURL.pathname,
            headers,
            ...(init?.body ? { body: init.body } : {}),
          }),
          { signingDate },
        );
        signatureMatches = actualAuthorization === expected.headers['authorization'];
        return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await client.responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(signatureMatches).toBe(true);
  });

  test('signs query parameters as a Smithy query bag', async () => {
    let signatureMatches = false;
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'access key',
      awsSecretAccessKey: 'secret key',
      fetch: async (url, init) => {
        const parsedURL = new URL(String(url));
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const actualAuthorization = headers['authorization'];
        delete headers['authorization'];
        const query: Record<string, string | string[]> = {};
        for (const [name, value] of parsedURL.searchParams) {
          const existing = query[name];
          query[name] =
            existing === undefined ? value
            : typeof existing === 'string' ? [existing, value]
            : [...existing, value];
        }
        const amzDate = headers['x-amz-date']!;
        const signingDate = new Date(
          amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
        );
        const expected = await new SignatureV4({
          credentials: { accessKeyId: 'access key', secretAccessKey: 'secret key' },
          region: 'us-east-1',
          service: 'bedrock-mantle',
          sha256: Hash.bind(null, 'sha256'),
        }).sign(
          new HttpRequest({
            protocol: parsedURL.protocol,
            hostname: parsedURL.hostname,
            method: init?.method?.toUpperCase() ?? 'GET',
            path: parsedURL.pathname,
            query,
            headers,
          }),
          { signingDate },
        );
        signatureMatches = actualAuthorization === expected.headers['authorization'];
        return new globalThis.Response(responseStreamSSE(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });

    for await (const _event of await client.responses.retrieve('resp_123', {
      starting_after: 1,
      stream: true,
    })) {
      // Consume the stream so the request completes.
    }

    expect(signatureMatches).toBe(true);
  });

  test('refreshes AWS credentials before retries', async () => {
    const requests: Headers[] = [];
    const credentials = [
      { accessKeyId: 'first access key', secretAccessKey: 'first secret', sessionToken: 'first token' },
      { accessKeyId: 'second access key', secretAccessKey: 'second secret', sessionToken: 'second token' },
    ];
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsCredentialsProvider: async () => credentials.shift()!,
      fetch: async (_url, init) => {
        requests.push(new Headers(init?.headers));
        const status = requests.length === 1 ? 500 : 200;
        return new globalThis.Response(
          JSON.stringify(status === 500 ? { error: 'server error' } : RESPONSE_BODY),
          { status, headers: { 'Content-Type': 'application/json' } },
        );
      },
      maxRetries: 1,
    });

    await client.responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(requests[0]!.get('authorization')).toContain('Credential=first access key/');
    expect(requests[0]!.get('x-amz-security-token')).toBe('first token');
    expect(requests[1]!.get('authorization')).toContain('Credential=second access key/');
    expect(requests[1]!.get('x-amz-security-token')).toBe('second token');
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

  test('preserves AWS credentials across withOptions', async () => {
    const requests: Headers[] = [];
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'access key',
      awsSecretAccessKey: 'secret key',
      fetch: async (_url, init) => {
        requests.push(new Headers(init?.headers));
        return new globalThis.Response(JSON.stringify(RESPONSE_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await client.withOptions({ timeout: 1 }).responses.create({ model: 'gpt-4o', input: 'hello' });

    expect(requests[0]!.get('authorization')).toContain('Credential=access key/');
  });

  test('replaces the AWS credential source in withOptions', () => {
    const explicitCredentialsClient = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'access key',
      awsSecretAccessKey: 'secret key',
    });

    const profileClient = explicitCredentialsClient.withOptions({ awsProfile: 'other-profile' });
    expect(() =>
      profileClient.withOptions({
        awsAccessKeyId: 'replacement access key',
        awsSecretAccessKey: 'replacement secret key',
      }),
    ).not.toThrow();
  });

  test('recomputes a region-derived base URL in withOptions', () => {
    const client = new BedrockOpenAI({ awsRegion: 'us-east-1', apiKey: 'token' });

    const copiedClient = client.withOptions({ awsRegion: 'eu-west-1' });

    expect(copiedClient.baseURL).toBe('https://bedrock-mantle.eu-west-1.api.aws/openai/v1');
  });

  test('keeps an explicit base URL when the region changes in withOptions', () => {
    const client = new BedrockOpenAI({
      baseURL: 'https://example.com/openai/v1',
      awsRegion: 'us-east-1',
      apiKey: 'token',
    });

    const copiedClient = client.withOptions({ awsRegion: 'eu-west-1' });

    expect(copiedClient.baseURL).toBe('https://example.com/openai/v1');
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
          status === 500 ?
            { error: 'server error' }
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

      const body =
        requestURL.pathname === '/openai/v1/responses/compact' ? COMPACTED_RESPONSE_BODY
        : requestURL.pathname === '/openai/v1/responses/input_tokens' ? INPUT_TOKENS_BODY
        : requestURL.pathname === '/openai/v1/responses/resp_123/input_items' ? INPUT_ITEMS_BODY
        : RESPONSE_BODY;

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
