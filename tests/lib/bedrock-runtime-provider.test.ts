import { vi } from 'vitest';

import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';

const originalEnv = process.env;
const RUNTIME_MODEL = 'us.openai.gpt-5.6-sol';
const DOTTED_CANONICAL_BEDROCK_ENDPOINTS = [
  { endpoint: 'mantle' as const, region: 'us-east-1', hostname: 'bedrock-mantle.us-east-1.api.aws.' },
  { endpoint: 'runtime' as const, region: 'us-east-1', hostname: 'bedrock-runtime.us-east-1.amazonaws.com.' },
  {
    endpoint: 'runtime' as const,
    region: 'cn-north-1',
    hostname: 'bedrock-runtime.cn-north-1.amazonaws.com.cn.',
  },
  {
    endpoint: 'runtime' as const,
    region: 'eusc-de-east-1',
    hostname: 'bedrock-runtime.eusc-de-east-1.amazonaws.eu.',
  },
  {
    endpoint: 'runtime' as const,
    region: 'us-iso-east-1',
    hostname: 'bedrock-runtime.us-iso-east-1.c2s.ic.gov.',
  },
  {
    endpoint: 'runtime' as const,
    region: 'us-isob-east-1',
    hostname: 'bedrock-runtime.us-isob-east-1.sc2s.sgov.gov.',
  },
  {
    endpoint: 'runtime' as const,
    region: 'eu-isoe-west-1',
    hostname: 'bedrock-runtime.eu-isoe-west-1.cloud.adc-e.uk.',
  },
  {
    endpoint: 'runtime' as const,
    region: 'us-isof-south-1',
    hostname: 'bedrock-runtime.us-isof-south-1.csp.hci.ic.gov.',
  },
];
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
    Reflect.deleteProperty(process.env, name);
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

function expectRejectedBedrockConfiguration(
  options: { endpoint: 'mantle' | 'runtime'; region: string; baseURL: string },
  expectedError: RegExp,
): void {
  const fetch = vi.fn(async () => jsonResponse());
  const providers = [
    () => bearerBedrock({ ...options, apiKey: 'bedrock-token' }),
    () => bedrock({ ...options, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
  ];

  for (const provider of providers) {
    expect(() => new OpenAI({ provider: provider(), fetch })).toThrow(expectedError);
  }
  expect(fetch).not.toHaveBeenCalled();
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

    expect(client.baseURL).toBe('https://bedrock-runtime.eusc-de-east-1.amazonaws.eu/openai/v1');
  });

  test.each(DOTTED_CANONICAL_BEDROCK_ENDPOINTS)(
    'preserves a valid dotted HTTPS $endpoint endpoint and credentials for $region',
    async ({ endpoint, region, hostname }) => {
      const baseURL = `https://${hostname}/openai/v1`;
      const requestedURLs: string[] = [];
      const authorizationHeaders: string[] = [];
      const fetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
        requestedURLs.push(String(url));
        authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
        return jsonResponse();
      };
      const bearerClient = new OpenAI({
        provider: bearerBedrock({ endpoint, region, baseURL, apiKey: 'bedrock-token' }),
        fetch,
      });
      const awsClient = new OpenAI({
        provider: bedrock({
          endpoint,
          region,
          baseURL,
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
        fetch,
      });

      expect(bearerClient.baseURL).toBe(baseURL);
      expect(awsClient.baseURL).toBe(baseURL);
      await bearerClient.request({ method: 'get', path: '/models' });
      await awsClient.request({ method: 'get', path: '/models' });

      expect(requestedURLs).toEqual([`${baseURL}/models`, `${baseURL}/models`]);
      expect(authorizationHeaders[0]).toBe('Bearer bedrock-token');
      expect(authorizationHeaders[1]).toContain(
        `/${region}/${endpoint === 'runtime' ? 'bedrock' : 'bedrock-mantle'}/aws4_request`,
      );
    },
  );

  test.each(DOTTED_CANONICAL_BEDROCK_ENDPOINTS)(
    'rejects dotted canonical $endpoint HTTP for $region before attaching credentials',
    ({ endpoint, region, hostname }) => {
      expectRejectedBedrockConfiguration(
        { endpoint, region, baseURL: `http://${hostname}/openai/v1` },
        /HTTPS/iu,
      );
    },
  );

  test.each([
    { endpoint: 'runtime' as const, hostname: 'bedrock-mantle.us-east-1.api.aws.' },
    { endpoint: 'mantle' as const, hostname: 'bedrock-runtime.us-east-1.amazonaws.com.' },
  ])(
    'rejects a dotted canonical hostname that mismatches the $endpoint endpoint',
    ({ endpoint, hostname }) => {
      expectRejectedBedrockConfiguration(
        { endpoint, region: 'us-east-1', baseURL: `https://${hostname}/openai/v1` },
        /endpoint|mode/iu,
      );
    },
  );

  test.each([
    { endpoint: 'mantle' as const, hostname: 'bedrock-mantle.us-west-2.api.aws.' },
    { endpoint: 'runtime' as const, hostname: 'bedrock-runtime.us-west-2.amazonaws.com.' },
  ])(
    'rejects a dotted canonical $endpoint hostname with a mismatched AWS region',
    ({ endpoint, hostname }) => {
      expectRejectedBedrockConfiguration(
        { endpoint, region: 'us-east-1', baseURL: `https://${hostname}/openai/v1` },
        /endpoint region.*does not match/iu,
      );
    },
  );

  test.each([
    ['userinfo and fragment injection', 'us-east-1.amazonaws.com@attacker.example#'],
    ['path injection', 'us-east-1/../../attacker.example'],
    ['query injection', 'us-east-1?target=attacker.example'],
    ['malformed region', 'not-a-region'],
  ])('rejects %s in explicit AWS regions before configuring any Bedrock provider', (_scenario, region) => {
    for (const endpoint of ['mantle', 'runtime'] as const) {
      expect(() => bearerBedrock({ endpoint, region, apiKey: 'bedrock-token' })).toThrow(
        /region.*invalid|invalid.*region|valid.*region/iu,
      );
      expect(() =>
        bedrock({ endpoint, region, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
      ).toThrow(/region.*invalid|invalid.*region|valid.*region/iu);
    }
  });

  test.each(['AWS_REGION', 'AWS_DEFAULT_REGION'] as const)(
    'rejects URL-delimiter injection through the %s environment variable',
    (environmentVariable) => {
      process.env[environmentVariable] = 'us-east-1.amazonaws.com@attacker.example#';

      for (const endpoint of ['mantle', 'runtime'] as const) {
        expect(() => bearerBedrock({ endpoint, apiKey: 'bedrock-token' })).toThrow(
          /region.*invalid|invalid.*region|valid.*region/iu,
        );
        expect(() => bedrock({ endpoint, accessKeyId: 'access-key', secretAccessKey: 'secret-key' })).toThrow(
          /region.*invalid|invalid.*region|valid.*region/iu,
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
      ).toThrow(/region.*invalid|invalid.*region|valid.*region/iu);
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
      /Credential=first-access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/u,
    );
    expect(requestHeaders[1]?.get('authorization')).toMatch(
      /Credential=second-access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/u,
    );
    expect(requestHeaders.map((headers) => headers.get('x-amz-security-token'))).toEqual([
      'first-session-token',
      'second-session-token',
    ]);
  });
});
