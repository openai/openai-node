import { vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError, NotFoundError } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';
import type { BedrockProviderOptions } from 'openai/providers/bedrock/aws';
import { SignatureV4 } from '@smithy/signature-v4';

import sigV4Fixture from '../fixtures/bedrock/v1/sigv4.json';

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

describe('bedrock provider', () => {
  test('owns the Mantle endpoint and bearer authentication', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bearerBedrock({ region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
    expect(String(requestedURL)).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1/models');
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer bedrock-token');
  });

  test('apiKey: null skips the environment bearer fallback', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'environment-token';
    process.env['AWS_EC2_METADATA_DISABLED'] = 'true';
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', apiKey: null }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'Could not find credentials for Bedrock',
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  test('the dependency-free entrypoint points AWS credential users to the AWS entrypoint', () => {
    expect(() => bearerBedrock({ region: 'us-east-1', apiKey: null })).toThrow(
      'openai/providers/bedrock/aws',
    );
  });

  test('baseURL: null skips the environment endpoint fallback', () => {
    process.env['AWS_BEDROCK_BASE_URL'] = 'https://environment.example/v1';

    const client = new OpenAI({
      provider: bearerBedrock({ region: 'us-east-1', baseURL: null, apiKey: 'bedrock-token' }),
    });

    expect(client.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
  });

  test('requires a region only when deriving the default endpoint', () => {
    expect(() => bearerBedrock({ apiKey: 'bedrock-token' })).toThrow('Bedrock requires an AWS region');
    expect(() => bearerBedrock({ endpoint: 'runtime', apiKey: 'bedrock-token' })).toThrow(
      'Bedrock requires an AWS region',
    );
    expect(() =>
      bearerBedrock({ baseURL: 'https://bedrock.example.com/openai/v1', apiKey: 'bedrock-token' }),
    ).not.toThrow();
  });

  test('normalizes a Responses URL back to its API root', () => {
    const client = new OpenAI({
      provider: bearerBedrock({
        baseURL: 'https://bedrock.example.com/responses/response-id',
        apiKey: 'bedrock-token',
      }),
    });

    expect(client.baseURL).toBe('https://bedrock.example.com');
  });

  test('matches the canonical SigV4 fixture and disables automatic redirects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(sigV4Fixture.signingDate));
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({
        region: sigV4Fixture.region,
        accessKeyId: sigV4Fixture.credentials.accessKeyId,
        secretAccessKey: sigV4Fixture.credentials.secretAccessKey,
        sessionToken: sigV4Fixture.credentials.sessionToken,
      }),
      organization: null,
      project: null,
      defaultHeaders: {
        accept: null,
        'user-agent': null,
        'x-stainless-retry-count': null,
        'x-stainless-lang': null,
        'x-stainless-package-version': null,
        'x-stainless-os': null,
        'x-stainless-arch': null,
        'x-stainless-runtime': null,
        'x-stainless-runtime-version': null,
      },
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({
      method: 'post',
      path: '/responses',
      body: sigV4Fixture.request.body,
      headers: { 'content-type': sigV4Fixture.request.contentType },
    });

    const headers = new Headers(requestedInit?.headers);
    expect(String(requestedURL)).toBe(sigV4Fixture.request.url);
    expect(requestedInit?.method).toBe(sigV4Fixture.request.method);
    expect(requestedInit?.redirect).toBe('manual');
    expect(requestedInit?.body).toBe(sigV4Fixture.request.body);
    expect(headers.get('x-amz-date')).toBe(sigV4Fixture.expected.date);
    expect(headers.get('x-amz-content-sha256')).toBe(sigV4Fixture.expected.payloadHash);
    expect(headers.get('x-amz-security-token')).toBe(sigV4Fixture.credentials.sessionToken);
    expect(headers.get('authorization')).toBe(sigV4Fixture.expected.authorization);
  });

  test.each([
    {
      endpoint: 'mantle' as const,
      hostname: 'bedrock-mantle.us-east-1.api.aws',
      service: 'bedrock-mantle',
    },
    {
      endpoint: 'runtime' as const,
      hostname: 'bedrock-runtime.us-east-1.amazonaws.com',
      service: 'bedrock',
    },
  ])(
    'signs $endpoint requests with the corresponding SigV4 credential scope',
    async ({ endpoint, hostname, service }) => {
      let requestedURL: RequestInfo | undefined;
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: bedrock({
          endpoint,
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
        fetch: async (url, init) => {
          requestedURL = url;
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: '/models' });

      expect(client.baseURL).toBe(`https://${hostname}/openai/v1`);
      expect(String(requestedURL)).toBe(`https://${hostname}/openai/v1/models`);
      expect(new Headers(requestedInit?.headers).get('authorization')).toMatch(
        new RegExp(`Credential=access-key/\\d{8}/us-east-1/${service}/aws4_request`),
      );
    },
  );

  test('supports the alternative Runtime /v1 root without changing the SigV4 service', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: bedrock({
        endpoint: 'runtime',
        region: 'us-east-1',
        baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com/v1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'post', path: '/responses', body: { input: 'hello' } });

    expect(client.baseURL).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/v1');
    expect(String(requestedURL)).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/v1/responses');
    expect(new Headers(requestedInit?.headers).get('authorization')).toMatch(
      /Credential=access-key\/\d{8}\/us-east-1\/bedrock\/aws4_request/,
    );
  });

  test.each([
    { endpoint: 'mantle' as const, service: 'bedrock-mantle' },
    { endpoint: 'runtime' as const, service: 'bedrock' },
  ])(
    'signs a custom $endpoint endpoint with its explicitly selected SigV4 service',
    async ({ endpoint, service }) => {
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: bedrock({
          endpoint,
          region: 'us-east-1',
          baseURL: 'https://proxy.example.com/openai/v1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
        fetch: async (_url, init) => {
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: '/models' });

      expect(new Headers(requestedInit?.headers).get('authorization')).toMatch(
        new RegExp(`Credential=access-key/\\d{8}/us-east-1/${service}/aws4_request`),
      );
    },
  );

  test.each([
    {
      authentication: 'bearer',
      provider: () => bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', apiKey: 'bedrock-token' }),
    },
    {
      authentication: 'AWS SigV4',
      provider: () =>
        bedrock({
          endpoint: 'runtime',
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
    },
  ])(
    'rejects cross-origin absolute paths before sending $authentication credentials',
    async ({ provider }) => {
      const fetch = vi.fn(async () => jsonResponse());
      const client = new OpenAI({ provider: provider(), fetch });

      const crossOriginPaths = [
        'https://other.example/openai/v1/models',
        'http://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/models',
        'https://bedrock-runtime.us-east-1.amazonaws.com:8443/openai/v1/models',
      ];

      await Promise.all(
        crossOriginPaths.map((path) =>
          expect(client.request({ method: 'get', path })).rejects.toThrow(
            /origin|different host|configured endpoint/i,
          ),
        ),
      );

      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      authentication: 'bearer',
      provider: () =>
        bearerBedrock({
          endpoint: 'runtime',
          region: 'us-east-1',
          baseURL: 'https://proxy.example.com/openai/v1',
          apiKey: 'bedrock-token',
        }),
      expectedAuthorization: /Bearer bedrock-token/,
    },
    {
      authentication: 'AWS SigV4',
      provider: () =>
        bedrock({
          endpoint: 'runtime',
          region: 'us-east-1',
          baseURL: 'https://proxy.example.com/openai/v1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
      expectedAuthorization: /\/bedrock\/aws4_request/,
    },
  ])(
    'allows same-origin absolute paths for a configured $authentication proxy',
    async ({ provider, expectedAuthorization }) => {
      let requestedURL: RequestInfo | undefined;
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: provider(),
        fetch: async (url, init) => {
          requestedURL = url;
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: 'https://proxy.example.com/openai/v1/models' });

      expect(String(requestedURL)).toBe('https://proxy.example.com/openai/v1/models');
      expect(new Headers(requestedInit?.headers).get('authorization')).toMatch(expectedAuthorization);
    },
  );

  test.each([
    { endpoint: 'mantle' as const, baseURL: 'http://localhost:8443/openai/v1' },
    { endpoint: 'runtime' as const, baseURL: 'http://proxy.example.com/openai/v1' },
  ])('allows an explicitly configured HTTP custom proxy for $endpoint', async ({ endpoint, baseURL }) => {
    const requestedURLs: string[] = [];
    const authorizationHeaders: string[] = [];
    const fetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
      requestedURLs.push(String(url));
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse();
    };
    const bearerClient = new OpenAI({
      provider: bearerBedrock({ endpoint, region: 'us-east-1', baseURL, apiKey: 'bedrock-token' }),
      fetch,
    });
    const awsClient = new OpenAI({
      provider: bedrock({
        endpoint,
        region: 'us-east-1',
        baseURL,
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch,
    });

    await bearerClient.request({ method: 'get', path: '/models' });
    await awsClient.request({ method: 'get', path: '/models' });

    expect(requestedURLs).toEqual([`${baseURL}/models`, `${baseURL}/models`]);
    expect(authorizationHeaders[0]).toBe('Bearer bedrock-token');
    expect(authorizationHeaders[1]).toContain(
      `/${endpoint === 'runtime' ? 'bedrock' : 'bedrock-mantle'}/aws4_request`,
    );
  });

  test('rejects a custom Authorization header before fetch', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bearerBedrock({ region: 'us-east-1', apiKey: 'bedrock-token' }),
      fetch,
    });

    await expect(
      client.request({
        method: 'get',
        path: '/models',
        headers: { authorization: 'Bearer custom-token' },
      }),
    ).rejects.toThrow('cannot be combined with a custom `Authorization` header');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects non-replayable SigV4 bodies before fetch', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const body = new FormData();
    body.append('input', 'hello');
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch,
    });

    await expect(client.request({ method: 'post', path: '/responses', body })).rejects.toThrow(
      'requires a replayable request body',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('surfaces bearer credential provider failures with their cause', async () => {
    const cause = new Error('token service unavailable');
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        tokenProvider: async () => {
          throw cause;
        },
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([[''], ['   '], [undefined as unknown as string]])(
    'rejects an invalid value returned by a bearer credential provider',
    async (token) => {
      const fetch = vi.fn(async () => jsonResponse());
      const client = new OpenAI({
        provider: bearerBedrock({ region: 'us-east-1', tokenProvider: async () => token }),
        fetch,
      });

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
        'must return a non-empty string',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('fails if an ambient bearer credential disappears before the request', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'temporary-token';
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({ provider: bearerBedrock({ region: 'us-east-1' }), fetch });
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: expect.objectContaining({
        message: expect.stringContaining('Could not find credentials for Bedrock'),
      }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    undefined,
    { accessKeyId: '', secretAccessKey: 'secret-key' },
    { accessKeyId: 'access-key', secretAccessKey: '' },
    { accessKeyId: 'access-key', secretAccessKey: 'secret-key', sessionToken: '' },
  ])('rejects an invalid identity returned by a credential provider', async (credentials) => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        credentialProvider: async () => credentials as any,
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'Failed to resolve AWS credentials for Bedrock',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('surfaces credential provider failures with their cause', async () => {
    const cause = new Error('credential service unavailable');
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        credentialProvider: async () => {
          throw cause;
        },
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toMatchObject({
      message:
        'Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.',
      cause,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects SigV4 authentication outside Node-compatible runtimes', async () => {
    const runtime = configureProvider(
      bedrock({ region: 'us-east-1', accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
    );
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    Object.defineProperty(globalThis, 'process', { configurable: true, value: undefined });

    let thrown: unknown;
    try {
      await runtime.prepareRequest!({ headers: new Headers(), method: 'GET' } as any, {
        url: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1/models',
        options: {} as any,
      });
    } catch (error) {
      thrown = error;
    } finally {
      if (processDescriptor) {
        Object.defineProperty(globalThis, 'process', processDescriptor);
      }
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining('only supported in Node.js and compatible server runtimes'),
    });
  });

  test('signs buffered body variants and replaces stale signing headers', async () => {
    const sign = vi.spyOn(SignatureV4.prototype, 'sign');
    const runtime = configureProvider(
      bedrock({
        endpoint: 'mantle',
        region: 'us-east-1',
        baseURL: 'https://localhost:8443/openai/v1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
    );
    const firstRequest = {
      headers: new Headers({
        'x-amz-date': 'stale-date',
        'x-amz-security-token': 'stale-token',
        'x-amz-content-sha256': 'stale-hash',
      }),
      method: 'post',
      body: new ArrayBuffer(2),
    } as any;

    await runtime.prepareRequest!(firstRequest, {
      url: 'https://localhost:8443/openai/v1/models?tag=one&tag=two&tag=three',
      options: {} as any,
    });

    expect(firstRequest.method).toBe('POST');
    expect(firstRequest.redirect).toBe('manual');
    expect(firstRequest.headers.get('host')).toBe('localhost:8443');
    expect(firstRequest.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    expect(firstRequest.headers.get('x-amz-date')).not.toBe('stale-date');
    expect(firstRequest.headers.get('x-amz-security-token')).toBeNull();
    expect(firstRequest.headers.get('x-amz-content-sha256')).not.toBe('stale-hash');
    expect(sign.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      port: 8443,
      path: '/openai/v1/models',
      query: { tag: ['one', 'two', 'three'] },
      body: firstRequest.body,
    });

    const secondRequest = { headers: new Headers(), method: 'post', body: new Uint8Array([1]) } as any;
    await runtime.prepareRequest!(secondRequest, {
      url: 'https://localhost:8443/openai/v1/responses',
      options: {} as any,
    });
    expect(secondRequest.method).toBe('POST');
    expect(secondRequest.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    expect(sign.mock.calls[1]?.[0]).toMatchObject({ method: 'POST', body: secondRequest.body });

    const thirdRequest = { headers: new Headers() } as any;
    await runtime.prepareRequest!(thirdRequest, {
      url: 'https://localhost:8443/openai/v1/models',
      options: {} as any,
    });
    expect(thirdRequest.method).toBe('GET');
    expect(sign.mock.calls[2]?.[0]).toMatchObject({ method: 'GET' });
  });

  test('signs with a valid custom credential provider', async () => {
    const credentialProvider = vi.fn(async () => ({
      accessKeyId: 'provider-access-key',
      secretAccessKey: 'provider-secret-key',
      sessionToken: 'provider-session-token',
    }));
    let requestedHeaders: Headers | undefined;
    const client = new OpenAI({
      provider: bedrock({ region: 'us-east-1', credentialProvider }),
      fetch: async (_url, init) => {
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(credentialProvider).toHaveBeenCalledTimes(1);
    expect(requestedHeaders?.get('authorization')).toContain('Credential=provider-access-key/');
    expect(requestedHeaders?.get('x-amz-security-token')).toBe('provider-session-token');
  });

  test('requires a signing region when a custom endpoint uses the default AWS credential chain', () => {
    expect(
      () =>
        new OpenAI({
          provider: bedrock({ endpoint: 'mantle', baseURL: 'https://bedrock.example.com/openai/v1' }),
        }),
    ).toThrow('Bedrock requires an AWS region');
  });

  test.each([
    { endpoint: 'mantle' as const, hostname: 'bedrock-mantle.us-west-2.api.aws' },
    { endpoint: 'runtime' as const, hostname: 'bedrock-runtime.us-west-2.amazonaws.com' },
  ])(
    'rejects a canonical $endpoint endpoint whose region does not match the configured AWS region',
    ({ endpoint, hostname }) => {
      const sharedOptions = {
        endpoint,
        region: 'us-east-1',
        baseURL: `https://${hostname}/openai/v1`,
      };
      const expectedMessage =
        'endpoint region `us-west-2` does not match the configured AWS region `us-east-1`';

      expect(() => bearerBedrock({ ...sharedOptions, apiKey: 'bedrock-token' })).toThrow(expectedMessage);
      expect(() =>
        bedrock({ ...sharedOptions, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
      ).toThrow(expectedMessage);
    },
  );

  test.each([
    { endpoint: 'mantle' as const, hostname: 'bedrock-mantle.us-east-1.api.aws' },
    { endpoint: 'runtime' as const, hostname: 'bedrock-runtime.us-east-1.amazonaws.com' },
  ])('rejects insecure HTTP for the canonical $endpoint AWS endpoint', ({ endpoint, hostname }) => {
    const sharedOptions = {
      endpoint,
      region: 'us-east-1',
      baseURL: `http://${hostname}/openai/v1`,
    };

    expect(() => bearerBedrock({ ...sharedOptions, apiKey: 'bedrock-token' })).toThrow(/HTTPS|https/);
    expect(() =>
      bedrock({ ...sharedOptions, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
    ).toThrow(/HTTPS|https/);
  });

  test.each([
    { endpoint: 'runtime' as const, hostname: 'bedrock-mantle.us-east-1.api.aws' },
    { endpoint: 'mantle' as const, hostname: 'bedrock-runtime.us-east-1.amazonaws.com' },
  ])('rejects a canonical host that does not match the explicit $endpoint mode', ({ endpoint, hostname }) => {
    const sharedOptions = {
      endpoint,
      region: 'us-east-1',
      baseURL: `https://${hostname}/openai/v1`,
    };

    expect(() => bearerBedrock({ ...sharedOptions, apiKey: 'bedrock-token' })).toThrow(/endpoint|mode/i);
    expect(() =>
      bedrock({ ...sharedOptions, accessKeyId: 'access-key', secretAccessKey: 'secret-key' }),
    ).toThrow(/endpoint|mode/i);
  });

  test.each(['https://proxy.example.com/openai/v1', 'https://localhost:8443/openai/v1'])(
    'requires an explicit endpoint mode before signing the custom endpoint %s',
    (baseURL) => {
      expect(() =>
        bedrock({
          region: 'us-east-1',
          baseURL,
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
      ).toThrow(/explicit.*endpoint|endpoint.*explicit/i);
    },
  );

  test('requires an explicit endpoint mode before signing a custom environment endpoint', () => {
    process.env['AWS_BEDROCK_BASE_URL'] = 'https://proxy.example.com/openai/v1';

    expect(() =>
      bedrock({
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
    ).toThrow(/explicit.*endpoint|endpoint.*explicit/i);
  });

  test.each(['', ' ', 'invalid', 'Runtime', null, 123])('rejects invalid endpoint mode %j', (endpoint) => {
    const invalidEndpoint = endpoint as BedrockProviderOptions['endpoint'];

    expect(() =>
      bearerBedrock({ endpoint: invalidEndpoint, region: 'us-east-1', apiKey: 'bedrock-token' }),
    ).toThrow(/endpoint.*mantle.*runtime/i);
    expect(() =>
      bedrock({ endpoint: invalidEndpoint, region: 'us-east-1', apiKey: 'bedrock-token' }),
    ).toThrow(/endpoint.*mantle.*runtime/i);
  });

  test.each<[string, BedrockProviderOptions]>([
    ['empty access key ID', { accessKeyId: '', secretAccessKey: 'secret-key' }],
    ['empty secret access key', { accessKeyId: 'access-key', secretAccessKey: '' }],
    ['empty session token', { accessKeyId: 'access-key', secretAccessKey: 'secret-key', sessionToken: '' }],
    ['empty profile', { profile: ' ' }],
    ['empty bearer credential', { apiKey: ' ' }],
    ['empty region', { region: ' ' }],
    ['empty base URL', { baseURL: ' ' }],
  ])('rejects an explicit %s instead of falling back to ambient credentials', (_name, options) => {
    expect(() => bedrock({ region: 'us-east-1', ...options })).toThrow(/must not be empty|non-empty/);
  });

  test.each<[string, BedrockProviderOptions]>([
    ['session token without static credentials', { sessionToken: 'session-token' }],
    [
      'multiple AWS credential modes',
      { accessKeyId: 'access-key', secretAccessKey: 'secret-key', profile: 'profile' },
    ],
    ['profile and credential provider', { profile: 'profile', credentialProvider: async () => ({}) as any }],
    ['bearer and AWS credentials', { apiKey: 'token', profile: 'profile' }],
    ['static bearer and token provider', { apiKey: 'token', tokenProvider: async () => 'token' }],
  ])('rejects %s', (_name, options) => {
    expect(() => bedrock({ region: 'us-east-1', ...options })).toThrow(
      /must be provided together|ambiguous|mutually exclusive/,
    );
  });
});
