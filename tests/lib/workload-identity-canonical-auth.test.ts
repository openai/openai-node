/* oxlint-disable max-classes-per-file -- Independent fixtures exercise authentication hook boundaries. */
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('Canonical workload authentication inputs', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each(['record', 'native', 'tuples', 'mixed'] as const)(
    'derives POST authentication from refreshed %s headers without rereading retained values',
    async (kind) => {
      const retainedValue = vi.fn(() => 'retained');
      const record = { 'X-Derive': 'initial' };
      if (kind === 'mixed') {
        Object.defineProperty(record, 'X-Retained', { enumerable: true, get: retainedValue });
      }
      const tuple: [string, string] = ['X-Derive', 'initial'];
      const tuples = [tuple];
      const native = new Headers({ 'X-Derive': 'initial' });
      const headers = { record, native, tuples, mixed: record }[kind];
      class AuthClient extends OpenAI {
        // oxlint-disable-next-line class-methods-use-this -- This fixture overrides the public request's auth hook.
        protected override async authHeaders(options: FinalRequestOptions) {
          record['X-Derive'] = 'updated';
          native.set('X-Derive', 'updated');
          tuple[1] = 'updated';
          const parsed = buildHeaders([options.headers]);
          return buildHeaders([{ Authorization: `Bearer ${parsed.values.get('X-Derive')}` }]);
        }
      }
      const sent: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        return Response.json({ id: 'synthetic-completion', choices: [] });
      });
      const client = new AuthClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await client.chat.completions.create({ model: 'synthetic-model', messages: [] }, { headers });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.get('Authorization')).toBe('Bearer updated');
      expect(sent[0]?.get('X-Derive')).toBe('updated');
      expect(transport.exchanges).toBe(0);
      if (kind === 'mixed') {
        expect(retainedValue).toHaveBeenCalledTimes(1);
        expect(sent[0]?.get('X-Retained')).toBe('retained');
      }
    },
  );

  describe.each(['authHeaders', 'bearerAuth'] as const)('%s recovery', (hook) => {
    test.each(['method', 'accessor', 'iterator', 'frozen-iterator'] as const)(
      'uses native storage without invoking a replaced get %s',
      async (kind) => {
        const read = vi.fn(() => {
          throw new Error('Synthetic overridden get must not run');
        });
        const replaceReader = (headers: ReturnType<typeof buildHeaders>) => {
          const values = new Headers(headers.values);
          if (kind === 'iterator' || kind === 'frozen-iterator') {
            const iterator = values.entries();
            Object.defineProperty(values, Symbol.iterator, { value: () => iterator });
          }
          Object.defineProperty(values, 'get', {
            configurable: true,
            ...(kind === 'accessor' ? { get: read } : { value: read }),
          });
          const result = { ...headers, values };
          return kind === 'frozen-iterator' ? Object.freeze(result) : result;
        };
        class AuthClient extends OpenAI {
          protected override async authHeaders(
            options: FinalRequestOptions,
            schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
            context?: object,
          ) {
            const headers = await super.authHeaders(options, schemes, context);
            return headers && hook === 'authHeaders' ? replaceReader(headers) : headers;
          }
          protected override async bearerAuth(options: FinalRequestOptions, context?: object) {
            const headers = await super.bearerAuth(options, context);
            return headers && hook === 'bearerAuth' ? replaceReader(headers) : headers;
          }
        }
        const sent: Headers[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          sent.push(new Headers(init?.headers));
          return sent.length === 1
            ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new AuthClient({
          ...createTestClientOptions(),
          fetch: transport.fetch,
          maxRetries: 0,
        });

        await client.models.list();

        expect(sent.map((headers) => headers.get('Authorization'))).toEqual([
          'Bearer access-token-1',
          'Bearer access-token-2',
        ]);
        expect(transport.exchanges).toBe(2);
        expect(read).not.toHaveBeenCalled();
      },
    );
  });

  test.for(
    (['divergent', 'throwing'] as const).flatMap((kind) =>
      [false, true].map((matchesToken) => ({ kind, matchesToken })),
    ),
  )('serializes structural auth without calling its get method: %j', async ({ kind, matchesToken }) => {
    let reads = 0;
    let iterations = 0;
    const StructuralHeaders = class Headers {
      // oxlint-disable-next-line class-methods-use-this -- This fixture has an untrusted reader.
      get() {
        reads += 1;
        if (kind === 'throwing') {
          throw new Error('Structural get must not run');
        }
        return 'Bearer access-token-1';
      }
      // oxlint-disable-next-line class-methods-use-this -- This fixture has a counted serialization.
      *entries() {
        iterations += 1;
        yield ['Authorization', matchesToken ? 'Bearer access-token-1' : 'Bearer independent'];
      }
    };
    Object.defineProperties(StructuralHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: StructuralHeaders.prototype.entries },
    });
    class AuthClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        // The public hook accepts a platform-shaped foreign Headers collection at runtime.
        return headers && { ...headers, values: new StructuralHeaders() as unknown as Headers };
      }
    }
    const sent: Headers[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers));
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new AuthClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sent.map((headers) => headers.get('Authorization'))).toEqual([
      matchesToken ? 'Bearer access-token-1' : 'Bearer independent',
    ]);
    expect(transport.exchanges).toBe(1);
    expect(reads).toBe(0);
    expect(iterations).toBe(1);
  });
});
