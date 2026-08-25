import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import { vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import type { ClientOptions } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import { Page } from 'openai/core/pagination';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import {
  isRetryableX509TransportFailure,
  resolveX509Transport,
} from 'openai/internal/auth/x509-transport-registry';
import { OpenAIRealtimeWebSocket as StableNativeRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaNativeRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

const TOKEN_RESPONSE = {
  access_token: 'synthetic-review-bearer',
  token_type: 'Bearer',
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  expires_in: 3600,
};

let dispatcher: Agent;
let transport: X509Transport;

function options(overrides: Partial<ClientOptions> = {}): ClientOptions {
  return {
    apiKey: null,
    maxRetries: 0,
    workloadIdentity: {
      type: 'x509',
      identityProviderId: 'synthetic-review-provider',
      serviceAccountId: 'synthetic-review-account',
    },
    x509Transport: transport,
    ...overrides,
  };
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
  vi.restoreAllMocks();
  await dispatcher.close();
});

describe('X.509 review regressions', () => {
  test('documents the public X.509 authentication flow alongside workload-identity guidance', () => {
    const authenticationGuide = readFileSync('docs/authentication.md', 'utf-8');

    expect(authenticationGuide).toContain("import { createX509Transport } from 'openai/auth/x509-transport'");
    expect(authenticationGuide).toContain("certificateIdentity: 'static'");
    expect(authenticationGuide).toContain('https://mtls.api.openai.com/v1');
    expect(authenticationGuide).toContain('WebSocket');
  });

  test('classifies an accessor-backed workload identity exactly once', async () => {
    const configuration = options();
    const enrolled = configuration.workloadIdentity;
    const getter = vi.fn(() =>
      getter.mock.calls.length === 1
        ? enrolled
        : {
            identityProviderId: 'synthetic-other-provider',
            serviceAccountId: 'synthetic-other-account',
            provider: { tokenType: 'jwt' as const, getToken: async () => 'synthetic-subject-token' },
          },
    );
    Object.defineProperty(configuration, 'workloadIdentity', { enumerable: true, get: getter });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ data: [] }),
      );

    await new OpenAI(configuration).models.list();

    expect(getter).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('preserves an explicitly empty admin credential without presenting its certificate', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(Response.json({ data: [] }));
    const client = new OpenAI(options({ adminAPIKey: '' }));

    await client.request({
      path: '/organization/projects',
      method: 'get',
      __security: { adminAPIKeyAuth: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.api.openai.com');
    expect(new Headers(send.mock.calls[0]?.[2].headers).get('Authorization')).toBe('Bearer');
  });

  test('never approves caller-substituted admin credentials', async () => {
    const send = vi.spyOn(transportCapability, 'sendX509Request');
    const client = new OpenAI(options({ adminAPIKey: '' }));

    await expect(
      client.request({
        path: '/organization/projects',
        method: 'get',
        headers: { Authorization: 'Bearer synthetic-attacker-admin' },
        __security: { adminAPIKeyAuth: true },
      }),
    ).rejects.toThrow(/authorization/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([408, 409, 429, 500, 503])('retries trusted issuer status %i', async (status) => {
    let issuerRequests = 0;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          issuerRequests += 1;
          return issuerRequests === 1
            ? new Response(null, { status, headers: { 'retry-after-ms': '1' } })
            : Response.json(TOKEN_RESPONSE);
        }
        return Response.json({ data: [] });
      });

    await new OpenAI(options({ maxRetries: 1 })).models.list();

    expect(issuerRequests).toBe(2);
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('honors an explicit issuer retry denial', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'x-should-retry': 'false' } }));

    await expect(new OpenAI(options({ maxRetries: 2 })).models.list()).rejects.toMatchObject({
      status: 503,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test.each(['request', 'method', 'list'] as const)(
    'starts the %s X.509 deadline only after deferred request options resolve',
    async (surface) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? Response.json(TOKEN_RESPONSE)
            : Response.json({ data: [] }),
        );
      const client = new OpenAI(options({ timeout: 20 }));
      const deferred = delay(45).then(() => ({}));

      if (surface === 'request') {
        await client.request(deferred.then((request) => ({ ...request, path: '/models', method: 'get' })));
      } else if (surface === 'method') {
        await client.get('/models', deferred);
      } else {
        await client.getAPIList('/models', Page, deferred);
      }

      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  test('keeps a nested public request in an independent X.509 authentication scope', async () => {
    const scopes: ReturnType<ReturnType<typeof resolveX509Transport>['current']>[] = [];
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ data: [] }),
      );
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async () => {
        scopes.push(resolveX509Transport(transport).current());
        if (scopes.length === 1) {
          await client.models.list();
        }
      },
    });

    await client.models.list();

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(send.mock.calls.filter((call) => call[1].origin === 'https://mtls.api.openai.com')).toHaveLength(
      2,
    );
  });

  test('validates the exact rendered API destination before presenting its certificate', async () => {
    const path = vi.fn(() =>
      path.mock.calls.length === 1 ? 'https://attacker.invalid/v1/models' : '/models',
    );
    const request = Object.defineProperty({ method: 'get' as const, path: '/models' }, 'path', {
      enumerable: true,
      get: path,
    });
    const send = vi.spyOn(transportCapability, 'sendX509Request');

    await expect(new OpenAI(options()).request(request)).rejects.toThrow(/approved.*mTLS.*origin/iu);

    expect(path).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  test('never replays a one-shot body installed by a hook after response-body timeout', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }),
      );
    const client = new OpenAI(options({ timeout: 35, maxRetries: 1 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.body = new ReadableStream();
      },
    });

    await expect(client.models.list()).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('never retries a synchronous one-shot iterator installed by a request hook', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : new Response(null, { status: 503, headers: { 'retry-after-ms': '1' } }),
      );
    const client = new OpenAI(options({ maxRetries: 1 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        Object.defineProperty(request, 'body', {
          value: [new TextEncoder().encode('synthetic-one-shot-chunk')][Symbol.iterator](),
          writable: true,
          configurable: true,
        });
      },
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 503 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('authenticates with the same accessor-backed signal captured for API dispatch', async () => {
    const actual = new AbortController();
    const unrelated = new AbortController();
    const getter = vi.fn(() => (getter.mock.calls.length === 1 ? actual.signal : unrelated.signal));
    const request = Object.defineProperty({ path: '/models', method: 'get' as const }, 'signal', {
      enumerable: true,
      get: getter,
    });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, _url, init) => {
        await delay(500, undefined, { signal: init.signal ?? undefined });
        return Response.json(TOKEN_RESPONSE);
      });
    const pending = new OpenAI(options()).buildRequest(request);
    await delay(20);
    actual.abort(new Error('synthetic-snapshotted-signal-canceled'));

    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('authenticates within the same accessor-backed timeout captured for API dispatch', async () => {
    const getter = vi.fn(() => (getter.mock.calls.length === 1 ? 30 : 1000));
    const request = Object.defineProperty({ path: '/models', method: 'get' as const }, 'timeout', {
      enumerable: true,
      get: getter,
    });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, _url, init) => {
        await delay(150, undefined, { signal: init.signal ?? undefined });
        return Response.json(TOKEN_RESPONSE);
      });

    await expect(new OpenAI(options()).buildRequest(request)).rejects.toBeInstanceOf(
      APIConnectionTimeoutError,
    );
    expect(getter).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('preserves its original accessor-backed signal when issuer authentication retries', async () => {
    const actual = new AbortController();
    const unrelated = new AbortController();
    const getter = vi.fn(() => (getter.mock.calls.length === 1 ? actual.signal : unrelated.signal));
    const request = Object.defineProperty({ path: '/models', method: 'get' as const }, 'signal', {
      enumerable: true,
      get: getter,
    });
    let issuerCalls = 0;
    let dispatchedSignal: RequestInit['signal'];
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) => {
        if (url.origin !== 'https://mtls.auth.openai.com') {
          return Response.json({ data: [] });
        }
        issuerCalls += 1;
        return issuerCalls === 1
          ? new Response(null, { status: 503, headers: { 'retry-after-ms': '1' } })
          : Response.json(TOKEN_RESPONSE);
      });
    const client = new OpenAI(options({ maxRetries: 1 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (prepared: RequestInit) => {
        dispatchedSignal = prepared.signal;
      },
    });

    await client.request(request);

    expect(dispatchedSignal).toBe(actual.signal);
    expect(getter.mock.calls.length).toBeGreaterThan(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('never generically retries a rejected X.509 credential after refreshing it once', async () => {
    let issuerRequests = 0;
    let apiRequests = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        issuerRequests += 1;
        return Response.json({
          ...TOKEN_RESPONSE,
          access_token: `synthetic-review-bearer-${issuerRequests}`,
        });
      }
      apiRequests += 1;
      return apiRequests === 3
        ? Response.json({ data: [] })
        : new Response(null, { status: 401, headers: { 'x-should-retry': 'true' } });
    });
    const client = new OpenAI(options({ maxRetries: 5 }));

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(issuerRequests).toBe(2);
    expect(apiRequests).toBe(2);

    await client.models.list();
    expect(issuerRequests).toBe(3);
    expect(apiRequests).toBe(3);
  });

  test('never retries issuer authentication after a one-shot request body starts pulling', async () => {
    let pulledChunks = 0;
    const body = {
      async *[Symbol.asyncIterator]() {
        pulledChunks += 1;
        yield new TextEncoder().encode('synthetic-first-chunk');
        pulledChunks += 1;
        yield new TextEncoder().encode('synthetic-second-chunk');
      },
    };
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'retry-after-ms': '1' } }));

    await expect(
      new OpenAI(options({ maxRetries: 1 })).request({ path: '/responses', method: 'post', body }),
    ).rejects.toMatchObject({ status: 503 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].origin).toBe('https://mtls.auth.openai.com');
    expect(pulledChunks).toBe(1);
  });

  test('cancels API retry backoff immediately when its caller aborts', async () => {
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? Response.json(TOKEN_RESPONSE)
        : new Response(null, { status: 503, headers: { 'retry-after-ms': '500' } }),
    );
    const controller = new AbortController();
    const startedAt = performance.now();
    const pending = new OpenAI(options({ maxRetries: 1, timeout: 1000 })).models.list({
      signal: controller.signal,
    });
    await delay(20);
    controller.abort(new Error('synthetic-retry-canceled'));

    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
    expect(performance.now() - startedAt).toBeLessThan(350);
  });

  test('keeps terminal API error-body consumption inside its request deadline', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull: async () => {
        await Promise.race([]);
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? Response.json(TOKEN_RESPONSE)
        : new Response(stream, { status: 400 }),
    );

    await expect(new OpenAI(options({ timeout: 35 })).models.list()).rejects.toBeInstanceOf(
      APIConnectionTimeoutError,
    );
  });

  test('preserves caller cancellation when an error body fails synchronously on abort', async () => {
    const caller = new AbortController();
    const reason = new Error('synthetic-immediate-error-body-cancellation');
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? Response.json(TOKEN_RESPONSE)
        : new Response(
            new ReadableStream({
              pull(controller) {
                caller.abort(reason);
                controller.error(reason);
              },
            }),
            { status: 403 },
          ),
    );

    await expect(new OpenAI(options()).models.list({ signal: caller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
  });

  test('preserves hook-signal cancellation while reading a stalled terminal error body', async () => {
    const replacement = new AbortController();
    const reason = new Error('synthetic-hook-error-body-cancellation');
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, request) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : new Response(
              new ReadableStream({
                start(stream) {
                  request.signal?.addEventListener('abort', () => stream.error(request.signal?.reason), {
                    once: true,
                  });
                },
              }),
              { status: 403 },
            ),
      );
    const client = new OpenAI(options({ timeout: 1000 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.signal = replacement.signal;
      },
    });
    const pending = client.models.list();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    replacement.abort(reason);

    await expect(pending).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
  });

  test.each(['default', 'request'] as const)(
    'renders mutable %s header values only once before presenting its certificate',
    async (location) => {
      const getter = vi.fn(() => (getter.mock.calls.length === 1 ? undefined : 'synthetic-forbidden'));
      const headers = Object.defineProperty({}, 'api-key', { enumerable: true, get: getter });
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? Response.json(TOKEN_RESPONSE)
            : Response.json({ data: [] }),
        );
      const client = new OpenAI(options(location === 'default' ? { defaultHeaders: headers } : {}));

      await client.models.list(location === 'request' ? { headers } : {});

      expect(getter).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(new Headers(send.mock.calls[1]?.[2].headers).has('api-key')).toBe(false);
    },
  );

  test.each(['default', 'request'] as const)(
    'rejects forbidden %s header snapshots before presenting its certificate',
    async (location) => {
      const getter = vi.fn(() => 'synthetic-forbidden');
      const headers = Object.defineProperty({}, 'Proxy-Authorization', { enumerable: true, get: getter });
      const send = vi.spyOn(transportCapability, 'sendX509Request');
      const client = new OpenAI(options(location === 'default' ? { defaultHeaders: headers } : {}));

      await expect(client.models.list(location === 'request' ? { headers } : {})).rejects.toThrow(
        /caller-supplied.*credentials/iu,
      );
      expect(getter).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['OpenAI_Organization', 'synthetic-enrolled-organization'],
    ['OpenAI_Project', 'synthetic-enrolled-project'],
  ])('rejects an equal-valued %s alias before presenting its certificate', async (header, value) => {
    const send = vi.spyOn(transportCapability, 'sendX509Request');
    const client = new OpenAI(
      options({ organization: 'synthetic-enrolled-organization', project: 'synthetic-enrolled-project' }),
    );

    await expect(client.models.list({ headers: { [header]: value } })).rejects.toThrow(
      /organization or project/iu,
    );
    expect(send).not.toHaveBeenCalled();
  });

  test('preserves caller request and header identities while snapshotting authenticated headers', async () => {
    const headers = { 'X-Synthetic-Request': 'synthetic-value' };
    const request = { path: '/models', method: 'get' as const, headers };
    let observedOptions: unknown;
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (_request: RequestInit, context: { options: unknown }) => {
        observedOptions = context.options;
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? Response.json(TOKEN_RESPONSE)
        : Response.json({ data: [] }),
    );

    await client.request(request);

    expect(observedOptions).toBe(request);
    expect(request.headers).toBe(headers);
  });

  test('accepts an equivalent Headers replacement from a protected request hook', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ data: [] }),
      );
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.headers = new Headers(request.headers);
        request.headers.set('X-Synthetic-Hook', 'synthetic-approved-value');
      },
    });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Headers(send.mock.calls[1]?.[2].headers).get('Authorization')).toBe(
      'Bearer synthetic-review-bearer',
    );
    expect(new Headers(send.mock.calls[1]?.[2].headers).get('X-Synthetic-Hook')).toBe(
      'synthetic-approved-value',
    );
  });

  test.each([
    ['Authorization', 'Bearer synthetic-attacker-bearer'],
    ['Proxy-Authorization', 'synthetic-attacker-proxy'],
  ])('rejects a hook-replaced Headers container carrying forbidden %s', async (name, value) => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(Response.json(TOKEN_RESPONSE));
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.headers = new Headers(request.headers);
        request.headers.set(name, value);
      },
    });

    await expect(client.models.list()).rejects.toThrow(/authorization|authentication/iu);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('clears authenticated request credentials when a protected request hook fails', async () => {
    let observedScope: ReturnType<ReturnType<typeof resolveX509Transport>['current']>;
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async () => {
        observedScope = resolveX509Transport(transport).current();
        throw new Error('synthetic-request-hook-failure');
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(Response.json(TOKEN_RESPONSE));

    await expect(client.models.list()).rejects.toThrow('synthetic-request-hook-failure');
    expect(observedScope).toBeDefined();
    expect(observedScope).not.toHaveProperty('token');
    expect(observedScope).not.toHaveProperty('headers');
    expect(observedScope).not.toHaveProperty('authorization');
    expect(observedScope).not.toHaveProperty('defaultHeaders');
    expect(observedScope).not.toHaveProperty('requestHeaders');
  });

  test('cancels an unread successful response when parsing begins after its request deadline', async () => {
    const canceled = vi.fn();
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? Response.json(TOKEN_RESPONSE)
        : new Response(new ReadableStream({ cancel: canceled }), {
            headers: { 'content-type': 'application/json' },
          }),
    );
    const request = new OpenAI(options({ timeout: 25 })).models.list();

    await request.asResponse();
    await delay(35);

    await expect(request).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(canceled).toHaveBeenCalledTimes(1);
  });

  test('preserves caller cancellation when a protected hook replaces the request signal', async () => {
    class SignalReplacingClient extends OpenAI {
      readonly replacementSignal = new AbortController().signal;

      protected override async prepareRequest(request: RequestInit): Promise<void> {
        request.signal = this.replacementSignal;
      }
    }
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url, request) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        return Response.json(TOKEN_RESPONSE);
      }
      await delay(500, undefined, { signal: request.signal ?? undefined });
      return Response.json({ data: [] });
    });
    const controller = new AbortController();
    const startedAt = performance.now();
    const pending = new SignalReplacingClient(options()).models.list({ signal: controller.signal });
    await delay(20);
    controller.abort(new Error('synthetic-original-caller-canceled'));

    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
    expect(performance.now() - startedAt).toBeLessThan(350);
  });

  test('recognizes an inherited plain-data X.509 identity discriminator', () => {
    const inheritedIdentity = Object.assign(Object.create({ type: 'x509' }) as object, {
      identityProviderId: 'synthetic-inherited-provider',
      serviceAccountId: 'synthetic-inherited-account',
    });

    const client = new OpenAI(
      options({ workloadIdentity: inheritedIdentity as ClientOptions['workloadIdentity'] }),
    );

    expect(client.baseURL).toBe('https://mtls.api.openai.com/v1');
  });

  test.each(['own', 'inherited'] as const)('treats an %s undefined legacy provider as absent', (location) => {
    const identity = {
      type: 'x509',
      identityProviderId: 'synthetic-undefined-provider',
      serviceAccountId: 'synthetic-service-account',
    };
    const workloadIdentity =
      location === 'own'
        ? { ...identity, provider: undefined }
        : Object.assign(Object.create({ provider: undefined }) as object, identity);

    const client = new OpenAI(
      options({ workloadIdentity: workloadIdentity as ClientOptions['workloadIdentity'] }),
    );

    expect(client.baseURL).toBe('https://mtls.api.openai.com/v1');
  });

  test('clones only the identity selectors captured before caller configuration mutation', async () => {
    const configuration = options();
    const client = new OpenAI(configuration);
    const identity = configuration.workloadIdentity;
    if (!identity || !('identityProviderId' in identity)) {
      throw new Error('Expected a synthetic X.509 identity.');
    }
    Object.assign(identity, {
      type: 'mutated',
      identityProviderId: 'synthetic-attacker-provider',
      serviceAccountId: 'synthetic-attacker-account',
    });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(TOKEN_RESPONSE)
          : Response.json({ data: [] }),
      );

    await client.withOptions({ timeout: 2000 }).models.list();

    expect(JSON.parse(String(send.mock.calls[0]?.[2].body))).toMatchObject({
      identity_provider_id: 'synthetic-review-provider',
      service_account_id: 'synthetic-review-account',
    });
  });

  test.each(['own', 'inherited'] as const)(
    'rejects an %s accessor discriminator without invoking it',
    (location) => {
      const getter = vi.fn(() => 'x509');
      const base = {
        identityProviderId: 'synthetic-accessor-provider',
        serviceAccountId: 'synthetic-accessor-account',
      };
      const workloadIdentity =
        location === 'own'
          ? Object.defineProperty(base, 'type', { get: getter })
          : Object.assign(Object.create(Object.defineProperty({}, 'type', { get: getter })) as object, base);

      expect(
        () =>
          new OpenAI(options({ workloadIdentity: workloadIdentity as ClientOptions['workloadIdentity'] })),
      ).toThrow(/plain data property/iu);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['permanent outer TLS code', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ECONNRESET'],
    ['permanent nested TLS code', 'ECONNRESET', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['permanent decompression', 'Z_DATA_ERROR', 'ECONNRESET'],
  ])('never retries a transport failure with a %s', (_label, outer, nested) => {
    const failure = Object.assign(new Error('synthetic mixed transport failure'), {
      code: outer,
      cause: { code: nested },
    });

    expect(isRetryableX509TransportFailure(failure)).toBe(false);
  });

  test('accepts a wrapper around a known transient transport code', () => {
    const failure = Object.assign(new Error('synthetic temporary transport failure'), {
      cause: { code: 'ECONNRESET' },
    });

    expect(isRetryableX509TransportFailure(failure)).toBe(true);
  });

  const websocketSurfaces = [
    ['stable Responses', (client: OpenAI) => new StableResponsesWS(client)],
    ['beta Responses', (client: OpenAI) => new BetaResponsesWS(client)],
    ['stable Node Realtime', (client: OpenAI) => new StableNodeRealtime({ model: 'gpt-realtime' }, client)],
    ['beta Node Realtime', (client: OpenAI) => new BetaNodeRealtime({ model: 'gpt-realtime' }, client)],
    [
      'stable native Realtime',
      (client: OpenAI) => new StableNativeRealtime({ model: 'gpt-realtime' }, client),
    ],
    ['beta native Realtime', (client: OpenAI) => new BetaNativeRealtime({ model: 'gpt-realtime' }, client)],
  ] as const;

  test.each(websocketSurfaces)('rejects %s before opening an unsupported socket', (_name, open) => {
    const client = new OpenAI(options());

    expect(() => open(client)).toThrow(/X\.509.*WebSocket/iu);
  });

  test('keeps WebSockets disabled after the original identity object is mutated', () => {
    const configuration = options();
    const client = new OpenAI(configuration);
    const identity = configuration.workloadIdentity;
    if (!identity) {
      throw new Error('Expected a synthetic workload identity.');
    }
    Object.defineProperty(identity, 'type', { value: 'legacy' });

    expect(() => new StableResponsesWS(client)).toThrow(/X\.509.*WebSocket/iu);
    expect(() => new StableNodeRealtime({ model: 'gpt-realtime' }, client)).toThrow(/X\.509.*WebSocket/iu);
  });
});
