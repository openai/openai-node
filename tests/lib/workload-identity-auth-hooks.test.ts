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

  describe.each(['authHeaders', 'bearerAuth'] as const)('native %s result copies', (hook) => {
    test('refreshes an immediately delegated native result copy', async () => {
      class HookClient extends OpenAI {
        protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
          const headers = await super.authHeaders(...args);
          return hook === 'authHeaders' && headers
            ? { ...headers, values: new Headers(headers.values) }
            : headers;
        }

        protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
          const headers = await super.bearerAuth(...args);
          return hook === 'bearerAuth' && headers
            ? { ...headers, values: new Headers(headers.values) }
            : headers;
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list();

      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    });

    test.each([undefined, 'record', 'native'] as const)(
      'refreshes a native copy unless an independent layer replaces it (independent layer: %s)',
      async (independent) => {
        const replacementRecord = independent ? { Authorization: 'Bearer access-token-1' } : undefined;
        const replacement = independent === 'native' ? new Headers(replacementRecord) : replacementRecord;
        class HookClient extends OpenAI {
          protected override async authHeaders(
            options: FinalRequestOptions,
            schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          ) {
            const headers = await super.authHeaders({ ...options }, schemes);
            return hook === 'authHeaders'
              ? buildHeaders([new Headers(headers?.values), replacement])
              : headers;
          }

          protected override async bearerAuth(options: FinalRequestOptions) {
            const headers = await super.bearerAuth({ ...options });
            return hook === 'bearerAuth'
              ? buildHeaders([new Headers(headers?.values), replacement])
              : headers;
          }
        }
        let apiCalls = 0;
        const transport = createWorkloadIdentityTransport(() => {
          apiCalls += 1;
          return apiCalls === 1
            ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          fetch: transport.fetch,
          maxRetries: 0,
        });
        const result = client.models.list();
        await (independent ? expect(result).rejects.toMatchObject({ status: 401 }) : result);
        expect(apiCalls).toBe(independent ? 1 : 2);
        expect(transport.exchanges).toBe(independent ? 1 : 2);
      },
    );
  });

  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const)(
    'requires marked values or forwarded context after delayed copied-option delegation (context: %s, marked: %s)',
    async (forwardContext, marked) => {
      class DelayedClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          context?: object,
        ) {
          await Promise.resolve();
          const headers = await super.authHeaders(
            { ...options },
            schemes,
            forwardContext ? context : undefined,
          );
          return buildHeaders([marked ? headers : new Headers(headers?.values)]);
        }
      }
      let calls = 0;
      const transport = createWorkloadIdentityTransport(() => {
        calls += 1;
        return calls === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new DelayedClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 0,
      });
      const result = client.models.list();
      const refreshes = marked || forwardContext;
      await (refreshes ? result : expect(result).rejects.toMatchObject({ status: 401 }));
      expect(calls).toBe(refreshes ? 2 : 1);
      expect(transport.exchanges).toBe(refreshes ? 2 : 1);
    },
  );

  test.each([false, true])(
    'recovers the last same-byte issuance when its native copy is returned (mutated: %s)',
    async (mutateSelected) => {
      class HookClient extends OpenAI {
        protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
          const previous = await super.bearerAuth(...args);
          const selected = await super.bearerAuth(...args);
          if (!previous || !selected) {
            throw new Error('Expected both synthetic SDK issuances');
          }
          expect(previous.values.get('Authorization')).toBe(selected.values.get('Authorization'));
          const overwritten = mutateSelected ? selected : previous;
          overwritten.values.set('Authorization', overwritten.values.get('Authorization') ?? '');
          return { ...selected, values: new Headers(selected.values) };
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 0,
      });
      const result = client.models.list();
      await result;
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    },
  );

  test('refreshes rebuilt auth results for concurrent requests sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const bothHeadersReady = createBarrier();
    let authCalls = 0;
    class HookClient extends OpenAI {
      protected override async authHeaders(
        received: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        if (authCalls < 2) {
          expect(received).toBe(options);
        }
        await Promise.resolve();
        const headers = await super.authHeaders({ ...received }, schemes);
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

  test.each([false, true])(
    'does not attribute another request token to an independent hook (forward context: %s)',
    async (forwardContext) => {
      const independentWaiting = createBarrier();
      const tokenIssued = createBarrier();
      class HookClient extends OpenAI {
        protected override async authHeaders(
          options: FinalRequestOptions,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          context?: object,
        ) {
          if (options.path === '/independent') {
            independentWaiting.release();
            await tokenIssued.promise;
            return buildHeaders([{ Authorization: 'Bearer access-token-1' }]);
          }
          await independentWaiting.promise;
          const headers = await super.authHeaders(
            { ...options },
            schemes,
            forwardContext ? context : undefined,
          );
          tokenIssued.release();
          return buildHeaders([headers]);
        }
      }
      const paths: string[] = [];
      const transport = createWorkloadIdentityTransport((url) => {
        const path = new URL(url.toString()).pathname;
        paths.push(path);
        return path.endsWith('/independent')
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await Promise.all([
        expect(client.get('/independent')).rejects.toMatchObject({ status: 401 }),
        client.request(Object.freeze({ method: 'get', path: '/issued' })),
      ]);

      expect(paths.filter((path) => path.endsWith('/independent'))).toHaveLength(1);
      expect(transport.exchanges).toBe(1);
    },
  );

  test('keeps a stalled independent hook separate while another request rotates credentials', async () => {
    const waiting = createBarrier();
    const rotated = createBarrier();
    class HookClient extends OpenAI {
      protected override async authHeaders(
        options: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        context?: object,
      ) {
        if (options.path === '/independent') {
          waiting.release();
          await rotated.promise;
          return buildHeaders([{ Authorization: 'Bearer access-token-4' }]);
        }
        return super.authHeaders({ ...options }, schemes, context);
      }
    }
    let independentCalls = 0;
    const seenPaths = new Set<string>();
    const transport = createWorkloadIdentityTransport((url) => {
      const path = new URL(url.toString()).pathname;
      if (path.endsWith('/independent')) {
        independentCalls += 1;
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }
      const first = !seenPaths.has(path);
      seenPaths.add(path);
      return first
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    const independent = expect(client.get('/independent')).rejects.toMatchObject({ status: 401 });
    await waiting.promise;
    for (let index = 0; index < 3; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Each completed refresh must precede the next token rotation.
      await client.get(`/rotate/${index}`);
    }
    rotated.release();
    await independent;

    expect(independentCalls).toBe(1);
    expect(transport.exchanges).toBe(4);
  });

  test('does not reuse a failed attempt context for later independent authentication', async () => {
    let failedContext: object | undefined;
    let fail = true;
    const failure = new Error('Synthetic hook failure');
    class HookClient extends OpenAI {
      protected override async authHeaders(
        options: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        context?: object,
      ) {
        if (fail) {
          failedContext = context;
          await super.authHeaders(options, schemes, context);
          throw failure;
        }
        await super.authHeaders(options, schemes, failedContext);
        return buildHeaders([{ Authorization: 'Bearer access-token-1' }]);
      }
    }
    let apiCalls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      apiCalls += 1;
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    await expect(client.models.list()).rejects.toBe(failure);
    fail = false;
    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(apiCalls).toBe(1);
    expect(transport.exchanges).toBe(1);
  });

  test.each([false, true])(
    'legacy hooks without context refresh with original or copied options (copy: %s)',
    async (copyOptions) => {
      class HookClient extends OpenAI {
        protected override async authHeaders(options: FinalRequestOptions) {
          return super.authHeaders(copyOptions ? { ...options } : options);
        }
      }
      let apiCalls = 0;
      const transport = createWorkloadIdentityTransport(() => {
        apiCalls += 1;
        return apiCalls === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
      await client.models.list();

      expect(apiCalls).toBe(2);
      expect(transport.exchanges).toBe(2);
    },
  );

  test('does not replay an independent equal-byte Authorization layer added by an auth hook', async () => {
    class HookClient extends OpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        const headers = await super.authHeaders(options);
        return buildHeaders([headers, { Authorization: 'Bearer access-token-1' }]);
      }
    }
    let apiCalls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      apiCalls += 1;
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(apiCalls).toBe(1);
    expect(transport.exchanges).toBe(1);
  });

  test('keeps copied-option provenance independent across clients sharing options', async () => {
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const firstComplete = createBarrier();
    class HookClient extends OpenAI {
      waitForFirst = false;
      protected override async authHeaders(
        received: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        if (this.waitForFirst) {
          await firstComplete.promise;
        }
        return buildHeaders([await super.authHeaders({ ...received }, schemes), { 'X-Custom': 'wrapped' }]);
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
      protected override async authHeaders(
        options: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        const headers = await super.authHeaders({ ...options }, schemes);
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
