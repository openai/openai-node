import OpenAI from 'openai';
import type { HeadersInit } from 'openai/internal/builtin-types';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('Workload identity raw build input retries', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each(['deleting getter', 'deleting coercion', 'nonenumerable tuple', 'inherited value'] as const)(
    'retains the original replayability decision for %s',
    async (kind) => {
      let reads = 0;
      const record: Record<string, unknown> = {};
      const credential = () => {
        reads += 1;
        delete record.Authorization;
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
        record.Authorization = { toString: credential };
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
        record.Authorization = values;
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
});
