import { runInNewContext } from 'node:vm';
import OpenAI from 'openai';
import { snapshotHeaders } from 'openai/internal/headers';
import type { HeadersLike } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['request', 'default'] as const)('nested %s header values', (layer) => {
  test.each(['own getter', 'inherited getter', 'iterator getter', 'custom iterator', 'coercion'] as const)(
    'retains the first serialization of a nested %s',
    async (kind) => {
      const values = ['preserved'];
      const consume = vi.fn(function consumeValue(this: unknown) {
        expect(this).toBe(values);
        if (consume.mock.calls.length > 1) {
          throw new Error('Nested value was consumed twice');
        }
        return 'preserved';
      });
      if (kind === 'own getter' || kind === 'inherited getter') {
        const target = kind === 'own getter' ? values : Object.create(Array.prototype);
        Object.defineProperty(target, '0', { get: consume });
        if (kind === 'inherited getter') {
          delete values[0];
          Object.setPrototypeOf(values, target);
        }
      } else if (kind === 'iterator getter') {
        const iterator = values[Symbol.iterator];
        Object.defineProperty(values, Symbol.iterator, {
          get() {
            consume.call(this);
            return iterator;
          },
        });
      } else if (kind === 'custom iterator') {
        const iterator = values[Symbol.iterator]();
        Object.defineProperty(values, Symbol.iterator, {
          value() {
            consume.call(this);
            return iterator;
          },
        });
      } else {
        values[0] = { toString: () => consume.call(values) } as unknown as string;
      }
      const headers = { 'X-Custom': values };
      let calls = 0;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
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

      expect(calls).toBe(1);
      expect(consume).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(1);
    },
  );

  test.each(['local', 'foreign'] as const)(
    'keeps %s primitive arrays and records refreshable',
    async (realm) => {
      const values: string[] = realm === 'local' ? ['before'] : runInNewContext("['before']");
      const headers = { 'X-Custom': values, 'X-Record': 'before' };
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        values[0] = 'after';
        values.push('appended');
        headers['X-Record'] = 'after';
        return 'subject-token';
      };
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('X-Custom')).toBe('after, appended');
        expect(new Headers(init?.headers).get('X-Record')).toBe('after');
        return Response.json({ data: [] });
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

      await client.models.list(layer === 'request' ? { headers } : {});

      expect(transport.exchanges).toBe(1);
    },
  );
});

test('preserves nested getter order and receiver when a getter replaces itself', () => {
  const order: string[] = [];
  const values = ['first', 'second'];
  Object.defineProperty(values, '0', {
    configurable: true,
    get() {
      expect(this).toBe(values);
      order.push('first');
      Object.defineProperty(values, '0', { value: 'changed', configurable: true });
      return 'first';
    },
  });
  Object.defineProperty(values, '1', {
    get() {
      expect(this).toBe(values);
      order.push('second');
      return 'second';
    },
  });
  const snapshot = snapshotHeaders({ 'X-Custom': values });

  expect(snapshot.refresh().values.get('X-Custom')).toBe('first, second');
  expect(order).toEqual(['first', 'second']);

  Object.defineProperty(values, '0', { value: 'later' });
  expect(snapshot.refresh().values.get('X-Custom')).toBe('later, second');
  expect(order).toEqual(['first', 'second']);
});

test('reads a tuple header value once and retains accessor-backed rows', () => {
  const row = ['X-Custom', 'preserved'];
  const read = vi.fn(function readValue(this: unknown) {
    expect(this).toBe(row);
    if (read.mock.calls.length > 1) {
      throw new Error('Tuple value was read twice');
    }
    return 'preserved';
  });
  Object.defineProperty(row, '1', { get: read });
  const snapshot = snapshotHeaders([row]);

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
  expect(read).toHaveBeenCalledTimes(1);
});

test('retains stateful scalar coercion without evaluating it to classify the source', () => {
  const serialize = vi.fn(() => {
    if (serialize.mock.calls.length > 1) {
      throw new Error('Header value was serialized twice');
    }
    return 'preserved';
  });
  const headers = { 'X-Custom': { toString: serialize } } as unknown as HeadersLike;
  const snapshot = snapshotHeaders(headers);

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
  expect(serialize).toHaveBeenCalledTimes(1);
});

test('serializes values observed through a proxy instead of substituting descriptor values', () => {
  const target = ['descriptor'];
  let reads = 0;
  const values = new Proxy(target, {
    get(array, key, receiver) {
      if (key === '0') {
        reads += 1;
        return 'observed';
      }
      return Reflect.get(array, key, receiver);
    },
  });

  expect(snapshotHeaders({ 'X-Custom': values }).snapshot.values.get('X-Custom')).toBe('observed');
  expect(reads).toBe(1);
});

test.each([null, '', 'Bearer independent'] as const)(
  'retains nested Authorization %j through a 401 without workload-token acquisition',
  async (authorization) => {
    const values: (string | null)[] = [authorization];
    const read = vi.fn(function readAuthorization(this: unknown) {
      expect(this).toBe(values);
      delete values[0];
      return authorization;
    });
    Object.defineProperty(values, '0', { configurable: true, get: read });
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list({ headers: { Authorization: values } })).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toBe(1);
    expect(transport.exchanges).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  },
);

test('uses actual nested iteration when a proxy rejects descriptor inspection', () => {
  const values = new Proxy(['preserved'], {
    getOwnPropertyDescriptor() {
      throw new Error('Descriptors are unavailable');
    },
  });
  const snapshot = snapshotHeaders({ 'X-Custom': values });

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
});

test.each([401, 500])('retains nested serialization through an automatic %s retry', async (status) => {
  const values = ['preserved'];
  const read = vi.fn(() => {
    if (read.mock.calls.length > 1) {
      throw new Error('Nested value was read again during retry');
    }
    return 'preserved';
  });
  Object.defineProperty(values, '0', { get: read });
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
    expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
    return calls === 1
      ? Response.json({ error: 'synthetic failure' }, { status, headers: { 'retry-after-ms': '0' } })
      : Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    maxRetries: status === 500 ? 1 : 0,
    fetch: transport.fetch,
  });

  await client.models.list({ headers: { 'X-Custom': values } });

  expect(calls).toBe(2);
  expect(read).toHaveBeenCalledTimes(1);
  expect(transport.exchanges).toBe(status === 401 ? 2 : 1);
});

describe.each(['request', 'default'] as const)('%s nested Authorization deletion', (layer) => {
  test.each(['external', 'self', 'none'] as const)(
    'refreshes an accessor slot after %s removal',
    async (removal) => {
      const values = ['Bearer independent'];
      const read = vi.fn(() => {
        if (read.mock.calls.length > 1) {
          throw new Error('The nested accessor was read again');
        }
        if (removal === 'self') {
          delete values[0];
        }
        return 'Bearer independent';
      });
      Object.defineProperty(values, '0', { configurable: true, get: read });
      const headers = { Authorization: values };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        if (sent.length === 1) {
          if (removal === 'external') {
            delete values[0];
          }
          return Response.json(
            { error: 'synthetic retry' },
            { status: 500, headers: { 'retry-after-ms': '0' } },
          );
        }
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        maxRetries: 1,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
      });

      await client.models.list(layer === 'request' ? { headers } : {});

      expect(sent).toEqual([
        'Bearer independent',
        removal === 'external' ? 'Bearer access-token-1' : 'Bearer independent',
      ]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(removal === 'external' ? 1 : 0);
    },
  );
});

test('invokes a callable nested iterator without reading its call property', () => {
  const values = ['preserved'];
  const iterator = function* iterator(this: unknown) {
    expect(this).toBe(values);
    yield 'preserved';
  };
  Object.defineProperty(iterator, 'call', {
    get() {
      throw new Error('The iterator call property must not be read');
    },
  });
  Object.defineProperty(values, Symbol.iterator, { value: iterator });
  const snapshot = snapshotHeaders({ 'X-Custom': values });

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
});

test('rejects a non-callable nested iterator even when it has a call method', () => {
  const values = ['preserved'];
  const call = vi.fn(() => ['unexpected'][Symbol.iterator]());
  Object.defineProperty(values, Symbol.iterator, { value: { call } });

  expect(() => snapshotHeaders({ 'X-Custom': values })).toThrow(TypeError);
  expect(call).not.toHaveBeenCalled();
});
