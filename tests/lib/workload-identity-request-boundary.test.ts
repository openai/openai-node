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
