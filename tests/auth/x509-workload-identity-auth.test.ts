import { expect, vi } from 'vitest';

import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, OAuthError } from 'openai';
import type { X509WorkloadIdentity } from 'openai/auth';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';

const config: X509WorkloadIdentity = {
  type: 'x509',
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

function tokenResponse(token: string, expiresIn: unknown = 3600): Response {
  return Response.json({ access_token: token, expires_in: expiresIn });
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

function refreshWaiterCount(auth: WorkloadIdentityAuth): number {
  const internal = auth as unknown as {
    defaultState: { refreshAttempt: { waiters: Set<unknown> } | null };
  };
  return internal.defaultState.refreshAttempt?.waiters.size ?? 0;
}

describe('X.509 workload identity auth', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('uses the exact pinned exchange request and only inherits transport fetch options', async () => {
    const dispatcher = { name: 'client-certificate-dispatcher' };
    const inheritedSignal = new AbortController().signal;
    const customFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      tokenResponse('access-token'),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, {
      fetchOptions: {
        dispatcher,
        redirect: 'follow',
        method: 'DELETE',
        headers: { Authorization: 'Bearer unsafe' },
        body: 'unsafe body',
        signal: inheritedSignal,
      } as never,
      maxRetries: 0,
    });

    await expect(auth.getToken()).resolves.toBe('access-token');

    expect(customFetch).toHaveBeenCalledTimes(1);
    const [firstCall] = customFetch.mock.calls;
    if (!firstCall) {
      throw new Error('Expected one X.509 token exchange call');
    }
    const [url, init] = firstCall;
    expect(url).toBe('https://mtls.auth.openai.com/oauth/token');
    expect(init).toMatchObject({
      dispatcher,
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(init?.signal).not.toBe(inheritedSignal);
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:openai:params:oauth:token-type:x509',
      identity_provider_id: 'idp_test',
      service_account_id: 'svc_acct_test',
    });
    expect(body).not.toHaveProperty('subject_token');
    expect(body).not.toHaveProperty('client_id');
  });

  test('invokes a custom fetch with an undefined receiver', async () => {
    const receivers: unknown[] = [];
    const customFetch = vi.fn(function customFetch(this: unknown) {
      receivers.push(this);
      return Promise.resolve(tokenResponse('access-token'));
    });
    const auth = new WorkloadIdentityAuth(config, customFetch);

    await expect(auth.getToken()).resolves.toBe('access-token');
    expect(receivers).toEqual([undefined]);
  });

  test.each(['provider', 'clientId', 'refreshBufferSeconds'] as const)(
    'rejects the subject-token-only `%s` field at construction time',
    (field) => {
      expect(
        () =>
          new WorkloadIdentityAuth(
            {
              ...config,
              [field]: field === 'provider' ? { tokenType: 'jwt', getToken: vi.fn() } : 'invalid',
            } as never,
            vi.fn(),
          ),
      ).toThrow('does not accept');
    },
  );

  test('allows subject-token-only fields when they are explicitly undefined', () => {
    expect(
      () =>
        new WorkloadIdentityAuth(
          {
            ...config,
            provider: undefined,
            clientId: undefined,
            refreshBufferSeconds: undefined,
          } as unknown as X509WorkloadIdentity,
          vi.fn(),
        ),
    ).not.toThrow();
  });

  test.each([undefined, null, 0, -1, '3600', Number.NaN, Number.POSITIVE_INFINITY])(
    'requires a positive numeric expires_in value: %s',
    async (expiresIn) => {
      const customFetch = vi.fn(async () =>
        expiresIn === undefined
          ? Response.json({ access_token: 'unsafe-token' })
          : tokenResponse('unsafe-token', expiresIn),
      );
      const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 0 });

      await expect(auth.getToken()).rejects.toThrow("invalid 'expires_in'");
    },
  );

  test('collapses 100 concurrent cold requests into one exchange', async () => {
    const exchange = deferredResponse();
    const customFetch = vi.fn(() => exchange.promise);
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const tokens = Array.from({ length: 100 }, () => auth.getToken());
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    exchange.resolve(tokenResponse('shared-token'));

    await expect(Promise.all(tokens)).resolves.toEqual(Array.from({ length: 100 }, () => 'shared-token'));
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('a canceled waiter neither cancels nor poisons the shared refresh', async () => {
    const exchange = deferredResponse();
    const customFetch = vi.fn(() => exchange.promise);
    const auth = new WorkloadIdentityAuth(config, customFetch);
    const controller = new AbortController();

    const canceled = auth.getToken(controller.signal);
    const winner = auth.getToken();
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    controller.abort('caller stopped waiting');

    await expect(canceled).rejects.toBeInstanceOf(APIUserAbortError);
    exchange.resolve(tokenResponse('winner-token'));
    await expect(winner).resolves.toBe('winner-token');
    await expect(auth.getToken()).resolves.toBe('winner-token');
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('a timed-out waiter neither cancels nor poisons the shared refresh', async () => {
    vi.useFakeTimers();
    const exchange = deferredResponse();
    const customFetch = vi.fn(() => exchange.promise);
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const timedOut = auth.getToken(undefined, 1000);
    const winner = auth.getToken(undefined, 5000);
    const timeoutAssertion = expect(timedOut).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    expect(customFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await timeoutAssertion;
    exchange.resolve(tokenResponse('winner-token'));

    await expect(winner).resolves.toBe('winner-token');
    await expect(auth.getToken()).resolves.toBe('winner-token');
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('removes canceled and timed-out subscribers from a stalled shared refresh', async () => {
    vi.useFakeTimers();
    const exchange = deferredResponse();
    const customFetch = vi.fn(() => exchange.promise);
    const auth = new WorkloadIdentityAuth(config, customFetch);
    const controllers = Array.from({ length: 25 }, () => new AbortController());
    const canceled = controllers.map((controller) => auth.getToken(controller.signal));
    const timedOut = Array.from({ length: 25 }, () => auth.getToken(undefined, 1000));
    const abandoned = Promise.allSettled([...canceled, ...timedOut]);
    const winner = auth.getToken(undefined, 5000);

    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(refreshWaiterCount(auth)).toBe(51);
    for (const controller of controllers) {
      controller.abort('caller stopped waiting');
    }
    await vi.advanceTimersByTimeAsync(1000);
    await abandoned;

    expect(refreshWaiterCount(auth)).toBe(1);
    exchange.resolve(tokenResponse('winner-token'));
    await expect(winner).resolves.toBe('winner-token');
    expect(refreshWaiterCount(auth)).toBe(0);
  });

  test('clamps refreshBufferMs to half of a short token TTL using a suspension-aware clock', async () => {
    let wallTime = 9_000_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    let exchangeCount = 0;
    const customFetch = vi.fn(async () => {
      exchangeCount += 1;
      return tokenResponse(`token-${exchangeCount}`, 10);
    });
    const auth = new WorkloadIdentityAuth({ ...config, refreshBufferMs: 60_000 }, customFetch);

    await expect(auth.getToken()).resolves.toBe('token-1');
    wallTime += 4999;
    await expect(auth.getToken()).resolves.toBe('token-1');
    expect(customFetch).toHaveBeenCalledTimes(1);

    wallTime += 1;
    await expect(auth.getToken()).resolves.toBe('token-1');
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await auth.getToken()).toBe('token-2'));
  });

  test('expires a token when wall time advances across host suspension', async () => {
    let wallTime = 9_000_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('pre-suspension-token', 60))
      .mockResolvedValueOnce(tokenResponse('post-suspension-token', 60));
    const auth = new WorkloadIdentityAuth({ ...config, refreshBufferMs: 0 }, customFetch);

    await expect(auth.getToken()).resolves.toBe('pre-suspension-token');
    wallTime += 60_000;
    await expect(auth.getToken()).resolves.toBe('post-suspension-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('records background refresh backoff without scheduling a referenced retry timer', async () => {
    vi.useFakeTimers();
    let monotonicTime = 1000;
    let wallTime = 9_000_000_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
    const failedRefresh = deferredResponse();
    const successfulRefresh = deferredResponse();
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('cached-token', 300))
      .mockImplementationOnce(() => failedRefresh.promise)
      .mockImplementationOnce(() => successfulRefresh.promise);
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 2 });

    await expect(auth.getToken()).resolves.toBe('cached-token');
    monotonicTime += 150_000;
    wallTime += 150_000;
    await expect(auth.getToken()).resolves.toBe('cached-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
    failedRefresh.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);

    monotonicTime += 59_999;
    await expect(auth.getToken()).resolves.toBe('cached-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    monotonicTime += 1;
    await expect(auth.getToken()).resolves.toBe('cached-token');
    expect(customFetch).toHaveBeenCalledTimes(3);
    successfulRefresh.resolve(tokenResponse('refreshed-token', 300));
    await vi.advanceTimersByTimeAsync(0);
    await expect(auth.getToken()).resolves.toBe('refreshed-token');
  });

  test.each([408, 409, 429, 500, 503])('retries transient HTTP %i responses', async (status) => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    await expect(auth.getToken()).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('honors Retry-After before a transient retry', async () => {
    vi.useFakeTimers();
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1.5' } }))
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    const token = auth.getToken();
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1499);
    expect(customFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(token).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('does not start a refresh attempt when Retry-After reaches the waiter deadline', async () => {
    vi.useFakeTimers();
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(tokenResponse('too-late-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    const token = auth.getToken(undefined, 1000);
    const rejection = expect(token).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('makes late callers share an active Retry-After window and the next attempt', async () => {
    vi.useFakeTimers();
    const firstExchange = deferredResponse();
    const customFetch = vi
      .fn()
      .mockImplementationOnce(() => firstExchange.promise)
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const retrying = auth.getToken(undefined, undefined, { maxRetries: 1 });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    firstExchange.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }));
    await vi.advanceTimersByTimeAsync(0);

    const late = auth.getToken(undefined, undefined, { maxRetries: 0 });
    await vi.advanceTimersByTimeAsync(999);
    expect(customFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(Promise.all([retrying, late])).resolves.toEqual(['retried-token', 'retried-token']);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('rechecks shared backoff when another waiter extends it', async () => {
    vi.useFakeTimers();
    let monotonicTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const first = auth.getToken(undefined, undefined, { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(customFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    const staleSleeper = auth.getToken(undefined, undefined, { maxRetries: 2 });
    monotonicTime += 1000;
    await vi.advanceTimersByTimeAsync(900);
    expect(customFetch).toHaveBeenCalledTimes(2);

    monotonicTime += 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(customFetch).toHaveBeenCalledTimes(2);

    monotonicTime += 59_900;
    await vi.advanceTimersByTimeAsync(59_900);
    await expect(Promise.all([first, staleSleeper])).resolves.toEqual(['retried-token', 'retried-token']);
    expect(customFetch).toHaveBeenCalledTimes(3);
  });

  test('records Retry-After when an exchange settles after every waiter exits', async () => {
    vi.useFakeTimers();
    let monotonicTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
    const firstExchange = deferredResponse();
    const customFetch = vi
      .fn()
      .mockImplementationOnce(() => firstExchange.promise)
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const abandoned = auth.getToken(undefined, 1000);
    const timeoutAssertion = expect(abandoned).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await timeoutAssertion;

    firstExchange.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    await vi.advanceTimersByTimeAsync(0);

    const late = auth.getToken(undefined, undefined, { maxRetries: 0 });
    monotonicTime += 59_999;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(customFetch).toHaveBeenCalledTimes(1);
    monotonicTime += 1;
    await vi.advanceTimersByTimeAsync(1);

    await expect(late).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('clears the Retry-After timer when its waiter is canceled', async () => {
    vi.useFakeTimers();
    const customFetch = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });
    const controller = new AbortController();

    const token = auth.getToken(controller.signal);
    const rejection = expect(token).rejects.toBeInstanceOf(APIUserAbortError);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort('stop waiting');

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('clears the Retry-After timer when its waiter times out', async () => {
    vi.useFakeTimers();
    const customFetch = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    const token = auth.getToken(undefined, 1000);
    const rejection = expect(token).rejects.toBeInstanceOf(APIConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('bounds transient retries to maxRetries plus the initial attempt', async () => {
    const customFetch = vi.fn(
      async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } }),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 2 });

    await expect(auth.getToken()).rejects.toMatchObject({ status: 503 });
    expect(customFetch).toHaveBeenCalledTimes(3);
  });

  test('uses the effective per-call maxRetries when starting an exchange', async () => {
    const customFetch = vi.fn(
      async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } }),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 2 });

    await expect(auth.getToken(undefined, undefined, { maxRetries: 0 })).rejects.toMatchObject({
      status: 503,
    });
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('honors each concurrent waiter retry budget while keeping attempts single-flight', async () => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch);

    const retrying = auth.getToken(undefined, undefined, { maxRetries: 1 });
    const noRetry = auth.getToken(undefined, undefined, { maxRetries: 0 });

    await expect(noRetry).rejects.toMatchObject({ status: 503 });
    await expect(retrying).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('retries a connection error and reports a bounded terminal failure', async () => {
    const customFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary connection failure'))
      .mockRejectedValueOnce(new Error('terminal error containing private-key-material'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    const result = auth.getToken();
    await expect(result).rejects.toBeInstanceOf(APIConnectionError);
    await expect(result).rejects.not.toHaveProperty('cause');
    await expect(result).rejects.not.toThrow('private-key-material');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('retries a connection failure while reading a successful exchange body', async () => {
    const failedBody = new ReadableStream({
      start(controller) {
        controller.error(new Error('body stream contains private transport details'));
      },
    });
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(failedBody, { status: 200 }))
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    await expect(auth.getToken()).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('redacts a terminal connection failure while reading a successful exchange body', async () => {
    const failedBody = new ReadableStream({
      start(controller) {
        controller.error(new Error('body stream contains private transport details'));
      },
    });
    const auth = new WorkloadIdentityAuth(
      config,
      vi.fn(async () => new Response(failedBody, { status: 200 })),
      { maxRetries: 0 },
    );

    const caughtError = await auth.getToken().catch((error: unknown) => error);
    expect(caughtError).toBeInstanceOf(APIConnectionError);
    expect(`${String(caughtError)} ${JSON.stringify(caughtError)}`).not.toContain(
      'private transport details',
    );
  });

  test('preserves a retryable status error when response cleanup fails', async () => {
    const failedCleanupBody = new ReadableStream({
      cancel() {
        return Promise.reject(new Error('cleanup contains private transport details'));
      },
    });
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(failedCleanupBody, { status: 503, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(tokenResponse('retried-token'));
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 1 });

    await expect(auth.getToken()).resolves.toBe('retried-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    {
      name: 'an unexpected OAuth error value',
      response: Response.json({ error: 'certificate-subject-private-detail' }, { status: 400 }),
    },
    {
      name: 'a malformed success body',
      response: new Response('private-token-response-detail', { status: 200 }),
    },
  ])('redacts $name', async ({ response }) => {
    const auth = new WorkloadIdentityAuth(
      config,
      vi.fn(async () => response.clone()),
      { maxRetries: 0 },
    );

    const caughtError = await auth.getToken().catch((error: unknown) => error);
    const exposedError = `${String(caughtError)} ${JSON.stringify(caughtError)}`;
    expect(exposedError).not.toContain('private-detail');
    expect(exposedError).not.toContain('private-token-response-detail');
    expect(exposedError).not.toContain('certificate-subject-private-detail');
  });

  test.each([400, 401, 403, 404, 307])('does not retry non-transient HTTP %i responses', async (status) => {
    const customFetch = vi.fn(async () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'sensitive server detail' },
        { status, ...(status === 307 ? { headers: { Location: 'https://attacker.example/' } } : {}) },
      ),
    );
    const auth = new WorkloadIdentityAuth(config, customFetch, { maxRetries: 2 });

    const result = auth.getToken();
    const caughtError = await result.catch((error: unknown) => error);
    // oxlint-disable-next-line unicorn/prefer-ternary -- The two assertion shapes are clearer as branches.
    if (status === 400 || status === 401 || status === 403) {
      expect(caughtError).toBeInstanceOf(OAuthError);
    } else {
      expect(caughtError).toMatchObject({ status });
    }
    const exposedError = `${String(caughtError)} ${JSON.stringify(caughtError)}`;
    expect(exposedError).not.toContain('sensitive server detail');
    expect(exposedError).not.toContain(config.identityProviderId);
    expect(exposedError).not.toContain(config.serviceAccountId);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
