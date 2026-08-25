import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from 'undici';
import { vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import type { ClientOptions } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import { isRetryableX509TransportFailure } from 'openai/internal/auth/x509-transport-registry';
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
