/* oxlint-disable max-classes-per-file -- Distinct subclasses exercise existing async protected-hook forwarding contracts. */
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  OAuthError,
  SubjectTokenProviderError,
} from 'openai';
import type { Response, RequestInit, RequestInfo } from 'openai/internal/builtin-types';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import {
  getWorkloadIdentityToken,
  waitForWorkloadIdentityRetry,
} from 'openai/internal/auth/workload-identity-request';

const originalFetch = global.fetch;

const createTestWorkloadIdentity = () => ({
  identityProviderId: 'test-identity-provider-id',
  serviceAccountId: 'test-service-account-id',
  provider: {
    tokenType: 'jwt' as const,
    getToken: async () => 'subject-token',
  },
});

const createTestClientOptions = () => ({
  workloadIdentity: createTestWorkloadIdentity(),
  organization: 'test-org-id',
  project: 'test-project-id',
});

describe('OpenAI with Workload Identity', () => {
  test('a cache-owned issuer retry does not keep Node alive after callers leave', async () => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const timer = original(...args);
      timers.push(timer);
      return timer;
    }) as typeof setTimeout;
    try {
      const pending = waitForWorkloadIdentityRetry({
        error: new Error('issuer unavailable'),
        delayMillis: 30,
        notBefore: performance.now() + 30,
      });
      expect(timers.some((timer) => typeof timer.hasRef === 'function' && !timer.hasRef())).toBe(true);
      await pending;
    } finally {
      globalThis.setTimeout = original;
    }
  });

  test('a direct token caller keeps a shared issuer retry alive after SDK callers abort', async () => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const timer = original(...args);
      timers.push(timer);
      return timer;
    }) as typeof setTimeout;
    let exchanges = 0;
    const auth = new WorkloadIdentityAuth(createTestWorkloadIdentity(), async () => {
      exchanges += 1;
      return exchanges === 1
        ? globalThis.Response.json(
            { error: 'temporarily_unavailable' },
            { status: 503, headers: { 'retry-after-ms': '50' } },
          )
        : globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
    });
    const caller = new AbortController();
    const request = { deadline: performance.now() + 500, signal: caller.signal };
    try {
      await expect(getWorkloadIdentityToken(auth, request)).rejects.toThrow();
      const sdkWait = getWorkloadIdentityToken(auth, request);
      const retryTimer = timers.find((timer) => typeof timer.hasRef === 'function' && !timer.hasRef());
      expect(retryTimer).toBeDefined();
      const directWait = auth.getToken();
      expect(retryTimer?.hasRef()).toBe(true);
      caller.abort();
      await expect(sdkWait).rejects.toBeInstanceOf(APIUserAbortError);
      expect(retryTimer?.hasRef()).toBe(true);
      await expect(directWait).resolves.toBe('synthetic-token');
      expect(exchanges).toBe(2);
    } finally {
      globalThis.setTimeout = original;
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each([
    ['forward', 50, 3_600_000, false],
    ['backward', 150, -3_600_000, true],
  ] as const)(
    'keeps the 401 deadline monotonic when the wall clock moves %s',
    async (_direction, elapsed, jump, timesOut) => {
      vi.useFakeTimers();
      let apiCalls = 0;
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
        }
        apiCalls += 1;
        if (apiCalls === 1) {
          await new Promise((resolve) => setTimeout(resolve, elapsed));
          vi.setSystemTime(Date.now() + jump);
          return globalThis.Response.json(
            { error: { message: 'expired' } },
            { status: 401, headers: { 'retry-after-ms': '100' } },
          );
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: send, timeout: 200, maxRetries: 0 });
      const result = (async () => {
        try {
          return await client.models.list();
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(300);
      const outcome = await result;
      if (timesOut) {
        expect(outcome).toBeInstanceOf(APIConnectionTimeoutError);
        expect(apiCalls).toBe(1);
      } else {
        expect(outcome).not.toBeInstanceOf(Error);
        expect(apiCalls).toBe(2);
      }
    },
  );

  test.each(['date', 'numeric'] as const)(
    'retains a background issuer %s minimum across a wall-clock adjustment',
    async (hint) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T00:00:00Z'));
      let issuerCalls = 0;
      let apiCalls = 0;
      let finishFailureRead!: () => void;
      const failureRead = new Promise<void>((resolve) => {
        finishFailureRead = resolve;
      });
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          if (issuerCalls !== 2) {
            return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 2 });
          }
          const failure = globalThis.Response.json(
            { error: 'temporarily_unavailable' },
            {
              status: 503,
              headers:
                hint === 'date'
                  ? { 'retry-after': new Date(Date.now() + 2999).toUTCString() }
                  : { 'retry-after-ms': '2999' },
            },
          );
          const read = failure.text.bind(failure);
          vi.spyOn(failure, 'text').mockImplementation(async () => {
            const body = await read();
            finishFailureRead();
            return body;
          });
          return failure;
        }
        apiCalls += 1;
        if (apiCalls === 2) {
          await failureRead;
          vi.setSystemTime(Date.now() + 60_000);
          return globalThis.Response.json({ error: { message: 'expired' } }, { status: 401 });
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: send, maxRetries: 0, timeout: 5000 });
      await client.models.list();
      await vi.advanceTimersByTimeAsync(1001);
      const result = (async () => {
        try {
          return await client.models.list();
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(1);
      expect(issuerCalls).toBe(hint === 'date' ? 3 : 2);
      await vi.advanceTimersByTimeAsync(2999);
      expect(await result).not.toBeInstanceOf(Error);
      expect(issuerCalls).toBe(3);
    },
  );

  test.each([
    [false, 'none'],
    [true, 'none'],
    [false, 'forward'],
    [true, 'forward'],
    [false, 'copy-build'],
    [true, 'copy-build'],
    [false, 'copy-bearer'],
    [true, 'copy-bearer'],
  ] as const)(
    'retains a failed background issuer minimum (pending body: %s, legacy hooks: %s)',
    async (pendingBody, legacyHooks) => {
      vi.useFakeTimers();
      let issuerCalls = 0;
      let apiCalls = 0;
      const failure = globalThis.Response.json(
        { error: 'temporarily_unavailable' },
        {
          status: 503,
          headers: { 'retry-after': '90' },
        },
      );
      let finishFailureRead!: () => void;
      const failureRead = new Promise<void>((resolve) => {
        finishFailureRead = resolve;
      });
      let releaseFailureBody!: () => void;
      const failureBody = new Promise<void>((resolve) => {
        releaseFailureBody = resolve;
      });
      const read = failure.text.bind(failure);
      vi.spyOn(failure, 'text').mockImplementation(async () => {
        finishFailureRead();
        if (pendingBody) {
          await failureBody;
        }
        return await read();
      });
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          return issuerCalls === 2
            ? failure
            : globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 2 });
        }
        apiCalls += 1;
        if (apiCalls === 2) {
          await failureRead;
          return globalThis.Response.json({ error: { message: 'expired' } }, { status: 401 });
        }
        return globalThis.Response.json({ data: [] });
      });
      class LegacyHooksClient extends OpenAI {
        override async buildRequest(
          options: Parameters<OpenAI['buildRequest']>[0],
          retries?: Parameters<OpenAI['buildRequest']>[1],
        ) {
          await Promise.resolve();
          return await super.buildRequest(legacyHooks === 'copy-build' ? { ...options } : options, retries);
        }

        protected override async authHeaders(
          options: Parameters<OpenAI['buildRequest']>[0],
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        ) {
          await Promise.resolve();
          return await super.authHeaders(options, schemes);
        }

        protected override async bearerAuth(options: Parameters<OpenAI['buildRequest']>[0]) {
          await Promise.resolve();
          return await super.bearerAuth(legacyHooks === 'copy-bearer' ? { ...options } : options);
        }
      }
      const Client = legacyHooks === 'none' ? OpenAI : LegacyHooksClient;
      const client = new Client({ ...createTestClientOptions(), fetch: send, maxRetries: 0 });
      await client.models.list();
      await vi.advanceTimersByTimeAsync(1001);
      const result = (async () => {
        try {
          return await client.models.list();
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(0);
      releaseFailureBody();
      expect(issuerCalls).toBe(2);
      expect(await result).toBeInstanceOf(Error);
      expect(issuerCalls).toBe(2);
      expect(apiCalls).toBe(2);
      await client.models.list();
      expect(issuerCalls).toBe(3);
    },
  );

  test.each(['timeout', 'signal'] as const)(
    'honors a build hook mutation of %s during issuer acquisition without restarting the deadline',
    async (mode) => {
      vi.useFakeTimers();
      const original = new AbortController();
      const replacement = new AbortController();
      class MutatingHookClient extends OpenAI {
        override async buildRequest(
          options: Parameters<OpenAI['buildRequest']>[0],
          retries?: Parameters<OpenAI['buildRequest']>[1],
        ) {
          if (mode === 'timeout') {
            options.timeout = 100;
          } else {
            options.signal = replacement.signal;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          return await super.buildRequest(options, retries);
        }
      }
      let releaseIssuer!: (response: Response) => void;
      const issuer = new Promise<Response>((resolve) => {
        releaseIssuer = resolve;
      });
      let apiCalls = 0;
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          return await issuer;
        }
        apiCalls += 1;
        return globalThis.Response.json({ data: [] });
      });
      const client = new MutatingHookClient({ ...createTestClientOptions(), fetch: send, maxRetries: 0 });
      let settled = false;
      const result = (async () => {
        try {
          return await client.models.list({ timeout: 1000, signal: original.signal });
        } catch (error) {
          return error;
        } finally {
          settled = true;
        }
      })();
      try {
        await vi.advanceTimersByTimeAsync(60);
        expect(send).toHaveBeenCalledTimes(1);
        if (mode === 'signal') {
          replacement.abort('synthetic-hook-cancel');
        }
        await vi.advanceTimersByTimeAsync(40);
        expect(settled).toBe(true);
        expect(await result).toBeInstanceOf(
          mode === 'timeout' ? APIConnectionTimeoutError : APIUserAbortError,
        );
        expect(apiCalls).toBe(0);
      } finally {
        releaseIssuer(globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 }));
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  test('honors an issuer minimum when a protected auth hook defers acquisition to dispatch', async () => {
    vi.useFakeTimers();
    class DeferredAuthenticationClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This existing protected hook can defer token acquisition to dispatch.
      protected override async bearerAuth(): Promise<undefined> {}
    }
    let issuerCalls = 0;
    const send = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/oauth/token')) {
        issuerCalls += 1;
        return issuerCalls === 1
          ? globalThis.Response.json(
              { error: 'temporarily_unavailable' },
              {
                status: 503,
                headers: { 'retry-after': '90' },
              },
            )
          : globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      }
      return globalThis.Response.json({ data: [] });
    });
    const client = new DeferredAuthenticationClient({
      ...createTestClientOptions(),
      fetch: send,
      maxRetries: 1,
    });
    const result = (async () => {
      try {
        return await client.models.list();
      } catch (error) {
        return error;
      }
    })();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBeInstanceOf(APIConnectionError);
    expect(issuerCalls).toBe(1);
  });

  test.each(['response', 'timeout'] as const)(
    'keeps a fresh per-attempt timeout for ordinary workload API %s retries',
    async (mode) => {
      vi.useFakeTimers();
      let apiCalls = 0;
      const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes('/oauth/token')) {
          return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
        }
        apiCalls += 1;
        if (apiCalls === 1) {
          if (mode === 'response') {
            return new globalThis.Response('unavailable', { status: 503 });
          }
          await new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('request timed out')), {
              once: true,
            });
          });
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: send, timeout: 100, maxRetries: 1 });
      const result = Promise.allSettled([client.models.list()]);
      await vi.advanceTimersByTimeAsync(700);
      const [outcome] = await result;
      expect(outcome.status).toBe('fulfilled');
      expect(apiCalls).toBe(2);
    },
  );

  test.each([
    ['primitive', '200', false],
    ['foreign error', '200', false],
    ['primitive over-limit', '90000', true],
  ] as const)('preserves %s issuer hint after error normalization', async (kind, hint, refused) => {
    vi.useFakeTimers();
    let attempts = 0;
    class DeferredAuthenticationClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- Acquire the token during fetchWithAuth.
      protected override async bearerAuth(): Promise<undefined> {}

      override async buildRequest(
        options: Parameters<OpenAI['buildRequest']>[0],
        retries?: Parameters<OpenAI['buildRequest']>[1],
      ) {
        attempts += 1;
        return await super.buildRequest(options, retries);
      }
    }
    let issuerCalls = 0;
    let secondExchangeAt = 0;
    const send = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/oauth/token')) {
        issuerCalls += 1;
        if (issuerCalls === 1) {
          const failure = new globalThis.Response('unavailable', {
            status: 503,
            headers: { 'retry-after-ms': hint },
          });
          vi.spyOn(failure, 'text').mockImplementation(async () => {
            throw kind === 'foreign error'
              ? runInNewContext('new Error("foreign failure")')
              : 'synthetic failure';
          });
          return failure;
        }
        secondExchangeAt = performance.now();
        return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      }
      return globalThis.Response.json({ data: [] });
    });
    const client = new DeferredAuthenticationClient({
      ...createTestClientOptions(),
      fetch: send,
      timeout: 1000,
      maxRetries: 1,
    });
    const started = performance.now();
    const pending = Promise.allSettled([client.models.list()]);
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBe(refused ? 1 : 2);
    expect(issuerCalls).toBe(refused ? 1 : 2);
    await vi.advanceTimersByTimeAsync(450);
    const [outcome] = await pending;
    expect(outcome.status).toBe(refused ? 'rejected' : 'fulfilled');
    expect(attempts).toBe(refused ? 1 : 2);
    expect(issuerCalls).toBe(refused ? 1 : 2);
    if (!refused) {
      expect(secondExchangeAt - started).toBeGreaterThanOrEqual(200);
    }
  });

  test.each(['insufficient budget', 'late timer'] as const)(
    'bounds deferred issuer retries by the monotonic request deadline (%s)',
    async (mode) => {
      vi.useFakeTimers();
      class DeferredAuthenticationClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- Exercise the supported deferred auth hook.
        protected override async bearerAuth(): Promise<undefined> {}
      }
      let issuerCalls = 0;
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          if (issuerCalls === 1) {
            if (mode === 'insufficient budget') {
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            return globalThis.Response.json(
              { error: 'temporarily_unavailable' },
              { status: 503, headers: { 'retry-after-ms': mode === 'late timer' ? '50' : '100' } },
            );
          }
          return globalThis.Response.json({ access_token: 'unexpected-token', expires_in: 3600 });
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new DeferredAuthenticationClient({
        ...createTestClientOptions(),
        fetch: send,
        timeout: 200,
        maxRetries: 1,
      });
      const pending = Promise.allSettled([client.models.list()]);
      if (mode === 'late timer') {
        // The sleep timer wakes before the abort timer despite elapsed monotonic time.
        const clock = performance.now.bind(performance);
        setTimeout(() => vi.spyOn(performance, 'now').mockImplementation(() => clock() + 250), 49);
      }
      try {
        await vi.advanceTimersByTimeAsync(300);
        const [outcome] = await pending;
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(APIConnectionTimeoutError);
        }
        expect(issuerCalls).toBe(1);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  test('uses an issuer HTTP-date after its error body advances the wall clock in deferred dispatch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
    class DeferredAuthenticationClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- Exercise the supported deferred auth hook.
      protected override async bearerAuth(): Promise<undefined> {}
    }
    let issuerCalls = 0;
    let retriedAt = 0;
    const send = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/oauth/token')) {
        issuerCalls += 1;
        if (issuerCalls === 1) {
          const failure = globalThis.Response.json(
            { error: 'temporarily_unavailable' },
            { status: 503, headers: { 'retry-after': new Date(Date.now() + 1000).toUTCString() } },
          );
          const read = failure.text.bind(failure);
          vi.spyOn(failure, 'text').mockImplementation(async () => {
            const body = await read();
            vi.setSystemTime(Date.now() + 2000);
            return body;
          });
          return failure;
        }
        retriedAt = performance.now();
        return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      }
      return globalThis.Response.json({ data: [] });
    });
    const client = new DeferredAuthenticationClient({
      ...createTestClientOptions(),
      fetch: send,
      maxRetries: 1,
      timeout: 500,
    });
    const started = performance.now();
    const pending = Promise.allSettled([client.models.list()]);
    await vi.advanceTimersByTimeAsync(1200);
    const [outcome] = await pending;
    expect(outcome.status).toBe('fulfilled');
    expect(issuerCalls).toBe(2);
    expect(retriedAt - started).toBeLessThan(500);
  });

  test.each(['wait', 'cancel', 'deadline', 'invalid'] as const)(
    'preserves %s behavior for a cached bearer followed by a hinted issuer failure',
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let issuerCalls = 0;
      let apiCalls = 0;
      let finishFailureRead!: () => void;
      const failureRead = new Promise<void>((resolve) => {
        finishFailureRead = resolve;
      });
      const failure = globalThis.Response.json(
        { error: 'temporarily_unavailable' },
        {
          status: 503,
          headers: { 'retry-after-ms': mode === 'invalid' ? 'invalid' : '200' },
        },
      );
      const read = failure.text.bind(failure);
      vi.spyOn(failure, 'text').mockImplementation(async () => {
        const body = await read();
        finishFailureRead();
        return body;
      });
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          return issuerCalls === 2
            ? failure
            : globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 2 });
        }
        apiCalls += 1;
        if (apiCalls === 2) {
          await failureRead;
          return globalThis.Response.json({ error: { message: 'expired' } }, { status: 401 });
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        fetch: send,
        maxRetries: 0,
        timeout: mode === 'deadline' ? 100 : 1000,
      });
      await client.models.list();
      await vi.advanceTimersByTimeAsync(1001);
      const result = (async () => {
        try {
          return await client.models.list({ signal: controller.signal });
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(199);
      if (mode === 'invalid') {
        expect(issuerCalls).toBe(3);
      } else {
        expect(issuerCalls).toBe(2);
      }
      if (mode === 'cancel') {
        controller.abort('synthetic-cancel');
      }
      await vi.advanceTimersByTimeAsync(1);
      const outcome = await result;
      if (mode === 'cancel') {
        expect(outcome).toBeInstanceOf(APIUserAbortError);
      } else if (mode === 'deadline') {
        expect(outcome).toBeInstanceOf(APIConnectionTimeoutError);
      } else {
        expect(outcome).not.toBeInstanceOf(Error);
        expect(issuerCalls).toBe(3);
      }
    },
  );

  test.each(['abort', 'deadline'] as const)(
    'keeps a second caller alive when the first caller reaches its %s during a shared issuer wait',
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let issuerCalls = 0;
      let apiCalls = 0;
      let releaseBody!: () => void;
      const pendingBody = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      const failure = globalThis.Response.json(
        { error: 'temporarily_unavailable' },
        { status: 503, headers: { 'retry-after-ms': '200' } },
      );
      const read = failure.text.bind(failure);
      vi.spyOn(failure, 'text').mockImplementation(async () => {
        await pendingBody;
        return await read();
      });
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          return issuerCalls === 2
            ? failure
            : globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 2 });
        }
        apiCalls += 1;
        return apiCalls === 2
          ? globalThis.Response.json({ error: { message: 'expired' } }, { status: 401 })
          : globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: send, maxRetries: 0 });
      await client.models.list();
      await vi.advanceTimersByTimeAsync(1001);
      const first = (async () => {
        try {
          return await client.models.list({
            signal: controller.signal,
            timeout: mode === 'deadline' ? 100 : 1000,
          });
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(0);
      let secondSettled = false;
      const second = (async () => {
        try {
          return await client.models.list({ timeout: 1000 });
        } catch (error) {
          return error;
        } finally {
          secondSettled = true;
        }
      })();
      await vi.advanceTimersByTimeAsync(50);
      if (mode === 'abort') {
        controller.abort('synthetic-cancel');
      }
      await vi.advanceTimersByTimeAsync(50);
      const firstError = await first;
      releaseBody();
      expect(firstError).toBeInstanceOf(mode === 'abort' ? APIUserAbortError : APIConnectionTimeoutError);
      expect(secondSettled).toBe(false);
      expect(issuerCalls).toBe(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(await second).not.toBeInstanceOf(Error);
      expect(issuerCalls).toBe(3);
    },
  );

  test.each(['short', 'absent'] as const)(
    'retains an earlier issuer minimum after observing another generation with a %s hint',
    async (hint) => {
      vi.useFakeTimers();
      let issuerCalls = 0;
      let apiCalls = 0;
      let releaseBody!: () => void;
      const pendingBody = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      let expireToken!: (response: Response) => void;
      const expiration = new Promise<Response>((resolve) => {
        expireToken = resolve;
      });
      const laterFailure = globalThis.Response.json(
        { error: 'later-failure' },
        { status: 503, headers: hint === 'short' ? { 'retry-after-ms': '10' } : {} },
      );
      const read = laterFailure.text.bind(laterFailure);
      vi.spyOn(laterFailure, 'text').mockImplementation(async () => {
        await pendingBody;
        return await read();
      });
      const send = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          issuerCalls += 1;
          if (issuerCalls === 2) {
            return globalThis.Response.json(
              { error: 'earlier-failure' },
              { status: 503, headers: { 'retry-after': '90' } },
            );
          }
          if (issuerCalls === 3) {
            return laterFailure;
          }
          return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 2 });
        }
        apiCalls += 1;
        if (apiCalls === 2) {
          return globalThis.Response.json(
            { error: { message: 'retry API' } },
            { status: 503, headers: { 'retry-after-ms': '100' } },
          );
        }
        if (apiCalls === 4) {
          return await expiration;
        }
        return globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: send, maxRetries: 1 });
      try {
        await client.models.list();
        await vi.advanceTimersByTimeAsync(1001);
        const first = (async () => {
          try {
            return await client.models.list();
          } catch (error) {
            return error;
          }
        })();
        await vi.advanceTimersByTimeAsync(0);
        await client.models.list();
        await vi.advanceTimersByTimeAsync(100);
        expect(apiCalls).toBe(4);
        expect(issuerCalls).toBe(3);
        releaseBody();
        await vi.advanceTimersByTimeAsync(0);
        expireToken(globalThis.Response.json({ error: { message: 'expired' } }, { status: 401 }));
        await vi.advanceTimersByTimeAsync(10);
        expect(issuerCalls).toBe(3);
        expect(await first).toMatchObject({ status: 503, error: 'earlier-failure' });
      } finally {
        releaseBody();
        expireToken(globalThis.Response.json({ data: [] }));
      }
    },
  );

  test('shares one foreground issuer failure across concurrent requests reusing their options', async () => {
    let release!: (value: Response) => void;
    const issuer = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async () => issuer);
    const client = new OpenAI({ ...createTestClientOptions(), fetch: send, maxRetries: 1 });
    const options = { path: '/models', method: 'get' as const };
    const calls = [client.request(options), client.request(options)];
    const settled = Promise.allSettled(calls);
    release(
      globalThis.Response.json(
        { error: 'temporarily_unavailable' },
        { status: 503, headers: { 'retry-after': '90' } },
      ),
    );
    const results = await settled;
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    if (results[0]?.status === 'rejected' && results[1]?.status === 'rejected') {
      expect(results[0].reason).toBe(results[1].reason);
    }
  });

  test('keeps legacy-signature forwarding isolated when caller options are reused', async () => {
    const seen: object[] = [];
    class LegacyForwardingClient extends OpenAI {
      override async buildRequest(
        options: Parameters<OpenAI['buildRequest']>[0],
        retries?: Parameters<OpenAI['buildRequest']>[1],
      ) {
        seen.push(options);
        await Promise.resolve();
        return await super.buildRequest(options, retries);
      }

      protected override async bearerAuth(options: Parameters<OpenAI['buildRequest']>[0]) {
        seen.push(options);
        await Promise.resolve();
        return await super.bearerAuth(options);
      }
    }
    let issuerCalls = 0;
    const send = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/oauth/token')) {
        issuerCalls += 1;
        return globalThis.Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
      }
      return globalThis.Response.json({ data: [] });
    });
    const client = new LegacyForwardingClient({ ...createTestClientOptions(), fetch: send });
    const headers = { 'x-test-request': 'synthetic' };
    const options = { path: '/models', method: 'get' as const, headers };
    await Promise.all([client.request(options), client.request(options)]);
    expect(issuerCalls).toBe(1);
    expect(seen).toHaveLength(4);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toBe(seen[2]);
    expect(seen[1]).toBe(seen[3]);
    expect(seen.every((value) => (value as typeof options).headers === headers)).toBe(true);
    expect(options).toEqual({ path: '/models', method: 'get', headers });
  });

  test('initializes with workloadIdentity', () => {
    const client = new OpenAI(createTestClientOptions());

    expect(client).toBeDefined();
  });

  test('apiKey and workloadIdentity are mutually exclusive at runtime', () => {
    expect(
      () =>
        new OpenAI({
          apiKey: 'my-api-key',
          workloadIdentity: createTestWorkloadIdentity(),
          organization: 'test-org-id',
          project: 'test-project-id',
        }),
    ).toThrow(/mutually exclusive/);
  });

  test('requires at least one credential source', () => {
    expect(() => new OpenAI({})).toThrow(/Missing credentials/);
  });

  test('allows client initialization with adminAPIKey only', () => {
    expect(() => new OpenAI({ apiKey: null, adminAPIKey: 'my-admin-api-key' })).not.toThrow();
  });

  test('injects Authorization header with workload identity token', async () => {
    let apiRequestHeaders: Headers | undefined;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return globalThis.Response.json(
          {
            access_token: 'exchanged-access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        apiRequestHeaders = new Headers(init?.headers);
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await client.models.list();

    expect(apiRequestHeaders).toBeDefined();
    expect(apiRequestHeaders!.get('Authorization')).toBe('Bearer exchanged-access-token');
  });

  test('does not satisfy admin-only auth with workload identity', async () => {
    global.fetch = vi.fn(async () => new Response('Unexpected request', { status: 500 })) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(
      client
        .request({
          path: '/organization/projects',
          method: 'get',
          __security: { adminAPIKeyAuth: true },
        })
        .asResponse(),
    ).rejects.toThrow(/Could not resolve authentication method/);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reuses cached token across multiple requests', async () => {
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return globalThis.Response.json(
          {
            access_token: 'exchanged-access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await client.models.list();
    await client.models.list();
    await client.models.list();

    expect(tokenExchangeCallCount).toBe(1);
  });

  test('handles 401 response by invalidating token and retrying', async () => {
    let apiCallCount = 0;
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return globalThis.Response.json(
          {
            access_token: `access-token-${tokenExchangeCallCount}`,
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        apiCallCount++;
        if (apiCallCount === 1) {
          return globalThis.Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
        }
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    const result = await client.models.list();

    expect(result).toBeDefined();
    expect(apiCallCount).toBe(2);
    expect(tokenExchangeCallCount).toBe(2);
  });

  test.each([
    [0, false, undefined],
    [0, false, 'true'],
    [0, false, 'false'],
    [1, true, undefined],
    [1, true, 'true'],
    [1, true, 'false'],
    [1, false, undefined],
    [1, false, 'true'],
    [1, false, 'false'],
  ] as const)(
    'declines excessive authentication replay delays (maxRetries=%i, prior retry=%s, x-should-retry=%s)',
    async (maxRetries, retryFirst, retryHeader) => {
      let issuerCalls = 0;
      let apiCalls = 0;
      const terminalAttempt = retryFirst ? 2 : 1;
      global.fetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
        if (url.toString().includes('/oauth/token')) {
          issuerCalls++;
          return globalThis.Response.json({ access_token: `fake-token-${issuerCalls}`, expires_in: 3600 });
        }
        apiCalls++;
        if (retryFirst && apiCalls === 1) {
          return globalThis.Response.json(
            { error: { message: 'Retry now' } },
            {
              status: 503,
              headers: { 'retry-after': '0' },
            },
          );
        }
        return apiCalls === terminalAttempt
          ? globalThis.Response.json(
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
          : globalThis.Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), maxRetries });

      await expect(client.models.list()).rejects.toMatchObject({
        status: 401,
        code: 'retry_later',
        requestID: 'req_fake',
        error: { message: 'Try later', code: 'retry_later' },
      });
      expect([apiCalls, issuerCalls]).toEqual([terminalAttempt, 1]);
      await expect(client.models.list()).resolves.toMatchObject({ data: [] });
      expect([apiCalls, issuerCalls]).toEqual([terminalAttempt + 1, 2]);
    },
  );

  test('only retries once for 401 errors', async () => {
    let apiCallCount = 0;
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return globalThis.Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        apiCallCount++;
        return globalThis.Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(client.models.list()).rejects.toThrow();

    expect(apiCallCount).toBe(2);
    expect(tokenExchangeCallCount).toBe(2);
  });

  test('does not retry 401 errors with streaming request body', async () => {
    let apiCallCount = 0;
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return globalThis.Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/files')) {
        apiCallCount++;
        return globalThis.Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    async function* streamGenerator() {
      yield new TextEncoder().encode('test data chunk 1');
      yield new TextEncoder().encode('test data chunk 2');
    }

    await expect(
      client.post('/files', {
        body: streamGenerator(),
      }),
    ).rejects.toThrow();

    expect(apiCallCount).toBe(1);
    expect(tokenExchangeCallCount).toBe(1);
  });

  test('propagates SubjectTokenProviderError', async () => {
    const client = new OpenAI({
      workloadIdentity: {
        identityProviderId: 'test-identity-provider-id',
        serviceAccountId: 'test-service-account-id',
        provider: {
          tokenType: 'jwt',
          getToken: async () => {
            throw new SubjectTokenProviderError('Failed to get token', 'test-provider');
          },
        },
      },
      organization: 'test-org-id',
      project: 'test-project-id',
    });

    await expect(client.models.list()).rejects.toThrow(SubjectTokenProviderError);
  });

  test('propagates OAuthError on token exchange failure', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return globalThis.Response.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid subject token',
          },
          { status: 400 },
        );
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await expect(client.models.list()).rejects.toThrow(OAuthError);
  });

  test('refreshes expired tokens automatically', async () => {
    let tokenExchangeCallCount = 0;

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenExchangeCallCount++;
        return globalThis.Response.json(
          {
            access_token: `access-token-${tokenExchangeCallCount}`,
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 1,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    await client.models.list();

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await client.models.list();

    expect(tokenExchangeCallCount).toBe(2);
  });

  test('withOptions preserves workloadIdentity', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return globalThis.Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI(createTestClientOptions());

    const newClient = client.withOptions({ timeout: 5000 });

    await newClient.models.list();

    expect(fetch).toHaveBeenCalled();
  });

  test('works with custom subject token provider', async () => {
    let customProviderCallCount = 0;

    global.fetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return globalThis.Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI({
      workloadIdentity: {
        identityProviderId: 'test-identity-provider-id',
        serviceAccountId: 'test-service-account-id',
        provider: {
          tokenType: 'jwt',
          getToken: async () => {
            customProviderCallCount++;
            return `custom-token-${customProviderCallCount}`;
          },
        },
      },
      organization: 'test-org-id',
      project: 'test-project-id',
    });

    await client.models.list();

    expect(customProviderCallCount).toBe(1);
  });

  test('uses client fetch for token exchange', async () => {
    const globalFetchSpy = vi.fn(originalFetch as any);
    global.fetch = globalFetchSpy as typeof fetch;

    const clientFetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('/oauth/token')) {
        return globalThis.Response.json(
          {
            access_token: 'access-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            token_type: 'Bearer',
            expires_in: 3600,
          },
          { status: 200 },
        );
      }

      if (urlStr.includes('/models')) {
        return globalThis.Response.json({ data: [] }, { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const client = new OpenAI({ ...createTestClientOptions(), fetch: clientFetch });
    await client.models.list();

    expect(clientFetch).toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
