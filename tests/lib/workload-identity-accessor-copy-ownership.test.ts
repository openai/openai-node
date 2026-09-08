/* oxlint-disable max-classes-per-file -- Distinct fixtures cover accessor and membrane ownership. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe('prepared native header copies', () => {
  test.each([
    'unmarked accessor copy',
    'self-replacing accessor copy',
    'marked accessor',
    'native data copy',
  ] as const)('preserves the credential ownership of a %s', async (kind) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        await super.prepareRequest(...args);
        const [request] = args;
        const original = request.headers;
        Object.defineProperty(
          request,
          'headers',
          kind === 'native data copy'
            ? { value: new Headers(original), configurable: true, enumerable: true, writable: true }
            : {
                get() {
                  const headers = kind === 'marked accessor' ? original : new Headers(original);
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
    const result = client.models.list();
    if (kind === 'unmarked accessor copy' || kind === 'self-replacing accessor copy') {
      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(sent).toEqual(['Bearer access-token-1']);
      expect(transport.exchanges).toBe(1);
    } else {
      await result;
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    }
  });
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
