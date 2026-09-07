/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected header hooks. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { runInNewContext } from 'node:vm';
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { buildHeaders, snapshotHeaders, getRequestHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
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

test('does not classify URL inputs by evaluating their tag', () => {
  const url = new URL('https://api.example.test/models');
  Object.defineProperty(url, Symbol.toStringTag, {
    get() {
      throw new Error('Unrelated URL tag getter must not run');
    },
  });
  expect(getRequestHeaders(url)).toBeUndefined();
  expect(getRequestHeaders(url.href)).toBeUndefined();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

class OneShotHeaders extends Array<[string, string | null]> {
  #iterator: ReturnType<[string, string | null][]['values']> | undefined;

  override [Symbol.iterator]() {
    return (this.#iterator ??= super[Symbol.iterator]());
  }
}

test('keeps a Headers-shaped one-shot iterator snapshot-only', async () => {
  const SpoofedHeaders = class Headers {
    private iterator = [['Authorization', null] as const][Symbol.iterator]();

    entries() {
      return this.iterator;
    }
  };
  Object.defineProperties(SpoofedHeaders.prototype, {
    [Symbol.toStringTag]: { value: 'Headers' },
    [Symbol.iterator]: { value: SpoofedHeaders.prototype.entries },
  });
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await expect(
    client.models.list({ headers: new SpoofedHeaders() as unknown as Headers }),
  ).rejects.toMatchObject({
    status: 401,
  });
  expect(transport.exchanges).toBe(0);
});

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

test.each(['same client', 'separate clients'] as const)(
  'does not share accessor-backed default header snapshots between concurrent requests: %s',
  async (kind) => {
    const authorization = new AsyncLocalStorage<string | null | undefined>();
    const defaultHeaders = {
      get Authorization() {
        return authorization.getStore();
      },
    };
    const sent: { url: string; authorization: string | null }[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push({ url: url.toString(), authorization: new Headers(init?.headers).get('Authorization') });
      return Response.json({ data: [] });
    });
    const createClient = () =>
      new OpenAI({ ...createTestClientOptions(), defaultHeaders, fetch: transport.fetch, maxRetries: 0 });
    const firstClient = createClient();
    const secondClient = kind === 'same client' ? firstClient : createClient();

    await Promise.all([
      authorization.run('Bearer tenant-a', () => firstClient.models.list()),
      authorization.run(null, () =>
        secondClient.post('https://synthetic.example.test/resource', { body: { synthetic: true } }),
      ),
    ]);

    expect(sent).toEqual([
      { url: 'https://api.openai.com/v1/models', authorization: 'Bearer tenant-a' },
      { url: 'https://synthetic.example.test/resource', authorization: null },
    ]);
    expect(transport.exchanges).toBe(0);
  },
);

test('does not share accessor-backed request header snapshots between concurrent hooks', async () => {
  const credential = new AsyncLocalStorage<string>();
  const requestHeaders = {
    get 'X-Credential'() {
      return credential.getStore();
    },
  };
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture derives authentication from request headers.
    protected override async authHeaders(options: FinalRequestOptions) {
      const value = buildHeaders([options.headers]).values.get('X-Credential');
      return buildHeaders([{ Authorization: `Bearer ${value}` }]);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ data: [] });
  });
  const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await Promise.all([
    credential.run('tenant-a', () => client.models.list({ headers: requestHeaders })),
    credential.run('tenant-b', () => client.models.list({ headers: requestHeaders })),
  ]);

  expect(sent).toEqual(['Bearer tenant-a', 'Bearer tenant-b']);
  expect(transport.exchanges).toBe(0);
});

test('keeps tagged array subclasses with inherited one-shot iterators snapshot-only', async () => {
  class TaggedHeaders extends OneShotHeaders {}
  const iterator = TaggedHeaders.prototype[Symbol.iterator];
  Object.defineProperties(TaggedHeaders.prototype, {
    [Symbol.toStringTag]: { value: 'Headers' },
    [Symbol.iterator]: { value: iterator },
    entries: { value: iterator },
  });
  class HookClient extends OpenAI {
    protected override async authHeaders(options: FinalRequestOptions) {
      return super.authHeaders(options);
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    return Response.json({ data: [] });
  });
  const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers: new TaggedHeaders(['Authorization', null]) });
});

test.each(['local', 'foreign'] as const)(
  'reads an accessor-backed native %s array iterator once',
  async (realm) => {
    const headers: string[][] =
      realm === 'local' ? [['X-Custom', 'preserved']] : runInNewContext("[['X-Custom', 'preserved']]");
    const nativeIterator = headers[Symbol.iterator];
    const readIterator = vi.fn(() => nativeIterator);
    Object.defineProperty(headers, Symbol.iterator, { get: readIterator });
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

    await client.models.list({ headers });

    expect(readIterator).toHaveBeenCalledTimes(1);
  },
);

test.each(['own', 'inherited'] as const)(
  'reads an accessor-backed native Headers iterator once (%s protocol)',
  async (location) => {
    const headers = new Headers({ 'X-Custom': 'preserved' });
    const nativeIterator = headers[Symbol.iterator];
    const readIterator = vi.fn(() => nativeIterator);
    const target = location === 'own' ? headers : Object.create(Object.getPrototypeOf(headers));
    Object.defineProperty(target, Symbol.iterator, { get: readIterator });
    if (location === 'inherited') {
      Object.setPrototypeOf(headers, target);
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

    await client.models.list({ headers });

    expect(readIterator).toHaveBeenCalledTimes(1);
  },
);

test('lets a custom auth hook read one-shot headers on a bodyless request', async () => {
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture derives authentication from request headers.
    protected override async authHeaders(options: FinalRequestOptions) {
      const credential = buildHeaders([options.headers]).values.get('X-Credential');
      return buildHeaders([{ Authorization: `Bearer ${credential ?? 'fallback'}` }]);
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer intended');
    return Response.json({ data: [] });
  });
  const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers: new OneShotHeaders(['X-Credential', 'intended']) });
});

describe.each(['request', 'default'] as const)('%s header preflight changes', (location) => {
  test.each(['in-place', 'replacement'] as const)(
    'authenticates after %s removal of a preflight override',
    async (update) => {
      const headers: Record<string, string> = {
        Authorization: 'Bearer independent',
        'X-Custom': 'before',
      };
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          // Preflight runs synchronously; this mutation runs while authentication yields.
          queueMicrotask(() => {
            const replacement = { 'X-Custom': 'after' };
            if (update === 'in-place') {
              delete headers['Authorization'];
              Object.assign(headers, replacement);
            } else if (location === 'request') {
              args[0].headers = replacement;
            } else {
              this._options.defaultHeaders = replacement;
            }
          });
          return super.buildRequest(...args);
        }
      }
      let sent: Headers | undefined;
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent = new Headers(init?.headers);
        return Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        defaultHeaders: location === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list({ headers: location === 'request' ? headers : undefined });

      expect(sent?.get('Authorization')).toBe('Bearer access-token-1');
      expect(sent?.get('X-Custom')).toBe('after');
      expect(transport.exchanges).toBe(1);
    },
  );
});

test('uses a request header layer replaced during token acquisition', async () => {
  const options: FinalRequestOptions = {
    method: 'get',
    path: '/synthetic',
    headers: { 'X-Custom': 'original' },
  };
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    options.headers = { Authorization: 'Bearer independent', 'X-Custom': 'replacement' };
    return 'subject-token';
  };
  const transport = createWorkloadIdentityTransport((_url, init) => {
    const sent = new Headers(init?.headers);
    expect(sent.get('Authorization')).toBe('Bearer independent');
    expect(sent.get('X-Custom')).toBe('replacement');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    workloadIdentity: identity,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.request(options);
  expect(transport.exchanges).toBe(1);
});

test('uses a complete default header replacement made during token acquisition', async () => {
  class DefaultHeaderClient extends OpenAI {
    replaceDefaults() {
      this._options.defaultHeaders = {
        Authorization: 'Bearer independent',
        'X-Custom': 'replacement',
      };
    }
  }
  const identity = createTestWorkloadIdentity();
  // oxlint-disable-next-line prefer-const -- The provider captures the client before construction snapshots it.
  let client: DefaultHeaderClient;
  identity.provider.getToken = async () => {
    await Promise.resolve();
    client.replaceDefaults();
    return 'subject-token';
  };
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
    const sent = new Headers(init?.headers);
    expect(sent.get('Authorization')).toBe('Bearer independent');
    expect(sent.get('X-Custom')).toBe('replacement');
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  client = new DefaultHeaderClient({
    ...createTestClientOptions(),
    defaultHeaders: { 'X-Custom': 'original' },
    workloadIdentity: identity,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
  expect(calls).toBe(1);
  expect(transport.exchanges).toBe(1);
});

test.each(['Headers', 'array'] as const)('reads a changing %s iterator getter only once', async (kind) => {
  const headers = kind === 'Headers' ? new Headers({ 'X-Custom': 'preserved' }) : [['X-Custom', 'preserved']];
  const iterator = headers[Symbol.iterator];
  let reads = 0;
  Object.defineProperty(headers, Symbol.iterator, {
    get() {
      reads += 1;
      return reads === 1 ? iterator : () => [][Symbol.iterator]();
    },
  });
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers });

  expect(reads).toBe(1);
});

test.each(['Bearer previous', null, ''] as const)(
  'uses a request header layer replaced during body serialization (previous: %j)',
  async (previousAuthorization) => {
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/synthetic',
      headers: { Authorization: previousAuthorization },
    };
    options.body = {
      toJSON() {
        options.headers = { Authorization: 'Bearer independent', 'X-Custom': 'replacement' };
        return { synthetic: true };
      },
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const sent = new Headers(init?.headers);
      expect(sent.get('Authorization')).toBe('Bearer independent');
      expect(sent.get('X-Custom')).toBe('replacement');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.request(options);
    expect(transport.exchanges).toBe(0);
  },
);

test('snapshots a custom iterable with aligned one-shot methods', async () => {
  const iterator = [['X-Custom', 'preserved']].values();
  const iterate = vi.fn(() => iterator);
  const headers = Object.create({ entries: iterate, [Symbol.iterator]: iterate });
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

  await client.models.list({ headers });

  expect(iterate).toHaveBeenCalledTimes(1);
});

test.each(['authHeaders', 'bearerAuth'] as const)(
  'retains one-shot authorization removal through a delegating %s hook',
  async (hook) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(
        options: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        return super.authHeaders(options, schemes);
      }

      protected override async bearerAuth(options: FinalRequestOptions) {
        return super.bearerAuth(options);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const sent = new Headers(init?.headers);
      expect(sent.has('Authorization')).toBe(false);
      expect(sent.get('X-Custom')).toBe('keep-me');
      return Response.json({ ok: true });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    // Exercise each hook independently while preserving the subclass delegation.
    Object.defineProperty(client, hook === 'authHeaders' ? 'bearerAuth' : 'authHeaders', {
      value: Object.getOwnPropertyDescriptor(
        OpenAI.prototype,
        hook === 'authHeaders' ? 'bearerAuth' : 'authHeaders',
      )?.value,
    });

    await client.post('https://example.test/synthetic', {
      body: { synthetic: true },
      headers: new OneShotHeaders(['Authorization', null], ['X-Custom', 'keep-me']),
    });
  },
);

test('uses a complete request header replacement made by a delegating auth hook', async () => {
  class HookClient extends OpenAI {
    protected override async authHeaders(
      options: FinalRequestOptions,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      context?: object,
    ) {
      const headers = await super.authHeaders(options, schemes, context);
      options.headers = { Authorization: 'Bearer independent', 'X-Custom': 'replacement' };
      return headers;
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    const headers = new Headers(init?.headers);
    sent.push(headers.get('Authorization'));
    expect(headers.get('X-Custom')).toBe('replacement');
    return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  });
  const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await expect(
    client.post('/synthetic', {
      body: { synthetic: true },
      headers: new OneShotHeaders(['X-Custom', 'original']),
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(sent).toEqual(['Bearer independent']);
});

test('preserves removal of the request header layer by an auth hook', async () => {
  class HookClient extends OpenAI {
    protected override async authHeaders(
      options: FinalRequestOptions,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      context?: object,
    ) {
      const headers = await super.authHeaders(options, schemes, context);
      delete options.headers;
      return headers;
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Custom')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer access-token-1');
    return Response.json({ data: [] });
  });
  const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers: { 'X-Custom': 'removed' } });
});

test.each(['entries', Symbol.toStringTag])(
  'does not evaluate the overridden %s getter on platform Headers',
  async (property) => {
    const headers = new Headers({ 'X-Custom': 'before' });
    Object.defineProperty(headers, property, {
      get() {
        throw new Error('Unrelated getter must not run');
      },
    });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers.set('X-Custom', 'after');
      headers.set('Authorization', 'Bearer independent');
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('after');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: transport.fetch,
    });

    await client.models.list({ headers });
    expect(transport.exchanges).toBe(1);
  },
);

test('retains inherited one-shot header iterators during credential acquisition', async () => {
  const headers = new OneShotHeaders(['X-Custom', 'keep-me']);
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Custom')).toBe('keep-me');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers });
  expect(transport.exchanges).toBe(1);
});

test.each(['own', 'inherited'] as const)(
  'reads a non-callable %s iterator getter only once',
  async (location) => {
    const headers = { 'X-Custom': 'preserved' };
    let reads = 0;
    const target = location === 'own' ? headers : Object.create(Object.getPrototypeOf(headers));
    Object.defineProperty(target, Symbol.iterator, {
      get() {
        expect(this).toBe(headers);
        reads += 1;
        if (reads > 1) {
          throw new Error('Iterator getter was evaluated twice');
        }
        // oxlint-disable-next-line no-useless-return -- This getter intentionally supplies no callable protocol.
        return;
      },
    });
    if (location === 'inherited') {
      Object.setPrototypeOf(headers, target);
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch });

    await client.models.list({ headers });

    expect(reads).toBe(1);
  },
);

test('reads record getters eagerly before validating header names', () => {
  const read = vi.fn(() => 'preserved');
  const headers = {
    'invalid name': 'invalid',
    get 'X-Custom'() {
      return read();
    },
  };

  expect(() => snapshotHeaders(headers)).toThrow(TypeError);

  expect(read).toHaveBeenCalledTimes(1);
});

for (const location of ['request', 'default'] as const) {
  test.each(['throw', 'delete'] as const)(
    `reads accessor-backed ${location} headers once (getter: %s)`,
    async (behavior) => {
      const headers: Record<string, string> = {};
      let reads = 0;
      Object.defineProperty(headers, 'X-Custom', {
        enumerable: true,
        configurable: true,
        get() {
          expect(this).toBe(headers);
          reads += 1;
          if (reads > 1) {
            throw new Error('Header getter was evaluated twice');
          }
          if (behavior === 'delete') {
            delete headers['X-Custom'];
          }
          return 'preserved';
        },
      });
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        defaultHeaders: location === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list({ headers: location === 'request' ? headers : undefined });

      expect(reads).toBe(1);
      expect(transport.exchanges).toBe(1);
    },
  );

  test(`refreshes mutable data-only ${location} header records after credential acquisition`, async () => {
    const headers = { 'X-Custom': 'before' };
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers['X-Custom'] = 'after';
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('after');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      defaultHeaders: location === 'default' ? headers : undefined,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers: location === 'request' ? headers : undefined });
  });

  test.skipIf(Number(process.versions.node.split('.')[0]) < 24)(
    `refreshes reusable foreign Headers from ${location} options after credential acquisition`,
    async () => {
      const { Headers: ForeignHeaders } = await import('undici');
      const headers = new ForeignHeaders({ 'X-Custom': 'before' });
      expect(headers).not.toBeInstanceOf(Headers);
      const identity = createTestWorkloadIdentity();
      identity.provider.getToken = async () => {
        await Promise.resolve();
        headers.set('X-Custom', 'after');
        headers.set('Authorization', 'Bearer independent');
        return 'subject-token';
      };
      const transport = createWorkloadIdentityTransport((_url, init) => {
        expect(new Headers(init?.headers).get('X-Custom')).toBe('after');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        workloadIdentity: identity,
        defaultHeaders: location === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list({ headers: location === 'request' ? headers : undefined });
      expect(transport.exchanges).toBe(1);
    },
  );
}

test.each(['native Headers', 'array', 'foreign array'] as const)(
  'refreshes ordinary reusable %s after credential acquisition',
  async (kind) => {
    let headers: Headers | string[][];
    if (kind === 'native Headers') {
      headers = new Headers({ 'X-Custom': 'before' });
    } else if (kind === 'foreign array') {
      headers = runInNewContext('[["X-Custom", "before"]]');
      expect(headers).not.toBeInstanceOf(Array);
    } else {
      headers = [['X-Custom', 'before']];
    }
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      await Promise.resolve();
      if (headers instanceof Headers) {
        headers.set('X-Custom', 'after');
      } else {
        headers[0] = ['X-Custom', 'after'];
      }
      return 'subject-token';
    };
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('X-Custom')).toBe('after');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers });
    expect(transport.exchanges).toBe(1);
  },
);

test.each(['own', 'inherited'] as const)(
  'reuses %s one-shot header overrides for body encoding and authentication',
  async (kind) => {
    const headers = new OneShotHeaders(['Authorization', null], ['X-Custom', 'keep-me']);
    const iterate = vi.fn(headers[Symbol.iterator].bind(headers));
    if (kind === 'own') {
      headers[Symbol.iterator] = iterate;
    }
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = vi.fn(async () => {
      throw new Error('Unused subject token provider is unavailable');
    });
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(init?.headers).get('X-Custom')).toBe('keep-me');
      expect(init?.body).toBe('{"synthetic":true}');
      return Response.json({ ok: true });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.post('/synthetic', { body: { synthetic: true }, headers });
    expect(transport.exchanges).toBe(0);
    expect(identity.provider.getToken).not.toHaveBeenCalled();
    if (kind === 'own') {
      expect(iterate).toHaveBeenCalledTimes(1);
    }
  },
);

test.each([null, ''] as const)(
  'retains a one-shot authorization override materialized by prepareOptions: %j',
  async (authorization) => {
    const options: FinalRequestOptions = {
      method: 'post',
      path: 'https://synthetic.example.test/resource',
      body: { synthetic: true },
      headers: new OneShotHeaders(['Authorization', authorization], ['X-Custom', 'keep-me']),
    };
    class InspectingClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This instance override exercises the protected preparation hook.
      protected override async prepareOptions(received: FinalRequestOptions) {
        expect(received).toBe(options);
        received.headers = buildHeaders([received.headers]);
      }
    }
    const transport = createWorkloadIdentityTransport((url, init) => {
      expect(url.toString()).toBe(options.path);
      expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
      expect(new Headers(init?.headers).get('X-Custom')).toBe('keep-me');
      expect(init?.body).toBe('{"synthetic":true}');
      return Response.json({ ok: true });
    });
    const client = new InspectingClient({
      ...createTestClientOptions(),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.request(options);
    expect(transport.exchanges).toBe(0);
  },
);

test.each(['mutate', 'replace', 'delete'] as const)(
  'preserves prepareOptions header changes before the first SDK snapshot: %s',
  async (change) => {
    const headers: { Authorization: string | null } = { Authorization: null };
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/synthetic',
      body: { synthetic: true },
      headers,
    };
    class PreparingClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This instance override exercises the protected preparation hook.
      protected override async prepareOptions(received: FinalRequestOptions) {
        expect(received).toBe(options);
        if (change === 'mutate') {
          headers.Authorization = 'Bearer independent';
        } else if (change === 'replace') {
          received.headers = new OneShotHeaders(['Authorization', 'Bearer independent']);
        } else {
          delete received.headers;
        }
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        change === 'delete' ? 'Bearer access-token-1' : 'Bearer independent',
      );
      return Response.json({ data: [] });
    });
    const client = new PreparingClient({
      ...createTestClientOptions(),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.request(options);
    expect(transport.exchanges).toBe(change === 'delete' ? 1 : 0);
  },
);

describe.each(['request', 'default'] as const)('one-shot %s headers', (location) => {
  test.each([null, '', undefined] as const)(
    'retains headers through automatic retries: %j',
    async (authorization) => {
      const headers = new OneShotHeaders(['X-Custom', 'keep-me']);
      if (authorization !== undefined) {
        headers.push(['Authorization', authorization]);
      }
      const sent: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        return sent.length === 1
          ? Response.json(
              { error: { message: 'Synthetic retry' } },
              { status: authorization === undefined ? 401 : 500, headers: { 'retry-after-ms': '1' } },
            )
          : Response.json({ ok: true });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        defaultHeaders: location === 'default' ? headers : undefined,
        fetch: transport.fetch,
        maxRetries: 1,
      });

      await client.post('https://synthetic.example.test/resource', {
        body: { synthetic: true },
        headers: location === 'request' ? headers : undefined,
      });

      expect(sent.map((value) => value.get('Authorization'))).toEqual(
        authorization === undefined
          ? ['Bearer access-token-1', 'Bearer access-token-2']
          : [authorization, authorization],
      );
      expect(sent.map((value) => value.get('X-Custom'))).toEqual(['keep-me', 'keep-me']);
      expect(transport.exchanges).toBe(authorization === undefined ? 2 : 0);
    },
  );
});

test('releases preparation state before reusing options with a legacy authentication hook', async () => {
  const options: FinalRequestOptions = { method: 'get', path: '/models' };
  const preparationError = new Error('Synthetic preparation failure');
  let preparations = 0;
  class PreparingClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This instance override exercises the protected preparation hook.
    protected override async prepareOptions() {
      preparations += 1;
      if (preparations === 1) {
        throw preparationError;
      }
    }

    protected override async authHeaders(
      received: FinalRequestOptions,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
    ) {
      return super.authHeaders(received, schemes);
    }
  }
  const sent: Headers[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers));
    return sent.length === 1
      ? Response.json({ error: { message: 'Synthetic retry' } }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new PreparingClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await expect(client.request(options)).rejects.toBe(preparationError);
  expect(transport.exchanges).toBe(0);
  await client.request(options);

  expect(sent.map((value) => value.get('Authorization'))).toEqual([
    'Bearer access-token-1',
    'Bearer access-token-2',
  ]);
  expect(transport.exchanges).toBe(2);
});

test.each([null, ''] as const)(
  'retains a one-shot authorization override through a response body timeout: %j',
  async (authorization) => {
    vi.useFakeTimers();
    try {
      const sent: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        if (sent.length !== 1) {
          return Response.json({ ok: true });
        }
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        fetch: transport.fetch,
        maxRetries: 1,
        timeout: 1000,
      });
      const completed = client
        .post('https://synthetic.example.test/resource', {
          body: { synthetic: true },
          headers: new OneShotHeaders(['Authorization', authorization], ['X-Custom', 'keep-me']),
        })
        .then((response) => expect(response).toEqual({ ok: true }));

      await vi.advanceTimersByTimeAsync(2000);
      await completed;

      expect(sent.map((value) => value.get('Authorization'))).toEqual([authorization, authorization]);
      expect(sent.map((value) => value.get('X-Custom'))).toEqual(['keep-me', 'keep-me']);
      expect(transport.exchanges).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

test('retains a replacement one-shot header source materialized by retry preparation', async () => {
  const options: FinalRequestOptions = {
    method: 'post',
    path: 'https://synthetic.example.test/resource',
    body: { synthetic: true },
    headers: new OneShotHeaders(['Authorization', null], ['X-Custom', 'first']),
  };
  class InspectingClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This instance override exercises preparation on each attempt.
    protected override async prepareOptions(received: FinalRequestOptions) {
      expect(received).toBe(options);
      received.headers = buildHeaders([received.headers]);
    }
  }
  const sent: Headers[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers));
    if (sent.length === 1) {
      options.headers = new OneShotHeaders(['Authorization', null], ['X-Custom', 'keep-me']);
      return Response.json(
        { error: { message: 'Synthetic retry' } },
        { status: 500, headers: { 'retry-after-ms': '1' } },
      );
    }
    return Response.json({ ok: true });
  });
  const client = new InspectingClient({
    ...createTestClientOptions(),
    fetch: transport.fetch,
    maxRetries: 1,
  });

  await client.request(options);

  expect(sent.map((value) => value.get('Authorization'))).toEqual([null, null]);
  expect(sent.map((value) => value.get('X-Custom'))).toEqual(['first', 'keep-me']);
  expect(transport.exchanges).toBe(0);
});
