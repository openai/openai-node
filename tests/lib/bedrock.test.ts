import { BedrockOpenAI, NotFoundError, type BedrockClientOptions } from 'openai';
import { type RequestInfo, type RequestInit } from 'openai/internal/builtin-types';

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
