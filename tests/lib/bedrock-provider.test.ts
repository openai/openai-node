import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock, type BedrockProviderOptions } from 'openai/providers/bedrock/aws';
import { SignatureV4 } from '@smithy/signature-v4';

import sigV4Fixture from '../fixtures/bedrock/v1/sigv4.json';

const originalEnv = process.env;
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
  for (const name of BEDROCK_ENVIRONMENT_VARIABLES) delete process.env[name];
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = originalEnv;
});

function jsonResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
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
    const copiedClient = client.withOptions({ timeout: 1_000 });
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'refreshed-token';
    await copiedClient.request({ method: 'get', path: '/models' });

    expect(authorizationHeaders).toEqual(['Bearer first-token', 'Bearer refreshed-token']);
  });

  test('apiKey: null skips the environment bearer fallback', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'environment-token';
    process.env['AWS_EC2_METADATA_DISABLED'] = 'true';
    const fetch = jest.fn(async () => jsonResponse());
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date(sigV4Fixture.signingDate));
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

  test('rejects a custom Authorization header before fetch', async () => {
    const fetch = jest.fn(async () => jsonResponse());
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
    const fetch = jest.fn(async () => jsonResponse());
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
    const fetch = jest.fn(async () => jsonResponse());
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
      const fetch = jest.fn(async () => jsonResponse());
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
    const fetch = jest.fn(async () => jsonResponse());
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
    const fetch = jest.fn(async () => jsonResponse());
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
    const fetch = jest.fn(async () => jsonResponse());
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
      if (processDescriptor) Object.defineProperty(globalThis, 'process', processDescriptor);
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining('only supported in Node.js and compatible server runtimes'),
    });
  });

  test('signs buffered body variants and replaces stale signing headers', async () => {
    const sign = jest.spyOn(SignatureV4.prototype, 'sign');
    const runtime = configureProvider(
      bedrock({
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
    const credentialProvider = jest.fn(async () => ({
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
          provider: bedrock({ baseURL: 'https://bedrock.example.com/openai/v1' }),
        }),
    ).toThrow('Bedrock requires an AWS region');
  });

  test('rejects a canonical endpoint whose region does not match the signing region', async () => {
    const fetch = jest.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: bedrock({
        region: 'us-east-1',
        baseURL: 'https://bedrock-mantle.us-west-2.api.aws/openai/v1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'endpoint region `us-west-2` does not match the SigV4 region `us-east-1`',
    );
    expect(fetch).not.toHaveBeenCalled();
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
