import OpenAI from 'openai';
import { buildHeaders, createWorkloadHeaderSnapshots, snapshotHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

test.each([false, true])('retains a proxy-observed row until its slot is replaced: %s', async (replace) => {
  const rows = [['X-Custom', 'target']];
  let reads = 0;
  const headers = new Proxy(rows, {
    get(target, key, receiver) {
      if (key === '0') {
        reads += 1;
        if (reads === 1) {
          return ['X-Custom', 'observed'];
        }
        if (!replace || reads > 2) {
          throw new Error('Proxy row was read twice');
        }
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    if (replace) {
      rows[0] = ['X-Custom', 'replacement'];
    }
    return 'subject-token';
  };
  let sends = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sends += 1;
    expect(new Headers(init?.headers).get('X-Custom')).toBe(replace ? 'replacement' : 'observed');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    workloadIdentity: identity,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers });

  expect(reads).toBe(replace ? 2 : 1);
  expect(sends).toBe(1);
  expect(transport.exchanges).toBe(1);
});

test.each(['request', 'default'] as const)(
  'drops an accessor-backed nested %s value deleted between retry attempts',
  async (layer) => {
    const values: (string | undefined)[] = [];
    const read = vi.fn(() => 'Bearer independent');
    Object.defineProperty(values, 0, { configurable: true, get: read });
    const headers = { Authorization: values };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      if (sent.length === 1) {
        delete values[0];
        return Response.json({ error: 'synthetic retry' }, { status: 500 });
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await client.models.list(layer === 'request' ? { headers } : {});

    expect(sent).toEqual(['Bearer independent', 'Bearer access-token-1']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

describe.each(['own', 'inherited'] as const)('%s outer header slot', (location) => {
  describe.each(['request', 'default'] as const)('%s headers', (layer) => {
    test.each(
      ([null, 'Bearer independent'] as const).flatMap((authorization) =>
        [false, true].map((captured) => ({ authorization, captured })),
      ),
    )('retains one getter read while an ordinary row changes to %j', async ({ authorization, captured }) => {
      const authorizationRow: (string | null | undefined)[] = ['Authorization', undefined];
      const headers = [['X-Custom', 'initial'], authorizationRow];
      const read = vi.fn(function readSlot(this: object) {
        expect(this).toBe(headers);
        if (read.mock.calls.length > 1) {
          throw new Error('Outer slot getter was read twice');
        }
        return ['X-Custom', 'preserved'];
      });
      if (location === 'inherited') {
        delete headers[0];
        const prototype = Object.create(Array.prototype);
        Object.defineProperty(prototype, 0, { configurable: true, get: read });
        Object.setPrototypeOf(headers, prototype);
      } else {
        Object.defineProperty(headers, 0, { configurable: true, get: read });
      }
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        authorizationRow[1] = authorization;
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const actual = new Headers(init?.headers);
        expect(actual.get('X-Custom')).toBe('preserved');
        sent.push(actual.get('Authorization'));
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      class HookClient extends OpenAI {
        protected override async prepareOptions(...args: Parameters<OpenAI['prepareOptions']>) {
          if (captured) {
            buildHeaders([headers]);
          }
          return super.prepareOptions(...args);
        }
      }
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        workloadIdentity: identity,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
        status: 401,
      });

      expect(sent).toEqual([authorization]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(1);
    });
  });
});

test.each(['name', 'value'] as const)(
  'validates an invalid first row %s before reading later outer slots',
  async (field) => {
    const first = ['X-Custom', 'valid'];
    const headers = [first, ['X-Later', 'unused']];
    first[field === 'name' ? 0 : 1] = 'invalid\nheader';
    const read = vi.fn(() => {
      throw new Error('Later outer slot must remain unread');
    });
    Object.defineProperty(headers, 1, { get: read });
    const transport = createWorkloadIdentityTransport(() => Response.json({ data: [] }));
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
    });

    await expect(client.models.list({ headers })).rejects.toThrow(TypeError);

    expect(read).not.toHaveBeenCalled();
    expect(transport.exchanges).toBe(0);
  },
);

test.each(['replace', 'append', 'truncate'] as const)(
  'observes a row value getter that changes a later slot: %s',
  (operation) => {
    const headers = [
      ['X-First', 'first'],
      ['X-Later', 'initial'],
    ];
    const later = vi.fn(() => ['X-Later', 'old']);
    Object.defineProperty(headers, 1, { configurable: true, get: later });
    Object.defineProperty(headers[0], 1, {
      get() {
        if (operation === 'replace') {
          Object.defineProperty(headers, 1, { value: ['X-Later', 'replacement'] });
        } else if (operation === 'append') {
          headers.push(['X-Appended', 'appended']);
        } else {
          headers.length = 1;
        }
        return 'first';
      },
    });

    const snapshot = snapshotHeaders(headers).snapshot.values;

    expect(snapshot.get('X-First')).toBe('first');
    const laterValues = { replace: 'replacement', append: 'old', truncate: null };
    expect(snapshot.get('X-Later')).toBe(laterValues[operation]);
    expect(snapshot.get('X-Appended')).toBe(operation === 'append' ? 'appended' : null);
    expect(later).toHaveBeenCalledTimes(operation === 'append' ? 1 : 0);
  },
);

test('keeps a cached slot row live without rereading its getter after descriptor flag changes', () => {
  const row = ['X-Custom', 'initial'];
  const read = vi.fn(() => row);
  const headers = [row];
  Object.defineProperty(headers, 0, { configurable: true, enumerable: true, get: read });
  const snapshot = snapshotHeaders(headers);

  Object.defineProperty(headers, 0, { enumerable: false, get: read, set: vi.fn() });
  row[1] = 'updated';

  expect(snapshot.refresh().values.get('X-Custom')).toBe('updated');
  expect(read).toHaveBeenCalledTimes(1);
  expect(snapshot.replayable).toBe(false);
});

test('retains a self-deleting slot getter until a data property replaces it', () => {
  const headers = [['X-Custom', 'initial']];
  const read = vi.fn(() => {
    delete headers[0];
    return ['X-Custom', 'preserved'];
  });
  Object.defineProperty(headers, 0, { configurable: true, get: read });
  const snapshot = snapshotHeaders(headers);

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
  headers[0] = ['X-Replacement', 'replacement'];
  expect([...snapshot.refresh().values]).toEqual([['x-replacement', 'replacement']]);
  expect(read).toHaveBeenCalledTimes(1);
});

describe.each(['request', 'default'] as const)('%s outer slot deletion', (layer) => {
  test.each(['data', 'accessor', 'self read', 'self serialization'] as const)(
    'preserves canonical retry behavior after deleting a %s slot',
    async (kind) => {
      const row = ['Authorization', 'Bearer independent'];
      const headers = [row];
      const read = vi.fn(() => {
        if (read.mock.calls.length > 1) {
          throw new Error('An outer accessor was reread');
        }
        if (kind === 'self read') {
          delete headers[0];
        }
        return row;
      });
      if (kind !== 'data') {
        Object.defineProperty(headers, 0, { configurable: true, get: read });
      }
      if (kind === 'self serialization') {
        Object.defineProperty(row, 1, {
          get() {
            delete headers[0];
            return 'Bearer independent';
          },
        });
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        if (sent.length === 1) {
          if (kind === 'data' || kind === 'accessor') {
            delete headers[0];
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
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
        fetch: transport.fetch,
        maxRetries: 1,
      });

      const request = client.models.list(layer === 'request' ? { headers } : {});
      if (kind === 'data' || kind === 'accessor') {
        await expect(request).rejects.toThrow(TypeError);
        expect(sent).toEqual(['Bearer independent']);
      } else {
        await request;
        expect(sent).toEqual(['Bearer independent', 'Bearer independent']);
      }
      expect(read).toHaveBeenCalledTimes(kind === 'data' ? 0 : 1);
      expect(transport.exchanges).toBe(0);
    },
  );
});

test('does not throw when outer slot descriptors are hidden by a proxy', () => {
  const headers = new Proxy([['X-Custom', 'preserved']], {
    getOwnPropertyDescriptor(target, key) {
      if (key === '0') {
        throw new Error('Uninspectable slot descriptor');
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  const snapshot = snapshotHeaders(headers);

  expect(snapshot.snapshot.values.get('X-Custom')).toBe('preserved');
  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
});

test('preserves native array iteration length coercion', () => {
  const later = vi.fn(() => ['X-Later', 'unused']);
  const rows = [
    ['X-Custom', 'preserved'],
    ['X-Later', 'unused'],
  ];
  Object.defineProperty(rows, 1, { get: later });
  const headers = new Proxy(rows, {
    get(target, key, receiver) {
      return key === 'length' ? 1.5 : Reflect.get(target, key, receiver);
    },
  });

  expect([...snapshotHeaders(headers).snapshot.values]).toEqual([['x-custom', 'preserved']]);
  expect(later).not.toHaveBeenCalled();
});

test('forgets truncated slot state before the same getter is installed again', () => {
  const read = vi.fn(() => ['X-Custom', String(read.mock.calls.length)]);
  const headers: string[][] = [];
  Object.defineProperty(headers, 0, { configurable: true, get: read });
  const snapshot = snapshotHeaders(headers);
  expect(snapshot.snapshot.values.get('X-Custom')).toBe('1');

  headers.length = 0;
  expect([...snapshot.refresh().values]).toEqual([]);
  Object.defineProperty(headers, 0, { configurable: true, get: read });

  expect(snapshot.refresh().values.get('X-Custom')).toBe('2');
  expect(read).toHaveBeenCalledTimes(2);
});

test('keeps aliased layer slot caches independent after one source is replaced', () => {
  const row = ['X-Custom', 'initial'];
  const read = vi.fn(() => row);
  const headers = [row];
  Object.defineProperty(headers, 0, { configurable: true, get: read });
  const snapshots = createWorkloadHeaderSnapshots(headers, headers);

  snapshots.requestHeaders.refresh([['X-Request', 'replacement']]);
  row[1] = 'updated';

  expect(snapshots.defaultHeaders.refresh().values.get('X-Custom')).toBe('updated');
  expect(snapshots.requestHeaders.snapshot.values.get('X-Request')).toBe('replacement');
  expect(read).toHaveBeenCalledTimes(1);
});
