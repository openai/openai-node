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
  test('applies a lowered final override deadline before certificate authentication', async () => {
    let minted = false;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, _url, request) => {
        await delay(140, undefined, { signal: request.signal ?? undefined });
        minted = true;
        return Response.json(tokenResponse);
      });
    const client = new OpenAI(options({ timeout: 500 }));
    const original = client.buildRequest.bind(client);
    Object.defineProperty(client, 'buildRequest', {
      value: async (...args: Parameters<OpenAI['buildRequest']>) => ({
        ...(await original(...args)),
        timeout: 35,
      }),
    });

    await expect(client.models.list()).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(minted).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('retires an unread error response when its headers exhaust the request deadline', async () => {
    let elapsed = 0;
    let apiSignal: AbortSignal | undefined;
    const canceled = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, request) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          return Response.json(tokenResponse);
        }
        apiSignal = request.signal ?? undefined;
        elapsed = 51;
        return new Response(new ReadableStream({ cancel: canceled }), { status: 403 });
      });

    await expect(new OpenAI(options({ timeout: 50 })).models.list()).rejects.toBeInstanceOf(
      APIConnectionTimeoutError,
    );
    expect(apiSignal?.aborted).toBe(true);
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('preserves caller cancellation when error headers also exhaust the request deadline', async () => {
    let elapsed = 0;
    const caller = new AbortController();
    const reason = new Error('synthetic-error-headers-cancellation');
    const canceled = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        return Response.json(tokenResponse);
      }
      elapsed = 51;
      caller.abort(reason);
      return new Response(new ReadableStream({ cancel: canceled }), { status: 403 });
    });

    await expect(
      new OpenAI(options({ timeout: 50 })).models.list({ signal: caller.signal }),
    ).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(canceled).toHaveBeenCalledTimes(1);
  });

  test.each(['caller', 'protected hook'] as const)(
    'preserves %s cancellation when successful response parsing starts after its deadline',
    async (source) => {
      let elapsed = 0;
      const caller = new AbortController();
      const reason = new Error(`synthetic-delayed-${source}-cancellation`);
      const canceled = vi.fn();
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? Response.json(tokenResponse)
          : new Response(new ReadableStream({ cancel: canceled }), {
              headers: { 'content-type': 'application/json' },
            }),
      );
      const client = new OpenAI(options({ timeout: 50 }));
      if (source === 'protected hook') {
        Object.defineProperty(client, 'prepareRequest', {
          value: async (request: RequestInit) => {
            request.signal = caller.signal;
          },
        });
      }
      const request =
        source === 'caller' ? client.models.list({ signal: caller.signal }) : client.models.list();

      await request.asResponse();
      caller.abort(reason);
      elapsed = 51;

      await expect(request).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
      expect(canceled).toHaveBeenCalledTimes(1);
    },
  );

  test('retires an SDK-materialized one-shot iterator when certificate authentication fails', async () => {
    let finalized = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        try {
          yield new TextEncoder().encode('synthetic-private-upload');
          yield new TextEncoder().encode('synthetic-never-dispatched');
        } finally {
          finalized = true;
        }
      },
    };
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'retry-after-ms': '1' } }));

    await expect(
      new OpenAI(options({ maxRetries: 1 })).request({ path: '/responses', method: 'post', body }),
    ).rejects.toMatchObject({ status: 503 });
    await vi.waitFor(() => expect(finalized).toBe(true), { timeout: 200 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('retires an SDK-owned upload when a protected request hook replaces its body', async () => {
    let finalized = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        try {
          yield new TextEncoder().encode('synthetic-replaced-private-upload');
          yield new TextEncoder().encode('synthetic-never-dispatched');
        } finally {
          finalized = true;
        }
      },
    };
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, request) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          return Response.json(tokenResponse);
        }
        expect(request.body).toBe('synthetic-protected-hook-replacement');
        return Response.json({ data: [] });
      });
    const client = new OpenAI(options());
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.body = 'synthetic-protected-hook-replacement';
      },
    });

    await client.request({ path: '/responses', method: 'post', body });
    await vi.waitFor(() => expect(finalized).toBe(true), { timeout: 200 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('does not cancel a caller-owned request stream after certificate authentication fails', async () => {
    let canceled = false;
    const body = new ReadableStream({
      cancel() {
        canceled = true;
      },
    });
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      new OpenAI(options()).request({ path: '/responses', method: 'post', body }),
    ).rejects.toMatchObject({ status: 503 });
    expect(canceled).toBe(false);
  });

  test('retires an SDK-owned upload when direct authenticated request construction fails', async () => {
    let finalized = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        try {
          yield new TextEncoder().encode('synthetic-direct-upload');
        } finally {
          finalized = true;
        }
      },
    };
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      new OpenAI(options()).buildRequest({ path: '/responses', method: 'post', body }),
    ).rejects.toMatchObject({ status: 503 });
    await vi.waitFor(() => expect(finalized).toBe(true), { timeout: 200 });
  });

  test('transfers a directly built SDK-owned upload to its caller without cancellation', async () => {
    let finalized = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        try {
          yield new TextEncoder().encode('synthetic-direct-approved-upload');
        } finally {
          finalized = true;
        }
      },
    };
    vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(Response.json(tokenResponse));

    const built = await new OpenAI(options()).buildRequest({ path: '/responses', method: 'post', body });
    expect(finalized).toBe(false);
    if (!(built.req.body instanceof ReadableStream)) {
      throw new Error('Expected the SDK-owned upload stream.');
    }
    await built.req.body.cancel();
    expect(finalized).toBe(true);
  });

  test('preserves protected-hook cancellation into the next certificate exchange', async () => {
    const hook = new AbortController();
    const reason = new Error('synthetic-retried-issuer-hook-cancellation');
    let issuerAttempts = 0;
    let apiAttempts = 0;
    let retriedIssuerMinted = false;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, request) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          issuerAttempts += 1;
          if (issuerAttempts > 1) {
            await delay(500, undefined, { signal: request.signal ?? undefined });
            retriedIssuerMinted = true;
          }
          return Response.json(tokenResponse);
        }
        apiAttempts += 1;
        return new Response(null, { status: 401 });
      });
    const client = new OpenAI(options({ timeout: 2000, maxRetries: 1 }));
    Object.defineProperty(client, 'prepareRequest', {
      value: async (request: RequestInit) => {
        request.signal = hook.signal;
      },
    });

    const pending = client.models.list();
    await vi.waitFor(() => expect(issuerAttempts).toBe(2));
    const canceledAt = performance.now();
    hook.abort(reason);

    await expect(pending).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
    expect(performance.now() - canceledAt).toBeLessThan(250);
    expect(retriedIssuerMinted).toBe(false);
    expect(apiAttempts).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

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

  test.each(['OpenAI-Organization', 'OpenAI-Project', 'OpenAI_Organization', 'OpenAI_Project'])(
    'rejects overridden final tenant selector %s before certificate exchange',
    async (name) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockResolvedValue(Response.json(tokenResponse));
      const client = new OpenAI(
        options({ organization: 'synthetic-enrolled-org', project: 'synthetic-enrolled-project' }),
      );
      const original = client.buildRequest.bind(client);
      Object.defineProperty(client, 'buildRequest', {
        value: async (...args: Parameters<OpenAI['buildRequest']>) => {
          const built = await original(...args);
          built.req.headers.set(name, 'synthetic-unapproved-tenant');
          return built;
        },
      });

      await expect(client.models.list()).rejects.toThrow(/organization|project/iu);
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
