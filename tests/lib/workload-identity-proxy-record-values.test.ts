/* oxlint-disable max-classes-per-file -- Each fixture installs its source at a distinct protected hook. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['prepareRequest', 'fetchWithTimeout'] as const)('%s record values', (hook) => {
  test.each(['workload', 'independent'] as const)(
    'dispatches the observed %s value when its descriptor disagrees',
    async (credential) => {
      const reads: number[] = [];
      const supplied: NonNullable<RequestInit['headers']>[] = [];
      const replaceHeaders = (request: RequestInit) => {
        const authorization = new Headers(request.headers).get('Authorization');
        const index = reads.push(0) - 1;
        const headers = new Proxy(
          { Authorization: 'Bearer synthetic-descriptor', 'X-Custom': 'synthetic-preserved' },
          {
            get(target, key, receiver) {
              expect(receiver).toBe(headers);
              if (key !== 'Authorization') {
                return Reflect.get(target, key, receiver);
              }
              reads[index] = (reads[index] ?? 0) + 1;
              if (reads[index] !== 1) {
                throw new Error('Record value was read after materialization');
              }
              return credential === 'workload' ? authorization : 'Bearer synthetic-independent';
            },
          },
        );
        supplied.push(headers);
        request.headers = headers;
      };
      class HookClient extends OpenAI {
        protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
          await super.prepareRequest(...args);
          if (hook === 'prepareRequest') {
            replaceHeaders(args[0]);
          }
        }

        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          if (hook === 'fetchWithTimeout' && args[1]) {
            replaceHeaders(args[1]);
          }
          return super.fetchWithTimeout(...args);
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(init?.headers).not.toBe(supplied[sent.length]);
        const actual = new Headers(init?.headers);
        sent.push(actual.get('Authorization'));
        expect(actual.get('X-Custom')).toBe('synthetic-preserved');
        return sent.length === 1
          ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      const request = client.models.list();
      if (credential === 'independent') {
        await expect(request).rejects.toMatchObject({ status: 401 });
        expect(sent).toEqual(['Bearer synthetic-independent']);
      } else {
        await request;
        expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      }
      expect(reads).toEqual(credential === 'workload' ? [1, 1] : [1]);
      expect(transport.exchanges).toBe(credential === 'workload' ? 2 : 1);
    },
  );
});

test.each(['case aliases', 'array value', 'coercing value'] as const)(
  'preserves native transport serialization for a record with %s',
  async (kind) => {
    const supplied: { source: object; reads: number }[] = [];
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture supplies a protected-hook record.
      protected override async prepareRequest(request: RequestInit) {
        const authorization = new Headers(request.headers).get('Authorization');
        const source = {
          'case aliases': { 'X-Custom': 'synthetic-first', 'x-custom': 'synthetic-second' },
          'array value': { 'X-Custom': ['synthetic-first', 'synthetic-second'] },
          'coercing value': { 'X-Custom': { toString: () => 'synthetic-coerced' } },
        }[kind];
        const state = { source, reads: 0 };
        Object.defineProperty(source, 'Authorization', {
          enumerable: true,
          get() {
            expect(this).toBe(source);
            state.reads += 1;
            return authorization;
          },
        });
        supplied.push(state);
        // Native Headers accepts and coerces these values at the transport boundary.
        request.headers = source as unknown as Record<string, string>;
      }
    }
    const sent: (string | null)[] = [];
    const custom: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const headers = new Headers(init?.headers);
      expect(init?.headers).not.toBe(supplied[sent.length]?.source);
      sent.push(headers.get('Authorization'));
      custom.push(headers.get('X-Custom'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list();

    const expected = {
      'case aliases': 'synthetic-first, synthetic-second',
      'array value': 'synthetic-first,synthetic-second',
      'coercing value': 'synthetic-coerced',
    }[kind];
    expect(custom).toEqual([expected, expected]);
    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(supplied.map((state) => state.reads)).toEqual([1, 1]);
    expect(transport.exchanges).toBe(2);
  },
);

test('preserves native authorization aliases without refreshing their combined credential', async () => {
  const supplied: Record<string, string>[] = [];
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture supplies independent aliases through a hook.
    protected override async prepareRequest(request: RequestInit) {
      const authorization = new Headers(request.headers).get('Authorization');
      if (authorization === null) {
        throw new Error('Expected workload authorization');
      }
      const source = {
        Authorization: 'Bearer synthetic-independent',
        authorization,
      };
      supplied.push(source);
      request.headers = source;
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(init?.headers).toBeInstanceOf(Headers);
    expect(init?.headers).not.toBe(supplied[sent.length]);
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

  expect(sent).toEqual(['Bearer synthetic-independent, Bearer access-token-1']);
  expect(transport.exchanges).toBe(1);
});

test('dispatches the inspected snapshot when a record would change during transport serialization', async () => {
  let inTransport = false;
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture installs a stateful protected-hook input.
    protected override async prepareRequest(request: RequestInit) {
      const authorization = new Headers(request.headers).get('Authorization');
      request.headers = new Proxy(
        { Authorization: 'Bearer synthetic-descriptor' },
        {
          get(target, key, receiver) {
            if (key === 'Authorization') {
              return inTransport ? 'Bearer synthetic-independent' : authorization;
            }
            return Reflect.get(target, key, receiver);
          },
        },
      );
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    inTransport = true;
    try {
      sent.push(new Headers(init?.headers).get('Authorization'));
    } finally {
      inTransport = false;
    }
    return sent.length === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list();

  expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
  expect(transport.exchanges).toBe(2);
});

test.each(['request', 'default'] as const)(
  'retains observed %s record values across authentication and retry',
  async (layer) => {
    let reads = 0;
    const headers = new Proxy(
      { 'X-Custom': 'synthetic-descriptor' },
      {
        get(target, key, receiver) {
          if (key !== 'X-Custom') {
            return Reflect.get(target, key, receiver);
          }
          reads += 1;
          if (reads !== 1) {
            throw new Error('Record value was read after materialization');
          }
          return 'synthetic-observed';
        },
      },
    );
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Custom'));
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

    expect(sent).toEqual(['synthetic-observed', 'synthetic-observed']);
    expect(reads).toBe(1);
    expect(transport.exchanges).toBe(2);
  },
);
