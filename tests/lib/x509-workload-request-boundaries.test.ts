import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from 'undici';
import { vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import type { ClientOptions } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';

const tokenResponse = {
  access_token: 'synthetic-request-boundary-bearer',
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
      identityProviderId: 'synthetic-boundary-provider',
      serviceAccountId: 'synthetic-boundary-account',
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

describe('X.509 request ownership boundaries', () => {
  test('validates the final overridden destination before presenting a certificate', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(Response.json(tokenResponse));
    const client = new OpenAI(options());
    const original = client.buildRequest.bind(client);
    Object.defineProperty(client, 'buildRequest', {
      value: async (...args: Parameters<OpenAI['buildRequest']>) => ({
        ...(await original(...args)),
        url: 'https://untrusted.invalid/v1/models',
      }),
    });

    await expect(client.models.list()).rejects.toThrow(/origin|endpoint|URL/iu);
    expect(send).not.toHaveBeenCalled();
  });

  test('uses one immutable accessor-backed override destination for authentication and dispatch', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : Response.json({ data: [] }),
      );
    const client = new OpenAI(options());
    const original = client.buildRequest.bind(client);
    const getter = vi.fn(() =>
      getter.mock.calls.length === 1
        ? 'https://mtls.api.openai.com/v1/models'
        : 'https://untrusted.invalid/v1/models',
    );
    Object.defineProperty(client, 'buildRequest', {
      value: async (...args: Parameters<OpenAI['buildRequest']>) =>
        Object.defineProperty(await original(...args), 'url', { get: getter }),
    });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[1]?.[1].origin).toBe('https://mtls.api.openai.com');
  });

  test.each(['Authorization', 'Proxy-Authorization', 'Host'])(
    'rejects overridden final %s before certificate exchange',
    async (name) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockResolvedValue(Response.json(tokenResponse));
      const client = new OpenAI(options());
      const original = client.buildRequest.bind(client);
      Object.defineProperty(client, 'buildRequest', {
        value: async (...args: Parameters<OpenAI['buildRequest']>) => {
          const built = await original(...args);
          built.req.headers.set(name, 'synthetic-unapproved-credential');
          return built;
        },
      });

      await expect(client.models.list()).rejects.toThrow(/caller-supplied.*credentials/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('starts its network deadline only after asynchronous request preparation completes', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : Response.json({ data: [] }),
      );
    const client = new OpenAI(options({ timeout: 45 }));
    Object.defineProperty(client, 'prepareOptions', {
      value: async () => await delay(90),
    });

    await expect(client.models.list()).resolves.toMatchObject({
      data: [],
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('cancels retry backoff promptly through the effective protected-hook signal', async () => {
    const hookController = new AbortController();
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : new Response(null, { status: 503, headers: { 'retry-after-ms': '500' } }),
      );
    const client = new OpenAI(options({ maxRetries: 1, timeout: 2000 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.signal = hookController.signal;
      },
    });
    const pending = client.models.list();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const reason = new Error('synthetic-hook-retry-cancellation');
    const canceledAt = performance.now();
    hookController.abort(reason);

    await expect(pending).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
    expect(performance.now() - canceledAt).toBeLessThan(250);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('keeps the captured accessor-backed signal during successful response parsing', async () => {
    const captured = new AbortController();
    const reason = new Error('synthetic-success-body-cancellation');
    const getter = vi.fn(() => {
      if (getter.mock.calls.length > 1) {
        throw new Error('unexpected signal accessor reread');
      }
      return captured.signal;
    });
    const request = Object.defineProperty({ path: '/models', method: 'get' as const }, 'signal', {
      enumerable: true,
      get: getter,
    });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, init) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : new Response(
              new ReadableStream({
                start(stream) {
                  init.signal?.addEventListener('abort', () => stream.error(init.signal?.reason), {
                    once: true,
                  });
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
      );

    const pending = new OpenAI(options({ timeout: 1000 })).request(request);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    captured.abort(reason);

    await expect(pending).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
    expect(getter).toHaveBeenCalledTimes(1);
  });

  test('uses the validated accessor-backed fetch options throughout issuer preflight and dispatch', async () => {
    const getter = vi.fn(() => {
      if (getter.mock.calls.length > 1) {
        throw new Error('unexpected fetch-options accessor reread');
      }
      return { cache: 'no-store' as const };
    });
    const request = Object.defineProperty({ path: '/models', method: 'get' as const }, 'fetchOptions', {
      enumerable: true,
      get: getter,
    });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : Response.json({ data: [] }),
      );

    await expect(new OpenAI(options()).request(request)).resolves.toMatchObject({ data: [] });
    expect(getter).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[1]?.[2].cache).toBe('no-store');
  });

  test('does not let a protected buildRequest override enlarge the authenticated request deadline', async () => {
    class ExtendedTimeoutClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        return { ...(await super.buildRequest(...args)), timeout: 500 };
      }
    }
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, init) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          return Response.json(tokenResponse);
        }
        await delay(140, undefined, { signal: init.signal ?? undefined });
        return Response.json({ data: [] });
      });

    await expect(new ExtendedTimeoutClient(options({ timeout: 50 })).models.list()).rejects.toBeInstanceOf(
      APIConnectionTimeoutError,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  test.each(['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN'])(
    'retries a temporary issuer routing failure with code %s',
    async (code) => {
      let issuerAttempts = 0;
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) => {
          if (url.origin !== 'https://mtls.auth.openai.com') {
            return Response.json({ data: [] });
          }
          issuerAttempts += 1;
          if (issuerAttempts === 1) {
            throw Object.assign(new Error('synthetic temporary routing failure'), { code });
          }
          return Response.json(tokenResponse);
        });

      await expect(new OpenAI(options({ maxRetries: 1 })).models.list()).resolves.toMatchObject({ data: [] });
      expect(issuerAttempts).toBe(2);
      expect(send).toHaveBeenCalledTimes(3);
    },
  );
});
