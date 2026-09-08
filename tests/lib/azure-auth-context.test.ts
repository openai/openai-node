/* oxlint-disable max-classes-per-file -- Fixtures exercise separate Azure authentication and dispatch hooks. */
import OpenAI, { AzureOpenAI } from 'openai';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const azureOptions = {
  baseURL: 'https://synthetic.azure.openai.com/openai',
  apiVersion: '2024-02-15-preview',
  maxRetries: 0,
};

test('forwards auth context after delayed Azure delegation with shared request options', async () => {
  const options: FinalRequestOptions = { method: 'get', path: '/models' };
  const incoming: object[] = [];
  const delegated: (object | undefined)[] = [];
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The barrier keeps both shared-options requests in flight.
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  class AuthClient extends AzureOpenAI {
    protected override async authHeaders(
      received: FinalRequestOptions,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      context?: object,
    ) {
      expect(received).toBe(options);
      if (!context) {
        throw new Error('Expected an opaque request context');
      }
      incoming.push(context);
      if (incoming.length === 2) {
        release();
      }
      await bothStarted;
      const headers = await super.authHeaders({ ...received }, schemes, context);
      return headers && { ...headers, values: new Headers(headers.values) };
    }

    protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
      delegated.push(args[1]);
      return super.bearerAuth(...args);
    }
  }
  let sends = 0;
  const client = new AuthClient({
    ...azureOptions,
    azureADTokenProvider: async () => 'synthetic-aad-token',
    fetch: async (_url, init) => {
      sends += 1;
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer synthetic-aad-token');
      expect(headers.has('api-key')).toBe(false);
      return Response.json({ ok: true });
    },
  });

  await Promise.all([client.request(options), client.request(options)]);

  expect(new Set(incoming).size).toBe(2);
  expect(delegated).toHaveLength(2);
  for (const context of incoming) {
    expect(delegated).toContain(context);
  }
  expect(sends).toBe(2);
});

test.each(['api-key', 'AAD'] as const)(
  'forwards Azure dispatch context when replacing init and controller with %s authentication',
  async (authentication) => {
    const incoming: object[] = [];
    const delegated: (object | undefined)[] = [];
    const original = Object.getOwnPropertyDescriptor(OpenAI.prototype, 'fetchWithAuth');
    if (!original || typeof original.value !== 'function') {
      throw new Error('Expected the base SDK dispatch hook');
    }
    const observeContext = function observeContext(
      this: OpenAI,
      ...args: Parameters<OpenAI['fetchWithAuth']>
    ) {
      delegated.push(args[5]);
      return Reflect.apply(original.value, this, args);
    };
    Object.defineProperty(OpenAI.prototype, 'fetchWithAuth', { ...original, value: observeContext });
    try {
      class DispatchClient extends AzureOpenAI {
        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          const [url, init, timeout, , schemes, context] = args;
          if (!context) {
            throw new Error('Expected an opaque dispatch context');
          }
          incoming.push(context);
          return super.fetchWithAuth(
            url,
            { method: init.method ?? 'GET', headers: new Headers(init.headers) },
            timeout,
            new AbortController(),
            schemes,
            context,
          );
        }
      }
      let sends = 0;
      const client = new DispatchClient({
        ...azureOptions,
        ...(authentication === 'api-key'
          ? { apiKey: 'synthetic-api-key' }
          : { azureADTokenProvider: async () => 'synthetic-aad-token' }),
        fetch: async (_url, init) => {
          sends += 1;
          const headers = new Headers(init?.headers);
          expect(headers.get('api-key')).toBe(authentication === 'api-key' ? 'synthetic-api-key' : null);
          expect(headers.get('Authorization')).toBe(
            authentication === 'AAD' ? 'Bearer synthetic-aad-token' : null,
          );
          expect(init?.redirect).toBe(authentication === 'api-key' ? 'manual' : undefined);
          return Response.json({ ok: true });
        },
      });

      await expect(client.get('/models')).resolves.toEqual({ ok: true });

      expect(incoming).toHaveLength(1);
      expect(delegated).toHaveLength(1);
      expect(delegated[0]).toBe(incoming[0]);
      expect(sends).toBe(1);
    } finally {
      Object.defineProperty(OpenAI.prototype, 'fetchWithAuth', original);
    }
  },
);
