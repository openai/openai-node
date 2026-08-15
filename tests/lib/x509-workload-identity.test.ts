import { expect, vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { CursorPage } from 'openai/core/pagination';
import type { RequestInit } from 'openai/internal/builtin-types';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

const subjectTokenIdentity = {
  identityProviderId: 'idp_subject',
  serviceAccountId: 'svc_subject',
  provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolveResponse!: (response: Response) => void;
  // oxlint-disable-next-line promise/avoid-new -- This fixture needs a manually controlled fetch response.
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return { promise, resolve: resolveResponse };
}

async function* nonReplayableBody() {
  yield new TextEncoder().encode('not replayable');
}

class RequestMutatingOpenAI extends OpenAI {
  requestMutation?: (request: RequestInit) => void;

  protected override async prepareRequest(request: RequestInit): Promise<void> {
    this.requestMutation?.(request);
  }
}

describe('OpenAI with X.509 workload identity', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test('is lazy and defaults only X.509 clients to the global mTLS API host', async () => {
    const urls: string[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(url.toString());
      if (url.toString() === 'https://mtls.auth.openai.com/oauth/token') {
        return tokenResponse('access-token');
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    expect(client.baseURL).toBe('https://mtls.api.openai.com/v1');
    expect(customFetch).not.toHaveBeenCalled();

    await client.models.list();
    expect(urls).toEqual([
      'https://mtls.auth.openai.com/oauth/token',
      'https://mtls.api.openai.com/v1/models',
    ]);
  });

  test('preserves an explicitly configured base URL', () => {
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      baseURL: 'https://gateway.example.com/v1',
      fetch: vi.fn(),
    });

    expect(client.baseURL).toBe('https://gateway.example.com/v1');
    expect(client.withOptions({ workloadIdentity: subjectTokenIdentity }).baseURL).toBe(
      'https://gateway.example.com/v1',
    );
  });

  test('recomputes a default base URL when withOptions changes workload identity modes', () => {
    const customFetch = vi.fn();
    const subjectTokenClient = new OpenAI({
      apiKey: null,
      workloadIdentity: subjectTokenIdentity,
      fetch: customFetch,
    });
    const x509Client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
    });

    const derivedSubjectTokenClient = subjectTokenClient.withOptions({ timeout: 5000 });

    expect(derivedSubjectTokenClient.withOptions({ workloadIdentity: x509Identity }).baseURL).toBe(
      'https://mtls.api.openai.com/v1',
    );
    expect(x509Client.withOptions({ workloadIdentity: subjectTokenIdentity }).baseURL).toBe(
      'https://api.openai.com/v1',
    );
  });

  test('preserves a runtime baseURL change when withOptions changes workload identity modes', () => {
    const customFetch = vi.fn();
    const subjectTokenClient = new OpenAI({
      apiKey: null,
      workloadIdentity: subjectTokenIdentity,
      fetch: customFetch,
    });
    const x509Client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
    });

    subjectTokenClient.baseURL = 'https://subject-gateway.example.com/v1';
    x509Client.baseURL = 'https://x509-gateway.example.com/v1';

    expect(subjectTokenClient.withOptions({ workloadIdentity: x509Identity }).baseURL).toBe(
      'https://subject-gateway.example.com/v1',
    );
    expect(x509Client.withOptions({ workloadIdentity: subjectTokenIdentity }).baseURL).toBe(
      'https://x509-gateway.example.com/v1',
    );
  });

  test('treats the X.509 API host as an SDK default for request-level route selection', () => {
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(),
    });

    expect(client.buildURL('/models', null, 'https://route-default.example/v1')).toBe(
      'https://route-default.example/v1/models',
    );
    client.baseURL = 'https://gateway.example.com/v1';
    expect(client.buildURL('/models', null, 'https://route-default.example/v1')).toBe(
      'https://gateway.example.com/v1/models',
    );
  });

  test('does not change API-key routing, redirects, or authentication', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: url.toString(), init });
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: 'api-key',
      fetch: customFetch,
      fetchOptions: { redirect: 'follow' },
    });

    await client.models.list();

    expect(client.baseURL).toBe('https://api.openai.com/v1');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.openai.com/v1/models');
    expect(requests[0]?.init).toMatchObject({ redirect: 'follow' });
    expect(new Headers(requests[0]?.init?.headers).get('Authorization')).toBe('Bearer api-key');
  });

  test('uses the client fetch and dispatcher for both exchange and API calls', async () => {
    const closeDispatcher = vi.fn();
    const dispatcher = { name: 'mtls-dispatcher', close: closeDispatcher };
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: url.toString(), init });
      return url.toString().includes('/oauth/token')
        ? tokenResponse('access-token')
        : Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: { dispatcher: dispatcher as never, redirect: 'follow' },
    });

    await client.models.list();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.init).toMatchObject({ dispatcher, redirect: 'manual' });
    expect(requests[1]?.init).toMatchObject({ dispatcher, redirect: 'manual' });
    expect(closeDispatcher).not.toHaveBeenCalled();
  });

  test('does not expose workload or transport secrets through debug logging', async () => {
    const logs: unknown[] = [];
    const log = (...values: unknown[]) => logs.push(values);
    const dispatcher = {
      cert: 'private-certificate-material',
      key: 'private-key-material',
    };
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetchOptions: { dispatcher: dispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request) =>
        url.toString().includes('/oauth/token')
          ? tokenResponse('private-access-token')
          : Response.json({ data: [] }),
      ),
      logLevel: 'debug',
      logger: { debug: log, info: log, warn: log, error: log },
    });

    await client.models.list();

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain('private-access-token');
    expect(serializedLogs).not.toContain('private-certificate-material');
    expect(serializedLogs).not.toContain('private-key-material');
    expect(serializedLogs).not.toContain(x509Identity.identityProviderId);
    expect(serializedLogs).not.toContain(x509Identity.serviceAccountId);
  });

  test('invalidates a warm token and uses replacement client fetchOptions for both legs', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const requests: RequestInit[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return url.toString().includes('/oauth/token')
        ? tokenResponse('access-token')
        : Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: { dispatcher: originalDispatcher as never },
    });

    await client.models.list();
    client.fetchOptions = { dispatcher: replacementDispatcher as never };
    await client.post('/non-replayable', { body: nonReplayableBody() });

    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({ dispatcher: originalDispatcher });
    expect(requests[1]).toMatchObject({ dispatcher: originalDispatcher });
    expect(requests[2]).toMatchObject({ dispatcher: replacementDispatcher });
    expect(requests[3]).toMatchObject({ dispatcher: replacementDispatcher });
  });

  test('invalidates a warm token when the client dispatcher is replaced in place', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const fetchOptions = { dispatcher: originalDispatcher as { name: string } };
    const requests: RequestInit[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return url.toString().includes('/oauth/token')
        ? tokenResponse('access-token')
        : Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: fetchOptions as never,
    });

    await client.models.list();
    fetchOptions.dispatcher = replacementDispatcher;
    await client.post('/non-replayable', { body: nonReplayableBody() });

    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({ dispatcher: originalDispatcher });
    expect(requests[1]).toMatchObject({ dispatcher: originalDispatcher });
    expect(requests[2]).toMatchObject({ dispatcher: replacementDispatcher });
    expect(requests[3]).toMatchObject({ dispatcher: replacementDispatcher });
  });

  test('restarts a cold exchange after transport rotation before sending a non-replayable body', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const fetchOptions = { dispatcher: originalDispatcher as { name: string } };
    const originalExchange = deferredResponse();
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: url.toString(), init });
      if (!url.toString().includes('/oauth/token')) {
        return Response.json({ ok: true });
      }
      return (init as { dispatcher?: unknown })?.dispatcher === originalDispatcher
        ? await originalExchange.promise
        : tokenResponse('replacement-token');
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: fetchOptions as never,
    });

    const request = client.post('/non-replayable', { body: nonReplayableBody() });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    fetchOptions.dispatcher = replacementDispatcher;
    originalExchange.resolve(tokenResponse('stale-token'));

    await expect(request).resolves.toMatchObject({ ok: true });
    expect(requests).toHaveLength(3);
    expect(requests.map(({ init }) => (init as { dispatcher?: unknown })?.dispatcher)).toEqual([
      originalDispatcher,
      replacementDispatcher,
      replacementDispatcher,
    ]);
    expect(new Headers(requests[2]?.init?.headers).get('Authorization')).toBe('Bearer replacement-token');
  });

  test('keeps an absent initial transport distinct when it is replaced during a cold exchange', async () => {
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const originalExchange = deferredResponse();
    const requests: RequestInit[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      if (!url.toString().includes('/oauth/token')) {
        return Response.json({ data: [] });
      }
      return requests.length === 1 ? await originalExchange.promise : tokenResponse('replacement-token');
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    const request = client.models.list();
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    client.fetchOptions = { dispatcher: replacementDispatcher as never };
    originalExchange.resolve(tokenResponse('stale-token'));

    await expect(request).resolves.toMatchObject({ data: [] });
    expect(requests).toHaveLength(3);
    expect(requests[0]).not.toHaveProperty('dispatcher');
    expect(requests[1]).toMatchObject({ dispatcher: replacementDispatcher });
    expect(requests[2]).toMatchObject({ dispatcher: replacementDispatcher });
  });

  test('honors per-request maxRetries for a cold token exchange', async () => {
    const noRetryFetch = vi.fn(
      async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } }),
    );
    const noRetryClient = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: noRetryFetch,
      maxRetries: 2,
    });

    await expect(noRetryClient.models.list({ maxRetries: 0 })).rejects.toMatchObject({ status: 503 });
    expect(noRetryFetch).toHaveBeenCalledTimes(1);

    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(tokenResponse('access-token'))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const retryClient = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: retryFetch,
      maxRetries: 0,
    });

    await expect(retryClient.models.list({ maxRetries: 1 })).resolves.toMatchObject({ data: [] });
    expect(retryFetch).toHaveBeenCalledTimes(3);
  });

  test('does not renew an exhausted exchange budget through API request retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let exchangeCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return exchangeCount === 1
          ? Response.json({ access_token: 'short-lived-token', expires_in: 1 })
          : new Response(null, { status: 503, headers: { 'Retry-After': '0' } });
      }
      apiCount += 1;
      return Response.json({ data: [] });
    });
    const client = new RequestMutatingOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      maxRetries: 2,
    });
    client.requestMutation = (request) => {
      vi.setSystemTime(new Date(Date.now() + 2000));
      (request.headers as Headers).set('Authorization', 'Bearer workload-identity-auth');
    };

    const rejection = expect(client.models.list()).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;

    expect(exchangeCount).toBe(4);
    expect(apiCount).toBe(0);
  });

  test('rejects per-request fetchOptions before exchanging a transport-scoped identity', async () => {
    const customFetch = vi.fn();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
    });

    await expect(
      client.models.list({ fetchOptions: { dispatcher: { name: 'request-dispatcher' } as never } }),
    ).rejects.toThrow('requires transport options on the client');
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('rejects request-hook transport changes before sending the API request', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const requests: string[] = [];

    const client = new RequestMutatingOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetchOptions: { dispatcher: originalDispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('access-token');
      }),
    });
    client.requestMutation = (request) => {
      (request as { dispatcher?: unknown }).dispatcher = replacementDispatcher;
    };

    await expect(client.models.list()).rejects.toThrow('request hooks must not change the transport');
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test('rejects nested request-hook transport changes before sending the API request', async () => {
    const tls = { cert: 'certificate-a', key: 'private-key-a' };
    const requests: string[] = [];
    const client = new RequestMutatingOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetchOptions: { tls } as never,
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('access-token');
      }),
    });
    client.requestMutation = (request) => {
      (request as { tls: { cert: string } }).tls.cert = 'certificate-b';
    };

    await expect(client.models.list()).rejects.toThrow();
    expect(tls.cert).toBe('certificate-a');
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test('rejects request-hook redirect changes before sending the API request', async () => {
    const requests: string[] = [];
    const client = new RequestMutatingOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('access-token');
      }),
    });
    client.requestMutation = (request) => {
      request.redirect = 'follow';
    };

    await expect(client.models.list()).rejects.toThrow('must not change the transport or redirect behavior');
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test('shares X.509 state by transport while isolating withOptions clients that diverge', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    let exchangeCount = 0;
    const exchangeDispatchers: unknown[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        exchangeDispatchers.push((init as { dispatcher?: unknown })?.dispatcher);
        return tokenResponse(`token-${exchangeCount}`);
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: { dispatcher: originalDispatcher as never },
    });
    const derivedClient = client.withOptions({ timeout: 5000 });

    await Promise.all([client.models.list(), derivedClient.models.list()]);
    derivedClient.fetchOptions = { dispatcher: replacementDispatcher as never };
    await derivedClient.models.list();
    await client.models.list();

    expect(exchangeCount).toBe(2);
    expect(exchangeDispatchers).toEqual([originalDispatcher, replacementDispatcher]);
  });

  test.each([
    { tokenType: 'jwt' as const, subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt' },
    { tokenType: 'id' as const, subjectTokenType: 'urn:ietf:params:oauth:token-type:id_token' },
  ])(
    'preserves ordinary $tokenType subject-token exchange behavior',
    async ({ tokenType, subjectTokenType }) => {
      const dispatcher = { name: 'api-only-dispatcher' };
      const requests: { url: string; init: RequestInit | undefined }[] = [];
      const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: url.toString(), init });
        return url.toString().includes('/oauth/token')
          ? tokenResponse('access-token')
          : Response.json({ data: [] });
      });
      const client = new OpenAI({
        workloadIdentity: {
          identityProviderId: 'idp_subject',
          serviceAccountId: 'svc_subject',
          provider: { tokenType, getToken: async () => 'subject-token' },
        },
        fetch: customFetch,
        fetchOptions: { dispatcher: dispatcher as never },
      });

      await client.models.list();

      expect(requests[0]?.init).not.toHaveProperty('dispatcher');
      expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
        subject_token: 'subject-token',
        subject_token_type: subjectTokenType,
      });
      expect(requests[1]?.init).toMatchObject({ dispatcher });
    },
  );

  test('rejects browser use even when dangerouslyAllowBrowser is enabled', () => {
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { userAgent: 'Chrome/120.0.0' });

    expect(
      () =>
        new OpenAI({
          apiKey: null,
          workloadIdentity: x509Identity,
          dangerouslyAllowBrowser: true,
          fetch: vi.fn(),
        }),
    ).toThrow('only supported in server runtimes');
  });

  test('rejects certificate-opaque edge runtimes even when Node globals are polyfilled', () => {
    vi.stubGlobal('EdgeRuntime', 'edge-runtime');

    expect(
      () =>
        new OpenAI({
          apiKey: null,
          workloadIdentity: x509Identity,
          dangerouslyAllowBrowser: true,
          fetch: vi.fn(),
        }),
    ).toThrow('only supported in server runtimes');
  });

  test('rejects Deno-like runtimes even when Node globals are polyfilled', () => {
    vi.stubGlobal('Deno', { version: { deno: '2.0.0' } });

    expect(
      () =>
        new OpenAI({
          apiKey: null,
          workloadIdentity: x509Identity,
          dangerouslyAllowBrowser: true,
          fetch: vi.fn(),
        }),
    ).toThrow('only supported in server runtimes');
  });

  test('invalidates and retries one 401 for a replayable request body', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const bodies: unknown[] = [];
    const authorizations: (string | null)[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }
      apiCount += 1;
      bodies.push(init?.body);
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return apiCount === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ ok: true });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    await client.post('/replayable', { body: 'same-body', headers: { 'Content-Type': 'text/plain' } });

    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
    expect(bodies).toEqual(['same-body', 'same-body']);
    expect(authorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  test('retries a replayable 401 when response cleanup fails', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }
      apiCount += 1;
      if (apiCount === 1) {
        const response = new Response(null, { status: 401 });
        Object.defineProperty(response, 'body', {
          value: {
            [Symbol.asyncIterator]: () => ({
              return: () => Promise.reject(new Error('response cleanup failed')),
            }),
          },
        });
        return response;
      }
      return Response.json({ ok: true });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    await expect(client.post('/replayable', { body: 'same-body' })).resolves.toMatchObject({ ok: true });
    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
  });

  test.each(['request headers', 'request hook'] as const)(
    'does not replay a 401 for a custom bearer set by %s',
    async (source) => {
      let exchangeCount = 0;
      let apiCount = 0;

      const client = new RequestMutatingOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchangeCount += 1;
            return tokenResponse(`token-${exchangeCount}`);
          }
          apiCount += 1;
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer custom-token');
          return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
        }),
      });
      client.requestMutation = (request) => {
        if (source === 'request hook') {
          (request.headers as Headers).set('Authorization', 'Bearer custom-token');
        }
      };

      await expect(
        client.models.list(
          source === 'request headers' ? { headers: { Authorization: 'Bearer custom-token' } } : {},
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(exchangeCount).toBe(source === 'request headers' ? 0 : 1);
      expect(apiCount).toBe(1);
    },
  );

  test.each([
    { identity: x509Identity, identityName: 'X.509', source: 'request headers' as const },
    { identity: x509Identity, identityName: 'X.509', source: 'request hook deletion' as const },
    { identity: x509Identity, identityName: 'X.509', source: 'request hook empty value' as const },
    { identity: subjectTokenIdentity, identityName: 'subject token', source: 'request headers' as const },
    {
      identity: subjectTokenIdentity,
      identityName: 'subject token',
      source: 'request hook deletion' as const,
    },
    {
      identity: subjectTokenIdentity,
      identityName: 'subject token',
      source: 'request hook empty value' as const,
    },
  ])('preserves anonymous $identityName requests created by $source', async ({ identity, source }) => {
    let exchangeCount = 0;
    const apiAuthorizations: (string | null)[] = [];
    const client = new RequestMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse('workload-identity-token');
        }
        apiAuthorizations.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      }),
    });
    client.requestMutation = (request) => {
      if (source === 'request hook deletion') {
        (request.headers as Headers).delete('Authorization');
      } else if (source === 'request hook empty value') {
        (request.headers as Headers).set('Authorization', '  ');
      }
    };

    await client.models.list(source === 'request headers' ? { headers: { Authorization: null } } : undefined);

    expect(apiAuthorizations).toEqual([source === 'request hook empty value' ? '' : null]);
    expect(exchangeCount).toBe(source === 'request headers' ? 0 : 1);
  });

  test.each([
    {
      headers: { Authorization: 'Bearer hook-token', 'X-Hook': 'object' },
      name: 'object',
      expectedAuthorization: 'Bearer hook-token',
    },
    {
      headers: [['X-Hook', 'tuples']],
      name: 'tuple array',
      expectedAuthorization: null,
    },
  ] as const)(
    'normalizes a $name HeadersInit installed by a request hook',
    async ({ headers, expectedAuthorization }) => {
      let exchangeCount = 0;
      const apiAuthorizations: (string | null)[] = [];
      const client = new RequestMutatingOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchangeCount += 1;
            return tokenResponse('workload-identity-token');
          }
          apiAuthorizations.push(new Headers(init?.headers).get('Authorization'));
          return Response.json({ data: [] });
        }),
      });
      client.requestMutation = (request) => {
        request.headers = headers as Exclude<RequestInit['headers'], undefined>;
      };

      await client.models.list();

      expect(apiAuthorizations).toEqual([expectedAuthorization]);
      expect(exchangeCount).toBe(1);
    },
  );

  test('collapses concurrent 401 invalidations into one shared refresh', async () => {
    const firstWaveGate = deferredResponse();
    let exchangeCount = 0;
    let firstWaveCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }

      apiCount += 1;
      if (new Headers(init?.headers).get('Authorization') === 'Bearer token-1') {
        firstWaveCount += 1;
        if (firstWaveCount === 2) {
          firstWaveGate.resolve(new Response());
        }
        await firstWaveGate.promise;
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    await expect(Promise.all([client.models.list(), client.models.list()])).resolves.toHaveLength(2);
    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(4);
  });

  test('invalidates the transport that received a 401 even if the client rotates before the response', async () => {
    const originalDispatcher = { name: 'original-dispatcher' };
    const replacementDispatcher = { name: 'replacement-dispatcher' };
    const firstAPIResponse = deferredResponse();
    const exchangeDispatchers: unknown[] = [];
    let exchangeCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const dispatcher = (init as { dispatcher?: unknown })?.dispatcher;
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        exchangeDispatchers.push(dispatcher);
        return tokenResponse(`token-${exchangeCount}`);
      }
      apiCount += 1;
      return apiCount === 1 ? await firstAPIResponse.promise : Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
      fetchOptions: { dispatcher: originalDispatcher as never },
    });
    const originalTransportClient = client.withOptions({ timeout: 5000 });

    const request = client.models.list();
    await vi.waitFor(() => expect(apiCount).toBe(1));
    client.fetchOptions = { dispatcher: replacementDispatcher as never };
    firstAPIResponse.resolve(Response.json({ error: { message: 'Unauthorized' } }, { status: 401 }));

    await expect(request).resolves.toMatchObject({ data: [] });
    await expect(originalTransportClient.models.list()).resolves.toMatchObject({ data: [] });
    expect(exchangeDispatchers).toEqual([originalDispatcher, replacementDispatcher, originalDispatcher]);
    expect(apiCount).toBe(3);
  });

  test('allows one independent 401 refresh for each pagination request', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }

      apiCount += 1;
      if (apiCount === 1 || apiCount === 3) {
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }
      return Response.json({
        data: [{ id: apiCount === 2 ? 'first' : 'second' }],
        has_more: apiCount === 2,
      });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    const firstPage = await client.getAPIList('/items', CursorPage<{ id: string }>);
    const secondPage = await firstPage.getNextPage();

    expect(firstPage.data).toEqual([{ id: 'first' }]);
    expect(secondPage.data).toEqual([{ id: 'second' }]);
    expect(exchangeCount).toBe(3);
    expect(apiCount).toBe(4);
  });

  test('invalidates without replaying a non-replayable body after a 401', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const apiAuthorizations: (string | null)[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }
      apiCount += 1;
      apiAuthorizations.push(new Headers(init?.headers).get('Authorization'));
      return apiCount === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    await expect(client.post('/streaming', { body: nonReplayableBody() })).rejects.toMatchObject({
      status: 401,
    });
    expect(exchangeCount).toBe(1);
    expect(apiCount).toBe(1);

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
    expect(apiAuthorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  test('a canceled API request does not cancel the exchange shared by another request', async () => {
    const exchange = deferredResponse();
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        return await exchange.promise;
      }
      apiCount += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });
    const controller = new AbortController();

    const canceled = client.models.list({ signal: controller.signal });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const winner = client.models.list();
    controller.abort('caller stopped waiting');

    await expect(canceled).rejects.toBeInstanceOf(APIUserAbortError);
    exchange.resolve(tokenResponse('shared-token'));
    await expect(winner).resolves.toMatchObject({ data: [] });
    expect(apiCount).toBe(1);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('a request timeout bounds its exchange wait without canceling another request', async () => {
    vi.useFakeTimers();
    const exchange = deferredResponse();
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        return await exchange.promise;
      }
      apiCount += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    const timedOut = client.models.list({ timeout: 1000 });
    const winner = client.models.list({ timeout: 5000 });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const timeoutAssertion = expect(timedOut).rejects.toBeInstanceOf(APIConnectionTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    await timeoutAssertion;
    exchange.resolve(tokenResponse('shared-token'));

    await expect(winner).resolves.toMatchObject({ data: [] });
    expect(apiCount).toBe(1);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });
});
