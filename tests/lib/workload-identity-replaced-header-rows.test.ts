import OpenAI from 'openai';
import { createWorkloadHeaderSnapshots, snapshotHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

test.each(['duplicate', 'replaced duplicate', 'expanded replacement', 'unrelated'] as const)(
  'refreshes tuple occurrences after removing a %s row before a retry',
  async (removed) => {
    const read = vi.fn(() => {
      if (removed === 'unrelated' && read.mock.calls.length > 2) {
        throw new Error('Unchanged tuple occurrences must not be reread');
      }
      return read.mock.calls.length === 1 ? 'A' : 'B';
    });
    const row = ['X-Custom', ''];
    Object.defineProperty(row, 1, { get: read });
    const headers = [row, row];
    if (removed === 'unrelated') {
      headers.push(['X-Unrelated', 'remove']);
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Custom'));
      if (sent.length === 1) {
        if (removed === 'unrelated') {
          headers.pop();
        } else {
          headers.shift();
          if (removed !== 'duplicate') {
            headers.push(['X-Replacement', 'new']);
          }
          if (removed === 'expanded replacement') {
            headers.push(['X-Extra', 'new']);
          }
        }
        return Response.json(
          { error: 'synthetic retry' },
          { status: 500, headers: { 'retry-after-ms': '1' } },
        );
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await client.models.list({ headers });

    expect(sent).toEqual(['A, B', removed === 'unrelated' ? 'A, B' : 'B']);
    expect(read).toHaveBeenCalledTimes(removed === 'unrelated' ? 2 : 3);
    expect(transport.exchanges).toBe(1);
  },
);

test('refreshes aliased row accessor replacements independently for each header layer', async () => {
  const row: (string | null | undefined)[] = ['Authorization', undefined];
  const original = vi.fn<() => undefined>();
  const replacement = vi.fn(() => (replacement.mock.calls.length === 1 ? undefined : null));
  Object.defineProperty(row, 1, { configurable: true, get: original });
  const headers = [row];
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    Object.defineProperty(row, 1, { get: replacement });
    return 'subject-token';
  };
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    workloadIdentity: identity,
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list({ headers })).rejects.toMatchObject({ status: 401 });

  expect(sent).toEqual([null]);
  expect(original).toHaveBeenCalledTimes(1);
  expect(replacement).toHaveBeenCalledTimes(2);
  expect(transport.exchanges).toBe(1);
});

test.each([false, true])(
  'refreshes duplicate rows beside opaque slots when replaced: %j',
  async (replace) => {
    const read = vi.fn(() => {
      if (!replace && read.mock.calls.length > 2) {
        throw new Error('An unchanged occurrence was reread');
      }
      return read.mock.calls.length === 1 ? 'A' : 'B';
    });
    const row = ['X-Custom', ''];
    Object.defineProperty(row, 1, { get: read });
    const headers = [row, row];
    const readSlot = vi.fn(() => {
      if (readSlot.mock.calls.length > 1) {
        throw new Error('The opaque row slot was reread');
      }
      return row;
    });
    Object.defineProperty(headers, 1, { get: readSlot });
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Custom'));
      if (sent.length === 1) {
        if (replace) {
          headers[0] = ['X-Replacement', 'new'];
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
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await client.models.list({ headers });

    expect(sent).toEqual(['A, B', replace ? 'B' : 'A, B']);
    expect(read).toHaveBeenCalledTimes(replace ? 3 : 2);
    expect(readSlot).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

describe.each(['name', 'value'] as const)('retained row %s getter', (field) => {
  describe.each(['request', 'default'] as const)('%s headers', (layer) => {
    test.each([null, 'Bearer independent'] as const)(
      'observes a new row value %j during token acquisition',
      async (authorization) => {
        const row: (string | null | undefined)[] = ['Authorization', undefined];
        const read = vi.fn(() => {
          if (read.mock.calls.length > 1) {
            throw new Error('Row getter was read twice');
          }
          return field === 'name' ? 'Authorization' : undefined;
        });
        Object.defineProperty(row, field === 'name' ? 0 : 1, { configurable: true, get: read });
        const headers = [row];
        const identity = createTestWorkloadIdentity();
        identity.provider.getToken = async () => {
          Object.defineProperty(row, 1, { value: authorization });
          return 'subject-token';
        };
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          sent.push(new Headers(init?.headers).get('Authorization'));
          return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
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

        await expect(
          client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {}),
        ).rejects.toMatchObject({ status: 401 });

        expect(sent).toEqual([authorization]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(transport.exchanges).toBe(1);
      },
    );
  });
});

describe.each(['nested', 'coercion'] as const)('stateful %s row value', (kind) => {
  describe.each(['request', 'default'] as const)('%s headers', (layer) => {
    test.each([null, 'Bearer independent'] as const)(
      'refreshes a separate Authorization row to %j',
      async (authorization) => {
        const read = vi.fn(() => 'preserved');
        const values = ['preserved'];
        Object.defineProperty(values, 0, { get: read });
        const authorizationRow: (string | null | undefined)[] = ['Authorization', undefined];
        const headers = [
          ['X-Custom', kind === 'nested' ? values : { toString: read }],
          authorizationRow,
        ] as unknown as string[][];
        const identity = createTestWorkloadIdentity();
        identity.provider.getToken = async () => {
          authorizationRow[1] = authorization;
          return 'subject-token';
        };
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          const actual = new Headers(init?.headers);
          sent.push(actual.get('Authorization'));
          expect(actual.get('X-Custom')).toBe('preserved');
          return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
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

        await expect(
          client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {}),
        ).rejects.toMatchObject({ status: 401 });

        expect(sent).toEqual([authorization]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(transport.exchanges).toBe(1);
      },
    );
  });
});

test('retains a value getter when the ordinary row name changes', () => {
  const read = vi.fn(() => 'preserved');
  const row = ['X-Original', ''];
  Object.defineProperty(row, 1, { get: read });
  const snapshot = snapshotHeaders([row]);
  row[0] = 'X-Replacement';

  expect(snapshot.refresh().values.get('X-Replacement')).toBe('preserved');
  expect(snapshot.refresh().values.has('X-Original')).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
});

test('refreshes deleted ordinary values beside a retained name getter', () => {
  const read = vi.fn(() => 'Authorization');
  const row = ['Authorization', 'Bearer original'];
  Object.defineProperty(row, 0, { get: read });
  const snapshot = snapshotHeaders([row]);
  delete row[1];

  expect(snapshot.refresh().values.has('Authorization')).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
});

test.each(['name', 'value'] as const)(
  'distinguishes a self-deleting %s getter from a later external deletion',
  (slot) => {
    const index = slot === 'name' ? 0 : 1;
    const expected = slot === 'name' ? 'X-Custom' : 'preserved';
    const selfDeleting = ['X-Custom', 'preserved'];
    Object.defineProperty(selfDeleting, index, {
      configurable: true,
      get() {
        Reflect.deleteProperty(selfDeleting, index);
        return expected;
      },
    });
    const retained = snapshotHeaders([selfDeleting]);

    expect(retained.refresh().values.get('X-Custom')).toBe('preserved');

    const externallyDeleted = ['X-Custom', 'preserved'];
    Object.defineProperty(externallyDeleted, index, {
      configurable: true,
      get: () => expected,
    });
    const refreshed = snapshotHeaders([externallyDeleted]);
    Reflect.deleteProperty(externallyDeleted, index);

    if (slot === 'name') {
      expect(() => refreshed.refresh()).toThrow('expected header name to be a string');
    } else {
      expect(refreshed.refresh().values.has('X-Custom')).toBe(false);
    }
  },
);

test.each(['name', 'value'] as const)(
  'retains a self-hiding %s getter whose descriptor becomes readable after its first access',
  (slot) => {
    const index = slot === 'name' ? 0 : 1;
    const expected = slot === 'name' ? 'X-Custom' : 'preserved';
    let reads = 0;
    const target = ['X-Custom', 'preserved'];
    Object.defineProperty(target, index, {
      configurable: true,
      get() {
        reads += 1;
        Object.defineProperty(target, index, { enumerable: false });
        if (reads > 1) {
          throw new Error('getter read twice');
        }
        return expected;
      },
    });
    const row = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        if (key === String(index) && reads === 0) {
          throw new Error('initial descriptor unavailable');
        }
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    const snapshot = snapshotHeaders([row]);

    expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
    expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
    expect(reads).toBe(1);
  },
);

test('retains a replacement name getter after an initially unavailable descriptor probe', () => {
  let nameReads = 0;
  const firstName = vi.fn(() => {
    nameReads += 1;
    return 'X-Original';
  });
  const value = vi.fn(() => 'preserved');
  const target = ['X-Original', 'preserved'];
  Object.defineProperty(target, 0, { configurable: true, get: firstName });
  Object.defineProperty(target, 1, { configurable: true, get: value });
  const row = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      if (key === '0' && nameReads === 0) {
        throw new Error('initial name descriptor unavailable');
      }
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const snapshot = snapshotHeaders([row]);
  const replacementName = vi.fn(() => {
    if (replacementName.mock.calls.length > 1) {
      throw new Error('replacement name getter was reread');
    }
    return 'X-Replacement';
  });
  Object.defineProperty(target, 0, { configurable: true, get: replacementName });

  expect(snapshot.refresh().values.get('X-Replacement')).toBe('preserved');
  expect(snapshot.refresh().values.get('X-Replacement')).toBe('preserved');
  expect(firstName).toHaveBeenCalledTimes(1);
  expect(replacementName).toHaveBeenCalledTimes(1);
  expect(value).toHaveBeenCalledTimes(1);
});

test('invalidates a recovered scalar value getter after confirmed external deletion', () => {
  let reads = 0;
  let failedPostRead = false;
  const target = ['X-Custom', 'preserved'];
  Object.defineProperty(target, 1, {
    configurable: true,
    get() {
      reads += 1;
      return 'preserved';
    },
  });
  const row = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      if (key === '1' && reads === 1 && !failedPostRead) {
        failedPostRead = true;
        throw new Error('initial post-read descriptor unavailable');
      }
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const snapshot = snapshotHeaders([row]);

  expect(snapshot.refresh().values.get('X-Custom')).toBe('preserved');
  Reflect.deleteProperty(target, 1);

  expect(snapshot.refresh().values.has('X-Custom')).toBe(false);
  expect(reads).toBe(1);
});

test('does not freeze consumed columns because of an unused accessor', () => {
  const unused = vi.fn(() => 'unused');
  const row = ['Authorization', 'Bearer original'];
  Object.defineProperty(row, 2, { get: unused });
  const snapshot = snapshotHeaders([row]);
  row[1] = 'Bearer replacement';

  expect(snapshot.refresh().values.get('Authorization')).toBe('Bearer replacement');
  expect(unused).not.toHaveBeenCalled();
});

test('observes replacement of an inherited row accessor without rereading it', () => {
  const read = vi.fn(() => 'Bearer original');
  const prototype = Object.create(Array.prototype) as object;
  Object.defineProperty(prototype, 1, { configurable: true, get: read });
  const row: (string | null)[] = ['Authorization'];
  row.length = 2;
  Object.setPrototypeOf(row, prototype);
  const snapshot = snapshotHeaders([row]);
  Object.defineProperty(prototype, 1, { value: null });

  expect(snapshot.refresh().nulls.has('authorization')).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
});

test('keeps stateful row caches local through concurrent requests and later reuse', async () => {
  let reads = 0;
  const shared = ['X-Custom', ''];
  Object.defineProperty(shared, 1, {
    get() {
      reads += 1;
      return `preserved-${reads}`;
    },
  });
  const firstAuthorization: (string | null | undefined)[] = ['Authorization', undefined];
  const secondAuthorization: (string | null | undefined)[] = ['Authorization', undefined];
  const inputs = [
    [shared, firstAuthorization],
    [shared, secondAuthorization],
  ] as const;
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    firstAuthorization[1] = null;
    secondAuthorization[1] = 'Bearer independent';
    return 'subject-token';
  };
  const sent: Headers[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers));
    return Response.json({ ok: true });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    workloadIdentity: identity,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await Promise.all(inputs.map((headers) => client.get('/synthetic', { headers })));
  expect(new Set(sent.map((headers) => headers.get('X-Custom')))).toEqual(
    new Set(['preserved-1', 'preserved-2']),
  );
  expect(sent.map((headers) => headers.get('Authorization'))).toEqual(
    expect.arrayContaining([null, 'Bearer independent']),
  );
  await client.get('/synthetic', { headers: inputs[0] });
  expect(sent[2]?.get('X-Custom')).toBe('preserved-3');
  expect(reads).toBe(3);
  expect(transport.exchanges).toBe(1);
});

test.each(['requestHeaders', 'defaultHeaders'] as const)(
  'keeps the other aliased layer intact when %s is replaced',
  (layer) => {
    const read = vi.fn(() => 'preserved');
    const row = ['X-Shared', ''];
    Object.defineProperty(row, 1, { get: read });
    const shared = [row];
    const snapshots = createWorkloadHeaderSnapshots(shared, shared, {
      deferRequest: true,
      deferDefault: true,
    });
    expect(snapshots[layer].snapshot.values.get('X-Shared')).toBe('preserved');
    snapshots[layer].refresh([['X-Replacement', 'replacement']]);
    const other = layer === 'requestHeaders' ? 'defaultHeaders' : 'requestHeaders';

    expect(snapshots[other].refresh().values.get('X-Shared')).toBe('preserved');
    expect(snapshots[other].snapshot.values.has('X-Replacement')).toBe(false);
    expect(snapshots[layer].snapshot.values.has('X-Shared')).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  },
);
