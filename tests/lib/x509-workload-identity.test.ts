import { expect, vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
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

  test('rejects per-request fetchOptions before exchanging a transport-bound identity', async () => {
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

  test('shares the X.509 token cache with a transport-equivalent withOptions client', async () => {
    let exchangeCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });
    const derivedClient = client.withOptions({ timeout: 5000 });

    await Promise.all([client.models.list(), derivedClient.models.list()]);
    expect(exchangeCount).toBe(1);
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

  test('does not replay a non-replayable body after a 401', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`);
      }
      apiCount += 1;
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    await expect(client.post('/streaming', { body: nonReplayableBody() })).rejects.toMatchObject({
      status: 401,
    });
    expect(exchangeCount).toBe(1);
    expect(apiCount).toBe(1);
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
