import OpenAI from 'openai';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s tuple headers', (layer) => {
  test.each(['during authentication', 'during first read'] as const)(
    'distinguishes value deletion %s',
    async (deletion) => {
      const row: (string | undefined)[] = ['X-Custom', undefined];
      const read = vi.fn(() => {
        if (deletion === 'during first read') {
          delete row[1];
        }
        return 'synthetic-preserved';
      });
      Object.defineProperty(row, 1, { configurable: true, get: read });
      const headers = [row];
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (deletion === 'during authentication') {
          delete row[1];
        }
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('X-Custom'));
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        workloadIdentity: identity,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list(layer === 'request' ? { headers } : {});

      expect(sent).toEqual([deletion === 'during first read' ? 'synthetic-preserved' : null]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(1);
    },
  );

  test('retains a name removed while its value is first materialized', async () => {
    const row: (string | undefined)[] = ['X-Custom', undefined];
    const readName = vi.fn(() => 'X-Custom');
    const readValue = vi.fn(() => {
      delete row[0];
      return 'synthetic-preserved';
    });
    Object.defineProperty(row, 0, { configurable: true, get: readName });
    Object.defineProperty(row, 1, { get: readValue });
    const headers = [row];
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Custom'));
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list(layer === 'request' ? { headers } : {});

    expect(sent).toEqual(['synthetic-preserved']);
    expect(readName).toHaveBeenCalledTimes(1);
    expect(readValue).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  });
});
