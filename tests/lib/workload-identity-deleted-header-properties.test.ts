import OpenAI from 'openai';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s retained header property', (layer) => {
  test.each(['delete', 'self-delete', 'nested-self-delete', 'coercion-self-delete', 'replace'] as const)(
    'observes a caller %s across token acquisition and authentication retry',
    async (operation) => {
      const headers: Record<string, string | string[]> = {};
      const read = vi.fn(() => {
        if (operation.endsWith('self-delete')) {
          delete headers['X-Custom'];
        }
        return 'synthetic-original';
      });
      if (operation === 'nested-self-delete') {
        const values = ['synthetic-unused'];
        Object.defineProperty(values, 0, { get: read });
        headers['X-Custom'] = values;
      } else if (operation === 'coercion-self-delete') {
        // Exercise the supported runtime coercion path outside the string-only header type.
        headers['X-Custom'] = { toString: read } as unknown as string;
      } else {
        Object.defineProperty(headers, 'X-Custom', { configurable: true, enumerable: true, get: read });
      }
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (operation === 'delete') {
          delete headers['X-Custom'];
        }
        if (operation === 'replace') {
          Object.defineProperty(headers, 'X-Custom', { value: 'synthetic-replacement' });
        }
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const actual = new Headers(init?.headers);
        sent.push(actual.get('X-Custom'));
        authorizations.push(actual.get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
          : Response.json({ data: [] });
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

      const expected = {
        delete: null,
        'self-delete': 'synthetic-original',
        'nested-self-delete': 'synthetic-original',
        'coercion-self-delete': 'synthetic-original',
        replace: 'synthetic-replacement',
      }[operation];
      expect(sent).toEqual([expected, expected]);
      expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});

test.each([false, true])(
  'retains a successful getter read when post-read inspection is blocked (self-removal: %s)',
  async (selfRemoves) => {
    const read = vi.fn(() => 'synthetic-original');
    let inspections = 0;
    const headers = new Proxy(
      {
        get 'X-Custom'() {
          if (selfRemoves) {
            Reflect.deleteProperty(headers, 'X-Custom');
          }
          return read();
        },
      },
      {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'X-Custom') {
            inspections += 1;
          }
          if (key === 'X-Custom' && inspections === 2) {
            throw new Error('Post-read inspection is unavailable');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Custom'));
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers });

    expect(sent).toEqual(['synthetic-original']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);
