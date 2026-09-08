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

test.each(['Bearer', 'bEaReR'] as const)(
  'does not restore dispatch ownership with a %s-scheme structural copy',
  async (scheme) => {
    let ownedAuthorization: string | null = null;
    const record = { Authorization: 'Bearer independent' };
    class HookClient extends OpenAI {
      protected override fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        ownedAuthorization = new Headers(args[1].headers).get('Authorization');
        args[1].headers = record;
        return super.fetchWithAuth(...args);
      }
      override fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (!ownedAuthorization) {
          throw new Error('Expected workload Authorization before dispatch');
        }
        record.Authorization = ownedAuthorization.replace(/^Bearer/u, scheme);
        return super.fetchWithTimeout(...args);
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

test('lets the dispatch snapshot resolve a removed non-enumerable proxy alias', async () => {
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      await super.prepareRequest(...args);
      const [request] = args;
      const record = Object.fromEntries(new Headers(request.headers));
      Object.defineProperty(record, 'Authorization', {
        configurable: true,
        value: 'Bearer synthetic-hidden-metadata',
      });
      request.headers = new Proxy(record, {});
    }

    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      Reflect.deleteProperty(args[1].headers as object, 'Authorization');
      return super.fetchWithAuth(...args);
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

test.each([
  ['record', 'value'],
  ['array', 'value'],
  ['array', 'name'],
  ['array', 'slot'],
  ['array', 'descriptor'],
] as const)(
  'does not let an unrelated %s %s accessor hide an independent Authorization',
  async (shape, accessor) => {
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
        const note = ['X-Note', 'marker'] as [string, string];
        if (accessor !== 'slot' && accessor !== 'descriptor') {
          Object.defineProperty(note, accessor === 'name' ? '0' : '1', {
            get: () => (accessor === 'name' ? 'X-Note' : 'marker'),
          });
        }
        const exposedNote =
          accessor === 'descriptor'
            ? new Proxy(note, {
                getOwnPropertyDescriptor(target, key) {
                  if (key === '0') {
                    throw new Error('unrelated row descriptor unavailable');
                  }
                  return Reflect.getOwnPropertyDescriptor(target, key);
                },
              })
            : note;
        rows = [['Authorization', 'Bearer independent'], exposedNote];
        if (accessor === 'slot') {
          Object.defineProperty(rows, '1', { get: () => note });
        }
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

test.each(['outer', 'row'] as const)(
  'keeps a custom %s array iterator pending until dispatch proves workload ownership',
  async (location) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        const authorization = new Headers(request.headers).get('Authorization') ?? '';
        if (location === 'outer') {
          const rows: [string, string][] = [];
          Reflect.set(rows, Symbol.iterator, function* iterator(): Generator<[string, string], undefined> {
            yield ['Authorization', authorization];
          });
          request.headers = rows;
        } else {
          const row = ['Authorization', 'Bearer independent'] as [string, string];
          Reflect.set(row, Symbol.iterator, function* iterator(): Generator<string, undefined> {
            yield 'Authorization';
            yield authorization;
          });
          request.headers = [row];
        }
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

test.each(['delete', 'undefined'] as const)(
  'revokes workload ownership when request headers become %s before being restored',
  async (kind) => {
    let original: Headers | undefined;
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        original = request.headers as Headers;
        if (kind === 'delete') {
          Reflect.deleteProperty(request, 'headers');
        } else {
          Reflect.set(request, 'headers', undefined);
        }
      }
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (!original) {
          throw new Error('Expected prepared workload headers');
        }
        args[1].headers = original;
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

test('retains workload ownership when a native Request supplies the effective fallback headers', async () => {
  class HookClient extends OpenAI {
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      const [url, init] = args;
      const { headers } = init;
      if (!headers) {
        throw new Error('Expected prepared workload headers');
      }
      args[0] = new Request(url, { headers });
      Reflect.deleteProperty(init, 'headers');
      return super.fetchWithAuth(...args);
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

test.each(['plain', 'private descriptor membrane'] as const)(
  'dispatches an independent %s request without requiring a private carrier',
  async (kind) => {
    let privateProbes = 0;
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- The custom build deliberately avoids SDK provenance.
      override async buildRequest() {
        const request = { method: 'GET', headers: new Headers({ Authorization: 'Bearer independent' }) };
        const req =
          kind === 'plain'
            ? request
            : new Proxy(request, {
                getOwnPropertyDescriptor(target, key) {
                  if (typeof key === 'symbol' && !Reflect.has(target, key)) {
                    privateProbes += 1;
                    throw new Error('Private symbol descriptors are unavailable');
                  }
                  return Reflect.getOwnPropertyDescriptor(target, key);
                },
              });
        return { req, url: 'https://api.openai.com/v1/models', timeout: 1000 };
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sends += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(0);
    expect(privateProbes > 0).toBe(kind !== 'plain');
  },
);

test('does not grant unowned retry provenance when private descriptor lookup fails', async () => {
  const original = [['X-Custom', 'value']];
  const headers = (function* originalHeaders() {
    yield* original;
  })() as unknown as Headers;
  let builds = 0;
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- The custom build deliberately avoids SDK provenance.
    override async buildRequest() {
      builds += 1;
      const req = new Proxy(
        { method: 'GET', headers: new Headers({ Authorization: 'Bearer independent' }) },
        {
          getOwnPropertyDescriptor(target, key) {
            if (typeof key === 'symbol' && !Reflect.has(target, key)) {
              throw new Error('Private symbol descriptors are unavailable');
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      return { req, url: 'https://api.openai.com/v1/models', timeout: 1000 };
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return Response.json({}, { status: 500, headers: { 'retry-after-ms': '0' } });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 1,
  });
  await expect(client.models.list({ headers })).rejects.toThrow(/one-shot source/u);
  expect(builds).toBe(1);
  expect(sends).toBe(1);
  expect(transport.exchanges).toBe(0);
});
