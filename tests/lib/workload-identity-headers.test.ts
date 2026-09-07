import { runInNewContext } from 'node:vm';
import OpenAI from 'openai';
import { vi } from 'vitest';
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
  test(`refreshes reusable foreign Headers from ${location} options after credential acquisition`, async () => {
    if (Number(process.versions.node.split('.')[0]) < 24) {
      return;
    }
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
  });
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
