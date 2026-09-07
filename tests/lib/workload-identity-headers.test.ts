/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected header hooks. */
import { runInNewContext } from 'node:vm';
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
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

afterEach(() => {
  vi.unstubAllEnvs();
});

class OneShotHeaders extends Array<[string, string | null]> {
  #iterator: ReturnType<[string, string | null][]['values']> | undefined;

  override [Symbol.iterator]() {
    return (this.#iterator ??= super[Symbol.iterator]());
  }
}

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

for (const location of ['request', 'default'] as const) {
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
