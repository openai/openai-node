import OpenAI from 'openai';
import { vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s replay removal', (layer) => {
  test.each(['external deletion', 'self-removal', 'initial sparse'] as const)(
    'handles an outer accessor after %s',
    async (operation) => {
      const headers = [['Authorization', 'Bearer synthetic-independent']];
      const read = vi.fn(() => {
        if (operation === 'self-removal') {
          delete headers[0];
        }
        return ['Authorization', 'Bearer synthetic-independent'];
      });
      if (operation === 'initial sparse') {
        delete headers[0];
      } else {
        Object.defineProperty(headers, 0, { configurable: true, get: read });
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        delete headers[0];
        return sent.length < 3
          ? Response.json({}, { status: 500, headers: { 'retry-after-ms': '0' } })
          : Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        maxRetries: 2,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
      });
      const request = client.models.list(layer === 'request' ? { headers } : {});
      if (operation === 'initial sparse') {
        await expect(request).rejects.toBeInstanceOf(TypeError);
        expect(sent).toEqual([]);
      } else {
        await request;
        const retried =
          operation === 'external deletion' ? 'Bearer access-token-1' : 'Bearer synthetic-independent';
        expect(sent).toEqual(['Bearer synthetic-independent', retried, retried]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(transport.exchanges).toBe(operation === 'external deletion' ? 1 : 0);
      }
    },
  );

  test.each(['duplicate', 'unrelated'] as const)(
    'invalidates nested coercion after removing %s',
    async (removed) => {
      const coerce = vi.fn(() => (coerce.mock.calls.length === 1 ? 'A' : 'B'));
      const shared = { toString: coerce } as unknown as string;
      const values = [shared, shared];
      if (removed === 'unrelated') {
        values.push('unrelated');
      }
      const headers = { 'X-Custom': values };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('X-Custom'));
        if (sent.length === 1) {
          if (removed === 'duplicate') {
            values.shift();
          } else {
            values.pop();
          }
          return Response.json({}, { status: 500, headers: { 'retry-after-ms': '0' } });
        }
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        maxRetries: 1,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
      });
      await client.models.list(layer === 'request' ? { headers } : {});
      expect(sent).toEqual(removed === 'duplicate' ? ['A, B', 'B'] : ['A, B, unrelated', 'A, B']);
      expect(coerce).toHaveBeenCalledTimes(removed === 'duplicate' ? 3 : 2);
    },
  );
});
