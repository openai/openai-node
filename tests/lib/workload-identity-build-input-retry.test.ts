/* oxlint-disable max-classes-per-file -- Independent fixtures exercise copying build hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { HeadersInit } from 'openai/internal/builtin-types';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('Workload identity raw build input retries', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
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
    'retains the original replayability decision for %s',
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

      await expect(client.models.list({ headers: input as HeadersInit })).rejects.toThrow(
        'must retain parsed headers',
      );
      expect(sent).toEqual(['Bearer independent']);
      expect(reads).toBe(1);
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
});
