import OpenAI from 'openai';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s header authentication selection', (layer) => {
  describe.each(['Bearer independent', null, ''])('explicit Authorization: %j', (authorization) => {
    test.each([false, true])('aligns authentication with queued override deletion: %s', async (mutate) => {
      const record: Record<string, string | null> = { Authorization: authorization, 'X-Custom': 'preserved' };
      let scheduled = false;
      const headers = new Proxy(record, {
        get(target, key, receiver) {
          if (key === 'Authorization' && mutate && !scheduled) {
            scheduled = true;
            queueMicrotask(() => {
              delete record['Authorization'];
            });
          }
          return Reflect.get(target, key, receiver);
        },
      });
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const actual = new Headers(init?.headers);
        sent.push(actual.get('Authorization'));
        expect(actual.get('X-Custom')).toBe('preserved');
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        maxRetries: 0,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
      });

      await client.models.list(layer === 'request' ? { headers } : {});

      expect(sent).toEqual([mutate ? 'Bearer access-token-1' : authorization]);
      expect(transport.exchanges).toBe(mutate ? 1 : 0);
      expect(scheduled).toBe(mutate);
      expect(Object.getOwnPropertyDescriptor(record, 'Authorization') !== undefined).toBe(!mutate);
    });
  });

  test('still refreshes independent overrides introduced during token acquisition', async () => {
    const headers: Record<string, string> = { 'X-Custom': 'original' };
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers['Authorization'] = 'Bearer replacement';
      headers['X-Custom'] = 'replacement';
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      sent.push(actual.get('Authorization'));
      expect(actual.get('X-Custom')).toBe('replacement');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      workloadIdentity: identity,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
    });

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(sent).toEqual(['Bearer replacement']);
    expect(transport.exchanges).toBe(1);
  });
});
