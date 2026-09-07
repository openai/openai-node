/* oxlint-disable max-classes-per-file -- Independent fixtures exercise copying build hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { HeadersInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('Workload identity raw build input retries', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test('preserves legacy buildRequest wrappers that copy options and pass only retryCount', async () => {
    class HookClient extends OpenAI {
      override async buildRequest(
        options: FinalRequestOptions,
        { retryCount = 0 }: { retryCount?: number } = {},
      ) {
        await Promise.resolve();
        const result = await super.buildRequest({ ...options }, { retryCount });
        const carriers = Object.getOwnPropertySymbols(result.req).map(
          (key) => Object.getOwnPropertyDescriptor(result.req, key)?.value,
        );
        expect(carriers).toEqual([{}]);
        result.req.headers = new Headers(result.req.headers);
        return { ...result, req: { ...result.req, headers: new Headers(result.req.headers) } };
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

  test.each(
    [null, '', 'Bearer independent'].flatMap((authorization) =>
      [false, true].flatMap((forwardContext) =>
        [false, true].map((canonical) => ({ authorization, forwardContext, canonical })),
      ),
    ),
  )(
    'fails closed when a buildRequest wrapper drops one-shot credential state: %j',
    async ({ authorization, forwardContext, canonical }) => {
      class OneShotHeaders {
        private rows = [['Authorization', authorization] as const][Symbol.iterator]();
        private authorization = authorization;

        entries() {
          return this.rows;
        }

        get() {
          return this.authorization;
        }
      }
      Object.defineProperties(OneShotHeaders.prototype, {
        [Symbol.toStringTag]: { value: 'Headers' },
        [Symbol.iterator]: { value: OneShotHeaders.prototype.entries },
        constructor: {
          // oxlint-disable-next-line prefer-arrow-callback -- A constructor-shaped fixture needs a prototype.
          value: Object.defineProperty(function Headers() {}, 'prototype', {
            value: OneShotHeaders.prototype,
          }),
        },
      });
      class ReconstructingClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const [options, settings] = args;
          const headers = canonical
            ? buildHeaders([options.headers])
            : new Headers(options.headers as HeadersInit);
          const built = await super.buildRequest(
            { ...options, headers },
            forwardContext ? settings : { retryCount: settings?.retryCount ?? 0 },
          );
          return { ...built, req: Object.fromEntries(Object.entries(built.req)) } as typeof built;
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ error: 'synthetic retry' }, { status: 500 });
      });
      const client = new ReconstructingClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 1,
      });

      await expect(
        client.models.list({ headers: new OneShotHeaders() as unknown as Headers }),
      ).rejects.toThrow('must retain');

      expect(sent).toEqual([authorization === null && !canonical ? 'null' : authorization]);
      expect(transport.exchanges).toBe(0);
    },
  );

  test.each(['request', 'default'] as const)(
    'preserves one-shot %s authorization through a legacy copied buildRequest wrapper',
    async (location) => {
      class HookClient extends OpenAI {
        override async buildRequest(
          options: FinalRequestOptions,
          { retryCount = 0 }: { retryCount?: number } = {},
        ) {
          await Promise.resolve();
          return super.buildRequest({ ...options }, { retryCount });
        }
      }
      const rows: [string, string | null][] = [['Authorization', null]];
      const iterator = rows.values();
      rows[Symbol.iterator] = () => iterator;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        return Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        defaultHeaders: location === 'default' ? rows : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list({ headers: location === 'request' ? rows : undefined });

      expect(transport.exchanges).toBe(0);
    },
  );

  test.each(
    [false, true].flatMap((copy) =>
      [false, true].flatMap((forward) =>
        [false, true].flatMap((frozen) =>
          [null, '', 'Bearer independent'].flatMap((authorization) =>
            [false, true].map((foreign) => ({ copy, forward, frozen, authorization, foreign })),
          ),
        ),
      ),
    ),
  )(
    'preserves header ownership through legacy buildRequest: %j',
    async ({ copy, forward, frozen, authorization, foreign }) => {
      class LegacyClient extends OpenAI {
        override async buildRequest(
          options: FinalRequestOptions,
          { retryCount = 0, credentialContext }: { retryCount?: number; credentialContext?: object } = {},
        ) {
          return super.buildRequest(copy ? { ...options } : options, {
            retryCount,
            ...(forward ? { credentialContext } : undefined),
          });
        }
      }
      const rows = [['Authorization', authorization] as const][Symbol.iterator]();
      const ForeignHeaders = class Headers {
        // oxlint-disable-next-line class-methods-use-this -- A fresh wrapper intentionally shares the outer cursor.
        *entries() {
          yield ['X-Custom', 'fixed'];
          yield* rows;
        }
      };
      Object.defineProperties(ForeignHeaders.prototype, {
        [Symbol.toStringTag]: { value: 'Headers' },
        [Symbol.iterator]: { value: ForeignHeaders.prototype.entries },
      });
      const headers = (foreign
        ? new ForeignHeaders()
        : { [Symbol.iterator]: () => rows }) as unknown as Headers;
      let calls = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new LegacyClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 0,
      });

      const options: FinalRequestOptions = {
        method: 'get',
        path: 'https://independent.example.test/synthetic',
        headers,
      };
      const request = client.request(frozen ? Object.freeze(options) : options);
      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(calls).toBe(1);
      expect(transport.exchanges).toBe(0);
    },
  );

  test('releases consumed-source guards after a nested build and body serialization throw', async () => {
    let rows = [['Authorization', null] as const][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    const transport = createWorkloadIdentityTransport(() => {
      throw new Error('The guarded request must not dispatch');
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    const options: FinalRequestOptions = { method: 'post', path: '/synthetic', headers };
    let nested: Promise<unknown> | undefined;
    options.body = {
      toJSON() {
        nested = (async () => {
          try {
            return await client.buildRequest({ ...options });
          } catch (error) {
            return error;
          }
        })();
        throw new Error('Synthetic body serialization failure');
      },
    };

    await expect(client.request(options)).rejects.toThrow('Synthetic body serialization failure');
    expect(await nested).toMatchObject({
      message: expect.stringContaining('must forward credentialContext'),
    });
    rows = [['Authorization', null] as const][Symbol.iterator]();
    options.body = { synthetic: true };
    const built = await client.buildRequest(options);
    expect(built.req.headers.get('Authorization')).toBeNull();
    expect(transport.exchanges).toBe(0);
  });

  test.each([false, true])(
    'keeps build hooks first access to one-shot native header copies, context: %s',
    async (forward) => {
      class CopyClient extends OpenAI {
        override async buildRequest(
          options: FinalRequestOptions,
          settings: { retryCount?: number; credentialContext?: object } = {},
        ) {
          return super.buildRequest(
            { ...options, headers: new Headers(options.headers as HeadersInit) },
            forward ? settings : { retryCount: settings.retryCount ?? 0 },
          );
        }
      }
      const rows = [['Authorization', ''] as const][Symbol.iterator]();
      const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('');
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await expect(
        client.get('https://independent.example.test/synthetic', { headers }),
      ).rejects.toMatchObject({ status: 401 });
      expect(transport.exchanges).toBe(0);
    },
  );

  test.each([
    'record',
    'Headers',
    'array',
    'one-shot object',
    'one-shot array',
    'retained one-shot',
  ] as const)('retries copied build header inputs only when replayable or retained: %s', async (kind) => {
    class OneShotHeaders extends Array<[string, string]> {
      private iterator = super[Symbol.iterator]();
      override [Symbol.iterator]() {
        return this.iterator;
      }
    }
    class CopyClient extends OpenAI {
      override async buildRequest(
        options: FinalRequestOptions,
        settings: { retryCount?: number; credentialContext?: object } = {},
      ) {
        const headers = new Headers(options.headers as HeadersInit);
        if (kind === 'retained one-shot') {
          options.headers = headers;
        }
        return super.buildRequest({ ...options, headers }, settings);
      }
    }
    const rows: [string, string][] = [['Authorization', '']];
    const iterator = rows[Symbol.iterator]();
    let headers: HeadersInit;
    if (kind === 'record') {
      headers = { Authorization: '' };
    } else if (kind === 'Headers') {
      headers = new Headers(rows);
    } else if (kind === 'array') {
      headers = rows;
    } else if (kind === 'one-shot array') {
      headers = new OneShotHeaders(...rows);
    } else {
      headers = { [Symbol.iterator]: () => iterator } as unknown as Headers;
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('');
      return calls === 1
        ? Response.json({ error: 'synthetic retry' }, { status: 500 })
        : Response.json({ data: [] });
    });
    const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });
    const request = client.get('https://independent.example.test/synthetic', { headers });
    if (kind === 'one-shot object' || kind === 'one-shot array') {
      await expect(request).rejects.toThrow('must retain parsed headers');
      expect(calls).toBe(1);
    } else {
      await request;
      expect(calls).toBe(2);
    }
    expect(transport.exchanges).toBe(0);
  });

  test('releases copied-header recovery after a legacy request completes', async () => {
    class LegacyClient extends OpenAI {
      override async buildRequest(options: FinalRequestOptions, { retryCount = 0 } = {}) {
        return super.buildRequest({ ...options }, { retryCount });
      }
    }
    let rows = [['Authorization', null] as const][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    const transport = createWorkloadIdentityTransport(() => Response.json({ data: [] }));
    const client = new LegacyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    const options: FinalRequestOptions = { method: 'get', path: '/synthetic', headers };

    await client.request(options);
    rows = [['Authorization', null] as const][Symbol.iterator]();
    const built = await client.buildRequest(options);

    expect(built.req.headers.get('Authorization')).toBeNull();
    expect(transport.exchanges).toBe(0);
  });

  test.each(['authentication', 'build'] as const)(
    'does not assign shared defaults to an unrelated nested %s build',
    async (hook) => {
      let nested = false;
      class AuthClient extends OpenAI {
        protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
          if (hook === 'authentication' && !nested) {
            nested = true;
            await this.buildRequest({ method: 'get', path: '/nested', headers: { 'X-Nested': 'yes' } });
          }
          return super.authHeaders(...args);
        }
      }
      class BuildClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          if (!nested) {
            nested = true;
            await super.buildRequest({ method: 'get', path: '/nested', headers: { 'X-Nested': 'yes' } });
          }
          return super.buildRequest(...args);
        }
      }
      const rows = [['Authorization', null] as const][Symbol.iterator]();
      const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        return Response.json({ data: [] });
      });
      const Client = hook === 'authentication' ? AuthClient : BuildClient;
      const client = new Client({
        ...createTestClientOptions(),
        defaultHeaders: { 'X-Default': 'shared' },
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.post('https://independent.example.test/synthetic', { body: { synthetic: true }, headers });
      expect(nested).toBe(true);
    },
  );

  test.each(['deleting getter', 'deleting coercion', 'nonenumerable tuple', 'inherited value'] as const)(
    'does not upgrade credentials after a custom retry of %s',
    async (kind) => {
      let reads = 0;
      const record: Record<string, unknown> = {};
      const credential = () => {
        reads += 1;
        delete record['Authorization'];
        return 'Bearer independent';
      };
      let input: unknown = record;
      if (kind === 'deleting getter') {
        Object.defineProperty(record, 'Authorization', {
          enumerable: true,
          configurable: true,
          get: credential,
        });
      } else if (kind === 'deleting coercion') {
        record['Authorization'] = { toString: credential };
      } else if (kind === 'nonenumerable tuple') {
        const row: unknown[] = ['Authorization'];
        Object.defineProperty(row, '1', { value: { toString: credential }, enumerable: false });
        input = [row];
      } else {
        const values: unknown[] = [];
        values.length = 1;
        const prototype = Object.create(Array.prototype);
        Object.defineProperty(prototype, '0', { get: credential });
        Object.setPrototypeOf(values, prototype);
        record['Authorization'] = values;
      }
      class CopyClient extends OpenAI {
        override async buildRequest(
          options: FinalRequestOptions,
          settings: Parameters<OpenAI['buildRequest']>[1] = {},
        ) {
          return super.buildRequest(
            { ...options, headers: new Headers(options.headers as HeadersInit) },
            settings,
          );
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ error: 'synthetic retry' }, { status: 500 });
      });
      const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });

      const request = client.models.list({ headers: input as HeadersInit });
      if (kind === 'nonenumerable tuple') {
        await expect(request).rejects.toMatchObject({ status: 500 });
        expect(sent).toEqual(['Bearer independent', 'Bearer independent']);
        expect(reads).toBe(2);
      } else {
        await expect(request).rejects.toThrow('must retain parsed headers');
        expect(sent).toEqual(['Bearer independent']);
        expect(reads).toBe(1);
      }
      expect(transport.exchanges).toBe(0);
    },
  );
  describe.each(['native', 'foreign'] as const)('copied %s Headers', (kind) => {
    test.skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24).each([
      ['independent', 500],
      ['workload', 401],
    ] as const)('retries %s credentials after %s', async (credential, status) => {
      const implementation = kind === 'foreign' ? await import('undici') : { Headers };
      const headers = new implementation.Headers(
        credential === 'independent' ? { Authorization: 'Bearer independent' } : undefined,
      );
      class CopyClient extends OpenAI {
        override async buildRequest(
          options: FinalRequestOptions,
          settings: Parameters<OpenAI['buildRequest']>[1] = {},
        ) {
          return super.buildRequest(
            { ...options, headers: new Headers(options.headers as HeadersInit) },
            settings,
          );
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: 'synthetic retry' }, { status })
          : Response.json({ data: [] });
      });
      const client = new CopyClient({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: status === 500 ? 1 : 0,
      });

      await client.models.list({ headers });

      expect(sent).toEqual(
        credential === 'independent'
          ? ['Bearer independent', 'Bearer independent']
          : ['Bearer access-token-1', 'Bearer access-token-2'],
      );
      expect(transport.exchanges).toBe(credential === 'independent' ? 0 : 2);
    });
  });

  test('rejects a retry after a Headers-shaped one-shot build input is consumed', async () => {
    class SpoofedHeaders {
      private readonly rows = [['Authorization', 'Bearer independent'] as const].values();

      entries() {
        return this.rows;
      }

      // oxlint-disable-next-line class-methods-use-this -- A spoofed platform getter returns its fixed credential.
      get() {
        return 'Bearer independent';
      }
    }
    Object.defineProperties(SpoofedHeaders.prototype, {
      [Symbol.iterator]: { value: SpoofedHeaders.prototype.entries },
      [Symbol.toStringTag]: { value: 'Headers' },
      constructor: {
        // oxlint-disable-next-line prefer-arrow-callback -- The platform classifier requires a prototype-owning constructor.
        value: Object.defineProperty(function Headers() {}, 'prototype', {
          value: SpoofedHeaders.prototype,
        }),
      },
    });
    class CopyClient extends OpenAI {
      override async buildRequest(
        options: FinalRequestOptions,
        settings: Parameters<OpenAI['buildRequest']>[1] = {},
      ) {
        return super.buildRequest(
          { ...options, headers: new Headers(options.headers as HeadersInit) },
          settings,
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic retry' }, { status: 500 });
    });
    const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });

    await expect(client.models.list({ headers: new SpoofedHeaders() as unknown as Headers })).rejects.toThrow(
      'must retain parsed headers',
    );

    expect(sent).toEqual(['Bearer independent']);
    expect(transport.exchanges).toBe(0);
  });
});
