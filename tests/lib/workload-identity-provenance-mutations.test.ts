/* oxlint-disable max-classes-per-file -- Fixtures exercise independent protected hook boundaries. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test('keeps a resolved legacy placeholder independent after mutation and cloning', async () => {
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture delegates legacy credential resolution to transport.
    protected override async authHeaders() {
      return buildHeaders([{ Authorization: 'Bearer workload-identity-auth' }]);
    }

    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [, init] = args;
      if (init) {
        (init.headers as Headers).set('Authorization', 'Bearer access-token-1');
        init.headers = new Headers(init.headers);
      }
      return super.fetchWithTimeout(...args);
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    maxRetries: 0,
    fetch: transport.fetch,
  });

  await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
  expect(sends).toBe(1);
  expect(transport.exchanges).toBe(1);
});

describe.each(['in place', 'replacement'] as const)('%s independent credentials', (replacement) => {
  test.each([false, true])('remain independent through a later native clone: %s', async (clone) => {
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This fixture changes request authentication.
      protected override async prepareRequest(...[req]: Parameters<OpenAI['prepareRequest']>) {
        if (replacement === 'in place') {
          (req.headers as Headers).set('Authorization', 'Bearer access-token-1');
        } else {
          req.headers = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
        }
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (clone && args[1]) {
          args[1].headers = new Headers(args[1].headers);
        }
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(sent).toEqual(['Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
  });
});

test.each(['own', 'inherited'] as const)('bypasses %s get overrides on built Headers', async (kind) => {
  let reads = 0;
  class HookClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      const built = await super.buildRequest(...args);
      const target = kind === 'own' ? built.req.headers : Object.create(Headers.prototype);
      Object.defineProperty(target, 'get', {
        get() {
          reads += 1;
          throw new Error('Synthetic diagnostic getter must not run');
        },
      });
      if (kind === 'inherited') {
        Object.setPrototypeOf(built.req.headers, target);
      }
      return built;
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((url, init) => {
    sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
    return sent.length === 1
      ? Response.json({ error: 'unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    maxRetries: 0,
    fetch: transport.fetch,
  });

  await client.models.list();
  expect(reads).toBe(0);
  expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
});

test.each(['authHeaders', 'bearerAuth'] as const)(
  'keeps an equal-byte %s overwrite independent when returning its original layer',
  async (hook) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (hook === 'authHeaders') {
          headers?.values.set('Authorization', 'Bearer access-token-1');
        }
        return headers;
      }

      protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
        const headers = await super.bearerAuth(...args);
        if (hook === 'bearerAuth') {
          headers?.values.set('Authorization', 'Bearer access-token-1');
        }
        return headers;
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(sent).toEqual(['Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
  },
);
