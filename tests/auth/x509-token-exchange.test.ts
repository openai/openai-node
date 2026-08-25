import { X509Certificate } from 'node:crypto';
import { Agent, ProxyAgent } from 'undici';
import { vi } from 'vitest';

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  OAuthError,
  OpenAIError,
} from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import { exchangeX509Token } from 'openai/internal/auth/x509-token-exchange';

import {
  closeObservedServers,
  createConnectProxy,
  createMutualTLSServer,
  createX509TestLab,
  listenLoopback,
} from '../utils/x509-test-lab';

const ISSUER_URL = 'https://mtls.auth.openai.com/oauth/token';
const VALID_TOKEN_RESPONSE = {
  access_token: 'synthetic-workload.access-token_123',
  token_type: 'Bearer',
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  expires_in: 3600,
};

let dispatcher: Agent;
let transport: X509Transport;

function exchange(signal?: AbortSignal) {
  return exchangeX509Token({
    transport,
    identityProviderId: 'synthetic-identity-provider',
    serviceAccountId: 'synthetic-service-account',
    ...(signal ? { signal } : {}),
  });
}

function mockResponse(body: unknown, init?: ResponseInit) {
  return vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(Response.json(body, init));
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

describe('isolated X.509 workload-identity token exchange', () => {
  test('pins the issuer and sends exactly four certificate-authenticated OAuth fields', async () => {
    const send = mockResponse(VALID_TOKEN_RESPONSE);

    await expect(exchange()).resolves.toEqual({
      accessToken: VALID_TOKEN_RESPONSE.access_token,
      expiresIn: 3600,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [selectedTransport, url, options] = send.mock.calls[0] ?? [];
    expect(selectedTransport).toBe(transport);
    expect(url?.href).toBe(ISSUER_URL);
    expect(options?.method).toBe('POST');
    expect(options?.redirect).toBe('manual');
    expect(new Headers(options?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(options?.body))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:openai:params:oauth:token-type:x509',
      identity_provider_id: 'synthetic-identity-provider',
      service_account_id: 'synthetic-service-account',
    });
    expect(options).not.toHaveProperty('dispatcher');
  });

  test.each([undefined, null, '', '   ', 12, [], {}])(
    'rejects an invalid identity-provider selector before issuer dispatch: %j',
    async (identityProviderId) => {
      const send = mockResponse(VALID_TOKEN_RESPONSE);

      await expect(
        exchangeX509Token({
          transport,
          identityProviderId: identityProviderId as string,
          serviceAccountId: 'synthetic-service-account',
        }),
      ).rejects.toThrow(/provider.*service-account/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, null, '', '   ', 12, [], {}])(
    'rejects an invalid service-account selector before issuer dispatch: %j',
    async (serviceAccountId) => {
      const send = mockResponse(VALID_TOKEN_RESPONSE);

      await expect(
        exchangeX509Token({
          transport,
          identityProviderId: 'synthetic-identity-provider',
          serviceAccountId: serviceAccountId as string,
        }),
      ).rejects.toThrow(/provider.*service-account/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('rejects executable identity serializers without invoking them', async () => {
    const toJSON = vi.fn(() => 'synthetic-identity-provider');
    const send = mockResponse(VALID_TOKEN_RESPONSE);

    await expect(
      exchangeX509Token({
        transport,
        identityProviderId: { toJSON } as unknown as string,
        serviceAccountId: 'synthetic-service-account',
      }),
    ).rejects.toThrow(/provider.*service-account/iu);
    expect(toJSON).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test('snapshots each validated identity selector exactly once before serialization', async () => {
    const toJSON = vi.fn(() => 'synthetic-attacker-identity');
    const identityProviderId = vi.fn(() =>
      identityProviderId.mock.calls.length === 1 ? 'synthetic-identity-provider' : { toJSON },
    );
    const serviceAccountId = vi.fn(() =>
      serviceAccountId.mock.calls.length === 1 ? 'synthetic-service-account' : { toJSON },
    );
    const options = {
      transport,
      get identityProviderId() {
        return identityProviderId() as string;
      },
      get serviceAccountId() {
        return serviceAccountId() as string;
      },
    };
    const send = mockResponse(VALID_TOKEN_RESPONSE);

    await expect(exchangeX509Token(options)).resolves.toMatchObject({
      accessToken: VALID_TOKEN_RESPONSE.access_token,
    });
    expect(identityProviderId).toHaveBeenCalledTimes(1);
    expect(serviceAccountId).toHaveBeenCalledTimes(1);
    expect(toJSON).not.toHaveBeenCalled();
    expect(JSON.parse(String(send.mock.calls[0]?.[2].body))).toMatchObject({
      identity_provider_id: 'synthetic-identity-provider',
      service_account_id: 'synthetic-service-account',
    });
  });

  test.each([
    null,
    [],
    'token',
    { ...VALID_TOKEN_RESPONSE, access_token: undefined },
    { ...VALID_TOKEN_RESPONSE, access_token: '' },
    { ...VALID_TOKEN_RESPONSE, access_token: ' token' },
    { ...VALID_TOKEN_RESPONSE, access_token: 'token ' },
    { ...VALID_TOKEN_RESPONSE, access_token: 'token\nsecret' },
    { ...VALID_TOKEN_RESPONSE, access_token: 'token=middle' },
    { ...VALID_TOKEN_RESPONSE, access_token: 'tokén' },
    { ...VALID_TOKEN_RESPONSE, token_type: undefined },
    { ...VALID_TOKEN_RESPONSE, token_type: 'Token' },
    { ...VALID_TOKEN_RESPONSE, issued_token_type: undefined },
    { ...VALID_TOKEN_RESPONSE, issued_token_type: 'urn:attacker:token' },
    { ...VALID_TOKEN_RESPONSE, expires_in: undefined },
    { ...VALID_TOKEN_RESPONSE, expires_in: 0 },
    { ...VALID_TOKEN_RESPONSE, expires_in: -1 },
    { ...VALID_TOKEN_RESPONSE, expires_in: 3601 },
    { ...VALID_TOKEN_RESPONSE, expires_in: '3600' },
  ])('rejects an invalid token response: %j', async (response) => {
    mockResponse(response);

    await expect(exchange()).rejects.toThrow(OpenAIError);
  });

  test('accepts the documented bearer-token character alphabet and trailing padding', async () => {
    mockResponse({ ...VALID_TOKEN_RESPONSE, access_token: 'AZaz09._~+/-==' });

    await expect(exchange()).resolves.toMatchObject({ accessToken: 'AZaz09._~+/-==' });
  });

  test.each(['Bearer', 'bearer', 'bEaReR'])('accepts case-insensitive OAuth token type %s', async (type) => {
    mockResponse({ ...VALID_TOKEN_RESPONSE, token_type: type });

    await expect(exchange()).resolves.toMatchObject({ accessToken: VALID_TOKEN_RESPONSE.access_token });
  });

  test('accepts large valid issuer tokens and metadata without an arbitrary response-size cap', async () => {
    const accessToken = 'a'.repeat(128 * 1024);
    mockResponse({
      ...VALID_TOKEN_RESPONSE,
      access_token: accessToken,
      metadata: 'x'.repeat(2 * 1024 * 1024),
    });

    await expect(exchange()).resolves.toEqual({ accessToken, expiresIn: 3600 });
  });

  test('rejects malformed issuer JSON without disclosing its contents', async () => {
    const secret = 'synthetic-issuer-json-secret';
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(`{"token":"${secret}`));

    await expect(exchange()).rejects.toThrow(/invalid.*JSON/iu);
    await exchange().catch((error: Error) => expect(error.message).not.toContain(secret));
  });

  test('preserves issuer status and request ID when a successful token response is invalid', async () => {
    mockResponse(
      { ...VALID_TOKEN_RESPONSE, access_token: '' },
      { status: 200, headers: { 'X-Request-ID': 'synthetic-invalid-token-request' } },
    );

    await expect(exchange()).rejects.toMatchObject({
      status: 200,
      requestID: 'synthetic-invalid-token-request',
    });
  });

  test('preserves issuer status and request ID when successful issuer JSON is malformed', async () => {
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(
      new Response('{', { status: 202, headers: { 'X-Request-ID': 'synthetic-invalid-json-request' } }),
    );

    await expect(exchange()).rejects.toMatchObject({
      status: 202,
      requestID: 'synthetic-invalid-json-request',
    });
  });

  test('never accepts inherited token fields from a polluted object prototype', async () => {
    mockResponse({});
    vi.spyOn(JSON, 'parse').mockReturnValue(Object.create(VALID_TOKEN_RESPONSE));

    await expect(exchange()).rejects.toThrow(/invalid access token/iu);
  });

  test.each(['token_type', 'expires_in'] as const)(
    'never executes an inherited getter for a missing %s field',
    async (name) => {
      const getter = vi.fn(() => VALID_TOKEN_RESPONSE[name]);
      const response = { ...VALID_TOKEN_RESPONSE };
      Reflect.deleteProperty(response, name);

      const prototype = Object.defineProperty({}, name, { get: getter });
      const parsed = Object.assign(Object.create(prototype) as object, response);
      mockResponse(response);
      vi.spyOn(JSON, 'parse').mockReturnValue(parsed);

      await expect(exchange()).rejects.toThrow(OpenAIError);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each(['invalid_grant', 'invalid_subject_token', 'token_exchange_server_error'])(
    'preserves the known safe OAuth error class %s',
    async (code) => {
      const secret = 'synthetic-oauth-error-secret';
      mockResponse(
        { error: code, error_description: secret },
        {
          status: 403,
          headers: {
            Location: `https://attacker.invalid/?secret=${secret}`,
            'Set-Cookie': `credential=${secret}`,
            'X-Request-ID': 'synthetic-request-id',
            'X-Should-Retry': 'true',
          },
        },
      );

      const caught = await exchange().catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(OAuthError);
      expect(caught).toMatchObject({ status: 403, error_code: code });
      expect(String(caught)).not.toContain(secret);
      expect((caught as OAuthError).headers.get('location')).toBeNull();
      expect((caught as OAuthError).headers.get('set-cookie')).toBeNull();
      expect((caught as OAuthError).headers.get('x-should-retry')).toBeNull();
      expect((caught as OAuthError).requestID).toBe('synthetic-request-id');
    },
  );

  test('does not surface an unrecognized attacker-controlled OAuth error', async () => {
    const secret = 'synthetic-unrecognized-oauth-secret';
    mockResponse({ error: secret, error_description: secret }, { status: 401 });

    const caught = await exchange().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).error_code).toBeUndefined();
    expect(String(caught)).not.toContain(secret);
  });

  test('preserves a nested allowlisted OAuth error without disclosing nested details', async () => {
    const secret = 'synthetic-nested-oauth-secret';
    mockResponse({ error: { code: 'invalid_grant', message: secret } }, { status: 400 });

    const caught = await exchange().catch((error: unknown) => error);
    expect(caught).toMatchObject({ status: 400, error_code: 'invalid_grant' });
    expect(String(caught)).not.toContain(secret);
  });

  test.each([301, 302, 303, 307, 308])('rejects an issuer redirect with status %i', async (status) => {
    const secret = 'synthetic-redirect-secret';
    mockResponse(
      { secret },
      {
        status,
        headers: {
          Location: `https://attacker.invalid/?secret=${secret}`,
          'X-Should-Retry': 'true',
        },
      },
    );

    const caught = await exchange().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe(status);
    expect((caught as APIError).headers?.get('location')).toBeNull();
    expect((caught as APIError).headers?.get('x-should-retry')).toBeNull();
    expect(String(caught)).not.toContain(secret);
  });

  test.each([408, 409, 429, 500, 503])(
    'preserves only safe issuer retry guidance for transient status %i',
    async (status) => {
      const secret = 'synthetic-retry-header-secret';
      mockResponse(
        { secret },
        {
          status,
          headers: {
            'Retry-After': '4',
            'Retry-After-Ms': '250',
            'X-Should-Retry': 'true',
            'X-Request-ID': 'synthetic-retry-request-id',
            Location: `https://attacker.invalid/?secret=${secret}`,
            'Set-Cookie': `credential=${secret}`,
          },
        },
      );

      const caught = await exchange().catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(APIError);
      const error = caught as APIError;
      expect(error.status).toBe(status);
      expect(error.headers?.get('retry-after')).toBe('4');
      expect(error.headers?.get('retry-after-ms')).toBe('250');
      expect(error.headers?.get('x-should-retry')).toBe('true');
      expect(error.requestID).toBe('synthetic-retry-request-id');
      expect(error.headers?.get('location')).toBeNull();
      expect(error.headers?.get('set-cookie')).toBeNull();
      expect(String(error)).not.toContain(secret);
    },
  );

  test('redacts connection errors and their causes', async () => {
    const secret = 'synthetic-transport-private-key-secret';
    vi.spyOn(transportCapability, 'sendX509Request').mockRejectedValue(new Error(secret));

    const caught = await exchange().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(APIConnectionError);
    expect(String(caught)).not.toContain(secret);
    expect(caught).not.toHaveProperty('cause');
  });

  test('forwards cancellation to the certificate-authenticated issuer request', async () => {
    const send = mockResponse(VALID_TOKEN_RESPONSE);
    const controller = new AbortController();

    await exchange(controller.signal);

    const forwardedSignal = send.mock.calls[0]?.[2].signal;
    expect(forwardedSignal).toBeInstanceOf(AbortSignal);
    expect(forwardedSignal?.aborted).toBe(false);
  });

  test('rejects an already-canceled exchange without touching its transport', async () => {
    const send = mockResponse(VALID_TOKEN_RESPONSE);
    const controller = new AbortController();
    controller.abort(new Error('synthetic-request-canceled'));

    await expect(exchange(controller.signal)).rejects.toThrow(/canceled/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([307, 408, 429, 503])(
    'preserves cancellation racing issuer response headers with status %i',
    async (status) => {
      const controller = new AbortController();
      const cancellation = new Error('synthetic-response-header-cancellation');
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async () => {
        controller.abort(cancellation);
        return new Response(null, { status });
      });

      await expect(exchange(controller.signal)).rejects.toBe(cancellation);
    },
  );

  test('cancels and unlocks a hanging token response when the caller aborts', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull: async () => {
        await Promise.race([]);
      },
      cancel,
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(stream));
    const controller = new AbortController();
    const pending = exchange(controller.signal);

    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort(new Error('synthetic-stream-canceled'));

    await expect(pending).rejects.toThrow(/canceled/iu);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  test('preserves an SDK-native caller abort rather than turning it into an issuer error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull: async () => {
        await Promise.race([]);
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(stream));
    const controller = new AbortController();
    const pending = exchange(controller.signal);
    const abort = new APIUserAbortError({ message: 'synthetic-user-canceled' });

    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort(abort);

    await expect(pending).rejects.toBe(abort);
    expect(stream.locked).toBe(false);
  });

  test('bounds a hanging issuer response with its own five-second deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull: async () => {
        await Promise.race([]);
      },
      cancel,
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(stream));

    try {
      const pending = exchange();
      const rejected = expect(pending).rejects.toBeInstanceOf(APIConnectionTimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('does not await attacker-controlled cancellation while rejecting an issuer redirect', async () => {
    const stream = new ReadableStream<Uint8Array>({
      cancel: async () => {
        await Promise.race([]);
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(
      new Response(stream, { status: 307, headers: { Location: 'https://attacker.invalid/' } }),
    );

    await expect(exchange()).rejects.toMatchObject({ status: 307 });
    expect(stream.locked).toBe(false);
  });

  test('performs the pinned exchange over genuine mTLS through an approved HTTP CONNECT tunnel', async () => {
    const lab = createX509TestLab();
    const requestBodies: string[] = [];
    const issuer = createMutualTLSServer(
      lab,
      (request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        request.on('end', () => {
          requestBodies.push(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(VALID_TOKEN_RESPONSE));
        });
      },
      lab.issuerServer,
    );
    let proxyDispatcher: ProxyAgent | undefined;
    let proxy: ReturnType<typeof createConnectProxy> | undefined;

    try {
      const issuerURL = await listenLoopback(issuer);
      proxy = createConnectProxy(
        lab,
        false,
        lab.proxyServer,
        new Map([['mtls.auth.openai.com:443', issuerURL]]),
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
      const proxyTransport = createX509Transport({
        runtime: 'node',
        dispatcher: proxyDispatcher,
        certificateIdentity: 'static',
        proxy: 'http-connect',
      });

      await expect(
        exchangeX509Token({
          transport: proxyTransport,
          identityProviderId: 'synthetic-identity-provider',
          serviceAccountId: 'synthetic-service-account',
        }),
      ).resolves.toEqual({ accessToken: VALID_TOKEN_RESPONSE.access_token, expiresIn: 3600 });

      expect(proxy.requests).toEqual([
        expect.objectContaining({
          authorization: undefined,
          certificateFingerprint: undefined,
          path: 'mtls.auth.openai.com:443',
        }),
      ]);
      expect(issuer.requests).toEqual([
        expect.objectContaining({
          authority: 'mtls.auth.openai.com',
          authorization: undefined,
          certificateFingerprint: new X509Certificate(lab.firstClient.certificate).fingerprint256,
          path: '/oauth/token',
          proxyAuthorization: undefined,
          serverName: 'mtls.auth.openai.com',
        }),
      ]);
      expect(JSON.parse(requestBodies[0] ?? '')).toEqual({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:openai:params:oauth:token-type:x509',
        identity_provider_id: 'synthetic-identity-provider',
        service_account_id: 'synthetic-service-account',
      });
    } finally {
      await proxyDispatcher?.close();
      await closeObservedServers(issuer, ...(proxy ? [proxy] : []));
    }
  });
});
