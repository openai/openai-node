/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected SDK hooks. */
import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import type { RequestCredentialContext } from 'openai/internal/request-credentials';

const clientOptions = {
  apiKey: null,
  adminAPIKey: null,
  workloadIdentity: {
    identityProviderId: 'test-identity-provider-id',
    serviceAccountId: 'test-service-account-id',
    provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
  },
  organization: 'test-org-id',
  project: 'test-project-id',
};

function createTransport(
  reject: (request: Request, call: number) => boolean = (_request, call) => call === 1,
) {
  const requests: Request[] = [];
  let exchanges = 0;
  const fetch: Fetch = async (url, init) => {
    if (url.toString().endsWith('/oauth/token')) {
      exchanges += 1;
      return Response.json({
        access_token: `access-token-${exchanges}`,
        issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    const request = new Request(url, init);
    requests.push(request);
    return reject(request, requests.length)
      ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
      : Response.json({ data: [] });
  };
  return {
    fetch,
    requests,
    get authorizations() {
      return requests.map((request) => request.headers.get('Authorization'));
    },
    get exchanges() {
      return exchanges;
    },
  };
}

function deferred() {
  let resolveGate!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- Tests control concurrent authentication hook completion.
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return { promise, resolve: resolveGate };
}

class CloningBuildRequestClient extends OpenAI {
  override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
    const built = await super.buildRequest(...args);
    built.req.headers = new Headers(built.req.headers);
    return built;
  }
}

describe('workload identity authentication and dispatch hooks', () => {
  afterEach(() => vi.unstubAllGlobals());
  describe.each([undefined, 0])('retry budget %j', (maxRetries) => {
    test.each(['none', 'prepareRequest', 'buildRequest'])(
      'refreshes a rejected workload token with %s header cloning',
      async (hook) => {
        const transport = createTransport();
        const Client = hook === 'buildRequest' ? CloningBuildRequestClient : OpenAI;
        vi.stubGlobal('fetch', transport.fetch);
        const client = new Client({ ...clientOptions, maxRetries });
        if (hook === 'prepareRequest') {
          Object.defineProperty(client, 'prepareRequest', {
            value: async (request: RequestInit) => {
              request.headers = new Headers(request.headers);
            },
          });
        }

        await client.models.list();

        expect(transport.authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
        expect(transport.exchanges).toBe(2);
      },
    );

    test.each([OpenAI, CloningBuildRequestClient])('refreshes at most once with %s', async (Client) => {
      const transport = createTransport(() => true);
      vi.stubGlobal('fetch', transport.fetch);
      const client = new Client({ ...clientOptions, maxRetries });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(transport.authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    });
  });

  test.each([null, '', 'Bearer replacement'])(
    'does not refresh a workload token replaced after cloning headers: %j',
    async (authorization) => {
      class HookClient extends CloningBuildRequestClient {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
        protected override async prepareRequest(request: RequestInit): Promise<void> {
          if (!(request.headers instanceof Headers)) {
            throw new Error('Expected normalized headers');
          }
          if (authorization === null) {
            request.headers.delete('Authorization');
          } else {
            request.headers.set('Authorization', authorization);
          }
        }
      }
      const transport = createTransport();
      vi.stubGlobal('fetch', transport.fetch);
      const client = new HookClient({ ...clientOptions, maxRetries: 0 });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(transport.authorizations).toEqual([authorization]);
      expect(transport.exchanges).toBe(1);
    },
  );

  test.each(['authHeaders', 'bearerAuth', 'adminAPIKeyAuth'])(
    'preserves options identity and in-place header mutations in %s',
    async (hook) => {
      const headers: { Authorization: string | null } = { Authorization: null };
      const options: FinalRequestOptions = {
        method: 'get',
        path: '/models',
        headers,
        __security: { bearerAuth: true, adminAPIKeyAuth: true },
      };
      const transport = createTransport();
      vi.stubGlobal('fetch', transport.fetch);
      const client = new OpenAI({ ...clientOptions });
      Object.defineProperty(client, hook, {
        value: async (received: FinalRequestOptions) => {
          expect(received).toBe(options);
          headers.Authorization = 'Bearer hook-override';
        },
      });

      const { req } = await client.buildRequest(options);

      expect(req.headers.get('Authorization')).toBe('Bearer hook-override');
    },
  );

  describe.each([
    ['authHeaders', false],
    ['authHeaders', true],
    ['bearerAuth', false],
    ['bearerAuth', true],
  ] as const)('rebuilt %s results (cloned options: %s)', (hook, cloneOptions) => {
    test.each([undefined, 'Bearer replacement'])(
      'refreshes only the preserved workload credential (override: %j)',
      async (authorization) => {
        const extraHeaders = { 'X-Custom': 'wrapped', Authorization: authorization };
        class HookClient extends OpenAI {
          protected override async authHeaders(
            options: FinalRequestOptions,
            schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
            credentialContext?: RequestCredentialContext,
          ) {
            const headers = await super.authHeaders(
              cloneOptions ? { ...options } : options,
              schemes,
              credentialContext,
            );
            return hook === 'authHeaders' ? buildHeaders([headers, extraHeaders]) : headers;
          }

          protected override async bearerAuth(
            options: FinalRequestOptions,
            credentialContext?: RequestCredentialContext,
          ) {
            const headers = await super.bearerAuth(
              cloneOptions ? { ...options } : options,
              credentialContext,
            );
            return hook === 'bearerAuth' ? buildHeaders([headers, extraHeaders]) : headers;
          }
        }
        const transport = createTransport();
        vi.stubGlobal('fetch', transport.fetch);
        const client = new HookClient({ ...clientOptions, maxRetries: 0 });

        const request = client.models.list();
        await (authorization === undefined
          ? request
          : expect(request).rejects.toMatchObject({ status: 401 }));
        await client.models.list();

        expect(transport.authorizations).toEqual(
          authorization === undefined
            ? ['Bearer access-token-1', 'Bearer access-token-2', 'Bearer access-token-2']
            : [authorization, authorization],
        );
        expect(transport.requests.every((value) => value.headers.get('X-Custom') === 'wrapped')).toBe(true);
        expect(transport.exchanges).toBe(authorization === undefined ? 2 : 1);
      },
    );
  });

  test('refreshes rebuilt auth results for concurrent requests sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const bothHeadersReady = deferred();
    let authCalls = 0;
    class HookClient extends OpenAI {
      protected override async authHeaders(
        received: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        credentialContext?: RequestCredentialContext,
      ) {
        if (authCalls < 2) {
          expect(received).toBe(options);
        }
        const headers = await super.authHeaders({ ...received }, schemes, credentialContext);
        authCalls += 1;
        if (authCalls === 2) {
          bothHeadersReady.resolve();
        }
        await bothHeadersReady.promise;
        return buildHeaders([headers, { 'X-Custom': 'wrapped' }]);
      }
    }
    const transport = createTransport(
      (request) => request.headers.get('Authorization') === 'Bearer access-token-1',
    );
    vi.stubGlobal('fetch', transport.fetch);
    const client = new HookClient({ ...clientOptions, maxRetries: 0 });

    await Promise.all([client.request(options), client.request(options)]);

    expect(transport.requests).toHaveLength(4);
    expect(transport.authorizations.filter((value) => value === 'Bearer access-token-1')).toHaveLength(2);
    expect(transport.requests.every((value) => value.headers.get('X-Custom') === 'wrapped')).toBe(true);
    expect(transport.exchanges).toBeGreaterThanOrEqual(2);
    expect(transport.exchanges).toBeLessThanOrEqual(3);
  });

  test('keeps copied-option provenance independent across clients sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const firstComplete = deferred();
    class HookClient extends OpenAI {
      waitForFirst = false;
      protected override async authHeaders(
        received: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        credentialContext?: RequestCredentialContext,
      ) {
        if (this.waitForFirst) {
          await firstComplete.promise;
        }
        return buildHeaders([
          await super.authHeaders({ ...received }, schemes, credentialContext),
          { 'X-Custom': 'wrapped' },
        ]);
      }
    }
    const first = createTransport();
    const second = createTransport();
    vi.stubGlobal('fetch', first.fetch);
    const firstClient = new HookClient({ ...clientOptions, maxRetries: 0 });
    vi.stubGlobal('fetch', second.fetch);
    const secondClient = new HookClient({ ...clientOptions, maxRetries: 0 });
    secondClient.waitForFirst = true;

    await Promise.all([
      firstClient.request(options).finally(firstComplete.resolve),
      secondClient.request(options),
    ]);

    expect(first.authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(second.authorizations).toEqual(first.authorizations);
  });

  describe.each(['fetch', 'fetchWithAuth', 'fetchWithTimeout'] as const)(
    'authorization snapshot at %s dispatch',
    (hook) => {
      test.each([undefined, 'Bearer independent'])(
        'refreshes only the sent workload token (replacement: %j)',
        async (replacement) => {
          class HookClient extends OpenAI {
            protected override async fetchWithAuth(
              url: RequestInfo,
              init: RequestInit,
              timeout: number,
              controller: AbortController,
              schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
            ) {
              const response = await super.fetchWithAuth(url, { ...init }, timeout, controller, schemes);
              if (hook === 'fetchWithAuth' && init.headers instanceof Headers) {
                init.headers.delete('Authorization');
              }
              return response;
            }

            override async fetchWithTimeout(
              url: RequestInfo,
              init: RequestInit | undefined,
              timeout: number,
              controller: AbortController,
            ) {
              const headers =
                hook === 'fetch' && replacement === undefined ? init?.headers : new Headers(init?.headers);
              if (replacement !== undefined && headers instanceof Headers) {
                headers.set('Authorization', replacement);
              }
              const response = await super.fetchWithTimeout(
                url,
                { ...init, ...(headers === undefined ? {} : { headers }) },
                timeout,
                controller,
              );
              if (hook === 'fetchWithTimeout' && init?.headers instanceof Headers) {
                init.headers.delete('Authorization');
              }
              return response;
            }
          }
          const transport = createTransport();
          const defaultFetch: Fetch = async (url, init) => {
            const response = await transport.fetch(url, init);
            if (hook === 'fetch' && init?.headers instanceof Headers) {
              init.headers.delete('Authorization');
            }
            return response;
          };
          vi.stubGlobal('fetch', defaultFetch);
          const client = new HookClient({ ...clientOptions, maxRetries: 0 });

          const request = client.models.list();
          await (replacement === undefined
            ? request
            : expect(request).rejects.toMatchObject({ status: 401 }));

          expect(transport.authorizations).toEqual(
            replacement === undefined ? ['Bearer access-token-1', 'Bearer access-token-2'] : [replacement],
          );
          expect(transport.exchanges).toBe(replacement === undefined ? 2 : 1);
        },
      );
    },
  );

  test.each(['default', 'custom', 'reset'] as const)(
    'preserves transport refresh ownership through a %s clone',
    async (mode) => {
      const transport = createTransport();
      vi.stubGlobal('fetch', transport.fetch);
      const customFetch: Fetch = (url, init) => transport.fetch(url, init);
      const parent = new OpenAI({
        ...clientOptions,
        maxRetries: 0,
        ...(mode === 'reset' ? { fetch: customFetch } : {}),
      });
      const cloneOptions = {
        default: {},
        custom: { fetch: customFetch },
        reset: { fetch: undefined },
      };
      const client = parent.withOptions(cloneOptions[mode]);
      const refresh = mode === 'default' || mode === 'reset';
      const request = client.models.list();
      await (refresh ? request : expect(request).rejects.toMatchObject({ status: 401 }));

      expect(transport.authorizations).toEqual(
        refresh ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer access-token-1'],
      );
      expect(transport.exchanges).toBe(refresh ? 2 : 1);
    },
  );

  test('forwards the materialized header snapshot used for dispatch provenance', async () => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
      ) {
        const iterator = new Headers(init?.headers).entries();
        const headers = { [Symbol.iterator]: () => iterator } as unknown as NonNullable<
          RequestInit['headers']
        >;
        return super.fetchWithTimeout(url, { ...init, headers }, timeout, controller);
      }
    }
    const transport = createTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const client = new HookClient({ ...clientOptions, maxRetries: 0 });

    await client.models.list();

    expect(transport.authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test.each(['fetchWithAuth', 'fetchWithTimeout'] as const)(
    'does not refresh when %s dispatches an independent credential directly',
    async (hook) => {
      const transport = createTransport();
      const dispatch: Fetch = (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', 'Bearer independent');
        return transport.fetch(url, { ...init, headers });
      };
      class HookClient extends OpenAI {
        protected override async fetchWithAuth(
          url: RequestInfo,
          init: RequestInit,
          timeout: number,
          controller: AbortController,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        ) {
          return hook === 'fetchWithAuth'
            ? dispatch(url, init)
            : super.fetchWithAuth(url, init, timeout, controller, schemes);
        }

        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
        ) {
          return hook === 'fetchWithTimeout'
            ? dispatch(url, init)
            : super.fetchWithTimeout(url, init, timeout, controller);
        }
      }
      vi.stubGlobal('fetch', transport.fetch);
      const client = new HookClient({ ...clientOptions, maxRetries: 0 });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(transport.authorizations).toEqual(['Bearer independent']);
      expect(transport.exchanges).toBe(1);
    },
  );

  describe.each([
    ['frozen', (options: FinalRequestOptions) => Object.freeze(options)],
    ['sealed', (options: FinalRequestOptions) => Object.seal(options)],
    ['non-extensible', (options: FinalRequestOptions) => Object.preventExtensions(options)],
  ] as const)('%s request options', (_name, restrict) => {
    test.each([false, true])('supports public requests (401 refresh: %s)', async (refresh) => {
      const options: FinalRequestOptions = restrict({ method: 'get', path: '/models' });
      const keys = Reflect.ownKeys(options);
      let firstAttempt = true;
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          if (firstAttempt) {
            expect(args[0]).toBe(options);
            expect(Reflect.ownKeys(args[0])).toEqual(keys);
            firstAttempt = false;
          }
          return super.buildRequest(...args);
        }
      }
      const transport = createTransport((_request, call) => refresh && call === 1);
      vi.stubGlobal('fetch', transport.fetch);
      const client = new HookClient({ ...clientOptions, maxRetries: 0 });

      await client.request(options);

      expect(transport.authorizations).toEqual(
        refresh ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer access-token-1'],
      );
      expect(transport.exchanges).toBe(refresh ? 2 : 1);
      expect(Reflect.ownKeys(options)).toEqual(keys);
    });
  });
});
