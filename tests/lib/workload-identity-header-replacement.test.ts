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

test.each(['before', 'after'] as const)(
  'keeps a self-removing getter %s an existing alias',
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

    expect(sent).toEqual([order === 'before' ? 'Bearer alias' : 'Bearer getter']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(0);
  },
);

describe.each(['request', 'default'] as const)('replaced %s Authorization accessor', (layer) => {
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
        client.post('https://independent.example.test/synthetic', {
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
