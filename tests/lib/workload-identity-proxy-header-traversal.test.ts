import OpenAI from 'openai';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('%s proxy header traversal', (layer) => {
  describe.each(['matching', 'different', 'shrinking'] as const)(
    'initial array length %s the descriptor',
    (length) => {
      test.each(['throw', 'empty'] as const)(
        'retains the first traversal when a later length read would %s',
        async (behavior) => {
          const rows = [['X-Custom', 'synthetic-original']];
          if (length !== 'matching') {
            rows.push(['X-Hidden', 'synthetic-hidden']);
          }
          let lengthReads = 0;
          const headers = new Proxy(rows, {
            get(target, key, receiver) {
              if (key !== 'length') {
                return Reflect.get(target, key, receiver);
              }
              lengthReads += 1;
              if (lengthReads <= 2) {
                if (length === 'shrinking') {
                  return lengthReads === 1 ? 2 : 0;
                }
                return 1;
              }
              if (behavior === 'throw') {
                throw new Error('Array length was read after its first traversal');
              }
              return 0;
            },
          });
          const sent: (string | null)[] = [];
          const authorizations: (string | null)[] = [];
          const transport = createWorkloadIdentityTransport((_url, init) => {
            const actual = new Headers(init?.headers);
            sent.push(actual.get('X-Custom'));
            authorizations.push(actual.get('Authorization'));
            expect(actual.has('X-Hidden')).toBe(false);
            return sent.length === 1
              ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
              : Response.json({ data: [] });
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

          expect(sent).toEqual(['synthetic-original', 'synthetic-original']);
          expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
          expect(transport.exchanges).toBe(2);
          expect(lengthReads).toBe(2);
        },
      );
    },
  );

  test('retains a length that requires stateful coercion', async () => {
    let coercions = 0;
    const statefulLength = {
      valueOf() {
        coercions += 1;
        if (coercions > 2) {
          throw new Error('Array length was coerced after its first traversal');
        }
        return 1;
      },
    };
    const headers = new Proxy([['X-Custom', 'synthetic-original']], {
      get(target, key, receiver) {
        return key === 'length' ? statefulLength : Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === 'length' ? { ...descriptor, value: statefulLength } : descriptor;
      },
    });
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
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list(layer === 'request' ? { headers } : {});

    expect(sent).toEqual(['synthetic-original', 'synthetic-original']);
    expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
    expect(coercions).toBe(2);
  });

  test.each(
    (['array', 'transparent proxy'] as const).flatMap((kind) =>
      (['append', 'truncate'] as const).map((operation) => ({ kind, operation })),
    ),
  )('reflects an ordinary length change during authentication: %j', async ({ kind, operation }) => {
    const rows = [
      ['X-Custom', 'synthetic-original'],
      ['X-Later', 'synthetic-later'],
    ];
    const headers = kind === 'array' ? rows : new Proxy(rows, {});
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      if (operation === 'append') {
        rows[2] = ['X-Added', 'synthetic-added'];
      } else {
        rows.length = 1;
      }
      return 'subject-token';
    };
    const sent: (string | null)[][] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      sent.push([actual.get('X-Custom'), actual.get('X-Later'), actual.get('X-Added')]);
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

    const expected =
      operation === 'append'
        ? ['synthetic-original', 'synthetic-later', 'synthetic-added']
        : ['synthetic-original', null, null];
    expect(sent).toEqual([expected, expected]);
    expect(transport.exchanges).toBe(2);
  });
});
