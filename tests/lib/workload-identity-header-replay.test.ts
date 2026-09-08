/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected header hooks. */
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

beforeEach(() => {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable until unstubAllEnvs restores it.
  vi.stubEnv('OPENAI_API_KEY', undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable until unstubAllEnvs restores it.
  vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(['request', 'default'] as const)('%s record iterable protocol', (layer) => {
  test.each(
    (['own addition', 'inherited addition', 'getter replacement'] as const).flatMap((change) =>
      [null, 'Bearer independent'].map((authorization) => ({ change, authorization })),
    ),
  )('uses an observed $change during acquisition: $authorization', async ({ change, authorization }) => {
    const readRecord = vi.fn(() => 'record');
    const headers = {
      get 'X-Record'() {
        return readRecord();
      },
    };
    const readInitialIterator = vi.fn<() => undefined>();
    if (change === 'getter replacement') {
      Object.defineProperty(headers, Symbol.iterator, { configurable: true, get: readInitialIterator });
    }
    const rows = [
      ['Authorization', authorization],
      ['X-Protocol', 'iterable'],
    ][Symbol.iterator]();
    const iterate = vi.fn(() => rows);
    const readIterator = vi.fn(() => iterate);
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      if (change === 'inherited addition') {
        const prototype = Object.create(Object.getPrototypeOf(headers));
        Object.defineProperty(prototype, Symbol.iterator, { get: readIterator });
        Object.setPrototypeOf(headers, prototype);
      } else {
        Object.defineProperty(headers, Symbol.iterator, { configurable: true, value: iterate });
      }
      return 'subject-token';
    };
    const sent: Headers[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers);
      return sent.length === 1
        ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
        : Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await client.models.list(layer === 'request' ? { headers } : {});

    expect(sent.map((value) => value.get('Authorization'))).toEqual([authorization, authorization]);
    expect(sent.map((value) => value.get('X-Protocol'))).toEqual(['iterable', 'iterable']);
    expect(sent.every((value) => !value.has('X-Record'))).toBe(true);
    expect(readRecord).toHaveBeenCalledTimes(1);
    expect(readInitialIterator).toHaveBeenCalledTimes(change === 'getter replacement' ? 1 : 0);
    expect(readIterator).toHaveBeenCalledTimes(change === 'inherited addition' ? 1 : 0);
    expect(iterate).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  });

  test.each([false, true])('retains a non-iterable accessor that removes itself: %s', async (remove) => {
    const headers = { 'X-Record': 'record' };
    const readIterator = vi.fn(() => {
      if (remove) {
        Reflect.deleteProperty(headers, Symbol.iterator);
      }
    });
    Object.defineProperty(headers, Symbol.iterator, { configurable: true, get: readIterator });
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      const request = new Request(url, init as globalThis.RequestInit);
      sent.push(request.headers.get('Authorization'));
      expect(request.headers.get('X-Record')).toBe('record');
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list(layer === 'request' ? { headers } : {});

    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(readIterator).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(2);
  });
});

test.each(['record value', 'outer tuple', 'tuple name', 'tuple value'] as const)(
  'reads a nested %s accessor once',
  async (kind) => {
    const values = ['preserved'];
    const row = ['X-Custom', 'preserved'];
    const pairs = [row];
    const headers = kind === 'record value' ? { 'X-Custom': values } : pairs;
    const target = { 'record value': values, 'outer tuple': pairs, 'tuple name': row, 'tuple value': row }[
      kind
    ];
    const index = kind === 'tuple value' ? 1 : 0;
    const firstValue = target[index];
    const read = vi
      .fn<() => typeof firstValue>()
      .mockReturnValueOnce(firstValue)
      .mockImplementation(() => {
        throw new Error('Nested header accessor was read twice');
      });
    Object.defineProperty(target, index, { get: read });
    let sent: Headers | undefined;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent = new Headers(init?.headers);
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

    await client.models.list({ headers });

    expect(sent?.get('X-Custom')).toBe('preserved');
    expect(sent?.get('Authorization')).toBe('Bearer access-token-1');
    expect(read).toHaveBeenCalledTimes(1);
  },
);

test.each(['one-shot', 'getter'] as const)('reads a nested %s value iterator once', async (kind) => {
  const values = ['preserved'];
  const iterator = values.values();
  const iterate = vi.fn(() => iterator);
  const readIterator = vi
    .fn<() => typeof values.values>()
    .mockReturnValueOnce(Array.prototype.values)
    .mockImplementation(() => {
      throw new Error('Nested header iterator was read twice');
    });
  Object.defineProperty(
    values,
    Symbol.iterator,
    kind === 'getter' ? { get: readIterator } : { value: iterate },
  );
  let sent: Headers | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers);
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

  await client.models.list({ headers: { 'X-Custom': values } });

  expect(sent?.get('X-Custom')).toBe('preserved');
  expect(kind === 'getter' ? readIterator : iterate).toHaveBeenCalledTimes(1);
});

test('coerces a nested JavaScript header value once', async () => {
  const coerce = vi
    .fn<() => string>()
    .mockReturnValueOnce('preserved')
    .mockImplementation(() => {
      throw new Error('Header value was coerced twice');
    });
  const headers = { 'X-Custom': [{ toString: coerce }] };
  let sent: Headers | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers);
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

  // @ts-expect-error JavaScript callers can supply values that rely on Headers' string coercion.
  await client.models.list({ headers });

  expect(sent?.get('X-Custom')).toBe('preserved');
  expect(coerce).toHaveBeenCalledTimes(1);
});

test.each(['record values', 'tuple row'] as const)('refreshes ordinary mutable nested %s', async (kind) => {
  const values = ['before'];
  const row = ['X-Custom', 'before'];
  const headers = kind === 'record values' ? { 'X-Custom': values } : [row];
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    values[0] = 'after';
    row[1] = 'after';
    return 'subject-token';
  };
  let sent: Headers | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers);
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    workloadIdentity: identity,
    fetch: transport.fetch,
  });

  await client.models.list({ headers });

  expect(sent?.get('X-Custom')).toBe('after');
});

describe.each(['request', 'default'] as const)('%s nested value slots', (layer) => {
  test.each([null, 'Bearer independent'] as const)(
    'refreshes a data slot to %j beside a captured accessor during acquisition',
    async (authorization) => {
      const read = vi.fn<() => undefined>();
      const values: (string | null | undefined)[] = [undefined, undefined];
      Object.defineProperty(values, 0, { get: read });
      const headers = { Authorization: values };
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        values[1] = authorization;
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

test('retains nested accessor values independently for properties sharing a value array', async () => {
  const read = vi.fn(() => (read.mock.calls.length === 1 ? 'A' : 'B'));
  const values = ['', 'before'];
  Object.defineProperty(values, 0, { get: read });
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    values[1] = 'after';
    return 'subject-token';
  };
  const transport = createWorkloadIdentityTransport((_url, init) => {
    const sent = new Headers(init?.headers);
    expect(sent.get('X-First')).toBe('A, after');
    expect(sent.get('X-Second')).toBe('B, after');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    workloadIdentity: identity,
    fetch: transport.fetch,
  });

  await client.models.list({ headers: { 'X-First': values, 'X-Second': values } });

  expect(read).toHaveBeenCalledTimes(2);
});

test('refreshes nested slot replacements independently for aliased default and request layers', async () => {
  const original = vi.fn<() => undefined>();
  const replacement = vi.fn(() => (replacement.mock.calls.length === 1 ? undefined : null));
  const values: (string | null | undefined)[] = [undefined];
  Object.defineProperty(values, 0, { configurable: true, get: original });
  const headers = { Authorization: values };
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    Object.defineProperty(values, 0, { get: replacement });
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

class OneShotHeaders extends Array<[string, string | null]> {
  #iterator: ReturnType<[string, string | null][]['values']> | undefined;

  override [Symbol.iterator]() {
    return (this.#iterator ??= super[Symbol.iterator]());
  }
}

test.each(
  [false, true].flatMap((fresh) =>
    [false, true].flatMap((sentinel) =>
      [null, '', 'Bearer independent'].map((authorization) => ({ fresh, sentinel, authorization })),
    ),
  ),
)(
  'keeps a Headers-shaped one-shot iterator snapshot-only: %j',
  async ({ fresh, sentinel, authorization }) => {
    const SpoofedHeaders = class Headers {
      private iterator = [['Authorization', authorization] as const][Symbol.iterator]();

      entries() {
        const { iterator } = this;
        return fresh
          ? (function* replayEntries() {
              if (sentinel) {
                yield ['X-Custom', 'fixed'];
              }
              yield* iterator;
            })()
          : iterator;
      }
    };
    Object.defineProperties(SpoofedHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: SpoofedHeaders.prototype.entries },
    });
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(
      client.models.list({ headers: new SpoofedHeaders() as unknown as Headers }),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(transport.exchanges).toBe(0);
  },
);

describe.each(['authHeaders', 'bearerAuth'] as const)('one-shot defaults in %s', (hook) => {
  test.each([false, true])('lets the custom hook consume defaults first with body: %s', async (body) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        if (hook !== 'authHeaders') {
          return super.authHeaders(...args);
        }
        return this.defaultCredential();
      }

      protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
        if (hook !== 'bearerAuth') {
          return super.bearerAuth(...args);
        }
        return this.defaultCredential();
      }

      private defaultCredential() {
        const credential = new Headers(
          this._options.defaultHeaders as ConstructorParameters<typeof Headers>[0],
        ).get('X-Credential');
        return buildHeaders([{ Authorization: `Bearer ${credential ?? 'fallback'}` }]);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer intended');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      defaultHeaders: new OneShotHeaders(['X-Credential', 'intended']),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await (body ? client.post('/synthetic', { body: { synthetic: true } }) : client.models.list());
    expect(transport.exchanges).toBe(0);
  });
});

test.each(['Headers', 'array'] as const)(
  'refreshes a mutable %s through its captured native iterator without rereading the getter',
  async (kind) => {
    const headers = kind === 'Headers' ? new Headers({ 'X-Custom': 'before' }) : [['X-Custom', 'before']];
    const nativeIterator = headers[Symbol.iterator];
    const readIterator = vi.fn(() => nativeIterator);
    Object.defineProperty(headers, Symbol.iterator, { get: readIterator });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      if (headers instanceof Headers) {
        headers.set('Authorization', 'Bearer independent');
      } else {
        headers.push(['Authorization', 'Bearer independent']);
      }
      return 'subject-token';
    };
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list({ headers })).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
    expect(transport.exchanges).toBe(1);
    expect(readIterator).toHaveBeenCalledTimes(1);
  },
);

test
  .skipIf(Number(process.versions.node.split('.')[0]) < 24)
  .each(['before exchange', 'during exchange'] as const)(
  'keeps newly observed foreign credentials when another header disappears %s',
  async (phase) => {
    const { Headers: ForeignHeaders } = await import('undici');
    const headers = new ForeignHeaders({ 'X-Removed': 'initial' });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers.delete('X-Removed');
      if (phase === 'before exchange') {
        headers.set('Authorization', 'Bearer independent');
      }
      return 'subject-token';
    };
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: async (url, init) => {
        const response = await transport.fetch(url, init);
        if (phase === 'during exchange' && String(url).includes('/oauth/token')) {
          headers.set('Authorization', 'Bearer independent');
        }
        return response;
      },
      maxRetries: 0,
    });

    await expect(client.models.list({ headers: headers as unknown as Headers })).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);
