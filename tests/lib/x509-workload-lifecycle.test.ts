import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from 'undici';
import { vi } from 'vitest';

import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, OAuthError } from 'openai';
import type { ClientOptions } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';

const TOKEN_RESPONSE = {
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
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
      identityProviderId: 'synthetic-lifecycle-provider',
      serviceAccountId: 'synthetic-lifecycle-account',
    },
    x509Transport: transport,
    ...overrides,
  };
}

function token(value: string, expiresIn = 3600): Response {
  return Response.json({ ...TOKEN_RESPONSE, access_token: value, expires_in: expiresIn });
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  await dispatcher.close();
});

describe('X.509 workload credential lifecycle', () => {
  test('lazily exchanges and reuses one service-account credential across sequential requests', async () => {
    const issued: string[] = [];
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, target, request) => {
        if (target.origin === 'https://mtls.auth.openai.com') {
          return token('synthetic-cached-bearer');
        }
        issued.push(new Headers(request.headers).get('Authorization') ?? '');
        return Response.json({ data: [] });
      });
    const client = new OpenAI(options());

    expect(send).not.toHaveBeenCalled();
    await client.models.list();
    await client.models.list();
    await client.models.list();

    expect(send).toHaveBeenCalledTimes(4);
    expect(issued).toEqual([
      'Bearer synthetic-cached-bearer',
      'Bearer synthetic-cached-bearer',
      'Bearer synthetic-cached-bearer',
    ]);
  });

  test('shares one in-flight certificate exchange across concurrent isolated requests', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          await delay(15);
          return token('synthetic-shared-bearer');
        }
        return Response.json({ data: [] });
      });
    const client = new OpenAI(options());

    await Promise.all([
      client.models.list(),
      client.models.list(),
      client.models.list(),
      client.models.list(),
    ]);

    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls.filter(([, url]) => url.origin === 'https://mtls.auth.openai.com')).toHaveLength(
      1,
    );
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid refreshBufferMs %s before certificate presentation',
    (refreshBufferMs) => {
      const send = vi.spyOn(transportCapability, 'sendX509Request');

      expect(
        () =>
          new OpenAI(
            options({
              workloadIdentity: {
                type: 'x509',
                identityProviderId: 'synthetic-provider',
                serviceAccountId: 'synthetic-account',
                refreshBufferMs,
              },
            }),
          ),
      ).toThrow(/refreshBufferMs/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('caps proactive refresh at half of a short issuer-approved token lifetime', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-short-token-${exchanges}`, 10);
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options());

    await client.models.list();
    await vi.advanceTimersByTimeAsync(4999);
    await client.models.list();
    expect(exchanges).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    await client.models.list();
    expect(exchanges).toBe(2);
  });

  test('refreshes expired credentials after wall-clock suspend without monotonic-clock advancement', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-suspend-token-${exchanges}`, 10);
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options());

    await client.models.list();
    vi.setSystemTime(Date.now() + 10_001);
    await client.models.list();

    expect(exchanges).toBe(2);
  });

  test.each([
    ['default', {}, 1000],
    ['issuer milliseconds', { 'retry-after-ms': '5000' }, 5000],
    ['issuer seconds', { 'retry-after': '5' }, 5000],
  ] as const)('honors the %s cooldown after failed proactive refresh', async (_kind, headers, cooldown) => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return exchanges === 1
          ? token('synthetic-still-valid-bearer', 20)
          : new Response(null, { status: 503, headers });
      }
      dispatches += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options());

    await client.models.list();
    await vi.advanceTimersByTimeAsync(10_001);
    await client.models.list();
    await client.models.list();
    await vi.advanceTimersByTimeAsync(cooldown - 1);
    await client.models.list();

    expect(exchanges).toBe(2);
    expect(dispatches).toBe(4);

    await vi.advanceTimersByTimeAsync(1);
    await client.models.list();
    expect(exchanges).toBe(3);
  });

  test.each([401, 503])('retains an issuer refusal across a cached-token API %i replay', async (status) => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return exchanges === 2
          ? new Response(null, { status: 503, headers: { 'retry-after': '90' } })
          : token('synthetic-still-valid-bearer', 20);
      }
      dispatches += 1;
      if (dispatches === 2) {
        // Simulate time spent at the API past the cache's failed-refresh cooldown.
        await vi.advanceTimersByTimeAsync(1001);
        return new Response(null, { status, headers: { 'retry-after': '0' } });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1, timeout: 30_000 }));
    await client.models.list();
    await vi.advanceTimersByTimeAsync(10_001);
    const result = Promise.allSettled([client.models.list()]);
    await vi.advanceTimersByTimeAsync(0);
    const [outcome] = await result;
    if (status === 401) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ status: 503 });
        expect(outcome.reason.headers.get('retry-after')).toBe('90');
      }
    } else {
      expect(outcome.status).toBe('fulfilled');
    }
    expect(exchanges).toBe(2);
    // A fresh logical request is free to exchange; the refusal is not a global cooldown.
    await client.models.list();
    expect(exchanges).toBe(3);
  });

  test.each([
    [0, 'success'],
    [55, 'success'],
    [0, 'cancel'],
    [0, 'timeout'],
  ] as const)(
    'handles a cached-token auth replay after the issuer minimum (API delay=%ims, %s)',
    async (apiDelay, expected) => {
      vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
      let exchanges = 0;
      let dispatches = 0;
      let refusedAt = 0;
      let recoveredAt = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          exchanges += 1;
          if (exchanges === 2) {
            refusedAt = performance.now();
            return new Response(null, { status: 503, headers: { 'retry-after-ms': '50' } });
          }
          if (exchanges === 3) {
            recoveredAt = performance.now();
          }
          return token('synthetic-expiring-minimum', 20);
        }
        dispatches += 1;
        if (dispatches === 2) {
          await vi.advanceTimersByTimeAsync(apiDelay);
          return new Response(null, { status: 401 });
        }
        return Response.json({ data: [] });
      });
      const client = new OpenAI(options({ maxRetries: 1, timeout: expected === 'timeout' ? 30 : 30_000 }));
      await client.models.list();
      await vi.advanceTimersByTimeAsync(11_000);
      const controller = new AbortController();
      const pending = Promise.allSettled([client.models.list({ signal: controller.signal })]);
      await vi.advanceTimersByTimeAsync(0);
      if (expected === 'cancel') {
        controller.abort();
      }
      await vi.advanceTimersByTimeAsync(100);
      const [outcome] = await pending;
      if (expected === 'success') {
        expect(outcome.status).toBe('fulfilled');
        expect(exchanges).toBe(3);
        expect(dispatches).toBe(3);
        expect(recoveredAt - refusedAt).toBeGreaterThanOrEqual(50);
      } else {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(
            expected === 'cancel' ? APIUserAbortError : APIConnectionTimeoutError,
          );
        }
        expect(exchanges).toBe(2);
        expect(dispatches).toBe(2);
      }
    },
  );

  test.each(['date', 'milliseconds'] as const)(
    'keeps the issuer %s clock contract when wall time advances during cached fallback',
    async (hint) => {
      vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
      let exchanges = 0;
      let dispatches = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          exchanges += 1;
          if (exchanges === 2) {
            const headers =
              hint === 'date'
                ? { 'retry-after': new Date(Date.now() + 1000).toUTCString() }
                : { 'retry-after-ms': '1000' };
            return new Response(null, { status: 503, headers });
          }
          return token('synthetic-wall-clock-bearer', 20);
        }
        dispatches += 1;
        if (dispatches === 2) {
          // Suspension can advance wall time without advancing the monotonic timer.
          vi.setSystemTime(Date.now() + 2000);
          return new Response(null, { status: 401 });
        }
        return Response.json({ data: [] });
      });
      const client = new OpenAI(options({ maxRetries: 1, timeout: 100 }));
      await client.models.list();
      await vi.advanceTimersByTimeAsync(11_000);
      const pending = Promise.allSettled([client.models.list()]);
      await vi.advanceTimersByTimeAsync(200);
      const [outcome] = await pending;
      if (hint === 'date') {
        expect(outcome.status).toBe('fulfilled');
        expect(exchanges).toBe(3);
        expect(dispatches).toBe(3);
      } else {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(APIConnectionTimeoutError);
        }
        expect(exchanges).toBe(2);
        expect(dispatches).toBe(2);
      }
    },
  );

  test('preserves a timeout-shaped caller reason during the issuer minimum wait', async () => {
    const caller = new AbortController();
    const reason = new APIConnectionTimeoutError();
    let exchanges = 0;
    let dispatches = 0;
    const clock = vi.spyOn(performance, 'now');
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return exchanges === 2
          ? new Response(null, { status: 503, headers: { 'retry-after': '1' } })
          : token('synthetic-caller-reason', 20);
      }
      dispatches += 1;
      if (dispatches === 2) {
        setTimeout(() => caller.abort(reason), 10);
        return new Response(null, { status: 401 });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));
    await client.models.list();
    clock.mockReturnValue(performance.now() + 11_000);

    const request = client.models.list({ signal: caller.signal });
    await expect(request).rejects.toBeInstanceOf(APIUserAbortError);
    await expect(request).rejects.toMatchObject({ cause: reason });
    expect(exchanges).toBe(2);
    expect(dispatches).toBe(2);
  });

  test.each([false, true])(
    'keeps a shared issuer refusal in each surviving request (cancel first=%s)',
    async (cancelFirst) => {
      vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
      const gate = new EventTarget();
      const pending = once(gate, 'release');
      let exchanges = 0;
      let dispatches = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          exchanges += 1;
          if (exchanges === 2) {
            await pending;
            return new Response(null, { status: 503, headers: { 'retry-after': '90' } });
          }
          return token('synthetic-shared-cache', 20);
        }
        dispatches += 1;
        return dispatches === 1 ? Response.json({ data: [] }) : new Response(null, { status: 401 });
      });
      const client = new OpenAI(options({ maxRetries: 1 }));
      await client.models.list();
      await vi.advanceTimersByTimeAsync(10_001);
      const controller = new AbortController();
      const requests = Promise.allSettled([
        client.models.list({ signal: controller.signal }),
        client.models.list(),
      ]);
      await vi.advanceTimersByTimeAsync(0);
      expect(exchanges).toBe(2);
      if (cancelFirst) {
        controller.abort();
      }
      gate.dispatchEvent(new Event('release'));
      await vi.advanceTimersByTimeAsync(0);
      const outcomes = await requests;
      for (const [index, outcome] of outcomes.entries()) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          if (cancelFirst && index === 0) {
            expect(outcome.reason).toBeInstanceOf(APIUserAbortError);
          } else {
            expect(outcome.reason).toMatchObject({ status: 503 });
            expect(outcome.reason.headers.get('retry-after')).toBe('90');
          }
        }
      }
      expect(exchanges).toBe(2);
    },
  );

  test.each(['permanent-tls', 'permanent-body', 'invalid-token', 'retry-disabled'])(
    'never falls back to a cached bearer after a terminal %s refresh failure',
    async (failure) => {
      vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
      let exchanges = 0;
      let dispatches = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin !== 'https://mtls.auth.openai.com') {
          dispatches += 1;
          return Response.json({ data: [] });
        }
        exchanges += 1;
        if (exchanges === 1) {
          return token('synthetic-still-valid-bearer', 10);
        }
        if (failure === 'permanent-tls') {
          throw Object.assign(new Error('synthetic permanent certificate failure'), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
          });
        }
        if (failure === 'permanent-body') {
          return new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(
                  Object.assign(new Error('synthetic invalid issuer body'), { code: 'Z_DATA_ERROR' }),
                );
              },
            }),
          );
        }
        return failure === 'invalid-token'
          ? Response.json({ ...TOKEN_RESPONSE, access_token: 'synthetic-invalid-token', token_type: 'MAC' })
          : new Response(null, { status: 503, headers: { 'x-should-retry': 'false' } });
      });
      const client = new OpenAI(options());

      await client.models.list();
      await vi.advanceTimersByTimeAsync(5001);

      await expect(client.models.list()).rejects.toThrow();
      expect(exchanges).toBe(2);
      expect(dispatches).toBe(1);
    },
  );

  test('allows a still-valid cached bearer only after a classified transient transport failure', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin !== 'https://mtls.auth.openai.com') {
        dispatches += 1;
        return Response.json({ data: [] });
      }
      exchanges += 1;
      if (exchanges === 1) {
        return token('synthetic-still-valid-bearer', 10);
      }
      throw Object.assign(new Error('synthetic connection reset'), { code: 'ECONNRESET' });
    });
    const client = new OpenAI(options());

    await client.models.list();
    await vi.advanceTimersByTimeAsync(5001);
    await client.models.list();

    expect(exchanges).toBe(2);
    expect(dispatches).toBe(2);
  });

  test('never reuses an expired cached token after a failed refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    let exchanges = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return exchanges === 1 ? token('synthetic-expiring-bearer', 2) : new Response(null, { status: 503 });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options());

    await client.models.list();
    await vi.advanceTimersByTimeAsync(2001);

    await expect(client.models.list()).rejects.toThrow(/503/u);
    expect(exchanges).toBe(2);
  });

  test('does not cancel a shared refresh when only one waiting request is aborted', async () => {
    const first = new AbortController();
    const reason = new Error('synthetic-first-waiter-canceled');
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, request) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          await delay(30, undefined, { signal: request.signal ?? undefined });
          return token('synthetic-surviving-bearer');
        }
        return Response.json({ data: [] });
      });
    const client = new OpenAI(options());
    const canceled = client.models.list({ signal: first.signal });
    const surviving = client.models.list();
    setTimeout(() => first.abort(reason), 5);

    await expect(canceled).rejects.toMatchObject({ constructor: APIUserAbortError, cause: reason });
    await expect(surviving).resolves.toMatchObject({ data: [] });
    expect(send.mock.calls.filter(([, url]) => url.origin === 'https://mtls.auth.openai.com')).toHaveLength(
      1,
    );
  });

  test('handles cancellation fired synchronously while the first exchange begins', async () => {
    const caller = new AbortController();
    const reason = new Error('synthetic-synchronous-cancellation');
    let issuerSignal: AbortSignal | null | undefined;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, _url, request) => {
      issuerSignal = request.signal;
      caller.abort(reason);
      await delay(5000, undefined, { signal: request.signal ?? undefined });
      return token('synthetic-must-not-be-cached');
    });
    const client = new OpenAI(options({ timeout: 100 }));

    await expect(client.models.list({ signal: caller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    await vi.waitFor(() => expect(issuerSignal?.aborted).toBe(true));
  });

  test('never lets an abandoned, noncooperative certificate exchange overwrite a newer token', async () => {
    const first = new AbortController();
    const second = new AbortController();
    let exchanges = 0;
    let abandonedSignal: AbortSignal | null | undefined;
    const dispatched: string[] = [];
    const abandonedCompletion = new EventTarget();
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url, request) => {
      if (url.origin !== 'https://mtls.auth.openai.com') {
        dispatched.push(new Headers(request.headers).get('Authorization') ?? '');
        return Response.json({ data: [] });
      }
      exchanges += 1;
      if (exchanges === 1) {
        abandonedSignal = request.signal;
        await once(abandonedCompletion, 'complete');
        return token('synthetic-abandoned-bearer');
      }
      return token('synthetic-current-bearer');
    });
    const client = new OpenAI(options());
    const abandoned = [
      client.models.list({ signal: first.signal }),
      client.models.list({ signal: second.signal }),
    ];
    await vi.waitFor(() => expect(abandonedSignal).toBeDefined(), { interval: 1 });
    first.abort(new Error('synthetic-first-waiter-canceled'));
    second.abort(new Error('synthetic-second-waiter-canceled'));

    await Promise.all(
      abandoned.map(async (request) => await expect(request).rejects.toBeInstanceOf(APIUserAbortError)),
    );
    await vi.waitFor(() => expect(abandonedSignal?.aborted).toBe(true));
    await client.models.list();
    abandonedCompletion.dispatchEvent(new Event('complete'));
    await delay(0);
    await client.models.list();

    expect(exchanges).toBe(2);
    expect(dispatched).toEqual(['Bearer synthetic-current-bearer', 'Bearer synthetic-current-bearer']);
  });

  test('keeps token caches separate for distinct clients and service-account selectors', async () => {
    let exchanges = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-client-token-${exchanges}`);
      }
      return Response.json({ data: [] });
    });
    const first = new OpenAI(options());
    const second = new OpenAI(
      options({
        workloadIdentity: {
          type: 'x509',
          identityProviderId: 'synthetic-lifecycle-provider',
          serviceAccountId: 'synthetic-other-account',
        },
      }),
    );

    await first.models.list();
    await second.models.list();
    await first.models.list();

    expect(exchanges).toBe(2);
  });

  test('shares cached credentials across clones with the same transport and enrolled account', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? token('synthetic-shared-clone-bearer')
          : Response.json({ data: [] }),
      );
    const original = new OpenAI(options());

    await original.models.list();
    await original.withOptions({ timeout: 2500 }).models.list();

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.filter(([, url]) => url.origin === 'https://mtls.auth.openai.com')).toHaveLength(
      1,
    );
  });

  test('does not reuse clone credentials after changing the enrolled service account', async () => {
    let exchanges = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-account-bearer-${exchanges}`);
      }
      return Response.json({ data: [] });
    });
    const original = new OpenAI(options());

    await original.models.list();
    await original
      .withOptions({
        workloadIdentity: {
          type: 'x509',
          identityProviderId: 'synthetic-lifecycle-provider',
          serviceAccountId: 'synthetic-changed-account',
        },
      })
      .models.list();

    expect(exchanges).toBe(2);
  });

  test('never re-reads a mutable clone identity when deciding whether credentials can be shared', async () => {
    const accounts: string[] = [];
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url, request) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        const body: unknown = JSON.parse(String(request.body));
        if (typeof body === 'object' && body && 'service_account_id' in body) {
          accounts.push(String(body.service_account_id));
        }
        return token(`synthetic-account-token-${accounts.length}`);
      }
      return Response.json({ data: [] });
    });
    const original = new OpenAI(options());
    await original.models.list();
    let reads = 0;

    const clone = original.withOptions({
      workloadIdentity: {
        type: 'x509',
        identityProviderId: 'synthetic-lifecycle-provider',
        get serviceAccountId() {
          reads += 1;
          return reads === 1 ? 'synthetic-other-account' : 'synthetic-lifecycle-account';
        },
      },
    });
    await clone.models.list();

    expect(accounts).toEqual(['synthetic-lifecycle-account', 'synthetic-other-account']);
    expect(reads).toBe(1);
  });

  test.each(['OpenAI-Organization', 'OpenAI-Project'])(
    'rejects per-request %s tenant overrides before reusing a cached bearer',
    async (header) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? token('synthetic-tenant-scoped-bearer')
            : Response.json({ data: [] }),
        );
      const client = new OpenAI(options({ organization: 'synthetic-org', project: 'synthetic-project' }));

      await client.models.list();
      await expect(client.models.list({ headers: { [header]: 'synthetic-other-tenant' } })).rejects.toThrow(
        /organization or project/iu,
      );
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  test('rejects a clone that overrides its effective tenant through default headers', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? token('synthetic-tenant-scoped-bearer')
          : Response.json({ data: [] }),
      );
    const original = new OpenAI(options({ organization: 'synthetic-org' }));

    await original.models.list();
    await expect(
      original
        .withOptions({ defaultHeaders: { 'OpenAI-Organization': 'synthetic-other-org' } })
        .models.list(),
    ).rejects.toThrow(/organization or project/iu);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test.each(['OpenAI_Organization', 'OpenAI_Project'])(
    'rejects a protected-hook %s alias before dispatching a tenant-scoped bearer',
    async (header) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? token('synthetic-tenant-scoped-bearer')
            : Response.json({ data: [] }),
        );
      const client = new OpenAI(options({ organization: 'synthetic-org', project: 'synthetic-project' }));
      Object.defineProperty(client, 'prepareRequest', {
        value: async (request: RequestInit) => {
          if (request.headers instanceof Headers) {
            request.headers.set(header, 'synthetic-other-tenant');
          }
        },
      });

      await expect(client.models.list()).rejects.toThrow(/organization or project/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test.each(['organization', 'project'] as const)(
    'rejects a mutable public %s change before reusing a cached bearer',
    async (selector) => {
      const send = vi
        .spyOn(transportCapability, 'sendX509Request')
        .mockImplementation(async (_transport, url) =>
          url.origin === 'https://mtls.auth.openai.com'
            ? token('synthetic-tenant-scoped-bearer')
            : Response.json({ data: [] }),
        );
      const client = new OpenAI(options({ organization: 'synthetic-org', project: 'synthetic-project' }));
      await client.models.list();
      client[selector] = 'synthetic-other-tenant';

      await expect(client.models.list()).rejects.toThrow(/organization or project/iu);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  test('rotates to a new approved certificate capability without reusing its predecessors token', async () => {
    const rotatedDispatcher = new Agent();
    const rotated = createX509Transport({
      runtime: 'node',
      dispatcher: rotatedDispatcher,
      certificateIdentity: 'static',
      proxy: 'direct',
    });
    const issuerCapabilities: X509Transport[] = [];
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (capability, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        issuerCapabilities.push(capability);
        return token(`synthetic-rotated-token-${issuerCapabilities.length}`);
      }
      return Response.json({ data: [] });
    });

    try {
      const original = new OpenAI(options());
      await original.models.list();
      await original.withOptions({ x509Transport: rotated }).models.list();

      expect(issuerCapabilities).toEqual([transport, rotated]);
    } finally {
      await rotatedDispatcher.close();
    }
  });

  test.each([408, 409, 429, 500, 503])(
    'retries an eligible issuer %i once within the same overall retry budget',
    async (status) => {
      let exchanges = 0;
      let dispatches = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          exchanges += 1;
          return exchanges === 1
            ? new Response(null, { status, headers: { 'retry-after-ms': '1' } })
            : token('synthetic-retried-bearer');
        }
        dispatches += 1;
        return Response.json({ data: [] });
      });
      const client = new OpenAI(options({ maxRetries: 1 }));

      await expect(client.models.list()).resolves.toMatchObject({ data: [] });
      expect(exchanges).toBe(2);
      expect(dispatches).toBe(1);
    },
  );

  test('does not retry a terminal issuer OAuth rejection', async () => {
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const client = new OpenAI(options({ maxRetries: 2 }));

    await expect(client.models.list()).rejects.toBeInstanceOf(OAuthError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('keeps an issuer OAuth rejection terminal even when its error body reaches the issuer deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockResolvedValue(new Response(new ReadableStream(), { status: 400 }));
    const client = new OpenAI(options({ maxRetries: 1 }));
    const rejected = expect(client.models.list()).rejects.toBeInstanceOf(OAuthError);

    await vi.advanceTimersByTimeAsync(5001);
    await rejected;

    expect(send).toHaveBeenCalledTimes(1);
  });

  test.each(['ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN'])(
    'never retries a permanent final API certificate failure: %s',
    async (code) => {
      let exchanges = 0;
      let dispatches = 0;
      vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          exchanges += 1;
          return token('synthetic-approved-bearer');
        }
        dispatches += 1;
        throw Object.assign(new Error('synthetic permanent certificate failure'), { code });
      });
      const client = new OpenAI(options({ maxRetries: 2 }));

      await expect(client.models.list()).rejects.toThrow();
      expect(exchanges).toBe(1);
      expect(dispatches).toBe(1);
    },
  );

  test('retries a classified transient final API connection failure without exchanging another bearer', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token('synthetic-approved-bearer');
      }
      dispatches += 1;
      if (dispatches === 1) {
        throw Object.assign(new Error('synthetic connection reset'), { code: 'ECONNRESET' });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(exchanges).toBe(1);
    expect(dispatches).toBe(2);
  });

  test('never exposes a secret-bearing final transport failure through a public error cause', async () => {
    const secret = 'synthetic-private-proxy-credential';
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        return token('synthetic-approved-bearer');
      }
      throw Object.assign(new Error(`synthetic proxy failure: ${secret}`), {
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
    });
    const client = new OpenAI(options());

    try {
      await client.models.list();
      throw new Error('synthetic expected connection failure');
    } catch (error) {
      expect(error).toBeInstanceOf(APIConnectionError);
      if (error instanceof Error) {
        expect(error.message).not.toContain(secret);
        expect(Object.getOwnPropertyDescriptor(error, 'cause')?.value).toBeUndefined();
      }
    }
  });

  test('cancels issuer or API retry backoff immediately and preserves the caller reason', async () => {
    const caller = new AbortController();
    const reason = new Error('synthetic-backoff-cancellation');
    let dispatches = 0;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          return token('synthetic-approved-bearer');
        }
        dispatches += 1;
        return new Response(null, { status: 429, headers: { 'retry-after-ms': '700' } });
      });
    const client = new OpenAI(options({ maxRetries: 1 }));
    const startedAt = performance.now();
    setTimeout(() => caller.abort(reason), 20);

    await expect(client.models.list({ signal: caller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(performance.now() - startedAt).toBeLessThan(400);
    expect(send).toHaveBeenCalledTimes(2);
    expect(dispatches).toBe(1);
  });

  test('applies the original monotonic deadline while reading a terminal API error body', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token('synthetic-approved-bearer');
      }
      dispatches += 1;
      return new Response(new ReadableStream(), { status: 403 });
    });
    const client = new OpenAI(options({ timeout: 50, maxRetries: 0 }));
    const startedAt = performance.now();

    await expect(client.models.list()).rejects.toThrow(/timed out/iu);
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(exchanges).toBe(1);
    expect(dispatches).toBe(1);
  });

  test('preserves the caller cancellation reason while reading a terminal API error body', async () => {
    const caller = new AbortController();
    const reason = new Error('synthetic-error-body-cancellation');
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url) =>
        url.origin === 'https://mtls.auth.openai.com'
          ? token('synthetic-approved-bearer')
          : new Response(new ReadableStream(), { status: 403 }),
      );
    const client = new OpenAI(options({ timeout: 1000 }));
    setTimeout(() => caller.abort(reason), 10);

    await expect(client.models.list({ signal: caller.signal })).rejects.toMatchObject({
      constructor: APIUserAbortError,
      cause: reason,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('never exposes secret-bearing transport failures while reading a terminal API error body', async () => {
    const secret = 'synthetic-private-error-body-credential';
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? token('synthetic-approved-bearer')
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error(`synthetic response-body failure: ${secret}`));
              },
            }),
            { status: 403 },
          ),
    );
    const client = new OpenAI(options());

    try {
      await client.models.list();
      throw new Error('synthetic expected response failure');
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).toContain('403');
        expect(error.message).not.toContain(secret);
      }
    }
  });

  test('never exposes secret-bearing transport failures while reading a successful API response body', async () => {
    const secret = 'synthetic-private-success-body-credential';
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      url.origin === 'https://mtls.auth.openai.com'
        ? token('synthetic-approved-bearer')
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error(`synthetic response-body failure: ${secret}`));
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
    );
    const client = new OpenAI(options());

    try {
      await client.models.list();
      throw new Error('synthetic expected response failure');
    } catch (error) {
      expect(error).toBeInstanceOf(APIConnectionError);
      if (error instanceof Error) {
        expect(error.message).not.toContain(secret);
        expect(Object.getOwnPropertyDescriptor(error, 'cause')?.value).toBeUndefined();
      }
    }
  });

  test('honors an issuer instruction not to retry an otherwise transient status', async () => {
    const send = vi.spyOn(transportCapability, 'sendX509Request').mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'x-should-retry': 'false', 'retry-after-ms': '1' },
      }),
    );
    const client = new OpenAI(options({ maxRetries: 2 }));

    await expect(client.models.list()).rejects.toThrow(/429/u);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('refreshes a rejected workload token exactly once while consuming the shared retry budget', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-replayed-token-${exchanges}`);
      }
      dispatches += 1;
      return dispatches === 1
        ? Response.json({ error: { message: 'synthetic expired bearer' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(exchanges).toBe(2);
    expect(dispatches).toBe(2);
  });

  test('invalidates a rejected token without replaying when the retry budget is already exhausted', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-invalidated-token-${exchanges}`);
      }
      dispatches += 1;
      return dispatches === 1
        ? Response.json({ error: { message: 'synthetic expired bearer' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 0 }));

    await expect(client.models.list()).rejects.toThrow(/expired bearer/iu);
    expect(exchanges).toBe(1);
    expect(dispatches).toBe(1);

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
    expect(exchanges).toBe(2);
    expect(dispatches).toBe(2);
  });

  test('invalidates the refreshed token after a second rejected replay before the next logical request', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-generation-${exchanges}`);
      }
      dispatches += 1;
      return dispatches <= 2
        ? Response.json({ error: { message: 'synthetic rejected credential' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(client.models.list()).rejects.toThrow(/rejected credential/iu);
    expect(exchanges).toBe(2);
    await expect(client.models.list()).resolves.toMatchObject({ data: [] });

    expect(exchanges).toBe(3);
    expect(dispatches).toBe(3);
  });

  test('does not let a delayed rejection evict a newer generation containing identical bearer bytes', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token('synthetic-identical-bearer');
      }
      dispatches += 1;
      const attempt = dispatches;
      if (attempt === 1) {
        await delay(30);
      }
      return attempt <= 2
        ? Response.json({ error: { message: 'synthetic stale generation' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));
    const first = client.models.list();
    await delay(5);
    const second = client.models.list();

    await Promise.all([first, second]);
    await client.models.list();

    expect(exchanges).toBe(2);
    expect(dispatches).toBe(5);
  });

  test('invalidates a rejected bearer even when a streaming request body cannot be replayed', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return token(`synthetic-stream-token-${exchanges}`);
      }
      dispatches += 1;
      return dispatches === 1
        ? Response.json({ error: { message: 'synthetic rejected stream' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(
      client.request({
        path: '/models',
        method: 'post',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
      }),
    ).rejects.toThrow(/rejected stream/iu);
    expect(exchanges).toBe(1);
    expect(dispatches).toBe(1);

    await client.models.list();
    expect(exchanges).toBe(2);
    expect(dispatches).toBe(2);
  });

  test('shares one retry allowance across an issuer retry and a later rejected API bearer', async () => {
    let exchanges = 0;
    let dispatches = 0;
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        exchanges += 1;
        return exchanges === 1
          ? new Response(null, { status: 429, headers: { 'retry-after-ms': '1' } })
          : token('synthetic-last-allowance-token');
      }
      dispatches += 1;
      return Response.json({ error: { message: 'synthetic exhausted allowance' } }, { status: 401 });
    });
    const client = new OpenAI(options({ maxRetries: 1 }));

    await expect(client.models.list()).rejects.toThrow(/exhausted allowance/iu);
    expect(exchanges).toBe(2);
    expect(dispatches).toBe(1);
  });
});
