import { X509Certificate } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, ProxyAgent } from 'undici';
import { vi } from 'vitest';

import OpenAI, {
  APIConnectionTimeoutError,
  APIUserAbortError,
  AzureOpenAI,
  BedrockOpenAI,
  RateLimitError,
} from 'openai';
import type { ClientOptions } from 'openai';
import type { WorkloadIdentity, X509WorkloadIdentity } from 'openai/auth';
import { createX509Transport } from 'openai/auth/x509-transport';
import { X509WorkloadIdentityAuth } from 'openai/internal/auth/x509-workload-identity-auth';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import { createProvider } from 'openai/internal/provider';

import {
  closeObservedServers,
  createConnectProxy,
  createMutualTLSServer,
  createX509TestLab,
  listenLoopback,
} from '../utils/x509-test-lab';

const ACCESS_TOKEN = 'synthetic-x509-workload-access-token';
const TOKEN_RESPONSE = {
  access_token: ACCESS_TOKEN,
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
  expires_in: 3600,
};

let dispatcher: Agent;
let transport: X509Transport;

function identity(): X509WorkloadIdentity {
  return {
    type: 'x509' as const,
    identityProviderId: 'synthetic-identity-provider',
    serviceAccountId: 'synthetic-service-account',
  };
}

function options(overrides: Partial<ClientOptions> = {}): ClientOptions {
  return {
    apiKey: null,
    workloadIdentity: identity(),
    x509Transport: transport,
    ...overrides,
  };
}

function mockTransportRequests() {
  return vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, target) => {
    if (target.origin === 'https://mtls.auth.openai.com') {
      return Response.json(TOKEN_RESPONSE);
    }
    return Response.json({ data: [] });
  });
}

beforeEach(() => {
  dispatcher = new Agent();
  transport = createX509Transport({
    runtime: 'node',
    dispatcher,
    certificateIdentity: 'static',
    proxy: 'direct',
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await dispatcher.close();
});

describe('OpenAI X.509 workload-identity client integration', () => {
  test('defaults certificate-authenticated clients to the approved global mTLS endpoint', () => {
    const client = new OpenAI(options());

    expect(client.baseURL).toBe('https://mtls.api.openai.com/v1');
  });

  test('preserves an explicitly configured approved global mTLS endpoint', () => {
    const client = new OpenAI(options({ baseURL: 'https://mtls.api.openai.com:443/v1' }));

    expect(client.baseURL).toBe('https://mtls.api.openai.com:443/v1');
  });

  test('rejects an X.509 workload identity without its top-level transport capability', () => {
    expect(() => new OpenAI(options({ x509Transport: undefined }))).toThrow(/X\.509.*transport/iu);
  });

  test('rejects a forged X.509 transport capability before token exchange', () => {
    expect(() => new OpenAI(options({ x509Transport: {} as X509Transport }))).toThrow(/X\.509.*transport/iu);
  });

  test('rejects an X.509 transport without an X.509 workload identity', () => {
    expect(() => new OpenAI({ apiKey: 'synthetic-api-key', x509Transport: transport })).toThrow(
      /X\.509.*workload identity/iu,
    );
  });

  test('preserves a separate admin-only bearer without exchanging workload credentials', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ adminAPIKey: 'synthetic-admin-secret' }));

    await client.request({
      path: '/organization/projects',
      method: 'get',
      __security: { adminAPIKeyAuth: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.api.openai.com');
    expect(new Headers(send.mock.calls[0]?.[2].headers).get('Authorization')).toBe(
      'Bearer synthetic-admin-secret',
    );
  });

  test('keeps an inherited admin key separate from ordinary workload-authenticated requests', async () => {
    vi.stubEnv('OPENAI_ADMIN_KEY', 'synthetic-inherited-admin-secret');
    const send = mockTransportRequests();
    const client = new OpenAI(options());

    await client.models.list();

    expect(send).toHaveBeenCalledTimes(2);
    expect(new Headers(send.mock.calls[1]?.[2].headers).get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test('preserves an explicitly headerless request without presenting a certificate to the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());

    await client.models.list({ headers: { Authorization: null } });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.api.openai.com');
    expect(new Headers(send.mock.calls[0]?.[2].headers).has('Authorization')).toBe(false);
  });

  test('selects an explicitly requested admin bearer without exchanging a discarded workload credential', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ adminAPIKey: 'synthetic-admin-secret' }));

    await client.request({
      path: '/organization/projects',
      method: 'get',
      __security: { bearerAuth: true, adminAPIKeyAuth: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(new Headers(send.mock.calls[0]?.[2].headers).get('Authorization')).toBe(
      'Bearer synthetic-admin-secret',
    );
  });

  test('allows an explicit admin bearer to be intentionally omitted without exchanging a workload token', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ adminAPIKey: 'synthetic-admin-secret' }));

    await client.request({
      path: '/organization/projects',
      method: 'get',
      headers: { Authorization: null },
      __security: { adminAPIKeyAuth: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(new Headers(send.mock.calls[0]?.[2].headers).has('Authorization')).toBe(false);
  });

  test.each([
    ['headerless', { headers: { Authorization: null }, __security: { bearerAuth: true } }],
    ['admin', { __security: { bearerAuth: true, adminAPIKeyAuth: true } }],
  ])('does not replay a %s 401 as an unrequested workload identity', async (_mode, requestOptions) => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(Response.json({ error: { message: 'synthetic unauthorized' } }, { status: 401 }));
    const client = new OpenAI(options({ adminAPIKey: 'synthetic-admin-secret', maxRetries: 0 }));

    await expect(client.request({ path: '/models', method: 'get', ...requestOptions })).rejects.toThrow(
      /unauthorized/iu,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.api.openai.com');
  });

  test.each([
    'https://api.openai.com/v1',
    'https://mtls-eu.api.openai.com/v1',
    'https://tenant.openai.azure.com/openai',
    'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
    'https://attacker.invalid/v1',
    'http://mtls.api.openai.com/v1',
    'https://mtls.api.openai.com:8443/v1',
    'https://user:password@mtls.api.openai.com/v1',
  ])('rejects an unapproved API authority before token exchange: %s', (baseURL) => {
    expect(() => new OpenAI(options({ baseURL }))).toThrow(/approved.*mTLS.*origin/iu);
  });

  test('rejects an unapproved API authority inherited from the environment', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://tenant.openai.azure.com/openai');

    expect(() => new OpenAI(options())).toThrow(/approved.*mTLS.*origin/iu);
  });

  test.each(['global', 'us', 'eu', 'ae'] as const)(
    'rejects unsupported X.509 data residency selection %s',
    (dataResidency) => {
      expect(() => new OpenAI(options({ dataResidency }))).toThrow(/residency/iu);
    },
  );

  test('preserves null and undefined residency as ordinary omission', () => {
    expect(new OpenAI(options({ dataResidency: null })).baseURL).toBe('https://mtls.api.openai.com/v1');
    expect(new OpenAI(options({ dataResidency: undefined })).baseURL).toBe('https://mtls.api.openai.com/v1');
  });

  test('rejects a custom fetch before certificate authentication can be intercepted', () => {
    const customFetch = vi.fn(async () => Response.json({ data: [] }));

    expect(() => new OpenAI(options({ fetch: customFetch }))).toThrow(/custom fetch/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test.each(['dispatcher', 'agent', 'client', 'tls', 'proxy'])(
    'rejects a client-level %s transport override',
    (name) => {
      expect(() => new OpenAI(options({ fetchOptions: { [name]: {} } }))).toThrow(/transport/iu);
    },
  );

  test('rejects client-level request-body replacement before certificate presentation', () => {
    const send = mockTransportRequests();
    const fetchOptions: NonNullable<ClientOptions['fetchOptions']> = {};
    Object.defineProperty(fetchOptions, 'body', { value: 'synthetic-replaced-body', enumerable: true });

    expect(() => new OpenAI(options({ fetchOptions }))).toThrow(/request body/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test.each(['body', 'headers', 'method', 'signal'])(
    'rejects a mutable client-level %s override before certificate presentation',
    async (name) => {
      const send = mockTransportRequests();
      const client = new OpenAI(options());
      const fetchOptions: NonNullable<ClientOptions['fetchOptions']> = {};
      Object.defineProperty(fetchOptions, name, { value: 'synthetic-attacker-override', enumerable: true });
      client.fetchOptions = fetchOptions;

      await expect(client.models.list()).rejects.toThrow(/request body, headers, method, or signal/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('clones an X.509 client without mistaking its protected transport wrapper for a custom fetch', () => {
    const client = new OpenAI(options());
    const cloned = client.withOptions({ timeout: 2500 });

    expect(cloned.baseURL).toBe('https://mtls.api.openai.com/v1');
    expect(cloned.timeout).toBe(2500);
  });

  test('switches an X.509 client back to ordinary API-key authentication', () => {
    const client = new OpenAI(options());
    const switched = client.withOptions({ workloadIdentity: undefined, apiKey: 'synthetic-api-key' });

    expect(switched.baseURL).toBe('https://api.openai.com/v1');
    expect(switched.apiKey).toBe('synthetic-api-key');
  });

  test('switches an X.509 client back to ordinary subject-token workload identity', () => {
    const client = new OpenAI(options());
    const switched = client.withOptions({
      workloadIdentity: {
        identityProviderId: 'synthetic-legacy-provider',
        serviceAccountId: 'synthetic-legacy-account',
        provider: { tokenType: 'jwt', getToken: async () => 'synthetic-jwt' },
      },
      apiKey: null,
    });

    expect(switched.baseURL).toBe('https://api.openai.com/v1');
  });

  test('switches an ordinary API-key client into approved X.509 workload identity', () => {
    const ordinary = new OpenAI({
      apiKey: 'synthetic-api-key',
      defaultHeaders: { 'x-origin-private': 'synthetic-ordinary-header-secret' },
      defaultQuery: { api_key: 'synthetic-ordinary-query-secret' },
    });
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-environment-api-key');
    const switched = ordinary.withOptions({ workloadIdentity: identity(), x509Transport: transport });

    expect(switched.baseURL).toBe('https://mtls.api.openai.com/v1');
    expect(switched.apiKey).toBeNull();
    expect(switched.buildURL('/models', null)).toBe('https://mtls.api.openai.com/v1/models');
  });

  test('switches a provider into caller-owned X.509 authentication without inheriting provider state', () => {
    const provider = createProvider({
      configure: () => ({ name: 'synthetic-provider', baseURL: 'https://provider.example/v1' }),
    });
    const ordinary = new OpenAI({
      provider,
      defaultHeaders: { 'x-provider-private': 'synthetic-provider-header-secret' },
      defaultQuery: { api_key: 'synthetic-provider-query-secret' },
    });

    const switched = ordinary.withOptions({ workloadIdentity: identity(), x509Transport: transport });

    expect(switched.baseURL).toBe('https://mtls.api.openai.com/v1');
    expect(switched.apiKey).toBeNull();
    expect(switched.buildURL('/models', null)).toBe('https://mtls.api.openai.com/v1/models');
  });

  test.each([
    'api_key',
    'Authorization',
    'access_token',
    'session_token',
    'session_id',
    'id_token',
    'auth_token',
    'X-API-Key',
    'X-Session-Token',
    'X-Session-Id',
    'X-ID-Token',
    'X-Auth-Token',
    'X-Amz-Security-Token',
    'X-Amz-Signature',
  ])('rejects caller-supplied %s query credentials before exchanging a workload credential', async (name) => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ defaultQuery: { [name]: 'synthetic-conflicting-query-secret' } }));

    await expect(client.models.list()).rejects.toThrow(/query|credential|authentication/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects request-level query credentials before contacting the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());

    await expect(
      client.request({ method: 'get', path: '/models', query: { access_token: 'synthetic-request-secret' } }),
    ).rejects.toThrow(/query|credential|authentication/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects pre-aborted API requests before presenting a certificate to the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    const controller = new AbortController();
    const reason = new Error('synthetic-caller-canceled');
    controller.abort(reason);

    await expect(client.models.list({ signal: controller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('preserves the SDK cancellation error and reason when the issuer request is aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('synthetic-mid-exchange-cancellation');
    const send = vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });
    const client = new OpenAI(options({ maxRetries: 0 }));

    await expect(client.models.list({ signal: controller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('never presents a certificate after cancellation during request-option preflight', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ maxRetries: 0 }));
    const caller = new AbortController();
    const reason = new Error('synthetic-preflight-cancellation');
    let reads = 0;
    const request = { path: '/models', method: 'get' as const, signal: caller.signal };
    Object.defineProperty(request, 'fetchOptions', {
      enumerable: true,
      get: () => {
        reads += 1;
        if (reads === 1) {
          caller.abort(reason);
        }
        return {};
      },
    });

    await expect(client.request(request)).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(reads).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  test('preserves the caller cancellation reason while consuming an authenticated response body', async () => {
    const caller = new AbortController();
    const reason = new Error('synthetic-body-cancellation');
    let responseBody: ReadableStreamDefaultController<Uint8Array> | undefined;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : new Response(
              new ReadableStream({
                start(controller) {
                  responseBody = controller;
                  controller.enqueue(new TextEncoder().encode('{"data":['));
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
      );
    const client = new OpenAI(options({ maxRetries: 0 }));
    setTimeout(() => caller.abort(reason), 10);

    try {
      await expect(client.models.list({ signal: caller.signal })).rejects.toMatchObject({
        constructor: APIUserAbortError,
        cause: reason,
      });
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      responseBody?.close();
    }
  });

  test('keeps the original monotonic response-body deadline when the wall clock moves backward', async () => {
    const wallNow = Date.now.bind(Date);
    let responseBody: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        return Response.json(TOKEN_RESPONSE);
      }
      vi.spyOn(Date, 'now').mockImplementation(() => wallNow() - 5000);
      return new Response(
        new ReadableStream({
          start(controller) {
            responseBody = controller;
            controller.enqueue(new TextEncoder().encode('{"data":['));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const client = new OpenAI(options({ maxRetries: 0, timeout: 50 }));
    const startedAt = performance.now();

    try {
      await expect(client.models.list()).rejects.toThrow(/timed out/iu);
      expect(performance.now() - startedAt).toBeLessThan(500);
    } finally {
      responseBody?.close();
    }
  });

  test('rejects request-level transport replacement before presenting a certificate to the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());

    await expect(client.models.list({ fetchOptions: { dispatcher } })).rejects.toThrow(/transport/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects request-level body replacement before presenting a certificate to the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    const fetchOptions: NonNullable<ClientOptions['fetchOptions']> = {};
    Object.defineProperty(fetchOptions, 'body', { value: 'synthetic-replaced-body', enumerable: true });

    await expect(
      client.request({
        path: '/models',
        method: 'post',
        body: { intended: 'synthetic-original-body' },
        fetchOptions,
      }),
    ).rejects.toThrow(/request body/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('validates the same request fetch-options snapshot used for the final authenticated dispatch', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    const replacement: NonNullable<ClientOptions['fetchOptions']> = {};
    Object.defineProperty(replacement, 'body', { value: 'synthetic-attacker-override', enumerable: true });
    let reads = 0;
    const request = { path: '/models', method: 'post' as const, body: { synthetic: true } };
    Object.defineProperty(request, 'fetchOptions', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? replacement : {};
      },
    });

    await expect(client.request(request)).rejects.toThrow(/request body/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('does not replay a rejected certificate credential when no retry budget remains', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ error: { message: 'synthetic rejected credential' } }, { status: 401 }),
      );
    const client = new OpenAI(options({ maxRetries: 0 }));

    await expect(client.models.list()).rejects.toThrow(/rejected credential/iu);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.filter(([, url]) => url.origin === 'https://mtls.auth.openai.com')).toHaveLength(
      1,
    );
  });

  test.each([undefined, 'true', 'false'])(
    'declines excessive certificate replay delays (x-should-retry=%s)',
    async (retryHeader) => {
      vi.spyOn(performance, 'now').mockReturnValue(0);
      let apiCalls = 0;
      let issuerCalls = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          issuerCalls += 1;
          return Response.json({ ...TOKEN_RESPONSE, access_token: `fake-token-${issuerCalls}` });
        }
        apiCalls += 1;
        return apiCalls === 1
          ? Response.json(
              { error: { message: 'Try later', code: 'retry_later' } },
              {
                status: 401,
                headers: {
                  ...(retryHeader === undefined ? {} : { 'x-should-retry': retryHeader }),
                  'retry-after': '90',
                  'x-request-id': 'req_fake',
                },
              },
            )
          : Response.json({ data: [] });
      });
      const client = new OpenAI(options({ maxRetries: 1, timeout: 100 }));

      await expect(client.models.list()).rejects.toMatchObject({
        status: 401,
        code: 'retry_later',
        requestID: 'req_fake',
        error: { message: 'Try later', code: 'retry_later' },
      });
      expect([apiCalls, issuerCalls]).toEqual([1, 1]);
      await expect(client.models.list()).resolves.toMatchObject({ data: [] });
      expect([apiCalls, issuerCalls]).toEqual([2, 2]);
    },
  );

  test('consumes one retry allowance when replaying a rejected certificate credential', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ error: { message: 'synthetic rejected credential' } }, { status: 401 }),
      );
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(client.models.list()).rejects.toThrow(/rejected credential/iu);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.filter(([, url]) => url.origin === 'https://mtls.auth.openai.com')).toHaveLength(
      2,
    );
  });

  test.each([401, 429])(
    'does not allow stalled %i response cleanup to block an approved retry',
    async (status) => {
      const cancellation = Promise.race([]);
      let dispatches = 0;
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) => {
          if (url.origin === 'https://mtls.auth.openai.com') {
            return Response.json(TOKEN_RESPONSE);
          }
          dispatches += 1;
          return dispatches === 1
            ? new Response(new ReadableStream({ cancel: () => cancellation }), {
                status,
                headers: { 'retry-after-ms': '1' },
              })
            : Response.json({ data: [] });
        });
      const client = new OpenAI(options({ maxRetries: 1, timeout: 250 }));

      await expect(client.models.list()).resolves.toMatchObject({ data: [] });
      expect(dispatches).toBe(2);
      expect(send).toHaveBeenCalledTimes(status === 401 ? 4 : 3);
    },
  );

  test.each([
    'Authorization',
    'api-key',
    'x-api-key',
    'Proxy-Authorization',
    'Cookie',
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
    'Host',
  ])('rejects caller-supplied %s before exchanging a workload credential', async (header) => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ defaultHeaders: { [header]: 'synthetic-conflicting-secret' } }));

    await expect(client.models.list()).rejects.toThrow(/caller-supplied.*credentials/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects a public API-origin mutation before presenting a certificate to the issuer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    client.baseURL = 'https://tenant.openai.azure.com/openai';

    await expect(client.models.list()).rejects.toThrow(/approved.*mTLS.*origin/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('keeps final API dispatch on its private attested transport when public fetch is replaced', async () => {
    const send = mockTransportRequests();
    const attacker = vi.fn(async () => Response.json({ data: [] }));
    const client = new OpenAI(options());
    Object.defineProperty(client, 'fetch', { value: attacker });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(attacker).not.toHaveBeenCalled();
  });

  test('preserves direct public buildRequest with an independently scoped workload credential', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());

    const built = await client.buildRequest({ path: '/models', method: 'get' });

    expect(built.url).toBe('https://mtls.api.openai.com/v1/models');
    expect(new Headers(built.req.headers).get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.auth.openai.com');
  });

  test('runs an existing buildRequest override exactly once for direct request construction', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    const build = vi.spyOn(client, 'buildRequest');

    await client.buildRequest({ path: '/models', method: 'get' });

    expect(build).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('isolates concurrent logical requests that reuse the exact same caller options object', async () => {
    let exchangeCount = 0;
    const dispatched = new Set<string | null>();
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(
      async (_transport, target, request) => {
        if (target.origin === 'https://mtls.auth.openai.com') {
          exchangeCount += 1;
          const accessToken = `synthetic-concurrent-token-${exchangeCount}`;
          await delay(5);
          return Response.json({ ...TOKEN_RESPONSE, access_token: accessToken });
        }
        dispatched.add(new Headers(request.headers).get('Authorization'));
        return Response.json({ data: [] });
      },
    );
    const client = new OpenAI(options());
    const shared = { path: '/models', method: 'get' as const };

    await Promise.all([client.request(shared), client.request(shared)]);

    expect(exchangeCount).toBe(1);
    expect(dispatched).toEqual(new Set(['Bearer synthetic-concurrent-token-1']));
  });

  test('starts a new isolated operation when caller options are reused sequentially', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options({ timeout: 50 }));
    const shared = { path: '/models', method: 'get' as const };

    await client.request(shared);
    await delay(60);
    await client.request(shared);

    expect(send).toHaveBeenCalledTimes(3);
  });

  test('rejects protected hooks that replace the issued workload bearer', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        const { headers } = request;
        if (headers instanceof Headers) {
          headers.set('Authorization', 'Bearer synthetic-attacker-bearer');
        }
      },
    });

    await expect(client.models.list()).rejects.toThrow(/caller-supplied.*authorization/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([401, 503])(
    'never replays a one-shot request body installed by a protected hook after %i',
    async (status) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? Response.json(TOKEN_RESPONSE)
            : Response.json({ error: { message: 'synthetic one-shot request failure' } }, { status }),
        );
      const client = new OpenAI(options({ maxRetries: 2 }));
      Object.defineProperty(client, 'prepareRequest', {
        value: async (request: RequestInit) => {
          request.body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('synthetic one-shot payload'));
              controller.close();
            },
          });
        },
      });

      await expect(
        client.request({ path: '/models', method: 'post', body: { synthetic: true } }),
      ).rejects.toThrow(/one-shot request failure/iu);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  test('rejects protected hooks that disguise a replaced bearer with a spoofed Headers getter', async () => {
    const send = mockTransportRequests();
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        const { headers } = request;
        if (headers instanceof Headers) {
          headers.set('Authorization', 'Bearer synthetic-attacker-bearer');
          Object.defineProperty(headers, 'get', { value: () => `Bearer ${ACCESS_TOKEN}` });
        }
      },
    });

    await expect(client.models.list()).rejects.toThrow(/caller-supplied.*authorization/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects forbidden proxy credentials before they can reach an enabled debug logger', async () => {
    const secret = 'synthetic-private-proxy-secret';
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const send = mockTransportRequests();
    const client = new OpenAI(options({ logger, logLevel: 'debug' }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        if (request.headers instanceof Headers) {
          request.headers.set('Proxy-Authorization', secret);
        }
      },
    });

    await expect(client.models.list()).rejects.toThrow(/caller-supplied.*authentication/iu);
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(secret);
    expect(send).not.toHaveBeenCalled();
  });

  test.each(['fetchWithAuth', 'fetchWithTimeout'])(
    'rejects a %s replacement installed after client construction before exchanging credentials',
    async (hook) => {
      const send = mockTransportRequests();
      const attacker = vi.fn(async () => Response.json({ data: [] }));
      const client = new OpenAI(options());
      Object.defineProperty(client, hook, { value: attacker });

      await expect(client.models.list()).rejects.toThrow(/overridden fetch dispatch/iu);
      expect(send).not.toHaveBeenCalled();
      expect(attacker).not.toHaveBeenCalled();
    },
  );

  test('keeps private dispatch attestation when a protected hook replaces mutable authentication state', async () => {
    const send = mockTransportRequests();
    const attacker = vi.fn(async () => Response.json({ data: [] }));
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async () => {
        Object.defineProperty(client, '_workloadIdentityAuth', { value: undefined });
        Object.defineProperty(client, 'fetchWithTimeout', { value: attacker });
      },
    });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(attacker).not.toHaveBeenCalled();
  });

  test('shares one timeout across issuer authentication and the final API response', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, target, requestOptions) => {
        await delay(100, undefined, { signal: requestOptions.signal ?? undefined });
        return target.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ data: [] });
      });
    const client = new OpenAI(options({ timeout: 150, maxRetries: 0 }));

    await expect(client.models.list()).rejects.toThrow(/timed out/iu);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('rejects a retry delay that would exceed the original certificate request deadline', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, target) =>
        target.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json(
              { error: { message: 'synthetic rate limit' } },
              { status: 429, headers: { 'retry-after-ms': '250' } },
            ),
      );
    const client = new OpenAI(options({ timeout: 100, maxRetries: 1 }));

    await expect(client.models.list()).rejects.toThrow(/timed out/iu);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test.each([
    [100, APIConnectionTimeoutError],
    [2000, RateLimitError],
  ] as const)(
    'preserves certificate request errors with an excessive retry hint and %i ms timeout',
    async (timeout, ErrorClass) => {
      const response = Response.json(
        { error: { message: 'Retry later.', type: 'rate_limit_error', code: 'slow_down' } },
        { status: 429, headers: { 'retry-after': '90' } },
      );
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, target) =>
          target.origin === 'https://mtls.auth.openai.com' ? Response.json(TOKEN_RESPONSE) : response,
        );
      const client = new OpenAI(options({ timeout, maxRetries: 1 }));

      await expect(client.models.list()).rejects.toBeInstanceOf(ErrorClass);
      expect(send).toHaveBeenCalledTimes(2);
      expect(response.bodyUsed).toBe(true);
    },
  );

  test.each([
    [100, APIConnectionTimeoutError],
    [2000, RateLimitError],
    [120_000, RateLimitError],
  ] as const)('declines an excessive issuer retry hint with %i ms timeout', async (timeout, ErrorClass) => {
    const wait = vi.spyOn(X509WorkloadIdentityAuth.prototype, 'waitForRetry').mockResolvedValue();
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async () =>
        Response.json(
          { error: { message: 'Sensitive issuer detail.' } },
          { status: 429, headers: { 'retry-after': '90' } },
        ),
      );
    const client = new OpenAI(options({ timeout, maxRetries: 1 }));
    const request = client.models.list();

    await expect(request).rejects.toBeInstanceOf(ErrorClass);
    if (ErrorClass === RateLimitError) {
      await expect(request).rejects.toMatchObject({
        status: 429,
        message: '429 X.509 workload identity token exchange failed.',
      });
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  test('retains its request scope and original deadline while consuming a delayed response body', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, target) => {
        if (target.origin === 'https://mtls.auth.openai.com') {
          return Response.json(TOKEN_RESPONSE);
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":'));
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      });
    const client = new OpenAI(options({ timeout: 60, maxRetries: 1 }));

    await expect(client.models.list()).rejects.toThrow(/timed out/iu);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('rejects unsupported final-dispatch overrides before issuing a workload bearer', () => {
    class UnsafeDispatchClient extends OpenAI {
      override async fetchWithTimeout(): Promise<Response> {
        return Response.json({ baseURL: this.baseURL });
      }
    }

    const send = mockTransportRequests();
    expect(() => new UnsafeDispatchClient(options())).toThrow(/overridden fetch dispatch/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('rejects X.509 transport through the legacy Azure client', () => {
    const unsafe = {
      apiVersion: '2026-01-01',
      apiKey: 'synthetic-azure-key',
      endpoint: 'https://tenant.openai.azure.com',
      x509Transport: transport,
    };

    expect(() => new AzureOpenAI(unsafe as ConstructorParameters<typeof AzureOpenAI>[0])).toThrow(/X\.509/iu);
  });

  test('rejects X.509 transport through the legacy Bedrock client', () => {
    const unsafe = {
      apiKey: 'synthetic-bedrock-key',
      baseURL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
      x509Transport: transport,
    };

    expect(() => new BedrockOpenAI(unsafe as ConstructorParameters<typeof BedrockOpenAI>[0])).toThrow(
      /Bedrock.*authentication/iu,
    );
  });

  test('does not classify an extensible legacy workload identity with X.509 metadata as certificate auth', async () => {
    interface ApplicationWorkloadIdentity extends WorkloadIdentity {
      readonly type: 'x509';
    }

    const subjectToken = vi.fn(async () => 'synthetic-jwt-subject-token');
    const legacy: ApplicationWorkloadIdentity = {
      type: 'x509',
      identityProviderId: 'synthetic-legacy-identity-provider',
      serviceAccountId: 'synthetic-legacy-service-account',
      provider: { tokenType: 'jwt', getToken: subjectToken },
    };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === 'https://auth.openai.com/oauth/token'
        ? Response.json({ access_token: 'synthetic-legacy-bearer' })
        : Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: legacy, fetch });

    await client.models.list();

    expect(subjectToken).toHaveBeenCalledTimes(1);
    expect(client.baseURL).toBe('https://api.openai.com/v1');
  });

  test('reuses and rotates real TLS-issued credentials without exposing them to a CONNECT proxy', async () => {
    const lab = createX509TestLab();
    let exchanges = 0;
    let dispatches = 0;
    const issuer = createMutualTLSServer(
      lab,
      (_request, response) => {
        exchanges += 1;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ ...TOKEN_RESPONSE, access_token: `synthetic-wire-token-${exchanges}` }),
        );
      },
      lab.issuerServer,
    );
    const api = createMutualTLSServer(
      lab,
      (request, response) => {
        dispatches += 1;
        if (dispatches === 2) {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'synthetic rejected workload credential' } }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: [] }));
      },
      lab.apiServer,
    );
    let proxy: ReturnType<typeof createConnectProxy> | undefined;
    let proxyDispatcher: ProxyAgent | undefined;

    try {
      const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
      proxy = createConnectProxy(
        lab,
        false,
        lab.proxyServer,
        new Map([
          ['mtls.auth.openai.com:443', issuerURL],
          ['mtls.api.openai.com:443', apiURL],
        ]),
      );
      const proxyURL = await listenLoopback(proxy, false);
      proxyDispatcher = new ProxyAgent({
        uri: proxyURL.href,
        requestTls: {
          ca: lab.certificateAuthority,
          cert: lab.firstClient.certificate,
          key: lab.firstClient.privateKey,
        },
      });
      const approved = createX509Transport({
        runtime: 'node',
        dispatcher: proxyDispatcher,
        certificateIdentity: 'static',
        proxy: 'http-connect',
      });
      const client = new OpenAI(options({ x509Transport: approved, maxRetries: 1 }));

      const models = [await client.models.list(), await client.models.list(), await client.models.list()];

      expect(models.map((result) => result.data)).toEqual([[], [], []]);
      expect(exchanges).toBe(2);
      expect(dispatches).toBe(4);
      const fingerprint = new X509Certificate(lab.firstClient.certificate).fingerprint256;
      expect(issuer.requests).toHaveLength(2);
      for (const request of issuer.requests) {
        expect(request).toMatchObject({
          authority: 'mtls.auth.openai.com',
          authorization: undefined,
          certificateFingerprint: fingerprint,
          path: '/oauth/token',
          serverName: 'mtls.auth.openai.com',
        });
      }
      expect(api.requests.map((request) => request.authorization)).toEqual([
        'Bearer synthetic-wire-token-1',
        'Bearer synthetic-wire-token-1',
        'Bearer synthetic-wire-token-2',
        'Bearer synthetic-wire-token-2',
      ]);
      for (const request of api.requests) {
        expect(request).toMatchObject({
          authority: 'mtls.api.openai.com',
          certificateFingerprint: fingerprint,
          path: '/v1/models',
          serverName: 'mtls.api.openai.com',
        });
      }
      expect(new Set(proxy.requests.map((request) => request.path))).toEqual(
        new Set(['mtls.auth.openai.com:443', 'mtls.api.openai.com:443']),
      );
      for (const request of proxy.requests) {
        expect(request.authorization).toBeUndefined();
        expect(request.proxyAuthorization).toBeUndefined();
        expect(request.certificateFingerprint).toBeUndefined();
      }
    } finally {
      await proxyDispatcher?.close();
      await closeObservedServers(issuer, api, ...(proxy ? [proxy] : []));
    }
  });
});
