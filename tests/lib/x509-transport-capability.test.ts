import { Agent, Pool, ProxyAgent } from 'undici';
import { expect, vi } from 'vitest';

import OpenAI from 'openai';

const identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_certificate_a',
  serviceAccountId: 'svc_certificate_a',
};

function tokenResponse(token = 'certificate-token'): Response {
  return globalThis.Response.json({ access_token: token, expires_in: 3600 });
}

function successfulFetch() {
  return vi.fn(async (url: string | URL | Request) =>
    url.toString().includes('/oauth/token') ? tokenResponse() : globalThis.Response.json({ data: [] }),
  );
}

describe('X.509 transport capability boundary', () => {
  const originalBun = (globalThis as { Bun?: unknown }).Bun;
  const originalHTTPSProxy = process.env['HTTPS_PROXY'];
  const originalLowercaseHTTPSProxy = process.env['https_proxy'];
  const originalAllProxy = process.env['ALL_PROXY'];
  const originalLowercaseAllProxy = process.env['all_proxy'];

  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
    delete process.env['HTTPS_PROXY'];
    delete process.env['https_proxy'];
    delete process.env['ALL_PROXY'];
    delete process.env['all_proxy'];
    Reflect.deleteProperty(globalThis, 'Bun');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
    for (const [name, value] of [
      ['HTTPS_PROXY', originalHTTPSProxy],
      ['https_proxy', originalLowercaseHTTPSProxy],
      ['ALL_PROXY', originalAllProxy],
      ['all_proxy', originalLowercaseAllProxy],
    ] as const) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, 'Bun');
    } else {
      Reflect.set(globalThis, 'Bun', originalBun);
    }
  });

  test.each([
    'https://resource.openai.azure.com/openai/v1',
    'https://resource.openai.azure.us/openai/v1',
    'https://resource.services.ai.azure.com/openai/v1',
    'https://resource.services.ai.azure.us/openai/v1',
    'https://resource.azure-api.net/openai/v1',
    'https://resource.cognitiveservices.azure.com/openai/v1',
    'https://resource.cognitiveservices.azure.us/openai/v1',
    'https://RESOURCE.OPENAI.AZURE.COM./openai/v1',
    'https://bedrock-mantle.us-west-2.api.aws/openai/v1',
    'https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1',
    'https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com/openai/v1',
    'https://bedrock-runtime.us-east-1.api.aws/openai/v1',
    'https://bedrock-runtime.cn-north-1.api.amazonwebservices.com.cn/openai/v1',
    'https://bedrock-runtime.eusc-de-east-1.amazonaws.eu/openai/v1',
    'https://bedrock-runtime.us-iso-east-1.c2s.ic.gov/openai/v1',
    'https://bedrock-runtime.us-isob-east-1.api.aws.scloud/openai/v1',
    'https://bedrock-runtime.eu-isoe-west-1.cloud.adc-e.uk/openai/v1',
    'https://bedrock-runtime.us-isof-south-1.api.aws.hci.ic.gov/openai/v1',
  ])('rejects provider-owned API origin %s before token acquisition', (baseURL) => {
    const fetch = successfulFetch();

    expect(() => new OpenAI({ apiKey: null, workloadIdentity: identity, baseURL, fetch })).toThrow(
      /provider|origin/iu,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects a provider-owned API origin inherited from OPENAI_BASE_URL', () => {
    process.env['OPENAI_BASE_URL'] = 'https://resource.openai.azure.com/openai/v1';
    const fetch = successfulFetch();

    expect(() => new OpenAI({ apiKey: null, workloadIdentity: identity, fetch })).toThrow(
      /provider|origin/iu,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves a custom OpenAI gateway and ordinary API-key use of a provider-owned origin', async () => {
    const gatewayFetch = successfulFetch();
    const gateway = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      baseURL: 'https://gateway.example/openai/v1',
      fetch: gatewayFetch,
    });
    await expect(gateway.models.list()).resolves.toMatchObject({ data: [] });

    const providerFetch = vi.fn(async () => globalThis.Response.json({ data: [] }));
    const ordinaryClient = new OpenAI({
      apiKey: 'ordinary-api-key',
      baseURL: 'https://resource.openai.azure.com/openai/v1',
      fetch: providerFetch,
    });
    await expect(ordinaryClient.models.list()).resolves.toMatchObject({ data: [] });

    expect(gatewayFetch).toHaveBeenCalledTimes(2);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  test('rejects a dynamic Undici connector before token acquisition', async () => {
    const dispatcher = new Agent({
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Undici's connector contract is callback-based.
      connect(_options, callback) {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This callback must never be reached.
        callback(new Error('dynamic connector must not run'), null);
      },
    });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher: dispatcher as never },
    });

    await expect(client.models.list()).rejects.toThrow(/dynamic|static|certificate/iu);
    expect(fetch).not.toHaveBeenCalled();
    await dispatcher.close();
  });

  test('rejects a custom Undici origin factory before token acquisition', async () => {
    const dispatcher = new Agent({
      connect: { cert: 'certificate-a', key: 'private-key-a' },
      factory(origin, options) {
        return new Pool(origin, options);
      },
    });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher: dispatcher as never },
    });

    await expect(client.models.list()).rejects.toThrow(/factory|static|certificate/iu);
    expect(fetch).not.toHaveBeenCalled();
    await dispatcher.close();
  });

  test.each([
    {
      label: 'factory',
      options: {
        factory(origin: URL, options: object) {
          return new Pool(origin, options);
        },
      },
    },
    {
      label: 'clientFactory',
      options: {
        clientFactory(origin: URL, options: object) {
          return new Pool(origin, options);
        },
      },
    },
  ])('rejects an executable ProxyAgent $label before token acquisition', async ({ options }) => {
    const dispatcher = new ProxyAgent({
      uri: 'https://proxy.example:8443',
      requestTls: { cert: 'certificate-a', key: 'private-key-a' },
      ...options,
    });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher },
    });

    await expect(client.models.list()).rejects.toThrow(/ProxyAgent|factory|executable|verify/iu);
    expect(fetch).not.toHaveBeenCalled();
    await dispatcher.close();
  });

  test('preserves a static Undici Agent certificate across token and API calls', async () => {
    const dispatcher = new Agent({ connect: { cert: 'certificate-a', key: 'private-key-a' } });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher },
    });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    await expect(client.withOptions({ fetchOptions: { dispatcher } }).models.list()).resolves.toMatchObject({
      data: [],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    await dispatcher.close();
  });

  test('fails closed for executable dispatchers whose certificate identity cannot be verified', async () => {
    const dispatcher = { dispatch() {} };
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher: dispatcher as never },
    });

    await expect(client.models.list()).rejects.toThrow(/cannot verify|static Undici/iu);
    expect(fetch).not.toHaveBeenCalled();

    const apiKeyFetch = vi.fn(async () => globalThis.Response.json({ data: [] }));
    const apiKeyClient = new OpenAI({
      apiKey: 'ordinary-api-key',
      fetch: apiKeyFetch,
      fetchOptions: { dispatcher: dispatcher as never },
    });
    await expect(apiKeyClient.models.list()).resolves.toMatchObject({ data: [] });
    expect(apiKeyFetch).toHaveBeenCalledTimes(1);

    let subjectTokenRequests = 0;
    const subjectTokenFetch = vi.fn(async () => {
      const isTokenRequest = subjectTokenRequests === 0;
      subjectTokenRequests += 1;
      return isTokenRequest ? tokenResponse('subject-token-bearer') : globalThis.Response.json({ data: [] });
    });
    const subjectTokenClient = new OpenAI({
      apiKey: null,
      workloadIdentity: {
        identityProviderId: 'idp_subject_token',
        serviceAccountId: 'svc_subject_token',
        provider: { tokenType: 'jwt', getToken: async () => 'subject-token' },
      },
      fetch: subjectTokenFetch,
      fetchOptions: { dispatcher: dispatcher as never },
    });
    await expect(subjectTokenClient.models.list()).resolves.toMatchObject({ data: [] });
    expect(subjectTokenFetch).toHaveBeenCalledTimes(2);
  });

  test.each(['agent', 'client'] as const)(
    'rejects opaque %s transport selectors before token acquisition',
    async (key) => {
      const fetch = successfulFetch();
      const client = new OpenAI({
        apiKey: null,
        workloadIdentity: identity,
        fetch,
        fetchOptions: { [key]: { request() {} } } as never,
      });

      await expect(client.models.list()).rejects.toThrow(/opaque|static Undici/iu);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    { cert: ['certificate-a'], key: ['private-key-a'] },
    { cert: Buffer.from('certificate-a'), key: Buffer.from('private-key-a') },
    { pfx: new Uint8Array([1, 2, 3]) },
  ])('rejects mutable Bun certificate containers before token acquisition', async (tls) => {
    Reflect.set(globalThis, 'Bun', { version: '1.3.0' });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { tls } as never,
    });

    await expect(client.models.list()).rejects.toThrow(/immutable|mutable|certificate/iu);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does not revive a cached bearer when a TLS option is removed and restored', async () => {
    const tls: { cert?: string; key: string } = { cert: 'certificate-a', key: 'private-key-a' };
    const authorizations: (string | null)[] = [];
    let exchanges = 0;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/oauth/token')) {
        exchanges += 1;
        return tokenResponse(`certificate-token-${exchanges}`);
      }
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return globalThis.Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { tls } as never,
    });

    await client.models.list();
    Reflect.deleteProperty(tls, 'cert');
    await client.models.list();
    tls.cert = 'certificate-a';
    await client.models.list();

    expect(exchanges).toBe(3);
    expect(authorizations).toEqual([
      'Bearer certificate-token-1',
      'Bearer certificate-token-2',
      'Bearer certificate-token-3',
    ]);
  });

  test('rejects inherited and explicit Bun HTTPS proxies but preserves HTTP CONNECT', async () => {
    Reflect.set(globalThis, 'Bun', { version: '1.3.0' });
    process.env['HTTPS_PROXY'] = 'https://trusted-proxy.example:8443';
    const inheritedFetch = successfulFetch();
    const inherited = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: inheritedFetch,
      fetchOptions: { tls: { cert: 'certificate-a', key: 'private-key-a' } } as never,
    });
    await expect(inherited.models.list()).rejects.toThrow(/https prox(?:y|ies)|proxy.*certificate/iu);
    expect(inheritedFetch).not.toHaveBeenCalled();

    delete process.env['HTTPS_PROXY'];
    const explicitFetch = successfulFetch();
    const explicit = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: explicitFetch,
      fetchOptions: {
        tls: { cert: 'certificate-a', key: 'private-key-a' },
        proxy: 'https://trusted-proxy.example:8443',
      } as never,
    });
    await expect(explicit.models.list()).rejects.toThrow(/https prox(?:y|ies)|proxy.*certificate/iu);
    expect(explicitFetch).not.toHaveBeenCalled();

    const httpFetch = successfulFetch();
    const httpProxy = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: httpFetch,
      fetchOptions: {
        tls: { cert: 'certificate-a', key: 'private-key-a' },
        proxy: 'http://trusted-proxy.example:8080',
      } as never,
    });
    await expect(httpProxy.models.list()).resolves.toMatchObject({ data: [] });
    expect(httpFetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['a trusted custom fetch', undefined],
    ['static TLS options', { tls: { cert: 'certificate-a', key: 'private-key-a' } }],
  ] as const)(
    'rotates cached credentials with Bun inherited HTTP CONNECT proxies using %s',
    async (_, options) => {
      Reflect.set(globalThis, 'Bun', { version: '1.3.0' });
      process.env['HTTPS_PROXY'] = 'http://proxy-a.example:8080';
      let exchanges = 0;
      const authorizations: (string | null)[] = [];
      const client = new OpenAI({
        apiKey: null,
        workloadIdentity: identity,
        fetchOptions: options as never,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchanges += 1;
            return tokenResponse(`proxy-token-${exchanges}`);
          }
          authorizations.push(new Headers(init?.headers).get('Authorization'));
          return globalThis.Response.json({ data: [] });
        }),
      });

      await client.models.list();
      process.env['HTTPS_PROXY'] = 'http://proxy-b.example:8080';
      await client.models.list();
      process.env['HTTPS_PROXY'] = 'http://proxy-a.example:8080';
      await client.models.list();

      expect(exchanges).toBe(3);
      expect(authorizations).toEqual([
        'Bearer proxy-token-1',
        'Bearer proxy-token-2',
        'Bearer proxy-token-3',
      ]);
    },
  );

  test('keeps cached credentials when an explicit Bun proxy shadows inherited changes', async () => {
    Reflect.set(globalThis, 'Bun', { version: '1.3.0' });
    process.env['HTTPS_PROXY'] = 'http://inherited-a.example:8080';
    let exchanges = 0;
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: {
        proxy: 'http://explicit.example:8080',
        tls: { cert: 'certificate-a', key: 'private-key-a' },
      } as never,
      fetch: vi.fn(async (url: string | URL | Request) => {
        if (url.toString().includes('/oauth/token')) {
          exchanges += 1;
          return tokenResponse();
        }
        return globalThis.Response.json({ data: [] });
      }),
    });

    await client.models.list();
    process.env['HTTPS_PROXY'] = 'http://inherited-b.example:8080';
    await client.models.list();

    expect(exchanges).toBe(1);
  });

  test('rejects an unverifiable Undici ProxyAgent before token acquisition', async () => {
    const dispatcher = new ProxyAgent({
      uri: 'https://proxy.example:8443',
      requestTls: { cert: 'certificate-a', key: 'private-key-a' },
      proxyTls: { ca: 'proxy-ca' },
    });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher },
    });

    await expect(client.models.list()).rejects.toThrow(/ProxyAgent|factory|executable|verify/iu);
    expect(fetch).not.toHaveBeenCalled();
    await dispatcher.close();
  });

  test('rejects client certificate material in an unverifiable Undici ProxyAgent', async () => {
    const dispatcher = new ProxyAgent({
      uri: 'https://proxy.example:8443',
      requestTls: { cert: 'certificate-a', key: 'private-key-a' },
      proxyTls: { cert: 'certificate-a', key: 'private-key-a' },
    });
    const fetch = successfulFetch();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch,
      fetchOptions: { dispatcher },
    });

    await expect(client.models.list()).rejects.toThrow(/ProxyAgent|factory|executable|verify/iu);
    expect(fetch).not.toHaveBeenCalled();
    await dispatcher.close();
  });
});
