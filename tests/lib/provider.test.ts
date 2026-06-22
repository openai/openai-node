import OpenAI from 'openai';
import { createProvider, type ProviderRuntime } from 'openai/internal/provider';
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

    const callApiKey = jest.spyOn(client, '_callApiKey');
    const authHeaders = jest.spyOn(client as any, 'authHeaders');
    const validateHeaders = jest.spyOn(client as any, 'validateHeaders');

    await client.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://provider.example/v1');
    expect(client.buildURL('/models', null, 'https://route-default.example/v1')).toBe(
      'https://provider.example/v1/models',
    );
    expect(requestedURL).toBe('https://provider.example/v1/models');
    expect((requestedInit?.headers as Headers).get('authorization')).toBe('Provider token');
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

    const configure = jest.fn(() => ({
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
        if ((init?.headers as Headers).get('x-attempt') === '1') {
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

  test('shares provider definitions across duplicate module instances', () => {
    const configuredProvider = provider({ baseURL: 'https://shared.example/v1' });

    jest.isolateModules(() => {
      const duplicate = require('openai/internal/provider') as typeof import('openai/internal/provider');
      expect(duplicate.configureProvider(configuredProvider).baseURL).toBe('https://shared.example/v1');
    });
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
    const client = new OpenAI({
      apiKey: 'openai-api-key',
      fetch: async (url, init) => {
        requestedURL = url;
        requestedHeaders = new Headers(init?.headers);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
    const routedClient = client.withOptions({ provider: provider() });

    await routedClient.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe('https://api.openai.com/v1');
    expect(routedClient.baseURL).toBe('https://provider.example/v1');
    expect(requestedURL).toBe('https://provider.example/v1/models');
    expect(requestedHeaders?.has('authorization')).toBe(false);
  });

  test('drops inherited OpenAI headers when switching to a provider in withOptions', async () => {
    process.env['OPENAI_CUSTOM_HEADERS'] = 'X-OpenAI-Ambient: leaked';
    process.env['OPENAI_ORG_ID'] = 'openai-org';
    process.env['OPENAI_PROJECT_ID'] = 'openai-project';

    let requestedHeaders: Headers | undefined;
    const client = new OpenAI({
      apiKey: 'openai-api-key',
      fetch: async (_url, init) => {
        requestedHeaders = new Headers(init?.headers);
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
    const routedClient = client.withOptions({ provider: provider() });

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
