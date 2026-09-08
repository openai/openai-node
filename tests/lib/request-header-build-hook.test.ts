/* oxlint-disable max-classes-per-file -- Fixtures exercise distinct protected request-building hooks. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([false, true])(
  'lets a buildRequest hook initialize lazy request headers before their first read (workload identity: %s)',
  async (workloadIdentity) => {
    let initialized = false;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        initialized = true;
        return super.buildRequest(...args);
      }
    }
    const transport = createWorkloadIdentityTransport(() => Response.json({ ok: true }));
    const client = new HookClient({
      ...(workloadIdentity
        ? { ...createTestClientOptions(), apiKey: null, adminAPIKey: null }
        : { apiKey: 'synthetic-key' }),
      fetch: transport.fetch,
    });

    await expect(
      client.request({
        method: 'get',
        path: '/synthetic',
        get headers() {
          if (!initialized) {
            throw new Error('buildRequest has not initialized headers');
          }
          return { 'X-Custom': 'initialized' };
        },
      }),
    ).resolves.toEqual({ ok: true });
  },
);

test('does not reread lazy header input consumed by an independent build', async () => {
  let reads = 0;
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture deliberately owns its entire build.
    override async buildRequest(options: Parameters<OpenAI['buildRequest']>[0]) {
      return {
        req: { method: 'GET', headers: buildHeaders([options.headers]).values },
        url: 'https://api.openai.com/v1/synthetic',
        timeout: 1000,
      };
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Custom')).toBe('selected');
    return Response.json({ ok: true });
  });
  const client = new HookClient({ ...createTestClientOptions(), apiKey: null, fetch: transport.fetch });
  const options = Object.defineProperty({ method: 'get' as const, path: '/synthetic' }, 'headers', {
    get() {
      reads += 1;
      if (reads > 1) {
        throw new Error('Lazy input was already consumed by its owner');
      }
      return { 'X-Custom': 'selected', Authorization: 'Bearer independent' };
    },
  });
  await expect(client.request(options)).resolves.toEqual({ ok: true });
  expect(reads).toBe(1);
  expect(transport.exchanges).toBe(0);
});

test.skipIf(Number(process.versions.node.split('.')[0]) < 24).each(['frozen', 'getter-only'] as const)(
  'normalizes foreign headers without writing to a %s build result',
  async (kind) => {
    const { Headers: ForeignHeaders } = await import('undici');
    let original: Awaited<ReturnType<OpenAI['buildRequest']>>['req'] | undefined;
    let supplied: object | undefined;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        const headers = new ForeignHeaders([...built.req.headers]);
        supplied = headers;
        if (kind === 'frozen') {
          built.req.headers = headers as Headers;
          Object.freeze(built.req);
        } else {
          Object.defineProperty(built.req, 'headers', { get: () => headers });
        }
        original = built.req;
        return built;
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(original?.headers).toBe(supplied);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
      return Response.json({ ok: true });
    });
    const client = new HookClient({ ...createTestClientOptions(), apiKey: null, fetch: transport.fetch });
    await expect(client.request({ method: 'get', path: '/synthetic' })).resolves.toEqual({ ok: true });
    expect(transport.exchanges).toBe(1);
  },
);

test('resolves a workload placeholder in a frozen prepared request', async () => {
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      Object.freeze(args[0]);
      return super.prepareRequest(...args);
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sends += 1;
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer access-token-${sends}`);
    return sends === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ ok: true });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });
  await expect(
    client.request({
      method: 'get',
      path: '/synthetic',
      headers: { Authorization: 'Bearer workload-identity-auth' },
    }),
  ).resolves.toEqual({ ok: true });
  expect(sends).toBe(2);
  expect(transport.exchanges).toBe(2);
});

test('lets a buildRequest hook initialize lazy request headers before each retry read', async () => {
  let initialized = false;
  let builds = 0;
  let sends = 0;
  class HookClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      builds += 1;
      initialized = true;
      return super.buildRequest(...args);
    }
  }
  const transport = createWorkloadIdentityTransport(() => {
    initialized = false;
    sends += 1;
    return sends === 1
      ? new Response(null, { status: 500, headers: { 'retry-after-ms': '0' } })
      : Response.json({ ok: true });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 1,
  });

  await expect(
    client.request({
      method: 'get',
      path: '/synthetic',
      get headers() {
        if (!initialized) {
          throw new Error('buildRequest has not initialized headers for this attempt');
        }
        return { 'X-Custom': 'initialized' };
      },
    }),
  ).resolves.toEqual({ ok: true });
  expect({ builds, sends }).toEqual({ builds: 2, sends: 2 });
});
