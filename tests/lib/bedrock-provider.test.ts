import { vi } from 'vitest';
import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock } from 'openai/providers/bedrock/aws';
import type { BedrockProviderOptions } from 'openai/providers/bedrock/aws';
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

interface BedrockCredentialObservers {
  baseURL: string;
  tokenProvider: () => Promise<string>;
  credentialProvider: () => Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  }>;
}

const TRUSTED_BEDROCK_BASE_URL = 'https://bedrock.example.com/openai/v1';

const BEDROCK_AUTHENTICATION_MODES: readonly (readonly [
  string,
  (options: BedrockCredentialObservers) => ReturnType<typeof bearerBedrock>,
])[] = [
  [
    'dependency-free static bearer',
    ({ baseURL }) => bearerBedrock({ region: 'us-east-1', baseURL, apiKey: 'static-bedrock-token' }),
  ],
  [
    'dependency-free rotating bearer',
    ({ baseURL, tokenProvider }) => bearerBedrock({ region: 'us-east-1', baseURL, tokenProvider }),
  ],
  [
    'AWS static bearer',
    ({ baseURL }) => bedrock({ region: 'us-east-1', baseURL, apiKey: 'static-bedrock-token' }),
  ],
  [
    'AWS rotating bearer',
    ({ baseURL, tokenProvider }) => bedrock({ region: 'us-east-1', baseURL, tokenProvider }),
  ],
  [
    'AWS static SigV4 credentials',
    ({ baseURL }) =>
      bedrock({
        region: 'us-east-1',
        baseURL,
        accessKeyId: 'static-access-key',
        secretAccessKey: 'static-secret-key',
        sessionToken: 'static-session-token',
      }),
  ],
  [
    'AWS rotating SigV4 credential provider',
    ({ baseURL, credentialProvider }) => bedrock({ region: 'us-east-1', baseURL, credentialProvider }),
  ],
  ['AWS default credential chain', ({ baseURL }) => bedrock({ region: 'us-east-1', baseURL, apiKey: null })],
];

const CROSS_ORIGIN_BEDROCK_PATHS = [
  ['different host', 'https://attacker.example/exfiltrate?credential=private'],
  ['HTTP downgrade', 'http://bedrock.example.com/openai/v1/models?credential=private'],
  ['different effective port', 'https://bedrock.example.com:8443/openai/v1/models?credential=private'],
] as const;

const NON_HTTP_BEDROCK_URLS = [
  ['a file base URL and opaque data request', 'file:///trusted/openai/v1', 'data:text/plain,stolen'],
  ['an opaque data base URL and file request', 'data:text/plain,configured', 'file:///tmp/stolen'],
  [
    'a blob request with the trusted embedded HTTPS origin',
    TRUSTED_BEDROCK_BASE_URL,
    'blob:https://bedrock.example.com/01234567-89ab-cdef-0123-456789abcdef',
  ],
  [
    'a blob base URL with a matching HTTPS request origin',
    'blob:https://bedrock.example.com/01234567-89ab-cdef-0123-456789abcdef',
    'https://bedrock.example.com/openai/v1/models',
  ],
] as const;

function trackedBedrockCredentials(baseURL = TRUSTED_BEDROCK_BASE_URL) {
  process.env['AWS_ACCESS_KEY_ID'] = 'environment-access-key';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'environment-secret-key';
  process.env['AWS_SESSION_TOKEN'] = 'environment-session-token';

  return {
    baseURL,
    tokenProvider: vi.fn(async () => 'rotating-bedrock-token'),
    credentialProvider: vi.fn(async () => ({
      accessKeyId: 'provider-access-key',
      secretAccessKey: 'provider-secret-key',
      sessionToken: 'provider-session-token',
    })),
  };
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

  describe('request origin containment', () => {
    test.each(
      BEDROCK_AUTHENTICATION_MODES.flatMap(([mode, createProvider]) =>
        CROSS_ORIGIN_BEDROCK_PATHS.map(([attack, path]) => [mode, attack, createProvider, path] as const),
      ),
    )(
      'rejects %s with a %s before resolving credentials or sending',
      async (_mode, _attack, create, path) => {
        const credentials = trackedBedrockCredentials();
        const fetch = vi.fn(async () => jsonResponse());
        const sign = vi.spyOn(SignatureV4.prototype, 'sign');
        const client = new OpenAI({ provider: create(credentials), fetch, maxRetries: 0 });

        await expect(client.request({ method: 'get', path })).rejects.toThrow('Bedrock request origin');

        expect(fetch).not.toHaveBeenCalled();
        expect(credentials.tokenProvider).not.toHaveBeenCalled();
        expect(credentials.credentialProvider).not.toHaveBeenCalled();
        expect(sign).not.toHaveBeenCalled();
      },
    );

    test.each(
      BEDROCK_AUTHENTICATION_MODES.flatMap(([mode, createProvider]) =>
        NON_HTTP_BEDROCK_URLS.map(
          ([attack, baseURL, path]) => [mode, attack, createProvider, baseURL, path] as const,
        ),
      ),
    )(
      'rejects %s with %s before resolving credentials or sending',
      async (_mode, _attack, createProvider, baseURL, path) => {
        const credentials = trackedBedrockCredentials(baseURL);
        const fetch = vi.fn(async () => jsonResponse());
        const sign = vi.spyOn(SignatureV4.prototype, 'sign');
        const client = new OpenAI({ provider: createProvider(credentials), fetch, maxRetries: 0 });

        await expect(client.request({ method: 'get', path })).rejects.toThrow('Bedrock request origin');

        expect(fetch).not.toHaveBeenCalled();
        expect(credentials.tokenProvider).not.toHaveBeenCalled();
        expect(credentials.credentialProvider).not.toHaveBeenCalled();
        expect(sign).not.toHaveBeenCalled();
      },
    );

    test.each(BEDROCK_AUTHENTICATION_MODES)(
      'leaves the original request and headers untouched for cross-origin %s',
      async (_mode, createProvider) => {
        const credentials = trackedBedrockCredentials();
        const sign = vi.spyOn(SignatureV4.prototype, 'sign');
        const runtime = configureProvider(createProvider(credentials));
        const originalHeaders = new Headers({
          'x-amz-date': 'original-date',
          'x-amz-security-token': 'original-session-token',
          'x-request-marker': 'untouched',
        });
        const expectedHeaders = [...originalHeaders.entries()];
        const request = {
          method: 'post',
          headers: originalHeaders,
          redirect: 'follow',
        } as any;

        await expect(
          runtime.prepareRequest!(request, {
            url: 'https://attacker.example/exfiltrate?credential=private',
            options: {} as any,
          }),
        ).rejects.toThrow('Bedrock request origin');

        expect(request.headers).toBe(originalHeaders);
        expect([...originalHeaders.entries()]).toEqual(expectedHeaders);
        expect(request.method).toBe('post');
        expect(request.redirect).toBe('follow');
        expect(credentials.tokenProvider).not.toHaveBeenCalled();
        expect(credentials.credentialProvider).not.toHaveBeenCalled();
        expect(sign).not.toHaveBeenCalled();
      },
    );

    test('reports only canonical origins without leaking URL credentials, paths, queries, or fragments', async () => {
      const fetch = vi.fn(async () => jsonResponse());
      const client = new OpenAI({
        provider: bearerBedrock({ baseURL: TRUSTED_BEDROCK_BASE_URL, apiKey: 'bedrock-token' }),
        fetch,
      });
      const requestError = await client
        .request({
          method: 'get',
          path: 'https://embedded-user:embedded-password@attacker.example/exfiltrate/private?access_token=secret-query#secret-fragment',
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(requestError).toBeInstanceOf(Error);
      expect((requestError as Error).message).toContain('https://attacker.example');
      expect((requestError as Error).message).toContain('https://bedrock.example.com');
      expect((requestError as Error).message).not.toContain('embedded-user');
      expect((requestError as Error).message).not.toContain('embedded-password');
      expect((requestError as Error).message).not.toContain('/exfiltrate/private');
      expect((requestError as Error).message).not.toContain('secret-query');
      expect((requestError as Error).message).not.toContain('secret-fragment');
      expect((requestError as Error).message).not.toContain('/openai/v1');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('rejects cross-origin requests before inspecting the default AWS credential chain', async () => {
      const credentials = trackedBedrockCredentials();
      const fetch = vi.fn(async () => jsonResponse());
      const sign = vi.spyOn(SignatureV4.prototype, 'sign');
      const client = new OpenAI({
        provider: bedrock({ region: 'us-east-1', baseURL: credentials.baseURL, apiKey: null }),
        fetch,
        maxRetries: 0,
      });
      const credentialEnvironmentReads = vi.fn();
      const environment = process.env;
      process.env = new Proxy(environment, {
        get(target, property, receiver) {
          if (
            property === 'AWS_ACCESS_KEY_ID' ||
            property === 'AWS_SECRET_ACCESS_KEY' ||
            property === 'AWS_SESSION_TOKEN'
          ) {
            credentialEnvironmentReads(property);
          }
          return Reflect.get(target, property, receiver);
        },
      });

      await expect(
        client.request({ method: 'get', path: 'https://attacker.example/exfiltrate' }),
      ).rejects.toThrow('Bedrock request origin');

      expect(credentialEnvironmentReads).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    test.each(
      BEDROCK_AUTHENTICATION_MODES.flatMap(([mode, createProvider]) =>
        [
          [
            'a relative request on an arbitrary custom port',
            'https://custom.gateway.internal:9443/openai/v1',
            '/models',
            'https://custom.gateway.internal:9443/openai/v1/models',
          ],
          [
            'a same-origin absolute request outside the API base path',
            'https://custom.gateway.internal:9443/openai/v1',
            'https://CUSTOM.GATEWAY.INTERNAL:9443/another-api/models?view=summary',
            'https://custom.gateway.internal:9443/another-api/models?view=summary',
          ],
          [
            'an explicit default HTTPS port and uppercase hostname',
            'https://BEDROCK.EXAMPLE.COM:443/openai/v1',
            'https://bedrock.example.com:443/openai/v1/models',
            'https://bedrock.example.com/openai/v1/models',
          ],
          [
            'a configured HTTP endpoint with its implicit default port',
            'http://bedrock.example.com:80/openai/v1',
            'http://BEDROCK.EXAMPLE.COM/openai/v1/models',
            'http://bedrock.example.com/openai/v1/models',
          ],
        ].map(
          ([control, baseURL, path, expectedURL]) =>
            [mode, control, createProvider, baseURL!, path!, expectedURL!] as const,
        ),
      ),
    )('allows %s with %s', async (mode, _control, createProvider, baseURL, path, expectedURL) => {
      const credentials = trackedBedrockCredentials(baseURL);
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => jsonResponse());
      const client = new OpenAI({ provider: createProvider(credentials), fetch, maxRetries: 0 });

      await client.request({ method: 'get', path });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toBe(expectedURL);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBeTruthy();
      expect(credentials.tokenProvider).toHaveBeenCalledTimes(mode.includes('rotating bearer') ? 1 : 0);
      expect(credentials.credentialProvider).toHaveBeenCalledTimes(
        mode.includes('credential provider') ? 1 : 0,
      );
    });

    test.each([
      ['original client', false],
      ['cloned client', true],
    ] as const)(
      'keeps the configured provider origin after mutating the %s baseURL',
      async (_name, clone) => {
        const credentials = trackedBedrockCredentials();
        const fetch = vi.fn(async () => jsonResponse());
        const client = new OpenAI({
          provider: bearerBedrock({
            baseURL: credentials.baseURL,
            tokenProvider: credentials.tokenProvider,
          }),
          fetch,
          maxRetries: 0,
        });
        const requestClient = clone ? client.withOptions({ timeout: 1000 }) : client;
        requestClient.baseURL = 'https://attacker.example/openai/v1';

        await expect(requestClient.request({ method: 'get', path: '/exfiltrate' })).rejects.toThrow(
          'Bedrock request origin',
        );

        expect(credentials.tokenProvider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    test.each(
      BEDROCK_AUTHENTICATION_MODES.filter(([mode]) => /rotating bearer|credential provider/.test(mode)),
    )('checks the final request origin again before a retry with %s', async (mode, createProvider) => {
      const credentials = trackedBedrockCredentials();
      const options = { method: 'get' as const, path: '/models', maxRetries: 1 };
      const fetch = vi.fn(async () => {
        options.path = 'https://attacker.example/exfiltrate';
        return Response.json(
          { error: { message: 'retry the request' } },
          { status: 500, headers: { 'retry-after-ms': '1' } },
        );
      });
      const client = new OpenAI({ provider: createProvider(credentials), fetch });

      await expect(client.request(options)).rejects.toThrow('Bedrock request origin');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(credentials.tokenProvider).toHaveBeenCalledTimes(mode.includes('rotating bearer') ? 1 : 0);
      expect(credentials.credentialProvider).toHaveBeenCalledTimes(
        mode.includes('credential provider') ? 1 : 0,
      );
    });
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
          provider: bedrock({ baseURL: 'https://bedrock.example.com/openai/v1' }),
        }),
    ).toThrow('Bedrock requires an AWS region');
  });

  test('rejects a canonical endpoint whose region does not match the signing region', async () => {
    const fetch = vi.fn(async () => jsonResponse());
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
