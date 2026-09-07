/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected authentication hooks. */
import OpenAI from 'openai';
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

describe('Workload identity authentication hook provenance', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

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

  describe.each(['mutable', 'freeze', 'seal', 'preventExtensions'] as const)(
    'request options: %s',
    (kind) => {
      describe.each([
        ['authHeaders', false],
        ['authHeaders', true],
        ['bearerAuth', false],
        ['bearerAuth', true],
      ] as const)('rebuilt %s results (cloned options: %s)', (hook, cloneOptions) => {
        test.each([undefined, 'Bearer replacement'])(
          'refreshes only the preserved workload credential (override: %j)',
          async (authorization) => {
            const options: FinalRequestOptions = { method: 'get', path: '/models' };
            if (kind === 'freeze') {
              Object.freeze(options);
            } else if (kind === 'seal') {
              Object.seal(options);
            } else if (kind === 'preventExtensions') {
              Object.preventExtensions(options);
            }
            const extraHeaders = { 'X-Custom': 'wrapped', Authorization: authorization };
            class HookClient extends OpenAI {
              protected override async authHeaders(
                received: FinalRequestOptions,
                schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
              ) {
                if (!received.__metadata?.['workloadIdentityTokenRefreshed']) {
                  expect(received).toBe(options);
                }
                const headers = await super.authHeaders(
                  hook === 'authHeaders' && cloneOptions ? { ...received } : received,
                  schemes,
                );
                return hook === 'authHeaders' ? buildHeaders([headers, extraHeaders]) : headers;
              }

              protected override async bearerAuth(received: FinalRequestOptions) {
                if (hook === 'bearerAuth' && !received.__metadata?.['workloadIdentityTokenRefreshed']) {
                  expect(received).toBe(options);
                }
                const headers = await super.bearerAuth(
                  hook === 'bearerAuth' && cloneOptions ? { ...received } : received,
                );
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

            const request = client.request(options);
            await (authorization === undefined
              ? request
              : expect(request).rejects.toMatchObject({ status: 401 }));
            await client.request(options);

            expect(headers.map((value) => value.get('Authorization'))).toEqual(
              authorization === undefined
                ? ['Bearer access-token-1', 'Bearer access-token-2', 'Bearer access-token-2']
                : [authorization, authorization],
            );
            expect(headers.every((value) => value.get('X-Custom') === 'wrapped')).toBe(true);
            expect(transport.exchanges).toBe(authorization === undefined ? 2 : 1);
            expect(Reflect.ownKeys(options)).toEqual(['method', 'path']);
          },
        );
      });
    },
  );

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

  test('retains a cached credential held by an auth hook while another request refreshes it', async () => {
    const cachedHeadersReady = createBarrier();
    const refreshed = createBarrier();
    class HookClient extends OpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        const headers = await super.authHeaders({ ...options });
        if (options.path === '/models/held' && !options.__metadata?.['workloadIdentityTokenRefreshed']) {
          cachedHeadersReady.release();
          await refreshed.promise;
        }
        return buildHeaders([headers, { 'X-Custom': 'wrapped' }]);
      }
    }
    const requests: { path: string; authorization: string | null }[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      const path = new URL(url.toString()).pathname;
      const authorization = new Headers(init?.headers).get('Authorization');
      requests.push({ path, authorization });
      return path !== '/v1/models' && authorization === 'Bearer access-token-1'
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), maxRetries: 0, fetch: transport.fetch });
    await client.models.list();

    const held = client.request(Object.freeze({ method: 'get', path: '/models/held' }));
    // Start this lazy API promise before waiting for its authentication hook.
    const completed = held.then((response) => response);
    await cachedHeadersReady.promise;
    await client.request({ method: 'get', path: '/models/refresh' });
    refreshed.release();
    await completed;

    expect(requests).toEqual([
      { path: '/v1/models', authorization: 'Bearer access-token-1' },
      { path: '/v1/models/refresh', authorization: 'Bearer access-token-1' },
      { path: '/v1/models/refresh', authorization: 'Bearer access-token-2' },
      { path: '/v1/models/held', authorization: 'Bearer access-token-1' },
      { path: '/v1/models/held', authorization: 'Bearer access-token-3' },
    ]);
    expect(transport.exchanges).toBe(3);
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
  test('leaves caller options unchanged when an authentication hook freezes them and throws', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const failure = new Error('Synthetic authentication hook failure');
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async authHeaders(received: FinalRequestOptions): Promise<never> {
        expect(received).toBe(options);
        Object.freeze(received);
        throw failure;
      }
    }
    const client = new HookClient(createTestClientOptions());

    await expect(client.request(options)).rejects.toBe(failure);

    expect(Reflect.ownKeys(options)).toEqual(['method', 'path']);
  });
});
