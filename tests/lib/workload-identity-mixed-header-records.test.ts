import OpenAI from 'openai';
import { buildHeaders, snapshotHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['prepareOptions', 'authHeaders', 'bearerAuth'] as const)('captured %s records', (hook) => {
  describe.each(['request', 'default'] as const)('captured mixed %s records', (layer) => {
    test.each([null, 'Bearer independent'] as const)(
      'refreshes ordinary Authorization after preparation captured the accessor: %j',
      async (authorization) => {
        let reads = 0;
        const headers: Record<string, string | null | undefined> = { Authorization: undefined };
        Object.defineProperty(headers, 'X-Custom', {
          enumerable: true,
          configurable: true,
          get() {
            reads += 1;
            delete headers['X-Custom'];
            return 'preserved';
          },
        });
        class InspectClient extends OpenAI {
          // oxlint-disable-next-line class-methods-use-this -- The fixture inspects a supplied record before authentication.
          protected override async prepareOptions() {
            if (hook === 'prepareOptions') {
              expect(buildHeaders([headers]).values.get('X-Custom')).toBe('preserved');
            }
          }
          protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
            if (hook === 'authHeaders') {
              expect(buildHeaders([headers]).values.get('X-Custom')).toBe('preserved');
            }
            return super.authHeaders(...args);
          }
          protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
            if (hook === 'bearerAuth') {
              expect(buildHeaders([headers]).values.get('X-Custom')).toBe('preserved');
            }
            return super.bearerAuth(...args);
          }
        }
        const identity = createTestWorkloadIdentity();
        identity.provider.getToken = async () => {
          headers['Authorization'] = authorization;
          return 'subject-token';
        };
        const transport = createWorkloadIdentityTransport((_url, init) => {
          const actual = new Headers(init?.headers);
          expect(actual.get('Authorization')).toBe(authorization);
          expect(actual.get('X-Custom')).toBe('preserved');
          return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
        });
        const client = new InspectClient({
          ...createTestClientOptions(),
          apiKey: null,
          workloadIdentity: identity,
          ...(layer === 'default' ? { defaultHeaders: headers } : {}),
          fetch: transport.fetch,
          maxRetries: 0,
        });

        await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
          status: 401,
        });
        expect(reads).toBe(1);
        expect(transport.exchanges).toBe(1);
      },
    );
  });
});

describe.each(['request', 'default'] as const)('mixed %s header records', (layer) => {
  describe.each(['direct', 'nested'] as const)('%s getter', (kind) => {
    test.each([null, '', 'Bearer independent'] as const)(
      'observes Authorization replacement %j during token acquisition',
      async (authorization) => {
        const read = vi.fn(() => {
          if (read.mock.calls.length > 1) {
            throw new Error('Stateful header was read twice');
          }
          return 'preserved';
        });
        const headers: Record<string, string | null | string[] | undefined> = { Authorization: undefined };
        if (kind === 'direct') {
          Object.defineProperty(headers, 'X-Custom', { enumerable: true, get: read });
        } else {
          const values = ['preserved'];
          Object.defineProperty(values, '0', { get: read });
          headers['X-Custom'] = values;
        }
        const identity = createTestWorkloadIdentity();
        identity.provider.getToken = async () => {
          headers['Authorization'] = authorization;
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
          maxRetries: 0,
          ...(layer === 'default' ? { defaultHeaders: headers } : {}),
          fetch: transport.fetch,
        });

        await expect(
          client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {}),
        ).rejects.toMatchObject({ status: 401 });

        expect(sent).toEqual([authorization]);
        expect(transport.exchanges).toBe(1);
        expect(read).toHaveBeenCalledTimes(1);
      },
    );
  });
});

describe.each(['request', 'default'] as const)('retained %s data properties', (layer) => {
  describe.each(['nested', 'coercion'] as const)('%s value', (kind) => {
    test.each([false, true])('observes outer property replacement: %s', async (replace) => {
      const name = kind === 'nested' ? 'Authorization' : 'X-Custom';
      const read = vi.fn(() => (kind === 'nested' ? undefined : 'before'));
      const headers: Record<string, string | readonly (string | undefined)[] | undefined> = {};
      if (kind === 'nested') {
        const values = [undefined];
        Object.defineProperty(values, '0', { get: read });
        headers[name] = values;
      } else {
        // @ts-expect-error JavaScript callers can supply values coerced by Headers.append.
        headers[name] = { toString: read };
      }
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (replace) {
          headers[name] = kind === 'nested' ? 'Bearer independent' : 'after';
        }
        return 'subject-token';
      };
      const sent: Headers[] = [];
      const rejected = kind === 'nested' && replace;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        return rejected
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
      const request = client.get(
        'https://independent.example.test/synthetic',
        layer === 'request' ? { headers } : {},
      );

      await (rejected ? expect(request).rejects.toMatchObject({ status: 401 }) : request);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.get('Authorization')).toBe(rejected ? 'Bearer independent' : 'Bearer access-token-1');
      if (kind === 'coercion') {
        expect(sent[0]?.get('X-Custom')).toBe(replace ? 'after' : 'before');
      }
      expect(transport.exchanges).toBe(1);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});

test.each(['direct', 'nested', 'coercion'] as const)(
  'refreshes ordinary data additions and deletions alongside a retained %s value',
  (kind) => {
    const read = vi.fn(() => 'preserved');
    const headers: Record<string, unknown> = { Authorization: 'Bearer first', 'X-Deleted': 'before' };
    if (kind === 'direct') {
      Object.defineProperty(headers, 'X-Custom', { enumerable: true, get: read });
    } else if (kind === 'nested') {
      const values = ['preserved'];
      Object.defineProperty(values, '0', { get: read });
      headers['X-Custom'] = values;
    } else {
      headers['X-Custom'] = { toString: read };
    }
    const snapshot = snapshotHeaders(headers as Record<string, string>);

    delete headers['Authorization'];
    delete headers['X-Deleted'];
    headers['X-Added'] = 'after';
    let current = snapshot.refresh();
    expect(current.values.get('Authorization')).toBeNull();
    expect(current.values.get('X-Deleted')).toBeNull();
    expect(current.values.get('X-Added')).toBe('after');
    expect(current.values.get('X-Custom')).toBe('preserved');

    headers['Authorization'] = null;
    current = snapshot.refresh();
    expect(current.nulls.has('authorization')).toBe(true);
    headers['Authorization'] = 'Bearer replacement';
    current = snapshot.refresh();
    expect(current.values.get('Authorization')).toBe('Bearer replacement');
    expect(read).toHaveBeenCalledTimes(1);
  },
);

test('retains an empty accessor snapshot while refreshing other keys', () => {
  const read = vi.fn<() => undefined>();
  const headers = {
    'X-Live': 'before',
    get 'X-Empty'() {
      return read();
    },
  };
  const snapshot = snapshotHeaders(headers);
  headers['X-Live'] = 'after';

  expect(snapshot.refresh().values.get('X-Live')).toBe('after');
  expect(snapshot.refresh().values.has('X-Empty')).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
});

test.each(['request', 'default'] as const)(
  'uses a data property replacing a self-deleting %s Authorization accessor',
  async (layer) => {
    const headers: Record<string, string | undefined> = {};
    const read = vi.fn(() => {
      delete headers['Authorization'];
    });
    Object.defineProperty(headers, 'Authorization', { configurable: true, enumerable: true, get: read });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers['Authorization'] = 'Bearer independent';
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

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(sent).toEqual(['Bearer independent']);
    expect(transport.exchanges).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  },
);

test('preserves a self-deleting accessor before a live case-insensitive alias', () => {
  const headers = { 'X-Custom': 'initial', 'x-custom': 'winning' };
  const read = vi.fn(() => {
    delete (headers as Partial<typeof headers>)['X-Custom'];
    return 'retained';
  });
  Object.defineProperty(headers, 'X-Custom', { configurable: true, enumerable: true, get: read });
  const snapshot = snapshotHeaders(headers);
  headers['x-custom'] = 'updated';

  expect(snapshot.refresh().values.get('X-Custom')).toBe('updated');
  delete (headers as Partial<typeof headers>)['x-custom'];
  expect(snapshot.refresh().values.get('X-Custom')).toBe('retained');
  expect(read).toHaveBeenCalledTimes(1);
});

test('resets property snapshots when the caller replaces the header source', () => {
  const first = vi.fn(() => 'first');
  const second = vi.fn(() => 'second');
  const snapshot = snapshotHeaders({
    get 'X-Custom'() {
      return first();
    },
  });

  expect(
    snapshot
      .refresh({
        get 'X-Custom'() {
          return second();
        },
      })
      .values.get('X-Custom'),
  ).toBe('second');
  expect(snapshot.refresh().values.get('X-Custom')).toBe('second');
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

test.each(['request', 'default'] as const)(
  'retains the %s record protocol when an accessor adds an iterator',
  async (layer) => {
    const headers = { Authorization: null };
    const read = vi.fn(() => {
      Object.defineProperty(headers, Symbol.iterator, {
        *value() {
          yield ['X-Custom', 'preserved'];
        },
      });
      return 'preserved';
    });
    Object.defineProperty(headers, 'X-Custom', { enumerable: true, get: read });
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      expect(actual.has('Authorization')).toBe(false);
      expect(actual.get('X-Custom')).toBe('preserved');
      return Response.json({ ok: true });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      workloadIdentity: createTestWorkloadIdentity(),
      maxRetries: 0,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
    });

    await client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {});

    expect(transport.exchanges).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  },
);

test.each(['request', 'default'] as const)(
  'refreshes an ordinary %s Authorization tuple beside a retained outer slot',
  async (layer) => {
    const authorizationRow: [string, string | undefined] = ['Authorization', undefined];
    const headers = [['X-Custom', 'initial'], authorizationRow];
    const read = vi.fn(() => ['X-Custom', 'preserved']);
    Object.defineProperty(headers, 0, { get: read });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      authorizationRow[1] = 'Bearer independent';
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      expect(actual.get('Authorization')).toBe('Bearer independent');
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

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(['request', 'default'] as const)(
  'invalidates a retained outer %s slot when it is replaced',
  async (layer) => {
    const headers: [string, string][] = [['X-Custom', 'initial']];
    const read = vi.fn(() => ['X-Custom', 'preserved'] as [string, string]);
    Object.defineProperty(headers, 0, { configurable: true, get: read });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers.length = 0;
      headers.push(['Authorization', 'Bearer independent']);
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      expect(actual.get('Authorization')).toBe('Bearer independent');
      expect(actual.has('X-Custom')).toBe(false);
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

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(['request', 'default'] as const)(
  'invalidates a retained outer %s slot when its accessor is replaced',
  async (layer) => {
    const headers: [string, string][] = [['X-Custom', 'initial']];
    const read = vi.fn(() => ['X-Custom', 'preserved'] as [string, string]);
    Object.defineProperty(headers, 0, { configurable: true, get: read });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      Object.defineProperty(headers, 0, {
        configurable: true,
        get: () => ['Authorization', 'Bearer independent'],
      });
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      expect(actual.get('Authorization')).toBe('Bearer independent');
      expect(actual.has('X-Custom')).toBe(false);
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

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('retains distinct Set-Cookie values from a stateful property', () => {
  const read = vi.fn(() => ['a=1', 'b=2']);
  const snapshot = snapshotHeaders({
    get 'Set-Cookie'() {
      return read();
    },
  });

  expect(snapshot.snapshot.values.getSetCookie()).toEqual(['a=1', 'b=2']);
  expect(snapshot.refresh().values.getSetCookie()).toEqual(['a=1', 'b=2']);
  expect(snapshot.refresh().values.getSetCookie()).toEqual(['a=1', 'b=2']);
  expect(read).toHaveBeenCalledTimes(1);
});

test.each(['request', 'default'] as const)(
  'refreshes an ordinary %s Authorization tuple beside a retained stateful row',
  async (layer) => {
    const customRow = ['X-Custom', 'initial'];
    const read = vi.fn(() => 'preserved');
    Object.defineProperty(customRow, 1, { get: read });
    const authorizationRow: [string, string | undefined] = ['Authorization', undefined];
    const headers = [customRow, authorizationRow];
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      authorizationRow[1] = 'Bearer independent';
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const actual = new Headers(init?.headers);
      expect(actual.get('Authorization')).toBe('Bearer independent');
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

    await expect(client.models.list(layer === 'request' ? { headers } : {})).rejects.toMatchObject({
      status: 401,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);
