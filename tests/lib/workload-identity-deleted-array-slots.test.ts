import OpenAI from 'openai';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s outer array slot', (layer) => {
  test.each([
    'later deletion',
    'self deletion',
    'self deletion during row materialization',
    'replacement after self deletion',
  ] as const)('observes the current row after %s', async (operation) => {
    const target: (string | undefined)[][] = [['Authorization', undefined]];
    let reads = 0;
    const headers = new Proxy(target, {
      get(array, key, receiver) {
        if (key !== '0') {
          return Reflect.get(array, key, receiver);
        }
        reads += 1;
        if (reads === 1) {
          if (operation === 'self deletion during row materialization') {
            const row = ['Authorization', undefined];
            Object.defineProperty(row, 1, {
              get() {
                delete array[0];
              },
            });
            return row;
          }
          if (operation !== 'later deletion') {
            delete array[0];
          }
          return ['Authorization', undefined];
        }
        if (operation.startsWith('self deletion')) {
          throw new Error('Self-removing slot was read twice');
        }
        return ['Authorization', 'Bearer synthetic-independent'];
      },
    });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      if (operation === 'later deletion') {
        delete target[0];
      } else if (operation === 'replacement after self deletion') {
        target[0] = ['Authorization', 'Bearer synthetic-independent'];
      }
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
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

    const request = client.models.list(layer === 'request' ? { headers } : {});
    if (operation.startsWith('self deletion')) {
      await request;
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(reads).toBe(1);
      expect(transport.exchanges).toBe(2);
    } else {
      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(sent).toEqual(['Bearer synthetic-independent']);
      expect(reads).toBe(2);
      expect(transport.exchanges).toBe(1);
    }
  });
});
