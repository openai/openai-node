/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected dispatch hooks. */
import { test, vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch, HeadersInit, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { buildHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

class CloningBuildRequestClient extends OpenAI {
  override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
    const built = await super.buildRequest(...args);
    built.req.headers = new Headers(built.req.headers);
    return built;
  }
}

function normalizeBearerScheme(init: RequestInit, headers = new Headers(init.headers)) {
  const authorization = headers.get('Authorization');
  if (authorization !== null) {
    headers.set('Authorization', authorization.replace(/^Bearer /u, 'bEaReR '));
  }
  init.headers = headers;
}

function normalizeBearerRecord(init: RequestInit) {
  const authorization = new Headers(init.headers).get('Authorization');
  if (authorization === null) {
    throw new Error('Expected workload Authorization');
  }
  init.headers = {
    Authorization: authorization.replace(/^Bearer /u, 'bEaReR '),
  };
}

describe('Workload identity request and dispatch hooks', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each([
    [null, false],
    [null, true],
    ['', false],
    ['', true],
    ['Bearer replacement', false],
    ['Bearer replacement', true],
  ] as const)(
    'does not refresh a workload token replaced by a request hook: %j (cloned headers: %s)',
    async (authorization, cloneHeaders) => {
      const Client = cloneHeaders ? CloningBuildRequestClient : OpenAI;
      class HookClient extends Client {
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

  describe.each([undefined, 0])('retry budget %j', (maxRetries) => {
    test.each(['none', 'prepareRequest', 'buildRequest'])(
      'refreshes a rejected workload token with %s header cloning',
      async (hook) => {
        const headers: Headers[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          headers.push(new Headers(init?.headers));
          return headers.length === 1
            ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
            : Response.json({ data: [] });
        });
        const Client = hook === 'buildRequest' ? CloningBuildRequestClient : OpenAI;
        const client = new Client({ ...createTestClientOptions(), maxRetries, fetch: transport.fetch });
        if (hook === 'prepareRequest') {
          Object.defineProperty(client, 'prepareRequest', {
            value: async (request: RequestInit) => {
              request.headers = buildHeaders([request.headers]).values;
            },
          });
        }

        const result = await client.models.list();

        expect(result).toBeDefined();
        expect(headers.map((value) => value.get('Authorization'))).toEqual([
          'Bearer access-token-1',
          'Bearer access-token-2',
        ]);
        expect(transport.exchanges).toBe(2);
      },
    );

    test.each([OpenAI, CloningBuildRequestClient])('refreshes at most once with %s', async (Client) => {
      const headers: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        headers.push(new Headers(init?.headers));
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      });
      const client = new Client({ ...createTestClientOptions(), maxRetries, fetch: transport.fetch });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(headers.map((value) => value.get('Authorization'))).toEqual([
        'Bearer access-token-1',
        'Bearer access-token-2',
      ]);
      expect(transport.exchanges).toBe(2);
    });
  });

  test('preserves a one-shot removal through bodyless custom-auth retries', async () => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        return super.authHeaders(...args);
      }
    }
    const rows: [string, string | null][] = [['Authorization', null]];
    const iterator = rows.values();
    rows[Symbol.iterator] = () => iterator;
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: { message: 'retry' } }, { status: 500, headers: { 'retry-after-ms': '0' } })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });

    await client.models.list({ headers: rows });

    expect(sent).toEqual([null, null]);
    expect(transport.exchanges).toBe(1);
  });

  test('lets a later authentication hook retain a one-shot removal by materializing it', async () => {
    class HookClient extends OpenAI {
      protected override async authHeaders(
        options: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        context?: object,
      ) {
        options.headers = buildHeaders([options.headers]);
        return super.authHeaders(options, schemes, context);
      }
    }
    const rows: [string, string | null][] = [['Authorization', null]];
    const iterator = rows.values();
    rows[Symbol.iterator] = () => iterator;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return Response.json({ ok: true });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.post('/synthetic', { body: { synthetic: true }, headers: rows });

    expect(transport.exchanges).toBe(1);
  });

  test('strips SDK provenance from configured fetch while preserving caller extensions', async () => {
    const extension = Symbol('caller extension');
    class FrozenClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        return { ...built, req: Object.freeze({ ...built.req }) };
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(Object.getOwnPropertySymbols(init)).toEqual([extension]);
      expect(Object.getOwnPropertyDescriptor(init, extension)?.value).toBe('preserved');
      calls += 1;
      return calls === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const fetchOptions = { cache: 'no-store' as const, [extension]: 'preserved' };
    const client = new FrozenClient({
      ...createTestClientOptions(),
      fetch: transport.fetch,
      fetchOptions,
      maxRetries: 0,
    });
    await client.models.list();
    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(2);
  });

  test.each([false, true])(
    'does not replay independent equal-byte final headers (copied request: %s)',
    async (copyRequest) => {
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const built = await super.buildRequest(...args);
          const headers = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
          if (copyRequest) {
            return { ...built, req: { ...built.req, headers } };
          }
          built.req.headers = headers;
          return built;
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
    },
  );

  test.each(['prepareRequest', 'fetchWithTimeout'] as const)(
    'does not replay independent equal-byte headers from %s',
    async (hook) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
        protected override async prepareRequest(init: RequestInit) {
          if (hook === 'prepareRequest') {
            init.headers = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
          }
        }

        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
        ) {
          if (hook === 'fetchWithTimeout' && init) {
            init.headers = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
          }
          return super.fetchWithTimeout(url, init, timeout, controller);
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
    },
  );

  test.each(['prepareRequest', 'fetchWithTimeout'] as const)(
    'preserves bearer-scheme bytes through %s normalization',
    async (hook) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
        protected override async prepareRequest(init: RequestInit) {
          if (hook === 'prepareRequest') {
            normalizeBearerScheme(init, buildHeaders([init.headers]).values);
          }
        }

        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
        ) {
          if (hook === 'fetchWithTimeout' && init) {
            normalizeBearerScheme(init);
          }
          return super.fetchWithTimeout(url, init, timeout, controller);
        }
      }
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return authorizations.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      const request = client.models.list();
      await (hook === 'prepareRequest' ? expect(request).rejects.toMatchObject({ status: 401 }) : request);

      expect(authorizations).toEqual(
        hook === 'prepareRequest'
          ? ['bEaReR access-token-1']
          : ['bEaReR access-token-1', 'bEaReR access-token-2'],
      );
      expect(transport.exchanges).toBe(hook === 'prepareRequest' ? 1 : 2);
    },
  );

  test('does not refresh an observed Authorization overwrite that adds bearer spaces', async () => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(init: RequestInit) {
        const headers = buildHeaders([init.headers]).values;
        headers.set('Authorization', (headers.get('Authorization') ?? '').replace(/^Bearer /u, 'bearer  '));
        init.headers = headers;
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return authorizations.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(authorizations).toEqual(['bearer  access-token-1']);
    expect(transport.exchanges).toBe(1);
  });

  test.each(['prepareRequest', 'fetchWithAuth', 'fetchWithTimeout'] as const)(
    'applies bearer-scheme normalization semantics to record headers at %s',
    async (hook) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK boundary.
        protected override async prepareRequest(init: RequestInit) {
          if (hook === 'prepareRequest') {
            normalizeBearerRecord(init);
          }
        }
        protected override fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          if (hook === 'fetchWithAuth') {
            normalizeBearerRecord(args[1]);
          }
          return super.fetchWithAuth(...args);
        }
        override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          if (hook === 'fetchWithTimeout' && args[1]) {
            normalizeBearerRecord(args[1]);
          }
          return super.fetchWithTimeout(...args);
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      const request = client.models.list();
      await (hook === 'prepareRequest' ? expect(request).rejects.toMatchObject({ status: 401 }) : request);

      expect(sent).toEqual(
        hook === 'prepareRequest'
          ? ['bEaReR access-token-1']
          : ['bEaReR access-token-1', 'bEaReR access-token-2'],
      );
      expect(transport.exchanges).toBe(hook === 'prepareRequest' ? 1 : 2);
    },
  );

  test('defers a proxy descriptor normalization until its canonical getter is dispatched', async () => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture installs a proxy at preparation.
      protected override async prepareRequest(init: RequestInit) {
        const authorization = new Headers(init.headers).get('Authorization');
        if (authorization === null) {
          throw new Error('Expected workload Authorization');
        }
        const headers = { Authorization: authorization };
        init.headers = new Proxy(headers, {
          getOwnPropertyDescriptor(target, property) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
            return property === 'Authorization' && descriptor && 'value' in descriptor
              ? {
                  ...descriptor,
                  value: `${descriptor.value}`.replace(/^Bearer /u, 'bEaReR '),
                }
              : descriptor;
          },
        });
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.models.list();

    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test.each(['accessor', 'iterable', 'proxy-normalized'] as const)(
    'retains exact preparation semantics for deferred %s headers',
    async (shape) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture replaces prepared headers.
        protected override async prepareRequest(init: RequestInit) {
          const original = new Headers(init.headers).get('Authorization');
          if (!original) {
            throw new Error('Expected prepared workload Authorization');
          }
          const authorization = original.replace(/^Bearer /u, 'bEaReR ');
          if (shape === 'accessor') {
            init.headers = Object.defineProperty({}, 'Authorization', {
              enumerable: true,
              get: () => authorization,
            });
          } else if (shape === 'iterable') {
            init.headers = {
              *[Symbol.iterator]() {
                yield ['Authorization', authorization] as const;
              },
            } as unknown as Headers;
          } else {
            const headers = { Authorization: authorization };
            init.headers = new Proxy(headers, {
              getOwnPropertyDescriptor(target, property) {
                const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
                return property === 'Authorization' && descriptor && 'value' in descriptor
                  ? { ...descriptor, value: descriptor.value.replace(/^bEaReR /u, 'Bearer ') }
                  : descriptor;
              },
            });
          }
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(sent).toEqual(['bEaReR access-token-1']);
      expect(transport.exchanges).toBe(1);
    },
  );

  test('retains deferred preparation semantics through a copied dispatch request', async () => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture installs a deferred header value.
      protected override async prepareRequest(init: RequestInit) {
        const authorization = new Headers(init.headers).get('Authorization');
        init.headers = Object.defineProperty({}, 'Authorization', {
          enumerable: true,
          get: () => authorization?.replace(/^Bearer /u, 'bEaReR '),
        });
      }
      protected override fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const [url, init, timeout, controller, schemes, context] = args;
        return super.fetchWithAuth(url, { ...init }, timeout, controller, schemes, context);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(1);
  });

  test.each(['in place', 'native copy', 'data to accessor', 'accessor to data'] as const)(
    'recognizes %s dispatch normalization after canonical record preparation',
    async (shape) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture prepares a canonical record.
        protected override async prepareRequest(init: RequestInit) {
          const record = Object.fromEntries(new Headers(init.headers));
          if (shape === 'accessor to data') {
            const { authorization } = record;
            Object.defineProperty(record, 'authorization', {
              enumerable: true,
              configurable: true,
              get: () => authorization,
            });
          }
          init.headers = record;
        }
        override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          const [, init] = args;
          if (init) {
            const authorization = new Headers(init.headers).get('Authorization');
            if (!authorization) {
              throw new Error('Expected canonical record Authorization');
            }
            const normalized = authorization.replace(/^Bearer /u, 'bEaReR ');
            if (shape === 'native copy') {
              init.headers = new Headers({ Authorization: normalized });
            } else if (shape === 'data to accessor') {
              Object.defineProperty(init.headers, 'authorization', {
                enumerable: true,
                configurable: true,
                get: () => normalized,
              });
            } else if (shape === 'accessor to data') {
              Object.defineProperty(init.headers, 'authorization', {
                enumerable: true,
                configurable: true,
                writable: true,
                value: normalized,
              });
            } else {
              (init.headers as Record<string, string>)['authorization'] = normalized;
            }
          }
          return super.fetchWithTimeout(...args);
        }
      }
      let sends = 0;
      const transport = createWorkloadIdentityTransport(() => {
        sends += 1;
        return sends === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await client.models.list();

      expect(sends).toBe(2);
      expect(transport.exchanges).toBe(2);
    },
  );

  test.each([
    'tuple data to accessor',
    'tuple accessor to data',
    'iterator replacement',
    'outer iterator replacement',
    'row iterator replacement',
    'row getter replacement',
    'name getter replacement',
    'name getter value change',
    'custom row iterator value change',
  ] as const)('recognizes %s during final dispatch', async (shape) => {
    let source: object | undefined;
    let ownedAuthorization: string | undefined;
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture prepares structural headers.
      protected override async prepareRequest(init: RequestInit) {
        ownedAuthorization = new Headers(init.headers).get('Authorization') ?? undefined;
        if (!ownedAuthorization) {
          throw new Error('Expected prepared workload Authorization');
        }
        if (shape === 'iterator replacement') {
          source = {
            *[Symbol.iterator]() {
              yield ['Authorization', ownedAuthorization] as const;
            },
          };
        } else {
          const row: unknown[] = ['Authorization', ownedAuthorization];
          if (shape === 'tuple accessor to data') {
            Object.defineProperty(row, '1', {
              enumerable: true,
              configurable: true,
              get: () => ownedAuthorization,
            });
          }
          if (shape === 'name getter replacement' || shape === 'name getter value change') {
            Object.defineProperty(row, '0', {
              enumerable: true,
              configurable: true,
              get: () => 'Authorization',
            });
          }
          if (shape === 'custom row iterator value change') {
            Object.defineProperty(row, Symbol.iterator, {
              configurable: true,
              value: function* value() {
                yield row[0];
                yield row[1];
              },
            });
          }
          if (shape === 'row getter replacement') {
            source = [];
            Object.defineProperty(source, '0', {
              enumerable: true,
              configurable: true,
              get: () => row,
            });
          } else {
            source = [row];
          }
        }
        init.headers = source as Headers;
      }
      override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (!source || !ownedAuthorization) {
          throw new Error('Expected structural headers before dispatch');
        }
        const normalized = ownedAuthorization.replace(/^Bearer /u, 'bEaReR ');
        if (shape === 'iterator replacement') {
          Object.defineProperty(source, Symbol.iterator, {
            configurable: true,
            value: function* value() {
              yield ['Authorization', normalized] as const;
            },
          });
        } else if (shape === 'row getter replacement') {
          Object.defineProperty(source, '0', {
            enumerable: true,
            configurable: true,
            get: () => ['Authorization', normalized],
          });
        } else {
          const [row] = source as unknown[][];
          if (!row) {
            throw new Error('Expected Authorization tuple');
          }
          if (shape === 'outer iterator replacement') {
            Object.defineProperty(source, Symbol.iterator, {
              configurable: true,
              value: function* value() {
                yield ['Authorization', normalized] as const;
              },
            });
          } else if (shape === 'row iterator replacement') {
            Object.defineProperty(row, Symbol.iterator, {
              configurable: true,
              value: function* value() {
                yield 'Authorization';
                yield normalized;
              },
            });
          } else if (shape === 'name getter value change' || shape === 'custom row iterator value change') {
            row[1] = normalized;
          } else if (shape === 'name getter replacement') {
            Object.defineProperty(row, '0', {
              enumerable: true,
              configurable: true,
              get: () => 'Authorization',
            });
            row[1] = normalized;
          } else {
            Object.defineProperty(row, '1', {
              enumerable: true,
              configurable: true,
              ...(shape === 'tuple data to accessor'
                ? { get: () => normalized }
                : { value: normalized, writable: true }),
            });
          }
        }
        return super.fetchWithTimeout(...args);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return sends === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.models.list();

    expect(sends).toBe(2);
    expect(transport.exchanges).toBe(2);
  });

  test.each([false, true])('preserves native Request headers (throwing tag getter: %s)', async (throwTag) => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
        context?: object,
      ) {
        const request = new Request(url, init as globalThis.RequestInit);
        if (throwTag) {
          Object.defineProperty(request, Symbol.toStringTag, {
            get() {
              throw new Error('Unrelated Request tag getter must not run');
            },
          });
        }
        return super.fetchWithTimeout(request, undefined, timeout, controller, context);
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      authorizations.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return authorizations.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.models.list();

    expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test('does not inspect a native Request toStringTag before dispatch', async () => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
        context?: object,
      ) {
        const request = new Request(url, init as globalThis.RequestInit);
        Object.defineProperty(request, Symbol.toStringTag, {
          get() {
            throw new Error('Unrelated tag getter must not run');
          },
        });
        return super.fetchWithTimeout(request, undefined, timeout, controller, context);
      }
    }
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    const client = new HookClient({ apiKey: 'test-key', fetch, maxRetries: 0 });

    await client.models.list();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('refreshes a resolved workload identity placeholder', async () => {
    let apiCalls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      apiCalls += 1;
      return apiCalls === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });

    expect(apiCalls).toBe(2);
    expect(transport.exchanges).toBe(2);
  });

  test.skipIf(Number(process.versions.node.split('.')[0]) < 24).each([false, true])(
    'preserves foreign Request headers (throwing tag getter: %s)',
    async (throwTag) => {
      const { Request: ForeignRequest } = await import('undici');
      const requests: object[] = [];
      class HookClient extends OpenAI {
        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
          context?: object,
        ) {
          const request = new ForeignRequest(String(url), {
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            signal: init?.signal ?? null,
          });
          if (throwTag) {
            Object.defineProperty(request, Symbol.toStringTag, {
              get() {
                throw new Error('Unrelated foreign Request tag getter must not run');
              },
            });
          }
          requests.push(request);
          return super.fetchWithTimeout(
            request as unknown as RequestInfo,
            undefined,
            timeout,
            controller,
            context,
          );
        }
      }
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        expect(url).toBe(requests[authorizations.length]);
        expect(init?.headers).toBeInstanceOf(Headers);
        if (!(url instanceof ForeignRequest)) {
          throw new Error('Expected the foreign Request from the hook');
        }
        const headers = new Headers(init?.headers);
        expect([...headers]).toEqual([...url.headers]);
        authorizations.push(headers.get('Authorization'));
        return authorizations.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await client.models.list();

      expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    },
  );

  test.each([
    ['fetchWithAuth', false],
    ['fetchWithAuth', true],
    ['fetchWithTimeout', false],
    ['fetchWithTimeout', true],
  ] as const)(
    'refreshes after a delegating %s hook replaces the controller (copied request with context: %s)',
    async (hook, copyRequest) => {
      class HookClient extends OpenAI {
        protected override async fetchWithAuth(
          url: RequestInfo,
          init: RequestInit,
          timeout: number,
          controller: AbortController,
          schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
          context?: object,
        ) {
          return super.fetchWithAuth(
            url,
            copyRequest ? { ...init } : init,
            timeout,
            hook === 'fetchWithAuth' ? new AbortController() : controller,
            schemes,
            copyRequest ? context : undefined,
          );
        }

        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
          context?: object,
        ) {
          return super.fetchWithTimeout(
            url,
            copyRequest ? { ...init } : init,
            timeout,
            hook === 'fetchWithTimeout' ? new AbortController() : controller,
            copyRequest ? context : undefined,
          );
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

  test('retains provenance through a legacy controller wrapper followed by a request-copy wrapper', async () => {
    class HookClient extends OpenAI {
      protected override async fetchWithAuth(
        url: RequestInfo,
        init: RequestInit,
        timeout: number,
        _controller: AbortController,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        return super.fetchWithAuth(url, init, timeout, new AbortController(), schemes);
      }

      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
      ) {
        return super.fetchWithTimeout(url, { ...init }, timeout, controller);
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
  });

  test.each(['default', 'custom', 'reset'] as const)(
    'refreshes rejected workload credentials through a %s fetch clone',
    async (mode) => {
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return authorizations.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      vi.stubGlobal('fetch', transport.fetch);
      const customFetch: Fetch = (url, init) => transport.fetch(url, init);
      const parent = new OpenAI({
        ...createTestClientOptions(),
        maxRetries: 0,
        ...(mode === 'reset' ? { fetch: customFetch } : {}),
      });
      const cloneOptions = {
        default: {},
        custom: { fetch: customFetch },
        reset: { fetch: undefined },
      };
      const client = parent.withOptions(cloneOptions[mode]);

      await client.models.list();

      expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    },
  );

  test.each(['direct', 'wrapped'] as const)(
    'forwards the same materialized header snapshot after a hook supplies a %s iterator',
    async (kind) => {
      class HookClient extends OpenAI {
        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
        ) {
          const iterator = new Headers(init?.headers).entries();
          const headers = (kind === 'direct'
            ? iterator
            : { [Symbol.iterator]: () => iterator }) as unknown as NonNullable<HeadersInit>;
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
    },
  );

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
