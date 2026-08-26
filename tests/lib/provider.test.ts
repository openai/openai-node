import { vi } from 'vitest';
import OpenAI from 'openai';
import { createProvider } from 'openai/internal/provider';
import type { ProviderRuntime } from 'openai/internal/provider';
import type { Fetch } from 'openai/internal/builtin-types';
import { formatRequestDetails } from 'openai/internal/utils/log';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

function provider(runtime: Omit<ProviderRuntime, 'name' | 'baseURL'> & Partial<ProviderRuntime> = {}) {
  return createProvider({
    configure: () => ({
      name: 'test-provider',
      baseURL: 'https://provider.example/v1',
      ...runtime,
    }),
  });
}

describe('provider', () => {
  test('owns the base URL and authentication instead of using OpenAI environment variables', async () => {
    process.env['OPENAI_API_KEY'] = 'openai-api-key';
    process.env['OPENAI_ADMIN_KEY'] = 'openai-admin-key';
    process.env['OPENAI_BASE_URL'] = 'https://openai.example/v1';
    process.env['OPENAI_ORG_ID'] = 'openai-org';
    process.env['OPENAI_PROJECT_ID'] = 'openai-project';
    process.env['OPENAI_CUSTOM_HEADERS'] = 'X-OpenAI-Ambient: leaked';

    let requestedURL: string | URL | Request | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: provider({
        prepareRequest(request, { url }) {
          expect(url).toBe('https://provider.example/v1/models');
          expect(request.headers.has('authorization')).toBe(false);
          expect(request.headers.has('openai-organization')).toBe(false);
          expect(request.headers.has('openai-project')).toBe(false);
          expect(request.headers.has('x-openai-ambient')).toBe(false);
          request.headers.set('authorization', 'Provider token');
        },
      }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });

    const callApiKey = vi.spyOn(client, '_callApiKey');
    const authHeaders = vi.spyOn(client as any, 'authHeaders');
    const validateHeaders = vi.spyOn(client as any, 'validateHeaders');

    await client.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://provider.example/v1');
    expect(client.buildURL('/models', null, 'https://route-default.example/v1')).toBe(
      'https://provider.example/v1/models',
    );
    expect(requestedURL).toBe('https://provider.example/v1/models');
    expect((requestedInit?.headers as Headers | undefined)?.get('authorization')).toBe('Provider token');
    expect(callApiKey).not.toHaveBeenCalled();
    expect(authHeaders).not.toHaveBeenCalled();
    expect(validateHeaders).not.toHaveBeenCalled();
  });

  test.each([
    ['apiKey', 'openai-api-key'],
    ['adminAPIKey', 'openai-admin-key'],
    ['workloadIdentity', {}],
    ['baseURL', 'https://override.example/v1'],
  ])('rejects an explicit %s option', (key, value) => {
    expect(
      () =>
        new OpenAI({
          provider: provider(),
          [key]: value,
        }),
    ).toThrow(`\`${key}\``);
  });

  test('reports every conflicting top-level option together', () => {
    expect(
      () =>
        new OpenAI({
          provider: provider(),
          apiKey: 'openai-api-key',
          adminAPIKey: 'openai-admin-key',
          workloadIdentity: {
            identityProviderId: 'identity-provider',
            serviceAccountId: 'service-account',
            provider: { tokenType: 'jwt', getToken: async () => 'subject-token' },
          },
          baseURL: 'https://override.example/v1',
        }),
    ).toThrow('`apiKey`, `adminAPIKey`, `workloadIdentity`, `baseURL`');
  });

  test('allows null top-level options', () => {
    expect(
      () =>
        new OpenAI({
          provider: provider(),
          apiKey: null,
          adminAPIKey: null,
          workloadIdentity: null,
          baseURL: null,
        } as any),
    ).not.toThrow();
  });

  test('configures one runtime per client and preserves the provider in withOptions', () => {
    process.env['OPENAI_API_KEY'] = 'openai-api-key';
    process.env['OPENAI_ADMIN_KEY'] = 'openai-admin-key';
    process.env['OPENAI_BASE_URL'] = 'https://openai.example/v1';

    const configure = vi.fn(() => ({
      name: 'test-provider',
      baseURL: 'https://provider.example/v1',
    }));
    const configuredProvider = createProvider({ configure });
    const client = new OpenAI({ provider: configuredProvider });
    const cloned = client.withOptions({ timeout: 1 });

    expect(configure).toHaveBeenCalledTimes(2);
    expect(cloned).not.toBe(client);
    expect(cloned.baseURL).toBe('https://provider.example/v1');
    expect(cloned.timeout).toBe(1);
  });

  test('preserves provider headers when cloning withOptions', async () => {
    let requestedHeaders: Headers | undefined;
    const client = new OpenAI({
      provider: provider(),
      defaultHeaders: { 'x-provider-custom': 'preserve-me' },
      fetch: async (_url, init) => {
        requestedHeaders = new Headers(init?.headers);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });

    await client.withOptions({ timeout: 1 }).request({ method: 'get', path: '/models' });

    expect(requestedHeaders?.get('x-provider-custom')).toBe('preserve-me');
  });

  test('does not let a request-level default base URL replace the provider base URL', () => {
    const client = new OpenAI({
      provider: provider({ baseURL: 'https://api.openai.com/v1' }),
    });

    expect(client.buildURL('/models', null, 'https://route-default.example/v1')).toBe(
      'https://api.openai.com/v1/models',
    );
  });

  test('runs after subclass preparation on every request attempt', async () => {
    const order: string[] = [];
    let attempt = 0;

    class TestClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture exercises an overridable instance hook.
      protected override async prepareRequest(request: RequestInit): Promise<void> {
        order.push('subclass');
        (request.headers as Headers).set('x-prepared-by', 'subclass');
      }
    }

    const client = new TestClient({
      provider: provider({
        prepareRequest(request) {
          order.push('provider');
          expect(request.headers.get('x-prepared-by')).toBe('subclass');
          request.headers.set('x-attempt', String(++attempt));
        },
      }),
      maxRetries: 1,
      fetch: async (_url, init) => {
        if (new Headers(init?.headers).get('x-attempt') === '1') {
          return new Response(undefined, {
            status: 429,
            headers: { 'Retry-After-Ms': '1' },
          });
        }
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(order).toEqual(['subclass', 'provider', 'subclass', 'provider']);
    expect(attempt).toBe(2);
  });

  test('rejects provider objects that were not created by createProvider', () => {
    expect(() => new OpenAI({ provider: {} as any })).toThrow(
      'Invalid provider. Providers must be created with createProvider().',
    );
  });

  test('shares provider definitions across duplicate module instances', async () => {
    const configuredProvider = provider({ baseURL: 'https://shared.example/v1' });
    vi.resetModules();
    const duplicate = await import('openai/internal/provider');
    expect(duplicate.configureProvider(configuredProvider).baseURL).toBe('https://shared.example/v1');
  });

  test('preserves standard OpenAI authentication when no provider is configured', async () => {
    let requestedHeaders: Headers | undefined;
    const client = new OpenAI({
      apiKey: 'openai-api-key',
      fetch: async (_url, init) => {
        requestedHeaders = new Headers(init?.headers);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(requestedHeaders?.get('authorization')).toBe('Bearer openai-api-key');
  });

  test('can replace standard OpenAI routing with a provider in withOptions', async () => {
    let requestedURL: string | URL | Request | undefined;
    let requestedHeaders: Headers | undefined;
    const requestFetch: Fetch = async (url, init) => {
      requestedURL = url;
      requestedHeaders = new Headers(init?.headers);
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({ apiKey: 'openai-api-key', fetch: requestFetch });
    const routedClient = client.withOptions({ provider: provider(), fetch: requestFetch });

    await routedClient.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://api.openai.com/v1');
    expect(routedClient.baseURL).toBe('https://provider.example/v1');
    expect(requestedURL).toBe('https://provider.example/v1/models');
    expect(requestedHeaders?.has('authorization')).toBe(false);
  });

  test.each([
    ['standard OpenAI', undefined],
    ['another provider', provider({ baseURL: 'https://first-provider.example/v1' })],
  ] as const)(
    'does not forward %s query credentials to a replacement provider',
    async (_name, originalProvider) => {
      const requestedURLs: string[] = [];
      const requestFetch: Fetch = async (url) => {
        requestedURLs.push(String(url));
        return Response.json({});
      };
      const original = new OpenAI({
        ...(originalProvider ? { provider: originalProvider } : { apiKey: 'synthetic-openai-key' }),
        defaultQuery: { api_key: 'synthetic-origin-private-secret' },
        fetch: requestFetch,
      });
      const replacement = original.withOptions({ provider: provider(), fetch: requestFetch });

      await replacement.request({ method: 'get', path: '/models' });

      expect(requestedURLs).toEqual(['https://provider.example/v1/models']);
      expect(original.buildURL('/models', null)).toContain('api_key=synthetic-origin-private-secret');
    },
  );

  test('preserves explicit replacement query defaults and same-provider clone defaults', () => {
    const originalProvider = provider({ baseURL: 'https://first-provider.example/v1' });
    const original = new OpenAI({
      provider: originalProvider,
      defaultQuery: { api_key: 'synthetic-origin-private-secret' },
    });

    expect(original.withOptions({ timeout: 1 }).buildURL('/models', null)).toContain(
      'api_key=synthetic-origin-private-secret',
    );
    expect(
      original
        .withOptions({ provider: provider(), defaultQuery: { api_key: 'synthetic-replacement-secret' } })
        .buildURL('/models', null),
    ).toBe('https://provider.example/v1/models?api_key=synthetic-replacement-secret');
  });

  test('does not inherit certificate-bearing transport options across provider owners', () => {
    const inheritedTransport = { credentials: 'include' as const };
    const replacementTransport = { cache: 'no-store' as const };
    const original = new OpenAI({
      apiKey: 'synthetic-openai-key',
      fetchOptions: inheritedTransport,
    });

    expect(original.withOptions({ provider: provider() }).fetchOptions).toBeUndefined();
    expect(
      original.withOptions({ provider: provider(), fetchOptions: replacementTransport }).fetchOptions,
    ).toBe(replacementTransport);
  });

  test('does not inherit origin-bound state when the same provider resolves to a new origin', async () => {
    let configuredOrigin = 'https://first-provider.example/v1';
    const dynamicProvider = createProvider({
      configure: () => ({ name: 'dynamic-provider', baseURL: configuredOrigin }),
    });
    let requestedURL = '';
    let requestedHeaders = new Headers();
    const requestFetch: Fetch = async (url, init) => {
      requestedURL = String(url);
      requestedHeaders = new Headers(init?.headers);
      return Response.json({});
    };
    const original = new OpenAI({
      provider: dynamicProvider,
      defaultHeaders: { 'x-origin-private': 'synthetic-first-provider-header' },
      defaultQuery: { api_key: 'synthetic-first-provider-key' },
      fetchOptions: { credentials: 'include' },
      fetch: requestFetch,
    });
    configuredOrigin = 'https://second-provider.example/v1';
    const clone = original.withOptions({ timeout: 10_000, fetch: requestFetch });

    await clone.request({ method: 'get', path: '/models' });

    expect(requestedURL).toBe('https://second-provider.example/v1/models');
    expect(requestedHeaders.has('x-origin-private')).toBe(false);
    expect(clone.fetchOptions).toBeUndefined();
    expect(original.buildURL('/models', null)).toContain('synthetic-first-provider-key');
  });

  test('drops inherited OpenAI headers when switching to a provider in withOptions', async () => {
    process.env['OPENAI_CUSTOM_HEADERS'] = 'X-OpenAI-Ambient: leaked';
    process.env['OPENAI_ORG_ID'] = 'openai-org';
    process.env['OPENAI_PROJECT_ID'] = 'openai-project';

    let requestedHeaders: Headers | undefined;
    const requestFetch: Fetch = async (_url, init) => {
      requestedHeaders = new Headers(init?.headers);
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({ apiKey: 'openai-api-key', fetch: requestFetch });
    const routedClient = client.withOptions({ provider: provider(), fetch: requestFetch });

    await routedClient.request({ method: 'get', path: '/models' });

    expect(requestedHeaders?.has('authorization')).toBe(false);
    expect(requestedHeaders?.has('openai-organization')).toBe(false);
    expect(requestedHeaders?.has('openai-project')).toBe(false);
    expect(requestedHeaders?.has('x-openai-ambient')).toBe(false);
  });
});

test('request logging redacts AWS session tokens', () => {
  const details = formatRequestDetails({
    headers: new Headers({ 'x-amz-security-token': 'session-token' }),
  });

  expect(details.headers).toEqual({ 'x-amz-security-token': '***' });
});

test('request logging redacts proxy authentication and credential-bearing query parameters', () => {
  const details = formatRequestDetails({
    headers: new Headers({ 'proxy-authorization': 'Basic synthetic-private-proxy-secret' }),
    url: 'https://provider.example/v1/models?api_key=synthetic-private-api-key&view=public',
  });

  expect(details.headers).toEqual({ 'proxy-authorization': '***' });
  expect(details.url).toBe('https://provider.example/v1/models?api_key=***&view=public');
});

test('request logging redacts URL userinfo, fragments, and AWS query credentials', () => {
  const details = formatRequestDetails({
    url:
      'https://user:synthetic-password@provider.example/v1/models?' +
      'X-Amz-Security-Token=synthetic-session&X-Amz-Signature=synthetic-signature&session_token=synthetic-token' +
      '#synthetic-private-fragment',
  });

  expect(details.url).toBe(
    'https://provider.example/v1/models?X-Amz-Security-Token=***&X-Amz-Signature=***&session_token=***',
  );
});

test('request logging redacts credentials in structured request-option queries', () => {
  const details = formatRequestDetails({
    url: 'https://provider.example/v1/models?api_key=synthetic-private-api-key&view=public',
    options: {
      query: {
        api_key: 'synthetic-private-api-key',
        Authorization: 'Bearer synthetic-secret',
        view: 'public',
      },
    },
  });

  expect(details.options?.query).toEqual({ api_key: '***', Authorization: '***', view: 'public' });
});

test.each(['ordinary', 'provider'] as const)(
  '%s client debug logging redacts authentication embedded in public request paths',
  async (kind) => {
    const debug = vi.fn();
    const client = new OpenAI({
      ...(kind === 'provider' ? { provider: provider() } : { apiKey: 'synthetic-api-key' }),
      fetch: async () => Response.json({}),
      logLevel: 'debug',
      logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await client.get(
      '/models?api_key=synthetic-path-api-secret&x_session_token=synthetic-path-token&view=public#synthetic-path-fragment',
    );

    const logged = JSON.stringify(debug.mock.calls);
    expect(debug).toHaveBeenCalled();
    expect(logged).not.toContain('synthetic-path-api-secret');
    expect(logged).not.toContain('synthetic-path-token');
    expect(logged).not.toContain('synthetic-path-fragment');
    expect(logged).toContain('/models?api_key=***&x_session_token=***&view=public');
  },
);

test.each(['X-API-Key', 'X-Session-Token', 'X-Session-Id', 'X-Auth-Token', 'X-ID-Token'])(
  'request logging redacts the %s authentication query from URLs and structured options',
  (name) => {
    const details = formatRequestDetails({
      url: `https://provider.example/v1/models?${name}=synthetic-secret&view=public`,
      options: { query: { [name]: 'synthetic-secret', view: 'public' } },
    });

    expect(details.url).toBe(`https://provider.example/v1/models?${name}=***&view=public`);
    expect(details.options?.query).toEqual({ [name]: '***', view: 'public' });
  },
);

test('provider origin changes require an explicitly replaced custom fetch transport', async () => {
  const inheritedFetch = vi.fn(async () => Response.json({}));
  const replacementFetch = vi.fn(async () => Response.json({}));
  const original = new OpenAI({ apiKey: 'synthetic-openai-key', fetch: inheritedFetch });
  const replacement = original.withOptions({ provider: provider(), fetch: replacementFetch });

  await replacement.request({ method: 'get', path: '/models' });

  expect(inheritedFetch).not.toHaveBeenCalled();
  expect(replacementFetch).toHaveBeenCalledTimes(1);
  const defaultFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  try {
    await original.withOptions({ provider: provider() }).request({ method: 'get', path: '/models' });
    expect(defaultFetch).toHaveBeenCalledTimes(1);
    expect(inheritedFetch).not.toHaveBeenCalled();
  } finally {
    defaultFetch.mockRestore();
  }
});

test.each([
  'X-Access-Token',
  'X-Refresh-Token',
  'X-Session-Token',
  'X-Session-Id',
  'X-Auth-Token',
  'X-ID-Token',
  'Session-Token',
  'Session-Id',
  'Auth-Token',
  'ID-Token',
])('request logging redacts the %s authentication header', (header) => {
  const details = formatRequestDetails({
    headers: new Headers({ [header]: 'synthetic-provider-authentication-secret' }),
  });

  expect(details.headers).toEqual({ [header.toLowerCase()]: '***' });
});
