/* oxlint-disable max-classes-per-file -- Independent fixtures model separate transport wrappers. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

function deferred() {
  let resolveGate!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The gate orders two delegated transport completions.
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return { promise, resolve: resolveGate };
}

describe.each(['sdk', 'independent'] as const)('selecting the %s response', (selected) => {
  test.each([true, false])('tracks the returned dispatch when SDK starts first: %s', async (sdkFirst) => {
    class DispatchClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, , context] = args;
        const order = sdkFirst ? ['sdk', 'independent'] : ['independent', 'sdk'];
        const responses = await Promise.all(
          order.map((credential) => {
            const headers = new Headers(init?.headers);
            if (credential === 'independent') {
              headers.set('Authorization', 'Bearer independent');
            }
            return super.fetchWithTimeout(url, { ...init, headers }, timeout, new AbortController(), context);
          }),
        );
        const chosen = responses[order.indexOf(selected)];
        const discarded = responses[order.indexOf(selected === 'sdk' ? 'independent' : 'sdk')];
        if (!chosen || !discarded) {
          throw new Error('Expected both delegated responses');
        }
        await discarded.body?.cancel();
        return chosen;
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push(authorization);
      return authorization === 'Bearer access-token-2'
        ? Response.json({ ok: true })
        : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new DispatchClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const response = client.post('/models', { body: { synthetic: true } });
    if (selected === 'sdk') {
      await expect(response).resolves.toEqual({ ok: true });
      expect(transport.exchanges).toBe(2);
      expect(sent).toHaveLength(4);
    } else {
      await expect(response).rejects.toMatchObject({ status: 401 });
      expect(transport.exchanges).toBe(1);
      expect(sent).toHaveLength(2);
    }
  });
});

test.each(['fetchWithTimeout', 'fetchWithAuth'] as const)(
  'retains selected workload usage through a delegated %s response clone',
  async (hook) => {
    class CloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (hook !== 'fetchWithTimeout') {
          return response;
        }
        const clone = response.clone();
        await response.text();
        return clone;
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        if (hook !== 'fetchWithAuth') {
          return response;
        }
        const clone = response.clone();
        await response.text();
        return clone;
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ ok: true });
    });
    const client = new CloneClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.post('/synthetic', { body: { synthetic: true } })).resolves.toEqual({ ok: true });

    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);

test('does not replay when mixed delegated credentials return the same response object', async () => {
  const shared = new Response(null, { status: 401 });
  const sdkGate = deferred();
  class SharedResponseClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, , context] = args;
      const sdk = super.fetchWithTimeout(url, init, timeout, new AbortController(), context);
      const headers = new Headers(init?.headers);
      headers.set('Authorization', 'Bearer independent');
      const independent = await super.fetchWithTimeout(
        url,
        { ...init, headers },
        timeout,
        new AbortController(),
        context,
      );
      sdkGate.resolve();
      await sdk;
      return independent;
    }
  }
  let calls = 0;
  const transport = createWorkloadIdentityTransport(async (_url, init) => {
    calls += 1;
    if (new Headers(init?.headers).get('Authorization') !== 'Bearer independent') {
      await sdkGate.promise;
    }
    return shared;
  });
  const client = new SharedResponseClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { synthetic: true } })).rejects.toMatchObject({
    status: 401,
  });

  expect(calls).toBe(2);
  expect(transport.exchanges).toBe(1);
});

const wrapResponse = (response: Response) =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

describe.each(['sdk', 'independent'] as const)('single %s dispatch', (credential) => {
  test.each(['original', 'wrapped', 'shadowed body'] as const)('returns a %s response', async (mode) => {
    class DispatchClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (credential === 'independent' && args[1]) {
          args[1].headers = { Authorization: 'Bearer independent' };
        }
        const response = await super.fetchWithTimeout(...args);
        Reflect.deleteProperty(response, 'body');
        return mode === 'original' ? response : wrapResponse(response);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      const response =
        sends === 1
          ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
          : Response.json({ ok: true });
      if (mode === 'shadowed body') {
        Object.defineProperty(response, 'body', {
          configurable: true,
          get() {
            throw new Error('Bookkeeping must not invoke a caller-defined body getter');
          },
        });
      }
      return response;
    });
    const client = new DispatchClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    const response = client.post('/models', { body: { synthetic: true } });
    if (credential === 'sdk') {
      await expect(response).resolves.toEqual({ ok: true });
      expect(sends).toBe(2);
      expect(transport.exchanges).toBe(2);
    } else {
      await expect(response).rejects.toMatchObject({ status: 401 });
      expect(sends).toBe(1);
      expect(transport.exchanges).toBe(1);
    }
  });
});
