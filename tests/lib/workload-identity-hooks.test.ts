/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected authentication and dispatch hooks. */
import OpenAI from 'openai';
import type { HeadersInit, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

function createBarrier() {
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- Deferred gates control the order of concurrent auth hooks.
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Workload identity authentication and dispatch hooks', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each([null, '', 'Bearer replacement'])(
    'does not refresh a workload token replaced by a request hook: %j',
    async (authorization) => {
      class HookClient extends OpenAI {
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
      const headers: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        headers.push(new Headers(init?.headers));
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        maxRetries: 0,
        fetch: transport.fetch,
      });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(headers.map((value) => value.get('Authorization'))).toEqual([authorization]);
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
      const transport = createWorkloadIdentityTransport(() => Response.json({ data: [] }));
      const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });
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
          ) {
            const headers = await super.authHeaders(cloneOptions ? { ...options } : options, schemes);
            return hook === 'authHeaders' ? buildHeaders([headers, extraHeaders]) : headers;
          }

          protected override async bearerAuth(options: FinalRequestOptions) {
            const headers = await super.bearerAuth(cloneOptions ? { ...options } : options);
            return hook === 'bearerAuth' ? buildHeaders([headers, extraHeaders]) : headers;
          }
        }

        const headers: Headers[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          headers.push(new Headers(init?.headers));
          return headers.length === 1
            ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          maxRetries: 0,
          fetch: transport.fetch,
        });

        const request = client.models.list();
        await (authorization === undefined
          ? request
          : expect(request).rejects.toMatchObject({ status: 401 }));
        await client.models.list();

        expect(headers.map((value) => value.get('Authorization'))).toEqual(
          authorization === undefined
            ? ['Bearer access-token-1', 'Bearer access-token-2', 'Bearer access-token-2']
            : [authorization, authorization],
        );
        expect(headers.every((value) => value.get('X-Custom') === 'wrapped')).toBe(true);
        expect(transport.exchanges).toBe(authorization === undefined ? 2 : 1);
      },
    );
  });

  test('refreshes rebuilt auth results for concurrent requests sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const bothHeadersReady = createBarrier();
    let authCalls = 0;
    class HookClient extends OpenAI {
      protected override async authHeaders(received: FinalRequestOptions) {
        if (authCalls < 2) {
          expect(received).toBe(options);
        }
        const headers = await super.authHeaders({ ...received });
        authCalls += 1;
        if (authCalls === 2) {
          bothHeadersReady.release();
        }
        await bothHeadersReady.promise;
        return buildHeaders([headers, { 'X-Custom': 'wrapped' }]);
      }
    }

    const headers: Headers[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const requestHeaders = new Headers(init?.headers);
      headers.push(requestHeaders);
      return requestHeaders.get('Authorization') === 'Bearer access-token-1'
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await Promise.all([client.request(options), client.request(options)]);

    expect(headers).toHaveLength(4);
    expect(headers.filter((value) => value.get('Authorization') === 'Bearer access-token-1')).toHaveLength(2);
    expect(headers.every((value) => value.get('X-Custom') === 'wrapped')).toBe(true);
    expect(transport.exchanges).toBeGreaterThanOrEqual(2);
    expect(transport.exchanges).toBeLessThanOrEqual(3);
  });

  test('keeps copied-option provenance independent across clients sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const firstComplete = createBarrier();
    class HookClient extends OpenAI {
      waitForFirst = false;
      protected override async authHeaders(received: FinalRequestOptions) {
        if (this.waitForFirst) {
          await firstComplete.promise;
        }
        return buildHeaders([await super.authHeaders({ ...received }), { 'X-Custom': 'wrapped' }]);
      }
    }
    const createClient = () => {
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return authorizations.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        maxRetries: 0,
        fetch: transport.fetch,
      });
      return { client, authorizations };
    };
    const first = createClient();
    const second = createClient();
    second.client.waitForFirst = true;
    await Promise.all([
      first.client.request(options).finally(firstComplete.release),
      second.client.request(options),
    ]);
    expect(first.authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(second.authorizations).toEqual(first.authorizations);
  });

  test.each(['freeze', 'seal', 'preventExtensions'] as const)(
    'supports request options protected with Object.%s',
    async (kind) => {
      const options: FinalRequestOptions = { method: 'get', path: '/models' };
      if (kind === 'freeze') {
        Object.freeze(options);
      } else if (kind === 'seal') {
        Object.seal(options);
      } else {
        Object.preventExtensions(options);
      }
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        fetch: transport.fetch,
      });

      await client.request(options);

      expect(Reflect.ownKeys(options)).toEqual(['method', 'path']);
    },
  );

  test.each(['freeze', 'seal'] as const)(
    'supports a buildRequest hook that applies Object.%s to request options',
    async (kind) => {
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          if (kind === 'freeze') {
            Object.freeze(args[0]);
          } else {
            Object.seal(args[0]);
          }
          return super.buildRequest(...args);
        }
      }
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
        return Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
      });

      await client.models.list();
    },
  );

  test('retains workload provenance when buildRequest clones the final headers', async () => {
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        built.req.headers = new Headers(built.req.headers);
        return built;
      }
    }
    const headers: Headers[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      headers.push(new Headers(init?.headers));
      return headers.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.models.list();

    expect(headers.map((value) => value.get('Authorization'))).toEqual([
      'Bearer access-token-1',
      'Bearer access-token-2',
    ]);
    expect(transport.exchanges).toBe(2);
  });

  test.each([false, true])(
    'refreshes a rejected workload token (cloned headers: %s)',
    async (cloneHeaders) => {
      let apiCallCount = 0;
      const transport = createWorkloadIdentityTransport(() => {
        apiCallCount += 1;
        return apiCallCount === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });
      if (cloneHeaders) {
        Object.defineProperty(client, 'prepareRequest', {
          value: async (request: RequestInit) => {
            request.headers = new Headers(request.headers);
          },
        });
      }

      const result = await client.models.list();

      expect(result).toBeDefined();
      expect(apiCallCount).toBe(2);
      expect(transport.exchanges).toBe(2);
    },
  );

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
              if (hook === 'fetchWithAuth') {
                (init.headers as Headers).delete('Authorization');
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
                hook === 'fetch' && replacement === undefined
                  ? (init?.headers as Headers)
                  : new Headers(init?.headers);
              if (replacement !== undefined) {
                headers.set('Authorization', replacement);
              }
              const response = await super.fetchWithTimeout(url, { ...init, headers }, timeout, controller);
              if (hook === 'fetchWithTimeout' && init?.headers instanceof Headers) {
                init.headers.delete('Authorization');
              }
              return response;
            }
          }
          const authorizations: (string | null)[] = [];
          const transport = createWorkloadIdentityTransport((url, init) => {
            const sent = new Request(url, init as globalThis.RequestInit);
            authorizations.push(sent.headers.get('Authorization'));
            if (hook === 'fetch' && init?.headers instanceof Headers) {
              init.headers.delete('Authorization');
            }
            return authorizations.length === 1
              ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
              : Response.json({ data: [] });
          });
          const client = new HookClient({
            ...createTestClientOptions(),
            maxRetries: 0,
            fetch: transport.fetch,
          });

          const request = client.models.list();
          await (replacement === undefined
            ? request
            : expect(request).rejects.toMatchObject({ status: 401 }));
          expect(authorizations).toEqual(
            replacement === undefined ? ['Bearer access-token-1', 'Bearer access-token-2'] : [replacement],
          );
          expect(transport.exchanges).toBe(replacement === undefined ? 2 : 1);
        },
      );
    },
  );

  test('forwards the same materialized header snapshot after a hook supplies an iterator', async () => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
      ) {
        const headers = new Headers(init?.headers).entries() as unknown as NonNullable<HeadersInit>;
        return super.fetchWithTimeout(url, { ...init, headers }, timeout, controller);
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return authorizations.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.models.list();

    expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test.each(['fetchWithAuth', 'fetchWithTimeout'] as const)(
    'does not infer workload usage when %s owns dispatch without calling super',
    async (hook) => {
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        const sent = new Request(url, init as globalThis.RequestInit);
        authorizations.push(sent.headers.get('Authorization'));
        return Response.json({ data: [] });
      });
      const dispatchIndependent = (url: RequestInfo, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', 'Bearer independent');
        const sent = new Request(url, { ...init, headers } as globalThis.RequestInit);
        authorizations.push(sent.headers.get('Authorization'));
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      };
      class HookClient extends OpenAI {
        independent = true;

        protected override async fetchWithAuth(
          url: RequestInfo,
          init: RequestInit,
          timeout: number,
          controller: AbortController,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        ) {
          if (hook === 'fetchWithAuth' && this.independent) {
            return dispatchIndependent(url, init);
          }
          return super.fetchWithAuth(url, init, timeout, controller, schemes);
        }

        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
        ) {
          if (hook === 'fetchWithTimeout' && this.independent) {
            return dispatchIndependent(url, init);
          }
          return super.fetchWithTimeout(url, init, timeout, controller);
        }
      }
      const client = new HookClient({
        ...createTestClientOptions(),
        maxRetries: 0,
        fetch: transport.fetch,
      });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(authorizations).toEqual(['Bearer independent']);
      expect(transport.exchanges).toBe(1);

      client.independent = false;
      await client.models.list();
      expect(authorizations).toEqual(['Bearer independent', 'Bearer access-token-1']);
      expect(transport.exchanges).toBe(1);
    },
  );
});
