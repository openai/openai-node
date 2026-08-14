import { vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, NotFoundError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';

const originalEnv = process.env;
const RUNTIME_MODEL = 'us.openai.gpt-5.6-sol';
const BEDROCK_ENVIRONMENT_VARIABLES = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_BEDROCK_BASE_URL',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_EC2_METADATA_DISABLED',
] as const;

beforeEach(() => {
  process.env = { ...originalEnv };
  for (const name of BEDROCK_ENVIRONMENT_VARIABLES) {
    delete process.env[name];
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = originalEnv;
});

function jsonResponse(body: unknown = {}): Response {
  return Response.json(body, {
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatCompletionBody(content = 'Hello from Runtime') {
  return {
    id: 'chatcmpl_runtime',
    object: 'chat.completion',
    created: 0,
    model: RUNTIME_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  };
}

function responseBody(content = 'Hello from Runtime') {
  return {
    id: 'resp_runtime',
    object: 'response',
    model: RUNTIME_MODEL,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      },
    ],
  };
}

function eventStreamResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('bedrock Runtime provider', () => {
  test.each([
    { endpoint: 'mantle' as const, hostname: 'bedrock-mantle.us-east-1.api.aws' },
    { endpoint: 'runtime' as const, hostname: 'bedrock-runtime.us-east-1.amazonaws.com' },
  ])(
    'derives the explicit $endpoint endpoint for dependency-free bearer authentication',
    async ({ endpoint, hostname }) => {
      let requestedURL: RequestInfo | undefined;
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: bearerBedrock({ endpoint, region: 'us-east-1', apiKey: 'bedrock-token' }),
        fetch: async (url, init) => {
          requestedURL = url;
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: '/models' });

      expect(client.baseURL).toBe(`https://${hostname}/openai/v1`);
      expect(String(requestedURL)).toBe(`https://${hostname}/openai/v1/models`);
      expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
    },
  );

  test('supports Runtime bearer authentication through the AWS entrypoint', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(String(requestedURL)).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/models');
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
  });

  test.each(['AWS_REGION', 'AWS_DEFAULT_REGION'] as const)(
    'derives the Runtime endpoint region from %s',
    (environmentVariable) => {
      process.env[environmentVariable] = 'us-west-2';

      const client = new OpenAI({
        provider: bearerBedrock({ endpoint: 'runtime', apiKey: 'bedrock-token' }),
      });

      expect(client.baseURL).toBe('https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1');
    },
  );

  test('supports sovereign AWS region names when deriving a Runtime endpoint', () => {
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'eusc-de-east-1', apiKey: 'bedrock-token' }),
    });

    expect(client.baseURL).toBe('https://bedrock-runtime.eusc-de-east-1.amazonaws.com/openai/v1');
  });

  test.each([
    ['userinfo and fragment injection', 'us-east-1.amazonaws.com@attacker.example#'],
    ['path injection', 'us-east-1/../../attacker.example'],
    ['query injection', 'us-east-1?target=attacker.example'],
    ['malformed region', 'not-a-region'],
  ])('rejects %s in explicit AWS regions before configuring any Bedrock provider', (_scenario, region) => {
    for (const endpoint of ['mantle', 'runtime'] as const) {
      expect(() => bearerBedrock({ endpoint, region, apiKey: 'bedrock-token' })).toThrow(
        /region.*invalid|invalid.*region|valid.*region/i,
      );
      expect(() =>
        bedrock({ endpoint, region, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
      ).toThrow(/region.*invalid|invalid.*region|valid.*region/i);
    }
  });

  test.each(['AWS_REGION', 'AWS_DEFAULT_REGION'] as const)(
    'rejects URL-delimiter injection through the %s environment variable',
    (environmentVariable) => {
      process.env[environmentVariable] = 'us-east-1.amazonaws.com@attacker.example#';

      for (const endpoint of ['mantle', 'runtime'] as const) {
        expect(() => bearerBedrock({ endpoint, apiKey: 'bedrock-token' })).toThrow(
          /region.*invalid|invalid.*region|valid.*region/i,
        );
        expect(() => bedrock({ endpoint, accessKeyId: 'access-key', secretAccessKey: 'secret-key' })).toThrow(
          /region.*invalid|invalid.*region|valid.*region/i,
        );
      }
    },
  );

  test.each(['mantle', 'runtime'] as const)(
    'rejects an invalid AWS signing region for an explicitly configured %s proxy',
    (endpoint) => {
      expect(() =>
        bedrock({
          endpoint,
          region: 'us-east-1.amazonaws.com@attacker.example#',
          baseURL: 'https://proxy.example.com/openai/v1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
      ).toThrow(/region.*invalid|invalid.*region|valid.*region/i);
    },
  );

  test('routes Chat Completions through Runtime with SigV4 and preserves request IDs', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({
        endpoint: 'runtime',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return Response.json(chatCompletionBody(), { headers: { 'x-request-id': 'req_runtime_chat' } });
      },
    });

    const completion = await client.chat.completions.create({
      model: RUNTIME_MODEL,
      messages: [{ role: 'user', content: 'Say hello' }],
    });

    expect(String(requestedURL)).toBe(
      'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions',
    );
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({
      model: RUNTIME_MODEL,
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    expect(new Headers(requestedInit?.headers).get('authorization')).toContain('/bedrock/aws4_request');
    expect(completion.choices[0]?.message.content).toBe('Hello from Runtime');
    expect(completion.choices[0]?.finish_reason).toBe('stop');
    expect(completion.usage).toEqual({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
    expect(completion._request_id).toBe('req_runtime_chat');
  });

  test('streams signed Runtime Chat Completions through standard SSE decoding', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({
        endpoint: 'runtime',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return eventStreamResponse([
          {
            id: 'chatcmpl_runtime',
            object: 'chat.completion.chunk',
            created: 0,
            model: RUNTIME_MODEL,
            choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null }],
          },
          {
            id: 'chatcmpl_runtime',
            object: 'chat.completion.chunk',
            created: 0,
            model: RUNTIME_MODEL,
            choices: [{ index: 0, delta: { content: 'Runtime' }, finish_reason: 'stop' }],
          },
        ]);
      },
    });

    const stream = await client.chat.completions.create({
      model: RUNTIME_MODEL,
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: true,
    });
    const chunks: string[] = [];
    const finishReasons: (string | null)[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.choices[0]?.delta.content ?? '');
      finishReasons.push(chunk.choices[0]?.finish_reason ?? null);
    }

    expect(String(requestedURL)).toBe(
      'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions',
    );
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({ model: RUNTIME_MODEL, stream: true });
    expect(new Headers(requestedInit?.headers).get('authorization')).toContain('/bedrock/aws4_request');
    expect(chunks).toEqual(['Hello ', 'Runtime']);
    expect(finishReasons).toEqual([null, 'stop']);
  });

  test('routes Responses through Runtime and preserves the SDK output_text helper', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse(responseBody());
      },
    });

    const response = await client.responses.create({ model: RUNTIME_MODEL, input: 'Say hello' });

    expect(String(requestedURL)).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/responses');
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({
      model: RUNTIME_MODEL,
      input: 'Say hello',
    });
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
    expect(response.output_text).toBe('Hello from Runtime');
  });

  test('streams Runtime Responses through standard SSE event decoding', async () => {
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async (_url, init) => {
        requestedInit = init;
        return eventStreamResponse([
          { type: 'response.created', sequence_number: 0, response: responseBody() },
          { type: 'response.completed', sequence_number: 1, response: responseBody() },
        ]);
      },
    });

    const stream = await client.responses.create({
      model: RUNTIME_MODEL,
      input: 'Say hello',
      stream: true,
    });
    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }

    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({ model: RUNTIME_MODEL, stream: true });
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
    expect(events).toEqual(['response.created', 'response.completed']);
  });

  test('refreshes AWS credentials and re-signs each Runtime retry', async () => {
    const credentialProvider = vi
      .fn()
      .mockResolvedValueOnce({
        accessKeyId: 'first-access-key',
        secretAccessKey: 'first-secret-key',
        sessionToken: 'first-session-token',
      })
      .mockResolvedValueOnce({
        accessKeyId: 'second-access-key',
        secretAccessKey: 'second-secret-key',
        sessionToken: 'second-session-token',
      });
    const requestHeaders: Headers[] = [];
    const client = new OpenAI({
      provider: bedrock({ endpoint: 'runtime', region: 'us-east-1', credentialProvider }),
      maxRetries: 1,
      fetch: async (_url, init) => {
        requestHeaders.push(new Headers(init?.headers));
        if (requestHeaders.length === 1) {
          return Response.json(
            { error: { message: 'retry this request' } },
            {
              status: 429,
              headers: { 'retry-after-ms': '1' },
            },
          );
        }
        return jsonResponse(responseBody());
      },
    });

    await client.responses.create({ model: RUNTIME_MODEL, input: 'Say hello' });

    expect(credentialProvider).toHaveBeenCalledTimes(2);
    expect(requestHeaders[0]?.get('authorization')).toMatch(
      /Credential=first-access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/,
    );
    expect(requestHeaders[1]?.get('authorization')).toMatch(
      /Credential=second-access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/,
    );
    expect(requestHeaders.map((headers) => headers.get('x-amz-security-token'))).toEqual([
      'first-session-token',
      'second-session-token',
    ]);
  });

  test('refreshes Runtime bearer credentials before retrying a request', async () => {
    const tokenProvider = vi.fn().mockResolvedValueOnce('first-token').mockResolvedValueOnce('second-token');
    const authorizationHeaders: string[] = [];
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', tokenProvider }),
      maxRetries: 1,
      fetch: async (_url, init) => {
        authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
        if (authorizationHeaders.length === 1) {
          return Response.json(
            { error: { message: 'retry this request' } },
            {
              status: 503,
              headers: { 'retry-after-ms': '1' },
            },
          );
        }
        return jsonResponse(chatCompletionBody());
      },
    });

    await client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] });

    expect(tokenProvider).toHaveBeenCalledTimes(2);
    expect(authorizationHeaders).toEqual(['Bearer first-token', 'Bearer second-token']);
  });

  test('prefers and refreshes the environment bearer credential over ambient AWS credentials for Runtime', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'first-environment-token';
    process.env['AWS_ACCESS_KEY_ID'] = 'environment-access-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'environment-secret-key';
    const authorizationHeaders: string[] = [];
    const client = new OpenAI({
      provider: bedrock({ endpoint: 'runtime', region: 'us-east-1' }),
      fetch: async (_url, init) => {
        authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
        return jsonResponse(chatCompletionBody());
      },
    });

    await client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] });
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'refreshed-environment-token';
    await client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] });

    expect(authorizationHeaders).toEqual([
      'Bearer first-environment-token',
      'Bearer refreshed-environment-token',
    ]);
  });

  test('does not switch Runtime authentication modes when the selected environment bearer disappears', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'temporary-environment-token';
    process.env['AWS_ACCESS_KEY_ID'] = 'environment-access-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'environment-secret-key';
    const fetch = vi.fn(async () => jsonResponse(chatCompletionBody()));
    const client = new OpenAI({
      provider: bedrock({ endpoint: 'runtime', region: 'us-east-1' }),
      fetch,
    });
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];

    await expect(
      client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] }),
    ).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: expect.objectContaining({
        message: expect.stringContaining('Could not find credentials for Bedrock'),
      }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves Runtime HTTP error classification and request IDs', async () => {
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          { error: { message: 'model is unavailable in this AWS region' } },
          {
            status: 404,
            headers: { 'x-request-id': 'req_runtime_missing_model' },
          },
        ),
    });

    const request = client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] });

    await expect(request).rejects.toBeInstanceOf(NotFoundError);
    await expect(request).rejects.toMatchObject({
      status: 404,
      requestID: 'req_runtime_missing_model',
      message: expect.stringContaining('model is unavailable in this AWS region'),
    });
  });

  test('maps Runtime transport timeouts to the standard SDK timeout error', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('connection timed out');
    });
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
      maxRetries: 0,
      fetch,
    });

    await expect(
      client.chat.completions.create({ model: RUNTIME_MODEL, messages: [] }),
    ).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('keeps the environment bearer mode across withOptions and refreshes its value', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'first-token';
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse();
    };
    const client = new OpenAI({ provider: bearerBedrock({ region: 'us-east-1' }), fetch });

    await client.request({ method: 'get', path: '/models' });
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    const copiedClient = client.withOptions({ timeout: 1000 });
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'refreshed-token';
    await copiedClient.request({ method: 'get', path: '/models' });

    expect(authorizationHeaders).toEqual(['Bearer first-token', 'Bearer refreshed-token']);
  });

});
