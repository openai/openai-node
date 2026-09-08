import OpenAI from 'openai';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

beforeEach(() => {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
  vi.stubEnv('OPENAI_API_KEY', undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
  vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
});

afterEach(() => vi.unstubAllEnvs());

test.each([
  'record getter',
  'proxy record getter',
  'tuple getter',
  'tuple array getter',
  'nested getter',
  'data control',
  'self-delete control',
] as const)('does not replay an externally deleted %s after a retryable response', async (kind) => {
  const read = vi.fn(() => 'before');
  const record: Record<string, string | readonly string[]> = {};
  const row = ['X-Custom', 'before'];
  const values = ['before'];
  let headers: Record<string, string | readonly string[]> | string[][];
  if (kind === 'tuple getter' || kind === 'tuple array getter') {
    Object.defineProperty(row, '1', {
      configurable: true,
      get: () => (kind === 'tuple array getter' ? [read()] : read()),
    });
    headers = [row];
  } else if (kind === 'nested getter') {
    Object.defineProperty(values, '0', { configurable: true, get: read });
    record['X-Custom'] = values;
    headers = record;
  } else if (kind === 'data control') {
    record['X-Custom'] = 'before';
    headers = record;
  } else {
    Object.defineProperty(record, 'X-Custom', {
      configurable: true,
      enumerable: true,
      get() {
        const value = read();
        if (kind === 'self-delete control') {
          delete record['X-Custom'];
        }
        return value;
      },
    });
    headers = kind === 'proxy record getter' ? new Proxy(record, { ownKeys: () => ['X-Custom'] }) : record;
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Custom'));
    if (sent.length === 1) {
      if (kind === 'tuple getter' || kind === 'tuple array getter') {
        delete row[1];
      } else if (kind !== 'self-delete control') {
        delete record['X-Custom'];
      }
      return Response.json({ error: 'synthetic retry' }, { status: 500 });
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

  expect(sent).toEqual(['before', kind === 'self-delete control' ? 'before' : null]);
  expect(read).toHaveBeenCalledTimes(kind === 'data control' ? 0 : 1);
});

test.each(['before', 'after'] as const)(
  'prefers the live alias when a getter %s it removes itself',
  async (order) => {
    const headers: Record<string, string> = {};
    if (order === 'after') {
      headers['authorization'] = 'Bearer alias';
    }
    const read = vi.fn(() => {
      delete headers['Authorization'];
      return 'Bearer getter';
    });
    Object.defineProperty(headers, 'Authorization', { configurable: true, enumerable: true, get: read });
    if (order === 'before') {
      headers['authorization'] = 'Bearer alias';
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(client.models.list({ headers })).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual(['Bearer alias']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(0);
  },
);

describe.each(['request', 'default', 'shared'] as const)('live %s record alias', (layer) => {
  test.each(['unchanged', 'reinserted'] as const)(
    'keeps the %s removal authoritative over a self-removed getter',
    async (change) => {
      const headers: Record<string, string | null> = { 'x-custom': null };
      const read = vi.fn(() => {
        delete headers['X-Custom'];
        return 'captured';
      });
      Object.defineProperty(headers, 'X-Custom', { configurable: true, enumerable: true, get: read });
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (change === 'reinserted') {
          delete headers['x-custom'];
          headers['x-custom'] = null;
        }
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('X-Custom'));
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: layer === 'request' ? undefined : headers,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.post('/synthetic', {
        headers: layer === 'default' ? undefined : headers,
        body: { input: 'synthetic' },
      });

      expect(sent).toEqual([null]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(transport.exchanges).toBe(1);
    },
  );
});

describe.each(['request', 'default', 'shared'] as const)('initially non-emitting %s alias', (layer) => {
  describe.each(['empty', 'undefined'] as const)('%s array', (initial) => {
    test.each([
      ['replacement', 401],
      ['replacement', 500],
      ['unchanged', 401],
      ['removal', 401],
    ] as const)('observes %s during token acquisition and %i', async (change, status) => {
      const values: (string | null | undefined)[] = initial === 'empty' ? [] : [undefined];
      const headers: Record<string, string | (string | null | undefined)[]> = { authorization: values };
      const read = vi.fn(() => {
        delete headers['Authorization'];
        return 'Bearer workload-identity-auth';
      });
      Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (change !== 'unchanged') {
          values[0] = change === 'replacement' ? 'Bearer independent' : null;
        }
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        const request = new Request(url, init as globalThis.RequestInit);
        expect(request.method).toBe('POST');
        sent.push(request.headers.get('Authorization'));
        return Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: layer === 'request' ? undefined : headers,
        fetch: transport.fetch,
        maxRetries: status === 500 ? 1 : 0,
      });

      await expect(
        client.post('https://independent.example.test/synthetic', {
          headers: layer === 'default' ? undefined : headers,
          body: { input: 'synthetic' },
        }),
      ).rejects.toMatchObject({ status });

      // Live aliases take precedence in every layer; an empty array still emits no override.
      const usesWorkload = change === 'unchanged';
      const first = {
        replacement: 'Bearer independent',
        unchanged: 'Bearer access-token-1',
        removal: null,
      }[change];
      const expected = [first];
      if (status === 500) {
        expected.push(first);
      } else if (usesWorkload) {
        expected.push('Bearer access-token-2');
      }
      expect(sent).toEqual(expected);
      expect(transport.exchanges).toBe(usesWorkload && status === 401 ? 2 : 1);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});

describe.each(['request', 'default'] as const)('replaced %s nested iterator alias', (layer) => {
  describe.each(['inherited', 'getter', 'self-removing getter'] as const)('%s native iterator', (initial) => {
    test.each([
      ['replacement', 401],
      ['replacement', 500],
      ['unchanged', 401],
      ['removal', 401],
    ] as const)('preserves %s during acquisition and %i', async (change, status) => {
      const values: (string | null)[] = ['Bearer initial'];
      const nativeIterator = values[Symbol.iterator];
      const readIterator = vi.fn(() => {
        if (initial === 'self-removing getter') {
          Reflect.deleteProperty(values, Symbol.iterator);
        }
        return nativeIterator;
      });
      if (initial !== 'inherited') {
        Object.defineProperty(values, Symbol.iterator, { configurable: true, get: readIterator });
      }
      const headers: Record<string, string | (string | null)[]> = { authorization: values };
      const read = vi.fn(() => {
        delete headers['Authorization'];
        return 'Bearer workload-identity-auth';
      });
      Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
      const replacement = change === 'removal' ? null : 'Bearer independent';
      const cursor = [replacement][Symbol.iterator]();
      const iterate = vi.fn(() => cursor);
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        if (change !== 'unchanged') {
          Object.defineProperty(values, Symbol.iterator, { configurable: true, value: iterate });
        }
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        const request = new Request(url, init as globalThis.RequestInit);
        expect(request.method).toBe('POST');
        sent.push(request.headers.get('Authorization'));
        return Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: layer === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: status === 500 ? 1 : 0,
      });

      await expect(
        client.post('/synthetic', {
          headers: layer === 'request' ? headers : undefined,
          body: { input: 'synthetic' },
        }),
      ).rejects.toMatchObject({ status });

      // Even an unchanged live alias takes precedence after the competing accessor disappears.
      const expected = [
        { replacement: 'Bearer independent', unchanged: 'Bearer initial', removal: null }[change],
      ];
      if (status === 500) {
        expected.push('Bearer independent');
      }
      expect(sent).toEqual(expected);
      expect(transport.exchanges).toBe(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(readIterator).toHaveBeenCalledTimes(initial === 'inherited' ? 0 : 1);
      if (change !== 'unchanged') {
        expect(iterate).toHaveBeenCalledTimes(1);
      }
    });
  });
});

test.each(
  (['shared', 'fresh'] as const).flatMap((kind) => [200, 401, 500].map((status) => ({ kind, status }))),
)(
  'preserves a replaced nested $kind cursor across aliased header layers after $status',
  async ({ kind, status }) => {
    const values = ['Bearer initial'];
    const headers: Record<string, string | string[]> = { authorization: values };
    const read = vi.fn(() => {
      delete headers['Authorization'];
      return 'Bearer workload-identity-auth';
    });
    Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
    const cursor = ['Bearer independent'][Symbol.iterator]();
    const iterate = vi.fn(() => (kind === 'shared' ? cursor : ['Bearer independent'][Symbol.iterator]()));
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      Object.defineProperty(values, Symbol.iterator, { configurable: true, value: iterate });
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport(async (url, init) => {
      const request = new Request(url, init as globalThis.RequestInit);
      expect(request.method).toBe('POST');
      expect(await request.json()).toEqual({ input: 'synthetic' });
      sent.push(request.headers.get('Authorization'));
      return Response.json(
        { ok: true },
        { status: sent.length === 1 ? status : 200, headers: { 'retry-after-ms': '0' } },
      );
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      defaultHeaders: headers,
      fetch: transport.fetch,
      maxRetries: status === 500 ? 1 : 0,
    });

    const request = client.post('/synthetic', { headers, body: { input: 'synthetic' } });
    await (status === 401
      ? expect(request).rejects.toMatchObject({ status })
      : expect(request).resolves.toEqual({ ok: true }));

    expect(sent).toEqual(
      status === 500 ? ['Bearer independent', 'Bearer independent'] : ['Bearer independent'],
    );
    expect(transport.exchanges).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(iterate).toHaveBeenCalled();
  },
);

test('discards a nested cursor observation after its property disappears', async () => {
  const values = ['first'];
  const cursor = values[Symbol.iterator]();
  Object.defineProperty(values, Symbol.iterator, { value: () => cursor });
  const headers: Record<string, string[]> = { 'X-Custom': values };
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Custom'));
    if (sent.length === 1) {
      delete headers['X-Custom'];
    } else if (sent.length === 2) {
      headers['X-Custom'] = values;
    }
    return Response.json(
      { ok: true },
      { status: sent.length < 3 ? 500 : 200, headers: { 'retry-after-ms': '0' } },
    );
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    fetch: transport.fetch,
    maxRetries: 2,
  });

  await expect(client.post('/synthetic', { headers, body: { input: 'synthetic' } })).resolves.toEqual({
    ok: true,
  });

  expect(sent).toEqual(['first', null, null]);
});

test.each(['data', 'accessor'] as const)(
  'discards a nested cursor observation after a nonempty %s replacement',
  async (kind) => {
    const first = ['first'];
    const second = ['second'];
    for (const values of [first, second]) {
      const cursor = values[Symbol.iterator]();
      Object.defineProperty(values, Symbol.iterator, { value: () => cursor });
    }
    const headers: Record<string, string[]> = {};
    const original = { configurable: true, enumerable: true, writable: true, value: first };
    Object.defineProperty(headers, 'X-Probe', original);
    const read = vi.fn(() => second);
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('X-Probe'));
      if (sent.length === 1) {
        if (kind === 'data') {
          headers['X-Probe'] = second;
        } else {
          Object.defineProperty(headers, 'X-Probe', { configurable: true, enumerable: true, get: read });
        }
      } else if (sent.length === 2) {
        Object.defineProperty(headers, 'X-Probe', original);
      }
      return Response.json(
        { ok: true },
        { status: sent.length < 4 ? 500 : 200, headers: { 'retry-after-ms': '0' } },
      );
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 3 });

    await expect(client.post('/synthetic', { headers, body: { input: 'synthetic' } })).resolves.toEqual({
      ok: true,
    });

    expect(sent).toEqual(['first', 'second', null, null]);
    expect(read).toHaveBeenCalledTimes(kind === 'accessor' ? 1 : 0);
  },
);

test('preserves a sibling layer while another observes a temporary nested replacement', async () => {
  const first = ['first'];
  const second = ['second'];
  for (const values of [first, second]) {
    const cursor = values[Symbol.iterator]();
    Object.defineProperty(values, Symbol.iterator, { value: () => cursor });
  }
  const headers: Record<string, string[]> = {};
  const original = { configurable: true, enumerable: true, writable: true, value: first };
  Object.defineProperty(headers, 'X-Probe', original);
  const read = vi.fn(() => {
    // Default headers observe the replacement; request headers still own the original observation.
    Object.defineProperty(headers, 'X-Probe', original);
    return second;
  });
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Probe'));
    if (sent.length === 1) {
      Object.defineProperty(headers, 'X-Probe', { configurable: true, enumerable: true, get: read });
    }
    return Response.json(
      { ok: true },
      { status: sent.length === 1 ? 500 : 200, headers: { 'retry-after-ms': '0' } },
    );
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 1,
  });

  await expect(client.post('/synthetic', { headers, body: { input: 'synthetic' } })).resolves.toEqual({
    ok: true,
  });

  expect(sent).toEqual(['first', 'first']);
  expect(read).toHaveBeenCalledTimes(1);
});

test('discards a nested cursor observation after its property visibility is restored', async () => {
  const values = ['first'];
  const headers: Record<string, string[]> = { 'X-Custom': values };
  const cursor = (function* valueCursor() {
    yield 'first';
    Object.defineProperty(headers, 'X-Custom', { enumerable: false });
  })();
  Object.defineProperty(values, Symbol.iterator, { value: () => cursor });
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Custom'));
    if (sent.length === 1) {
      Object.defineProperty(headers, 'X-Custom', { enumerable: true });
    }
    return Response.json(
      { ok: true },
      { status: sent.length === 1 ? 500 : 200, headers: { 'retry-after-ms': '0' } },
    );
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    fetch: transport.fetch,
    maxRetries: 1,
  });

  await expect(client.post('/synthetic', { headers, body: { input: 'synthetic' } })).resolves.toEqual({
    ok: true,
  });

  expect(sent).toEqual(['first', null]);
});

test('isolates a nested cursor observation between requests on one client', async () => {
  const values = ['Bearer initial'];
  const headers: Record<string, string | string[]> = { authorization: values };
  let current = ['Bearer initial'][Symbol.iterator]();
  const cursor = { next: () => current.next() };
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    Object.defineProperty(values, Symbol.iterator, { configurable: true, value: () => cursor });
    return 'subject-token';
  };
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ ok: true });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    workloadIdentity: identity,
    defaultHeaders: headers,
    maxRetries: 0,
    fetch: transport.fetch,
  });

  let now = Date.now();
  const readNow = vi.spyOn(Date, 'now');
  try {
    for (const credential of ['Bearer independent-first', 'Bearer independent-second']) {
      readNow.mockReturnValue(now);
      Reflect.deleteProperty(values, Symbol.iterator);
      current = [credential][Symbol.iterator]();
      Object.defineProperty(headers, 'Authorization', {
        enumerable: true,
        configurable: true,
        get() {
          delete headers['Authorization'];
          return 'Bearer workload-identity-auth';
        },
      });
      // oxlint-disable-next-line no-await-in-loop -- Reuse the same cursor only after the prior request completes.
      await expect(client.post('/synthetic', { headers, body: { input: 'synthetic' } })).resolves.toEqual({
        ok: true,
      });
      now += 3_600_000;
    }
  } finally {
    readNow.mockRestore();
  }

  expect(sent).toEqual(['Bearer independent-first', 'Bearer independent-second']);
  expect(transport.exchanges).toBe(2);
});

describe.each(['request', 'default'] as const)('replaced %s Authorization accessor', (layer) => {
  describe.each(['data', 'mixed'] as const)('%s nested alias', (kind) => {
    test.each([
      ['replacement', 401],
      ['replacement', 500],
      ['empty', 401],
      ['unchanged', 401],
      ['equivalent', 401],
      ['removal', 401],
    ] as const)(
      'preserves the observed alias after %s during token acquisition and %i',
      async (change, status) => {
        const values: (string | null | undefined)[] = ['Bearer initial'];
        const readValue = vi.fn(() => {
          if (readValue.mock.calls.length > 1) {
            throw new Error('Nested accessor was read twice');
          }
        });
        if (kind === 'mixed') {
          values.unshift(undefined);
          Object.defineProperty(values, 0, { get: readValue });
        }
        const headers: Record<string, string | (string | null | undefined)[]> = { authorization: values };
        const read = vi.fn(() => {
          delete headers['Authorization'];
          return 'Bearer workload-identity-auth';
        });
        Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
        const identity = createTestWorkloadIdentity();
        identity.provider.getToken = async () => {
          const replacement = {
            replacement: 'Bearer independent',
            empty: '',
            unchanged: 'Bearer initial',
            equivalent: ' Bearer initial ',
            removal: null,
          }[change];
          values[values.length - 1] = replacement;
          return 'subject-token';
        };
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((url, init) => {
          const request = new Request(url, init as globalThis.RequestInit);
          expect(request.method).toBe('POST');
          sent.push(request.headers.get('Authorization'));
          return Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } });
        });
        const client = new OpenAI({
          ...createTestClientOptions(),
          workloadIdentity: identity,
          defaultHeaders: layer === 'default' ? headers : undefined,
          fetch: transport.fetch,
          maxRetries: status === 500 ? 1 : 0,
        });

        await expect(
          client.post('/synthetic', {
            headers: layer === 'request' ? headers : undefined,
            body: { input: 'synthetic' },
          }),
        ).rejects.toMatchObject({ status });

        const expected: (string | null)[] = {
          replacement: ['Bearer independent'],
          empty: [''],
          unchanged: ['Bearer initial'],
          equivalent: ['Bearer initial'],
          removal: [null],
        }[change];
        if (status === 500) {
          expected.push('Bearer independent');
        }
        expect(sent).toEqual(expected);
        expect(transport.exchanges).toBe(1);
        expect(read).toHaveBeenCalledTimes(1);
        expect(readValue).toHaveBeenCalledTimes(kind === 'mixed' ? 1 : 0);
      },
    );
  });

  test.each(['Bearer independent', null] as const)(
    'prefers a changed existing alias (%s) over a self-removed accessor',
    async (replacement) => {
      const headers: Record<string, string | null> = { authorization: 'Bearer original' };
      const read = vi.fn(() => {
        delete headers['Authorization'];
        return 'Bearer workload-identity-auth';
      });
      Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        headers['authorization'] = replacement;
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        const request = new Request(url, init as globalThis.RequestInit);
        expect(request.method).toBe('POST');
        sent.push(request.headers.get('Authorization'));
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: layer === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await expect(
        client.post('/synthetic', {
          headers: layer === 'request' ? headers : undefined,
          body: { input: 'synthetic' },
        }),
      ).rejects.toMatchObject({ status: 401 });

      expect(sent).toEqual([replacement]);
      expect(transport.exchanges).toBe(1);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ['authorization', 'Bearer independent'],
    ['authorization', null],
    ['Authorization', 'Bearer independent'],
    ['Authorization', null],
  ] as const)('prefers a live %s replacement (%s) over the missing accessor', async (name, value) => {
    const headers: Record<string, string | null> = {};
    const read = vi.fn(() => 'Bearer workload-identity-auth');
    Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      delete headers['Authorization'];
      headers[name] = value;
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      defaultHeaders: layer === 'default' ? headers : undefined,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(
      client.models.list({ headers: layer === 'request' ? headers : undefined }),
    ).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual([value]);
    expect(transport.exchanges).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([null, 'Bearer independent'])(
    'observes a data property replacement during token acquisition (%s)',
    async (authorization) => {
      const read = vi.fn(() => {
        if (read.mock.calls.length > 1) {
          throw new Error('Original accessor must be read once');
        }
      });
      const headers: Record<string, string | null | undefined> = {};
      Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        await Promise.resolve();
        Object.defineProperty(headers, 'Authorization', {
          value: authorization,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return 'subject-token';
      };
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: layer === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await expect(
        client.get('https://independent.example.test/synthetic', {
          headers: layer === 'request' ? headers : undefined,
        }),
      ).rejects.toMatchObject({ status: 401 });

      expect(sent).toEqual([authorization]);
      expect(transport.exchanges).toBe(1);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});

test('applies each live default alias while a non-emitting retry retains the missing accessor', async () => {
  const values = ['Bearer initial'];
  const headers: Record<string, string | string[]> = { authorization: values };
  const read = vi.fn(() => {
    delete headers['Authorization'];
    return 'Bearer workload-identity-auth';
  });
  Object.defineProperty(headers, 'Authorization', { enumerable: true, configurable: true, get: read });
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((url, init) => {
    sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
    if (sent.length === 1) {
      values.length = 0;
    } else if (sent.length === 2) {
      values.push('Bearer independent');
    }
    return Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 2,
  });

  await expect(
    client.post('https://independent.example.test/synthetic', { body: { input: 'synthetic' } }),
  ).rejects.toMatchObject({ status: 500 });

  expect(sent).toEqual(['Bearer initial', 'Bearer access-token-1', 'Bearer independent']);
  expect(transport.exchanges).toBe(1);
  expect(read).toHaveBeenCalledTimes(1);
});

describe.each(['request', 'default'] as const)('%s header alias ordering', (layer) => {
  test.each([
    ['Authorization', null],
    ['Authorization', 'Bearer existing-live'],
    ['X-Probe', null],
    ['X-Probe', 'existing-live'],
  ] as const)(
    'restores the surviving %s alias %j after removing a temporary alias',
    async (name, existing) => {
      const headers: Record<string, string | null> = {};
      const read = vi.fn(() => {
        Reflect.deleteProperty(headers, name);
        return 'captured-stale';
      });
      Object.defineProperty(headers, name, { configurable: true, enumerable: true, get: read });
      const liveAlias = name.toLowerCase();
      const temporaryAlias = name.toUpperCase();
      headers[liveAlias] = existing;
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get(name));
        if (sent.length < 3) {
          if (sent.length === 1) {
            headers[temporaryAlias] = 'temporary-live';
          } else {
            Reflect.deleteProperty(headers, temporaryAlias);
          }
          return Response.json({}, { status: 500, headers: { 'retry-after-ms': '1' } });
        }
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 2,
        ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      });

      await client.models.list(layer === 'request' ? { headers } : {});

      expect(sent).toEqual([existing, 'temporary-live', existing]);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});
