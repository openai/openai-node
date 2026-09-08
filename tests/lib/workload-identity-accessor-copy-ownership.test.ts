/* oxlint-disable max-classes-per-file -- Distinct fixtures cover accessor and membrane ownership. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('prepared native header copies', () => {
  test.each([
    'unmarked accessor copy',
    'precreated accessor copy',
    'self-replacing accessor copy',
    'marked accessor',
    'native data copy',
  ] as const)('preserves the credential ownership of a %s', async (kind) => {
    let prepared: object | undefined;
    const reads: { count: number }[] = [];
    let current = { count: 0 };
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        const original = request.headers;
        const copy = new Headers(original);
        prepared = request;
        const attempt = { count: 0 };
        current = attempt;
        reads.push(attempt);
        Object.defineProperty(
          request,
          'headers',
          kind === 'native data copy'
            ? { value: new Headers(original), configurable: true, enumerable: true, writable: true }
            : {
                get() {
                  attempt.count += 1;
                  let headers = original;
                  if (kind === 'precreated accessor copy') {
                    headers = copy;
                  } else if (kind !== 'marked accessor') {
                    headers = new Headers(original);
                  }
                  if (kind === 'self-replacing accessor copy') {
                    Object.defineProperty(request, 'headers', { value: headers });
                  }
                  return headers;
                },
                configurable: true,
                enumerable: true,
              },
        );
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        expect(args[1]).toBe(prepared);
        expect(current.count).toBe(0);
        return super.fetchWithAuth(...args);
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        expect(args[1]).toBe(prepared);
        expect(current.count).toBe(0);
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
    expect(reads.map((attempt) => attempt.count)).toEqual(kind === 'native data copy' ? [0, 0] : [1, 1]);
  });

  test.each(['data', 'getter'] as const)(
    'observes an Authorization write to a dispatched %s copy',
    async (kind) => {
      let supplied: Headers | undefined;
      class HookClient extends OpenAI {
        protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
          await super.prepareRequest(...args);
          const [request] = args;
          const copy = new Headers(request.headers);
          supplied = copy;
          Object.defineProperty(request, 'headers', {
            ...(kind === 'data' ? { value: copy } : { get: () => copy }),
            configurable: true,
            enumerable: true,
          });
        }

        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          const response = await super.fetchWithAuth(...args);
          await response.body?.cancel();
          const authorization = supplied?.get('Authorization');
          if (!supplied || !authorization) {
            throw new Error('Expected the dispatched credential');
          }
          supplied.set('Authorization', authorization);
          const [url, init, timeout, controller, , context] = args;
          return super.fetchWithTimeout(url, init, timeout, controller, context);
        }
      }
      let sends = 0;
      const transport = createWorkloadIdentityTransport(() => {
        sends += 1;
        return sends % 2 === 1
          ? Response.json({ data: [] })
          : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });
      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(sends).toBe(4);
      expect(transport.exchanges).toBe(2);
    },
  );
});

test('preserves a marked request whose membrane defers header descriptor inspection', async () => {
  let authHookObserved = false;
  class HookClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      const built = await super.buildRequest(...args);
      built.req = new Proxy(built.req, {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'headers' && !authHookObserved) {
            throw new Error('Header descriptor is unavailable before the auth hook');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      return built;
    }

    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      authHookObserved = true;
      return super.fetchWithAuth(...args);
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sends += 1;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });
  await client.models.list();
  expect(sends).toBe(1);
  expect(transport.exchanges).toBe(1);
  expect(authHookObserved).toBe(true);
});
