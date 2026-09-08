/* oxlint-disable max-classes-per-file -- Independent fixtures exercise request lifecycle boundaries. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test('keeps a prepared one-shot request identical through delegated transport hooks', async () => {
  const requests = new WeakSet<object>();
  let reads = 0;
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      const [request] = args;
      requests.add(request);
      const headers = new Headers(request.headers);
      request.headers = (function* requestHeaders() {
        reads += 1;
        yield* headers;
      })() as unknown as Headers;
      return super.prepareRequest(...args);
    }
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      expect(requests.has(args[1])).toBe(true);
      expect(reads).toBe(0);
      return super.fetchWithAuth(...args);
    }
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      expect(args[1] && requests.has(args[1])).toBe(true);
      expect(reads).toBe(0);
      return super.fetchWithTimeout(...args);
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });
  await client.models.list();
  expect(reads).toBe(1);
});

test.each([
  ['prepareRequest', 'record'],
  ['prepareRequest', 'array'],
  ['fetchWithAuth', 'record'],
  ['fetchWithAuth', 'array'],
] as const)('reads a one-shot %s %s only at final dispatch', async (hook, shape) => {
  let reads = 0;
  const install = (request: RequestInit) => {
    const entries = Object.fromEntries(new Headers(request.headers));
    entries['x-review'] = 'constant-marker';
    request.headers =
      shape === 'record'
        ? new Proxy(entries, {
            get(target, key, receiver) {
              if (key === 'x-review') {
                reads += 1;
                if (reads > 1) {
                  throw new Error('ordinary header read more than once');
                }
              }
              return Reflect.get(target, key, receiver);
            },
          })
        : Object.entries(entries).map((row) =>
            row[0] === 'x-review'
              ? new Proxy(row, {
                  get(target, key, receiver) {
                    if (key === '1') {
                      reads += 1;
                      if (reads > 1) {
                        throw new Error('ordinary header read more than once');
                      }
                    }
                    return Reflect.get(target, key, receiver);
                  },
                })
              : row,
          );
  };
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      await super.prepareRequest(...args);
      if (hook === 'prepareRequest') {
        install(args[0]);
      }
    }
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      if (hook === 'fetchWithAuth') {
        install(args[1]);
      }
      return super.fetchWithAuth(...args);
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Review')).toBe('constant-marker');
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list();

  expect(reads).toBe(1);
});

test.each([
  ['record', 'independent', 'in place'],
  ['record', 'independent', 'original'],
  ['record', 'missing', 'in place'],
  ['record', 'missing', 'original'],
  ['array', 'independent', 'in place'],
  ['array', 'independent', 'original'],
  ['array', 'missing', 'in place'],
  ['array', 'missing', 'original'],
] as const)(
  'does not restore workload ownership after a %s Authorization starts %s and returns %s',
  async (shape, initial, restoration) => {
    let original: Headers | undefined;
    let ownedAuthorization: string | null = null;
    let record: Record<string, string> = {};
    let rows: [string, string][] = [];
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        original = request.headers as Headers;
        ownedAuthorization = original.get('Authorization');
        record = Object.fromEntries(original);
        if (initial === 'independent') {
          record['authorization'] = 'Bearer independent';
        } else {
          Reflect.deleteProperty(record, 'authorization');
        }
        rows = Object.entries(record);
        request.headers = shape === 'record' ? record : rows;
      }
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (!original || !ownedAuthorization) {
          throw new Error('Expected prepared workload headers');
        }
        if (restoration === 'original') {
          args[1].headers = original;
        } else if (shape === 'record') {
          record['authorization'] = ownedAuthorization;
        } else {
          const authorization = rows.find(([name]) => name === 'authorization');
          if (authorization) {
            authorization[1] = ownedAuthorization;
          } else {
            rows.push(['authorization', ownedAuthorization]);
          }
        }
        return super.fetchWithAuth(...args);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('retains workload ownership for a structurally forwarded credential with HTTP whitespace', async () => {
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      await super.prepareRequest(...args);
      const [request] = args;
      const record = Object.fromEntries(new Headers(request.headers));
      record['authorization'] = ` \t${record['authorization']}\t `;
      request.headers = record;
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return sends === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list();

  expect(sends).toBe(2);
  expect(transport.exchanges).toBe(2);
});

test.each(['data', 'accessor', 'array'] as const)(
  'retains workload ownership for a non-enumerable Authorization %s property',
  async (kind) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        const authorization = new Headers(request.headers).get('Authorization');
        request.headers = Object.create(null, {
          Authorization:
            kind === 'accessor'
              ? { get: () => authorization }
              : { value: kind === 'array' ? [authorization] : authorization },
        }) as Headers;
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return sends === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list();

    expect(sends).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);

test.each(['record', 'array'] as const)(
  'does not let an unrelated %s accessor hide an independent Authorization',
  async (shape) => {
    let authorization = '';
    let record: Record<string, string> = {};
    let rows: [string, string][] = [];
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        authorization = new Headers(request.headers).get('Authorization') ?? '';
        record = { Authorization: 'Bearer independent' };
        Object.defineProperty(record, 'X-Note', {
          enumerable: true,
          get: () => 'marker',
        });
        const note = ['X-Note', 'unused'] as [string, string];
        Object.defineProperty(note, '1', { get: () => 'marker' });
        rows = [['Authorization', 'Bearer independent'], note];
        request.headers = shape === 'record' ? record : rows;
      }
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (shape === 'record') {
          record['Authorization'] = authorization;
        } else {
          const [row] = rows;
          if (!row) {
            throw new Error('Expected an Authorization row');
          }
          row[1] = authorization;
        }
        return super.fetchWithAuth(...args);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sends += 1;
      expect(new Headers(init?.headers).get('X-Note')).toBe('marker');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('does not restore workload ownership after removing an independent case alias', async () => {
  let headers: Record<string, string> = {};
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      await super.prepareRequest(...args);
      const [request] = args;
      const original = Object.fromEntries(new Headers(request.headers));
      headers = {
        ...original,
        Authorization: 'Bearer independent',
        authorization: original['authorization'] ?? '',
      };
      request.headers = headers;
    }
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      Reflect.deleteProperty(headers, 'Authorization');
      return super.fetchWithAuth(...args);
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

  expect(sends).toBe(1);
  expect(transport.exchanges).toBe(1);
});

test.each([
  ['record', 'direct'],
  ['record', 'nested'],
  ['array', 'direct'],
  ['array', 'nested'],
] as const)(
  'defers a %s Authorization array with %s custom coercion until dispatch',
  async (shape, nesting) => {
    let coercions = 0;
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        const authorization = new Headers(request.headers).get('Authorization');
        if (!authorization) {
          throw new Error('Expected workload Authorization');
        }
        const coercible = ['unused'];
        Object.defineProperty(coercible, 'toString', {
          configurable: true,
          get() {
            coercions += 1;
            return () => authorization;
          },
        });
        const value = nesting === 'direct' ? coercible : [coercible];
        request.headers = (shape === 'record'
          ? { Authorization: value }
          : [['Authorization', value]]) as unknown as NonNullable<RequestInit['headers']>;
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sends += 1;
      expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Bearer access-token-/u);
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(coercions).toBe(2);
    expect(sends).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);

test.each(['accessor', 'data control'] as const)(
  'keeps %s cache consistent with replacement headers',
  async (kind) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        const [request] = args;
        const values = new Headers(request.headers);
        values.set('X-Cache', 'default');
        request.headers = {
          *[Symbol.iterator]() {
            yield* values;
          },
        } as unknown as Headers;
        if (kind === 'accessor') {
          Object.defineProperty(request, 'cache', {
            enumerable: true,
            get(this: RequestInit) {
              return new Headers(this.headers).get('X-Cache');
            },
          });
        } else {
          request.cache = 'default';
        }
        return super.prepareRequest(...args);
      }
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const [, init] = args;
        init.headers = new Headers(init.headers);
        init.headers.set('X-Cache', 'no-store');
        if (kind === 'data control') {
          init.cache = 'no-store';
        }
        return super.fetchWithAuth(...args);
      }
    }
    const transport = createWorkloadIdentityTransport((url, init) => {
      const request = new Request(String(url), init);
      expect(request.headers.get('X-Cache')).toBe('no-store');
      expect(request.cache).toBe('no-store');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
  },
);

test.each(['inherited', 'non-enumerable', 'enumerable control'] as const)(
  'preserves %s fields in an independent build with structural headers',
  async (kind) => {
    const controller = new AbortController();
    const fields = { method: 'PUT', body: '{"value":1}', signal: controller.signal };
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture constructs an independent request.
      override async buildRequest() {
        const req = Object.create(kind === 'inherited' ? fields : Object.prototype) as RequestInit & {
          headers: Headers;
        };
        if (kind !== 'inherited') {
          for (const [name, value] of Object.entries(fields)) {
            Object.defineProperty(req, name, { value, enumerable: kind === 'enumerable control' });
          }
        }
        const values = new Headers({ Authorization: 'Bearer independent' });
        req.headers = (function* headers() {
          yield* values;
        })() as unknown as Headers;
        return { req, url: 'https://api.openai.com/v1/synthetic', timeout: 1000 };
      }
    }
    const transport = createWorkloadIdentityTransport(async (url, init) => {
      const request = new Request(String(url), init);
      expect(request.method).toBe('PUT');
      expect(await request.json()).toEqual({ value: 1 });
      controller.abort('synthetic cancellation');
      expect(init?.signal?.aborted).toBe(true);
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
    expect(transport.exchanges).toBe(0);
  },
);
