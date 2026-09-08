/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected authentication hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const independentHeaders = (headers: Headers) =>
  buildHeaders([{ Authorization: headers.get('Authorization') }]).values;

const mutator = function mutator(this: Headers, name: string, value: string) {
  return Headers.prototype.set.call(this, name, value);
};

describe('Workload credential ownership after native header mutations', () => {
  test.each(
    (['prepareRequest', 'fetchWithTimeout', 'authHeaders', 'buildRequest'] as const).flatMap((hook) =>
      (['same', 'coerced-name', 'different', 'delete-append'] as const).flatMap((mutation) =>
        [false, true].map((copy) => ({ hook, mutation, copy })),
      ),
    ),
  )('does not refresh an independent overwrite: %j', async ({ hook, mutation, copy }) => {
    const mutate = (headers: Headers) => {
      const authorization = headers.get('Authorization');
      expect(authorization).not.toBeNull();
      if (mutation === 'delete-append') {
        headers.delete('aUtHoRiZaTiOn');
        headers.append('AUTHORIZATION', authorization ?? '');
      } else {
        const name =
          mutation === 'coerced-name'
            ? ({ toString: () => 'aUtHoRiZaTiOn' } as unknown as string)
            : 'aUtHoRiZaTiOn';
        headers.set(name, mutation === 'different' ? 'Bearer independent' : (authorization ?? ''));
      }
      return copy ? new Headers(headers) : headers;
    };
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        if (hook === 'prepareRequest') {
          request.headers = mutate(request.headers as Headers);
        }
      }

      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (hook !== 'authHeaders' || !headers) {
          return headers;
        }
        const values = mutate(headers.values);
        return copy ? buildHeaders([values]) : headers;
      }

      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const result = await super.buildRequest(...args);
        if (hook === 'buildRequest') {
          result.req.headers = mutate(result.req.headers);
        }
        return result;
      }

      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
        context?: object,
      ) {
        if (hook === 'fetchWithTimeout' && init) {
          init.headers = mutate(init.headers as Headers);
        }
        return super.fetchWithTimeout(url, init, timeout, controller, context);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual([mutation === 'different' ? 'Bearer independent' : 'Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
  });

  test.each([
    'untouched',
    'unrelated',
    'copy',
    'failed',
    'borrowed',
    'coercion',
    'coercion-order',
    'coercion-throw',
    'mutator-getter',
  ] as const)('preserves native behavior for %s headers', async (operation) => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        const headers = request.headers as Headers;
        expect(headers).toBeInstanceOf(Headers);
        expect(Object.keys(headers)).toEqual([]);
        if (operation === 'unrelated') {
          headers.set('X-Custom', 'preserved');
          headers.append('X-Custom', 'again');
          headers.delete('X-Absent');
        } else if (operation === 'copy') {
          request.headers = new Headers(headers);
        } else if (operation === 'failed') {
          expect(() => headers.set('Authorization', 'invalid\nvalue')).toThrow(TypeError);
          expect(() => headers.set.call({}, 'Authorization', 'other')).toThrow(TypeError);
          expect(() => Reflect.apply(headers.set, headers, ['Authorization'])).toThrow(TypeError);
          expect(() => headers.set(Symbol('name') as unknown as string, 'other')).toThrow(TypeError);
        } else if (operation === 'borrowed') {
          const independent = new Headers();
          headers.set.call(independent, 'Authorization', 'independent');
          expect(independent.get('Authorization')).toBe('independent');
        } else if (operation === 'coercion') {
          const calls: string[] = [];
          const name = {
            [Symbol.toPrimitive](hint: string) {
              calls.push(hint);
              return 'X-Custom';
            },
          };
          headers.set(name as unknown as string, 'preserved');
          expect(calls).toEqual(['string']);
        } else if (operation === 'coercion-order') {
          const calls: string[] = [];
          const argument = (value: string) => ({
            get [Symbol.toPrimitive]() {
              calls.push(`get ${value}`);
              return (hint: string) => {
                calls.push(`${value} ${hint}`);
                return value;
              };
            },
          });
          headers.set(argument('X-Custom') as unknown as string, argument('preserved') as unknown as string);
          expect(calls).toEqual(['get X-Custom', 'X-Custom string', 'get preserved', 'preserved string']);
        } else if (operation === 'coercion-throw') {
          const failure = new Error('synthetic coercion failure');
          let reads = 0;
          const name = {
            get [Symbol.toPrimitive]() {
              reads += 1;
              throw failure;
            },
          };
          expect(() => headers.set(name as unknown as string, 'other')).toThrow(failure);
          expect(reads).toBe(1);
          expect(() => headers.set.call({}, name as unknown as string, 'other')).toThrow(TypeError);
          expect(reads).toBe(1);
        } else if (operation === 'mutator-getter') {
          Object.defineProperty(headers, 'set', {
            configurable: true,
            get() {
              throw new Error('Uncalled mutator getter must not run');
            },
          });
        }
        Object.freeze(headers);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list();

    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test('does not revoke a simultaneous attempt using the same cached token', async () => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        const headers = request.headers as Headers;
        if (headers.get('X-Synthetic-Request') === 'independent') {
          headers.set('Authorization', headers.get('Authorization') ?? '');
          request.headers = new Headers(headers);
        }
      }
    }
    const sent = new Map<string | null, (string | null)[]>();
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const headers = new Headers(init?.headers);
      const key = headers.get('X-Synthetic-Request');
      const attempts = sent.get(key) ?? [];
      attempts.push(headers.get('Authorization'));
      sent.set(key, attempts);
      return attempts.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const results = await Promise.allSettled([
      client.models.list({ headers: { 'X-Synthetic-Request': 'independent' } }),
      client.models.list({ headers: { 'X-Synthetic-Request': 'sdk' } }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(sent.get('independent')).toEqual(['Bearer access-token-1']);
    expect(sent.get('sdk')).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });

  test.each(['prepareRequest', 'fetchWithAuth', 'bearerAuth'] as const)(
    'retains an independent %s marker across a later native copy',
    async (boundary) => {
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
        protected override async prepareRequest(request: RequestInit) {
          if (boundary === 'prepareRequest') {
            request.headers = independentHeaders(request.headers as Headers);
          }
        }

        protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
          const headers = await super.bearerAuth(...args);
          return boundary === 'bearerAuth' && headers
            ? buildHeaders([independentHeaders(headers.values)])
            : headers;
        }

        protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
          const headers = await super.authHeaders(...args);
          return boundary === 'bearerAuth' && headers ? buildHeaders([new Headers(headers.values)]) : headers;
        }

        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          if (boundary === 'fetchWithAuth') {
            args[1].headers = independentHeaders(args[1].headers as Headers);
          }
          return super.fetchWithAuth(...args);
        }

        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          if (args[1]) {
            args[1].headers = new Headers(args[1].headers);
          }
          return super.fetchWithTimeout(...args);
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

      expect(sent).toEqual(['Bearer access-token-1']);
      expect(transport.exchanges).toBe(1);
    },
  );

  test('observes a native build-result copy before a later hook mutates it', async () => {
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const result = await super.buildRequest(...args);
        result.req.headers = new Headers(result.req.headers);
        return result;
      }

      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        const headers = request.headers as Headers;
        headers.set('Authorization', headers.get('Authorization') ?? '');
      }
    }
    let requests = 0;
    const transport = createWorkloadIdentityTransport(() => {
      requests += 1;
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(requests).toBe(1);
    expect(transport.exchanges).toBe(1);
  });

  test('retains a fresh SDK issuance after an earlier same-byte capability was revoked', async () => {
    class HookClient extends OpenAI {
      protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
        const previous = await super.bearerAuth(...args);
        previous?.values.set('Authorization', previous.values.get('Authorization') ?? '');
        const fresh = await super.bearerAuth(...args);
        previous?.values.set('Authorization', previous.values.get('Authorization') ?? '');
        return fresh;
      }
    }
    let requests = 0;
    const transport = createWorkloadIdentityTransport(() => {
      requests += 1;
      return requests === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
    expect(requests).toBe(2);
    expect(transport.exchanges).toBe(2);
  });

  test.each(['inherited', 'getter', 'nonconfigurable', 'membrane'] as const)(
    'preserves an unobservable %s mutator without enabling refresh',
    async (kind) => {
      class HookClient extends OpenAI {
        protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
          const headers = await super.authHeaders(...args);
          if (!headers) {
            return headers;
          }
          const values = new Headers(headers.values);
          const prototype = Object.create(Headers.prototype);
          if (kind === 'inherited') {
            Object.defineProperty(prototype, 'set', { value: mutator });
          } else if (kind === 'getter') {
            Object.defineProperty(prototype, 'set', {
              get() {
                throw new Error('Uncalled mutator getter must not run');
              },
            });
          } else if (kind === 'nonconfigurable') {
            Object.defineProperty(values, 'set', { value: Headers.prototype.set });
          }
          Object.setPrototypeOf(
            values,
            kind === 'membrane'
              ? new Proxy(prototype, {
                  getOwnPropertyDescriptor() {
                    throw new Error('Uninspectable membrane');
                  },
                })
              : prototype,
          );
          const result = { ...headers, values };
          return result;
        }
      }
      let requests = 0;
      const transport = createWorkloadIdentityTransport(() => {
        requests += 1;
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });
      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(requests).toBe(1);
      expect(transport.exchanges).toBe(1);
    },
  );

  test.for(
    (['native', 'foreign'] as const).flatMap((realm) =>
      (['buildRequest', 'prepareRequest'] as const).flatMap((boundary) =>
        [false, true].map((overwrite) => ({ realm, boundary, overwrite })),
      ),
    ),
  )('tracks SDK-observed platform Headers: %j', async ({ realm, boundary, overwrite }, context) => {
    if (realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24) {
      context.skip();
    }
    const foreign = realm === 'foreign' ? await import('undici') : undefined;
    const HeadersConstructor = foreign?.Headers ?? Headers;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const result = await super.buildRequest(...args);
        if (boundary === 'buildRequest') {
          result.req.headers = new HeadersConstructor(result.req.headers) as unknown as Headers;
        }
        return result;
      }

      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        if (boundary === 'prepareRequest') {
          request.headers = new HeadersConstructor(request.headers) as unknown as Headers;
        }
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request initialization');
        }
        if (overwrite) {
          const headers = request.headers as Headers;
          headers.set('Authorization', headers.get('Authorization') ?? '');
          request.headers = new HeadersConstructor(headers) as unknown as Headers;
        }
        return super.fetchWithTimeout(...args);
      }
    }
    let requests = 0;
    const transport = createWorkloadIdentityTransport(() => {
      requests += 1;
      return requests === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    const independent = overwrite;
    await (independent
      ? expect(client.models.list()).rejects.toMatchObject({ status: 401 })
      : client.models.list());
    expect(requests).toBe(independent ? 1 : 2);
    expect(transport.exchanges).toBe(independent ? 1 : 2);
  });

  test.for(
    (['native', 'foreign'] as const).flatMap((realm) =>
      [null, 'Bearer independent'].map((replacement) => ({ realm, replacement })),
    ),
  )(
    'retains an observed platform replacement before old bytes are restored: %j',
    async ({ realm, replacement }, context) => {
      if (realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24) {
        context.skip();
      }
      const foreign = realm === 'foreign' ? await import('undici') : undefined;
      const HeadersConstructor = foreign?.Headers ?? Headers;
      let previousAuthorization: string | null = null;
      class HookClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
        protected override async prepareRequest(request: RequestInit) {
          previousAuthorization = new Headers(request.headers).get('Authorization');
          request.headers = new HeadersConstructor(
            replacement === null ? {} : { Authorization: replacement },
          ) as unknown as Headers;
        }

        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          const [, request] = args;
          if (!request) {
            throw new Error('Expected request initialization');
          }
          const headers = request.headers as Headers;
          headers.set('Authorization', previousAuthorization ?? '');
          request.headers = new HeadersConstructor(headers) as unknown as Headers;
          return super.fetchWithTimeout(...args);
        }
      }
      let requests = 0;
      const transport = createWorkloadIdentityTransport(() => {
        requests += 1;
        return requests === 1
          ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });
      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(requests).toBe(1);
      expect(transport.exchanges).toBe(1);
    },
  );
});
