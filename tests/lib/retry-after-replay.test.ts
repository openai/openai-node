import { Agent } from 'undici';
import { vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';

const tokenResponse = () =>
  Response.json({
    access_token: 'synthetic-token',
    token_type: 'Bearer',
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    expires_in: 3600,
  });

describe.each(['legacy', 'x509'] as const)('%s authentication replay Retry-After', (kind) => {
  let dispatcher: Agent;
  let apiCalls: number[];
  let issuerCalls: number;
  function client(headers: Record<string, string>, timeout = 1000) {
    const respond = async (issuer: boolean) => {
      if (issuer) {
        issuerCalls += 1;
        return tokenResponse();
      }
      apiCalls.push(Date.now());
      return apiCalls.length === 1
        ? Response.json({ error: { message: 'Rejected credential' } }, { status: 401, headers })
        : Response.json({ data: [] });
    };
    if (kind === 'legacy') {
      return new OpenAI({
        apiKey: null,
        timeout,
        maxRetries: 0,
        workloadIdentity: {
          identityProviderId: 'synthetic-provider',
          serviceAccountId: 'synthetic-account',
          provider: { tokenType: 'jwt', getToken: async () => 'synthetic-subject' },
        },
        fetch: async (url) => respond(url.toString().includes('/oauth/token')),
      });
    }
    vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) =>
      respond(url.origin === 'https://mtls.auth.openai.com'),
    );
    return new OpenAI({
      apiKey: null,
      timeout,
      maxRetries: 1,
      workloadIdentity: {
        type: 'x509',
        identityProviderId: 'synthetic-provider',
        serviceAccountId: 'synthetic-account',
      },
      x509Transport: createX509Transport({
        runtime: 'node',
        dispatcher,
        certificateIdentity: 'static',
        proxy: 'direct',
      }),
    });
  }
  beforeEach(() => {
    dispatcher = new Agent();
    apiCalls = [];
    issuerCalls = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await dispatcher.close();
  });

  test.each([{ 'retry-after': '0.1001' }, { 'retry-after-ms': '100.1' }])(
    'waits the complete minimum %j before exchanging again',
    async (headers) => {
      const startedAt = Date.now();
      const request = client(headers)
        .models.list()
        .then((value) => value);
      await vi.advanceTimersByTimeAsync(100);
      expect(apiCalls).toHaveLength(1);
      expect(issuerCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(request).resolves.toMatchObject({ data: [] });
      expect(apiCalls).toEqual([startedAt, startedAt + 101]);
      expect(issuerCalls).toBe(2);
    },
  );
  test.each([{}, { 'retry-after': 'invalid' }])('preserves immediate replay for %j', async (headers) => {
    const request = client(headers)
      .models.list()
      .then((value) => value);
    await vi.advanceTimersByTimeAsync(0);
    await expect(request).resolves.toMatchObject({ data: [] });
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[1]).toBe(apiCalls[0]);
  });
  test('cancels the hinted wait without issuing another token or API request', async () => {
    const controller = new AbortController();
    let settled = false;
    const request = (async () => {
      try {
        await client({ 'retry-after': '0.5' }).models.list({ signal: controller.signal });
        return null;
      } catch (error) {
        return error;
      } finally {
        settled = true;
      }
    })();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(await request).toBeInstanceOf(APIUserAbortError);
    expect(apiCalls).toHaveLength(1);
    expect(issuerCalls).toBe(1);
  });
  if (kind === 'legacy') {
    test.each([
      ['missing-any', 'caller'],
      ['missing-any', 'hook'],
      ['non-native', 'caller'],
    ] as const)('cancels replay through %s %s signals without a second exchange', async (mode, source) => {
      const originalAny = AbortSignal.any;
      const caller = new AbortController();
      const hook = new AbortController();
      const signal =
        mode === 'non-native'
          ? new Proxy(caller.signal, {
              getPrototypeOf: () => Object.prototype,
              get(target, key) {
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            })
          : caller.signal;
      const sdk = client({ 'retry-after-ms': '300' });
      Object.assign(sdk, {
        async prepareRequest(request: RequestInit): Promise<void> {
          request.signal = mode === 'non-native' ? signal : hook.signal;
        },
      });
      let settled = false;
      if (mode === 'missing-any') {
        Object.defineProperty(AbortSignal, 'any', { value: undefined });
      }
      try {
        const request = (async () => {
          try {
            await sdk.models.list({ signal });
            return null;
          } catch (error) {
            return error;
          } finally {
            settled = true;
          }
        })();
        await vi.advanceTimersByTimeAsync(24);
        (source === 'caller' ? caller : hook).abort();
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
        expect(await request).toBeInstanceOf(APIUserAbortError);
        expect(apiCalls).toHaveLength(1);
        expect(issuerCalls).toBe(1);
      } finally {
        Object.defineProperty(AbortSignal, 'any', { value: originalAny });
      }
    });
  }
  test('declines a hinted wait beyond the remaining deadline', async () => {
    const request = Promise.allSettled([client({ 'retry-after': '0.5' }, 100).models.list()]);
    await vi.advanceTimersByTimeAsync(0);
    const [result] = await request;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(APIConnectionTimeoutError);
    }
    expect(apiCalls).toHaveLength(1);
    expect(issuerCalls).toBe(1);
  });
});

test.each(['0', '90'])(
  'uses the validated delay when body cancellation changes it to %s',
  async (replacement) => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const startedAt = Date.now();
    const response = new Response(
      new ReadableStream({
        cancel() {
          response.headers.set('retry-after', replacement);
        },
      }),
      { status: 503, headers: { 'retry-after': '0.1' } },
    );
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      maxRetries: 1,
      fetch: async () => {
        calls.push(Date.now());
        return calls.length === 1 ? response : Response.json({ data: [] });
      },
    });
    try {
      const request = client.models.list().then((value) => value);
      await vi.advanceTimersByTimeAsync(99);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(request).resolves.toMatchObject({ data: [] });
      expect(calls).toEqual([startedAt, startedAt + 100]);
    } finally {
      vi.useRealTimers();
    }
  },
);
