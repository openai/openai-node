/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct protected transport hooks. */
import OpenAI from 'openai';
import { test } from 'vitest';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const lazyHeaders = (request: RequestInit): NonNullable<RequestInit['headers']> => {
  const authorization = new Headers(request.headers).get('Authorization');
  if (authorization === null) {
    throw new Error('Expected workload Authorization');
  }
  return {
    get Authorization() {
      return authorization;
    },
  };
};

const nativeProxyReadable = () => {
  try {
    Headers.prototype.has.call(new Proxy(new Headers(), {}), 'Authorization');
    return true;
  } catch {
    return false;
  }
};

const emptyIterator = function* emptyIterator() {};

test('preserves a private-field accessor receiver while normalizing headers', async () => {
  class WrappedRequest implements RequestInit {
    #method: string;
    headers: NonNullable<RequestInit['headers']>;

    constructor(request: RequestInit) {
      const { method, ...properties } = request;
      Object.assign(this, properties);
      this.#method = method ?? 'GET';
      this.headers = lazyHeaders(request);
    }

    get method() {
      return this.#method;
    }

    set method(value: string) {
      this.#method = value;
    }
  }
  class HookClient extends OpenAI {
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      args[1] = new WrappedRequest(args[1]);
      return super.fetchWithAuth(...args);
    }

    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (!args[1]) {
        throw new Error('Expected normalized request');
      }
      args[1].method = 'PUT';
      return super.fetchWithTimeout(...args);
    }
  }
  const transport = createWorkloadIdentityTransport(async (url, init) => {
    if (!init) {
      throw new Error('Expected request init');
    }
    init.method = 'PUT';
    init.cache = 'no-store';
    Object.freeze(init);
    expect(init.method).toBe('PUT');
    const request = new Request(String(url), init);
    expect(request.method).toBe('PUT');
    expect(request.cache).toBe('no-store');
    expect(await request.json()).toEqual({ value: 1 });
    return Response.json({ ok: true });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { value: 1 } })).resolves.toEqual({ ok: true });
});

test('preserves an own accessor receiver while normalizing prepared headers', async () => {
  const methods = new WeakMap<object, string>();
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      const [request] = args;
      methods.set(request, request.method ?? 'GET');
      Object.defineProperty(request, 'method', {
        enumerable: true,
        configurable: true,
        get() {
          return methods.get(this);
        },
        set(value: string) {
          methods.set(this, value);
        },
      });
      request.headers = lazyHeaders(request);
      return super.prepareRequest(...args);
    }

    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (!args[1]) {
        throw new Error('Expected normalized request');
      }
      args[1].method = 'PUT';
      return super.fetchWithTimeout(...args);
    }
  }
  const transport = createWorkloadIdentityTransport(async (url, init) => {
    const request = new Request(String(url), init);
    expect(request.method).toBe('PUT');
    expect(await request.json()).toEqual({ value: 1 });
    return Response.json({ ok: true });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { value: 1 } })).resolves.toEqual({ ok: true });
});

test.each(['add', 'delete'] as const)(
  'preserves a later data field %s on normalized requests',
  async (change) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        const [request] = args;
        request.headers = lazyHeaders(request);
        if (change === 'delete') {
          request.cache = 'no-store';
        }
        return super.prepareRequest(...args);
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected normalized request');
        }
        if (change === 'add') {
          request.cache = 'no-store';
        } else {
          delete request.cache;
        }
        expect(request.cache).toBe(change === 'add' ? 'no-store' : undefined);
        return super.fetchWithTimeout(...args);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.cache).toBe(change === 'add' ? 'no-store' : undefined);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
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
    expect(transport.exchanges).toBe(1);
  },
);

describe.each(['own accessor', 'data control'] as const)('%s request state', (shape) => {
  test.each(['assignment', 'definition', 'deletion', 'prototype replacement'] as const)(
    'keeps cache consistent with method after %s through normalized headers',
    async (mutation) => {
      class HookClient extends OpenAI {
        protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
          const [request] = args;
          request.headers = lazyHeaders(request);
          request.method = 'GET';
          request.cache = 'default';
          if (shape !== 'data control') {
            const descriptor = {
              configurable: true,
              enumerable: true,
              get(this: RequestInit) {
                return this.method === 'GET' ? 'default' : 'no-store';
              },
            };
            Object.defineProperty(request, 'cache', descriptor);
          }
          return super.prepareRequest(...args);
        }

        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          const [, init] = args;
          if (mutation === 'assignment') {
            init.method = 'PUT';
          } else if (mutation === 'definition') {
            Object.defineProperty(init, 'method', { value: 'PUT' });
          } else {
            delete init.method;
            if (mutation === 'prototype replacement') {
              Object.setPrototypeOf(init, { method: 'PUT' });
            }
          }
          if (shape === 'data control') {
            init.cache = 'no-store';
          }
          Object.freeze(init);
          return super.fetchWithAuth(...args);
        }
      }
      const transport = createWorkloadIdentityTransport((url, init) => {
        expect(init?.cache).toBe('no-store');
        const request = new Request(String(url), init);
        expect(request.method).toBe(mutation === 'deletion' ? 'GET' : 'PUT');
        expect(request.cache).toBe('no-store');
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
      expect(transport.exchanges).toBe(1);
    },
  );
});

test.each(['inherited method', 'non-enumerable method', 'one-read headers'] as const)(
  'preserves %s while normalizing a frozen prepared request',
  async (kind) => {
    let reads = 0;
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        const [request] = args;
        const values = new Headers(request.headers);
        // The platform accepts iterable header pairs beyond the narrower DOM HeadersInit declaration.
        const headers = (function* headers() {
          yield* values;
        })() as unknown as NonNullable<RequestInit['headers']>;
        if (kind === 'inherited method') {
          delete request.method;
          Object.setPrototypeOf(request, { method: 'POST' });
          request.headers = headers;
        } else if (kind === 'non-enumerable method') {
          Object.defineProperty(request, 'method', { value: 'POST', enumerable: false });
          request.headers = headers;
        } else {
          Object.defineProperty(request, 'headers', {
            enumerable: true,
            get() {
              reads += 1;
              if (reads > 1) {
                throw new Error('Prepared header getter was consumed twice');
              }
              return headers;
            },
          });
        }
        Object.freeze(request);
        return super.prepareRequest(...args);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.method).toBe(kind === 'one-read headers' ? 'GET' : 'POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });
    await client.models.list();
    expect(transport.exchanges).toBe(1);
    expect(reads).toBe(kind === 'one-read headers' ? 1 : 0);
  },
);

describe.each(['prepareRequest', 'fetchWithAuth'] as const)('%s immutable dispatch input', (hook) => {
  describe.each(['foreign', 'one-shot'] as const)('%s headers', (kind) => {
    test
      .skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)
      .each(
        (['frozen', 'getter-only'] as const).flatMap((shape) =>
          (['workload', 'independent'] as const).map((credential) => ({ shape, credential })),
        ),
      )(
      'normalizes a $shape request with $credential credentials without mutating it',
      async ({ shape, credential }) => {
        const inputs: { request: RequestInit; headers: NonNullable<RequestInit['headers']> }[] = [];
        let iterations = 0;
        const prepare = async (request: RequestInit) => {
          const values = new Headers(request.headers);
          if (credential === 'independent') {
            values.set('Authorization', 'Bearer independent');
          }
          const foreign = kind === 'foreign' ? await import('undici') : undefined;
          const headers = foreign
            ? new foreign.Headers([...values])
            : (function* headers() {
                iterations += 1;
                yield* values;
              })();
          const supplied = headers as NonNullable<RequestInit['headers']>;
          request.headers = supplied;
          if (shape === 'frozen') {
            Object.freeze(request);
          } else {
            Object.defineProperty(request, 'headers', { get: () => supplied });
          }
          inputs.push({ request, headers: supplied });
        };
        class HookClient extends OpenAI {
          protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
            await super.prepareRequest(...args);
            if (hook === 'prepareRequest') {
              await prepare(args[0]);
            }
          }

          protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
            if (hook === 'fetchWithAuth') {
              await prepare(args[1]);
            }
            return super.fetchWithAuth(...args);
          }
        }
        let sends = 0;
        const transport = createWorkloadIdentityTransport((_url, init) => {
          const original = inputs[sends];
          if (!original) {
            throw new Error('Expected the prepared request');
          }
          expect(original.request.headers).toBe(original.headers);
          expect(init?.headers).toBeInstanceOf(Headers);
          expect(init?.headers).not.toBe(original.headers);
          sends += 1;
          expect(new Headers(init?.headers).get('Authorization')).toBe(
            credential === 'workload' ? `Bearer access-token-${sends}` : 'Bearer independent',
          );
          return sends === 1
            ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          adminAPIKey: null,
          maxRetries: 0,
          fetch: transport.fetch,
        });
        if (credential === 'workload') {
          await client.models.list();
          expect(sends).toBe(2);
        } else {
          await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
          expect(sends).toBe(1);
        }
        expect(transport.exchanges).toBe(sends);
        if (kind === 'one-shot') {
          expect(iterations).toBe(sends);
        }
      },
    );
  });
});

test('materializes a self-deleting header getter before transport dispatch', async () => {
  let reads = 0;
  class HookClient extends OpenAI {
    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, 'Authorization', {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1;
          delete headers['Authorization'];
          return 'Bearer independent';
        },
      });
      args[1].headers = headers;
      return super.fetchWithAuth(...args);
    }
  }
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
  expect(reads).toBe(1);
  expect(calls).toBe(1);
  expect(transport.exchanges).toBe(1);
});

describe.each(['prepareRequest', 'fetchWithTimeout'] as const)('%s header identity', (hook) => {
  describe.each(['record', 'array', 'native', 'foreign'] as const)('%s', (kind) => {
    test.skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)(
      'preserves native identity and dispatches snapshots of other inputs through workload refresh',
      async () => {
        const supplied: NonNullable<RequestInit['headers']>[] = [];
        const retainHeaders = async (request: RequestInit) => {
          const values = new Headers(request.headers);
          let headers: NonNullable<RequestInit['headers']>;
          if (kind === 'foreign') {
            const { Headers: ForeignHeaders } = await import('undici');
            headers = new ForeignHeaders([...values]) as unknown as Headers;
          } else if (kind === 'native') {
            headers = values;
          } else {
            headers = kind === 'record' ? Object.fromEntries(values) : [...values];
          }
          if (kind === 'native' || kind === 'foreign') {
            Object.defineProperty(headers, 'get', {
              get() {
                throw new Error('Shadowed get must not run');
              },
            });
          }
          Object.defineProperty(headers, 'transportMetadata', { value: 'synthetic-extension' });
          supplied.push(headers);
          request.headers = headers;
        };
        class HookClient extends OpenAI {
          protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
            await super.prepareRequest(...args);
            if (hook === 'prepareRequest') {
              await retainHeaders(args[0]);
            }
          }

          override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
            if (hook === 'fetchWithTimeout' && args[1]) {
              await retainHeaders(args[1]);
            }
            // oxlint-disable-next-line unicorn/prefer-at -- Keep indexed access compatible with the repository's ES2020 type library.
            expect(args[1]?.headers).toBe(supplied[supplied.length - 1]);
            expect(Object.getOwnPropertyDescriptor(args[1]?.headers, 'transportMetadata')?.value).toBe(
              'synthetic-extension',
            );
            return super.fetchWithTimeout(...args);
          }
        }
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          if (kind === 'native') {
            expect(init?.headers).toBe(supplied[sent.length]);
            expect(Object.getOwnPropertyDescriptor(init?.headers, 'transportMetadata')?.value).toBe(
              'synthetic-extension',
            );
          } else {
            expect(init?.headers).not.toBe(supplied[sent.length]);
            expect(init?.headers).toBeInstanceOf(Headers);
          }
          sent.push(new Headers(init?.headers).get('Authorization'));
          return sent.length === 1
            ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          adminAPIKey: null,
          maxRetries: 0,
          fetch: transport.fetch,
        });

        await client.models.list();

        expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
        expect(transport.exchanges).toBe(2);
      },
    );
  });
});

test.each(['workload', 'independent'] as const)(
  'dispatches the inspected %s credential from a changing record proxy',
  async (first) => {
    const reads: number[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request init');
        }
        const authorization = new Headers(request.headers).get('Authorization');
        if (authorization === null) {
          throw new Error('Expected workload Authorization');
        }
        const attempt = reads.length;
        let count = 0;
        reads.push(0);
        request.headers = new Proxy(
          { Authorization: authorization },
          {
            get(target, key, receiver) {
              if (key === 'Authorization') {
                count += 1;
                reads[attempt] = count;
                const workload = count % 2 === 1 ? first === 'workload' : first !== 'workload';
                return workload ? authorization : 'Bearer independent';
              }
              return Reflect.get(target, key, receiver);
            },
          },
        );
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ ok: true });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const result = client.post('/synthetic', { body: { value: 1 } });
    await (first === 'workload'
      ? expect(result).resolves.toEqual({ ok: true })
      : expect(result).rejects.toMatchObject({ status: 401 }));

    expect(sent).toEqual(
      first === 'workload' ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer independent'],
    );
    expect(reads).toEqual(first === 'workload' ? [1, 1] : [1]);
    expect(transport.exchanges).toBe(first === 'workload' ? 2 : 1);
  },
);

test.each(['iterator', 'getter'] as const)(
  'materializes a stateful %s exactly once before fetch',
  async (kind) => {
    let reads = 0;
    const supplied: NonNullable<RequestInit['headers']>[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected a request');
        }
        const authorization = new Headers(request.headers).get('Authorization');
        if (authorization === null) {
          throw new Error('Expected workload authorization');
        }
        const headers =
          kind === 'iterator'
            ? (function* oneShotHeaders() {
                reads += 1;
                yield ['Authorization', authorization];
              })()
            : {
                get Authorization() {
                  reads += 1;
                  return authorization;
                },
              };
        request.headers = headers as NonNullable<RequestInit['headers']>;
        supplied.push(headers as NonNullable<RequestInit['headers']>);
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(init?.headers).not.toBe(supplied[sent.length]);
      expect(init?.headers).toBeInstanceOf(Headers);
      expect(reads).toBe(sent.length + 1);
      sent.push(new Headers(init?.headers).get('Authorization'));
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
    expect(reads).toBe(2);
  },
);

test.each([200, 401].flatMap((status) => [false, true].map((bound) => ({ status, bound }))))(
  'preserves native Headers membrane dispatch (bound iterator: $bound, status: $status)',
  async ({ status, bound }) => {
    // Older native implementations accept proxy receivers and retain their existing refresh contract.
    const readable = nativeProxyReadable();
    const targets = new WeakMap<object, Headers>();
    let supplied: Headers | undefined;
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request init');
        }
        const target = new Headers(request.headers);
        supplied = new Proxy(target, {
          get(source, key, receiver) {
            return bound && key === Symbol.iterator
              ? source[Symbol.iterator].bind(source)
              : Reflect.get(source, key, receiver);
          },
        });
        targets.set(supplied, target);
        request.headers = supplied;
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      if (bound && !readable) {
        expect(init?.headers).not.toBe(supplied);
      } else {
        expect(init?.headers).toBe(supplied);
      }
      const target = bound || readable ? new Headers(init?.headers) : supplied && targets.get(supplied);
      if (!target) {
        throw new Error('Expected a membrane known to this transport');
      }
      sent.push(target.get('Authorization'));
      return Response.json({ ok: true }, { status: sent.length === 1 ? status : 200 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
      logLevel: 'debug',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const result = client.post('/synthetic', { body: { value: 1 } });
    const unreadable = !bound && !readable;
    if (unreadable) {
      await expect(result).rejects.toMatchObject({ cause: expect.any(TypeError) });
    } else if (status === 200 || bound || readable) {
      await expect(result).resolves.toEqual({ ok: true });
    } else {
      await expect(result).rejects.toMatchObject({ status: 401 });
    }
    const refreshed = (bound || readable) && status === 401;
    let expected: string[] = ['Bearer access-token-1'];
    if (unreadable) {
      expected = [];
    } else if (refreshed) {
      expected.push('Bearer access-token-2');
    }
    expect(sent).toEqual(expected);
    expect(transport.exchanges).toBe(refreshed ? 2 : 1);
  },
);

test.skipIf(Number(process.versions.node.split('.')[0]) < 24)(
  'rejects an unreadable foreign Headers membrane before transport dispatch',
  async () => {
    const { Headers: ForeignHeaders } = await import('undici');
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request init');
        }
        const target = new ForeignHeaders([...new Headers(request.headers)]);
        request.headers = new Proxy(target, {}) as unknown as NonNullable<RequestInit['headers']>;
        return super.fetchWithTimeout(...args);
      }
    }
    let dispatches = 0;
    const transport = createWorkloadIdentityTransport(() => {
      dispatches += 1;
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ cause: expect.any(TypeError) });

    expect(dispatches).toBe(0);
    expect(transport.exchanges).toBe(1);
  },
);

test.each([200, 401])(
  'forwards an unreadable iterator wrapper to its configured transport (status: %i)',
  async (status) => {
    const targets = new WeakMap<object, Headers>();
    let supplied: NonNullable<RequestInit['headers']> | undefined;
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request init');
        }
        const target = new Headers(request.headers);
        const wrapper = {
          [Symbol.iterator]() {
            throw new TypeError('Synthetic wrapper requires transport unwrapping');
          },
        };
        targets.set(wrapper, target);
        supplied = wrapper as NonNullable<RequestInit['headers']>;
        request.headers = supplied;
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      expect(init?.headers).toBe(supplied);
      const target = init?.headers && targets.get(init.headers);
      if (!target) {
        throw new Error('Expected a wrapper known to this transport');
      }
      const request = new Request(url, { ...init, headers: target } as globalThis.RequestInit);
      expect(request.method).toBe('POST');
      sent.push(request.headers.get('Authorization'));
      return Response.json({ ok: true }, { status });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
      logLevel: 'debug',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const result = client.post('/synthetic', { body: { value: 1 } });
    await (status === 200
      ? expect(result).resolves.toEqual({ ok: true })
      : expect(result).rejects.toMatchObject({ status: 401 }));

    expect(sent).toEqual(['Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
  },
);

describe.each(['fetchWithTimeout', 'fetchWithAuth'] as const)('%s prototype inspection', (hook) => {
  test.each([false, true])(
    'uses platform conversion when inspection fails (invalid value: %s)',
    async (invalid) => {
      const diagnostic = new Error('Synthetic header conversion failed');
      let valueReads = 0;
      const makeSource = (headers: NonNullable<RequestInit['headers']>) => {
        const values = Object.fromEntries(new Headers(headers));
        Object.defineProperty(values, 'X-Trace', {
          enumerable: true,
          get() {
            valueReads += 1;
            if (invalid) {
              throw diagnostic;
            }
            return 'preserved';
          },
        });
        return new Proxy(values, {
          getPrototypeOf() {
            throw new Error('Synthetic membrane blocks prototype inspection');
          },
        });
      };
      class HookClient extends OpenAI {
        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          if (hook === 'fetchWithTimeout' && args[1]) {
            args[1].headers = makeSource(args[1].headers ?? {});
          }
          return super.fetchWithTimeout(...args);
        }

        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          if (hook === 'fetchWithAuth') {
            args[1].headers = makeSource(args[1].headers ?? {});
          }
          return super.fetchWithAuth(...args);
        }
      }
      let sends = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sends += 1;
        const headers = new Headers(init?.headers);
        expect(headers.get('X-Trace')).toBe('preserved');
        expect(headers.get('Authorization')).toBe('Bearer access-token-1');
        return Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      const result = client.models.list();
      await (invalid
        ? expect(result).rejects.toMatchObject({ cause: diagnostic })
        : expect(result).resolves.toMatchObject({ data: [] }));
      expect(sends).toBe(invalid ? 0 : 1);
      expect(valueReads).toBe(1);
      expect(transport.exchanges).toBe(1);
    },
  );
});

test.each(['own keys', 'iterator descriptor'] as const)(
  'rejects a record wrapper with unreadable $kind before transport dispatch',
  async (kind) => {
    const diagnostic = new Error('Synthetic wrapper requires transport unwrapping');
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (!args[1]) {
          throw new Error('Expected request init');
        }
        args[1].headers = new Proxy(
          {},
          {
            ...(kind === 'own keys'
              ? {
                  ownKeys: () => {
                    throw diagnostic;
                  },
                }
              : {}),
            ...(kind === 'iterator descriptor'
              ? {
                  getOwnPropertyDescriptor: () => {
                    throw diagnostic;
                  },
                }
              : {}),
          },
        );
        return super.fetchWithTimeout(...args);
      }
    }
    let dispatches = 0;
    const transport = createWorkloadIdentityTransport(() => {
      dispatches += 1;
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ cause: diagnostic });
    expect(dispatches).toBe(0);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(['native iterator', 'record', 'array'] as const)(
  'retains configured-transport validation errors from invalid %s headers',
  async (kind) => {
    const diagnostic = new TypeError('Synthetic iterator diagnostic');
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected request init');
        }
        if (kind === 'native iterator') {
          const headers = new Headers(request.headers);
          Object.defineProperty(headers, Symbol.iterator, {
            value() {
              throw diagnostic;
            },
          });
          request.headers = headers;
        } else {
          request.headers =
            kind === 'record' ? { Authorization: 'invalid\rvalue' } : [['Authorization', 'invalid\rvalue']];
        }
        return super.fetchWithTimeout(...args);
      }
    }
    let transportCalls = 0;
    const sends: Request[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      transportCalls += 1;
      sends.push(new Request(url, init as globalThis.RequestInit));
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({
      cause: kind === 'native iterator' ? diagnostic : expect.any(TypeError),
    });
    expect(transportCalls).toBe(kind === 'native iterator' ? 1 : 0);
    expect(sends).toHaveLength(0);
    expect(transport.exchanges).toBe(1);
  },
);

test('does not dispatch a record whose failed field read makes its shape opaque', async () => {
  const diagnostic = new Error('Synthetic header parse failure');
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (!args[1]) {
        throw new Error('Expected request init');
      }
      let opaque = false;
      const target = {
        get 'X-Trace'() {
          opaque = true;
          throw diagnostic;
        },
      };
      args[1].headers = new Proxy(target, {
        ownKeys(value) {
          if (opaque) {
            throw diagnostic;
          }
          return Reflect.ownKeys(value);
        },
      }) as unknown as NonNullable<RequestInit['headers']>;
      return super.fetchWithTimeout(...args);
    }
  }
  let dispatches = 0;
  const transport = createWorkloadIdentityTransport(() => {
    dispatches += 1;
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ cause: diagnostic });
  expect(dispatches).toBe(0);
  expect(transport.exchanges).toBe(1);
});

test.each(
  (['iterator', 'custom array', 'native Headers', 'Headers proxy'] as const).flatMap((source) =>
    (['before first row', 'after first row'] as const).map((when) => ({ source, when })),
  ),
)('does not dispatch a one-shot $source that fails $when', async ({ source, when }) => {
  const diagnostic = new Error('Synthetic header iteration failed');
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [, request] = args;
      if (!request) {
        throw new Error('Expected request init');
      }
      const iterate = function* iterate() {
        if (when === 'after first row') {
          yield ['X-Trace', 'synthetic'];
        }
        throw diagnostic;
      };
      if (source === 'iterator') {
        request.headers = iterate() as unknown as NonNullable<RequestInit['headers']>;
      } else {
        if (source === 'native Headers') {
          request.headers = new Headers();
        } else if (source === 'Headers proxy') {
          request.headers = new Proxy(new Headers(), {});
        } else {
          request.headers = [];
        }
        Object.defineProperty(request.headers, Symbol.iterator, { value: iterate });
      }
      return super.fetchWithTimeout(...args);
    }
  }
  let transportCalls = 0;
  const transport = createWorkloadIdentityTransport(() => {
    transportCalls += 1;
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ cause: diagnostic });
  expect(transportCalls).toBe(0);
  expect(transport.exchanges).toBe(1);
});

test('does not dispatch an iterator whose next accessor fails after factory selection', async () => {
  const diagnostic = new Error('Synthetic next accessor failed');
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (!args[1]) {
        throw new Error('Expected request init');
      }
      args[1].headers = {
        [Symbol.iterator]() {
          return {
            get next() {
              throw diagnostic;
            },
          };
        },
      } as unknown as NonNullable<RequestInit['headers']>;
      return super.fetchWithTimeout(...args);
    }
  }
  let dispatches = 0;
  const transport = createWorkloadIdentityTransport(() => {
    dispatches += 1;
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ cause: diagnostic });
  expect(dispatches).toBe(0);
  expect(transport.exchanges).toBe(1);
});

test('does not dispatch a native array after consuming a failed one-shot row', async () => {
  const diagnostic = new Error('Synthetic row iteration failed');
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [, request] = args;
      if (!request) {
        throw new Error('Expected request init');
      }
      request.headers = [
        (function* row() {
          yield 'X-Trace';
          throw diagnostic;
        })(),
      ] as unknown as NonNullable<RequestInit['headers']>;
      return super.fetchWithTimeout(...args);
    }
  }
  let dispatches = 0;
  const transport = createWorkloadIdentityTransport(() => {
    dispatches += 1;
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ cause: diagnostic });
  expect(dispatches).toBe(0);
  expect(transport.exchanges).toBe(1);
});

test.each(['record', 'array'] as const)('selects a stateful $source header protocol once', async (source) => {
  let reads = 0;
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [, request] = args;
      if (!request) {
        throw new Error('Expected request init');
      }
      const headers: Record<string | symbol, unknown> | unknown[][] =
        source === 'record' ? { 'X-Trace': 'record' } : [['X-Trace', 'array']];
      const native = Reflect.get(headers, Symbol.iterator) as unknown;
      const protocolOwner = source === 'record' ? Object.create(Object.getPrototypeOf(headers)) : headers;
      if (source === 'record') {
        Object.setPrototypeOf(headers, protocolOwner);
      }
      Object.defineProperty(protocolOwner, Symbol.iterator, {
        configurable: true,
        get() {
          reads += 1;
          return reads === 1
            ? native
            : function* changed() {
                yield ['X-Trace', `second-${source}`];
              };
        },
      });
      request.headers = headers as NonNullable<RequestInit['headers']>;
      return super.fetchWithTimeout(...args);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Trace'));
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

  expect(reads).toBe(1);
  expect(sent).toEqual([source]);
});

test.each(['hidden record', 'hidden proxy', 'phantom proxy', 'stateful proxy', 'symbol'] as const)(
  'preserves native record conversion for a $kind header input',
  async (kind) => {
    const makeSource = () => {
      const record: Record<PropertyKey, unknown> = { 'X-Trace': 'marker' };
      if (kind === 'symbol') {
        record[Symbol('synthetic')] = 'value';
        return record;
      }
      if (kind === 'hidden record' || kind === 'hidden proxy') {
        Object.defineProperty(record, 'X-Hidden', { value: 'hidden' });
      }
      if (kind === 'hidden record') {
        return record;
      }
      if (kind === 'stateful proxy') {
        let reads = 0;
        return new Proxy(record, {
          ownKeys(target) {
            reads += 1;
            return reads === 1 ? Reflect.ownKeys(target) : [];
          },
        });
      }
      return new Proxy(
        record,
        kind === 'phantom proxy'
          ? {
              ownKeys(target) {
                return [...Reflect.ownKeys(target), 'X-Phantom'];
              },
            }
          : {},
      );
    };
    let expected: [string, string][] | undefined;
    let nativeError = false;
    try {
      expected = [...new Headers(makeSource() as NonNullable<RequestInit['headers']>)];
    } catch {
      nativeError = true;
    }
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (!args[1]) {
          throw new Error('Expected request init');
        }
        args[1].headers = makeSource() as NonNullable<RequestInit['headers']>;
        return super.fetchWithTimeout(...args);
      }
    }
    let actual: [string, string][] | undefined;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      actual = [...new Headers(init?.headers)];
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const result = client.models.list();
    await (nativeError ? expect(result).rejects.toThrow() : expect(result).resolves.toBeDefined());
    expect(actual).toEqual(expected);
  },
);

test.each(
  [null, undefined].flatMap((selected) =>
    (['own', 'inherited'] as const).map((location) => ({ selected, location })),
  ),
)('preserves a single $location nullish iterator selection ($selected)', async ({ selected, location }) => {
  const makeSource = () => {
    const owner = {};
    Object.defineProperty(owner, Symbol.iterator, { configurable: true, value: emptyIterator });
    let reads = 0;
    const protocol = new Proxy(owner, {
      get(target, key, receiver) {
        if (key === Symbol.iterator) {
          reads += 1;
          return selected;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const record = location === 'own' ? { 'X-Trace': 'marker' } : Object.create(protocol);
    if (location === 'own') {
      Object.defineProperty(record, Symbol.iterator, {
        configurable: true,
        value: emptyIterator,
      });
    } else {
      record['X-Trace'] = 'marker';
    }
    Object.defineProperty(record, 'X-Hidden', { value: 'hidden' });
    return {
      headers:
        location === 'own'
          ? new Proxy(record, {
              get(target, key, receiver) {
                if (key === Symbol.iterator) {
                  reads += 1;
                  return selected;
                }
                return Reflect.get(target, key, receiver);
              },
            })
          : record,
      reads: () => reads,
    };
  };
  const native = makeSource();
  const expected = [...new Headers(native.headers)];
  const supplied = makeSource();
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (!args[1]) {
        throw new Error('Expected request init');
      }
      args[1].headers = supplied.headers;
      return super.fetchWithTimeout(...args);
    }
  }
  let actual: [string, string][] | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    actual = [...new Headers(init?.headers)];
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

  expect(native.reads()).toBe(1);
  expect(supplied.reads()).toBe(1);
  expect(actual).toEqual(expected);
});

test('does not inspect or replace headers when workload attribution is unnecessary', async () => {
  let reads = 0;
  const headers = {
    get Authorization() {
      reads += 1;
      return 'Bearer independent';
    },
  };
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      if (args[1]) {
        args[1].headers = headers;
      }
      return super.fetchWithTimeout(...args);
    }
  }
  const client = new HookClient({
    apiKey: 'synthetic-static-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      expect(init?.headers).toBe(headers);
      expect(reads).toBe(0);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    },
  });

  await client.models.list();

  expect(reads).toBe(1);
});
