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

describe.each(['sdk', 'independent'] as const)('cloning the selected %s response', (selected) => {
  test('retains its credential attribution across mixed delegated dispatches', async () => {
    const trackedResponses: Response[] = [];
    class DispatchClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, , context] = args;
        const sdk = await super.fetchWithTimeout(url, init, timeout, new AbortController(), context);
        const headers = new Headers(init?.headers);
        headers.set('Authorization', 'Bearer independent');
        const independent = await super.fetchWithTimeout(
          url,
          { ...init, headers },
          timeout,
          new AbortController(),
          context,
        );
        const chosen = selected === 'sdk' ? sdk : independent;
        const discarded = selected === 'sdk' ? independent : sdk;
        await discarded.body?.cancel();
        const clone = this.cloneResponse(chosen);
        trackedResponses.push(chosen, clone);
        await chosen.text();
        return clone;
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
    expect(trackedResponses).toHaveLength(selected === 'sdk' ? 4 : 2);
    expect(
      trackedResponses.every((tracked) => Reflect.getOwnPropertyDescriptor(tracked, 'clone') === undefined),
    ).toBe(true);
  });
});

test.each(['fetchWithAuth', 'fetchWithTimeout'] as const)(
  'preserves an inherited clone accessor through %s',
  async (hook) => {
    let cloneCalls = 0;
    const original = new Response(null, { status: 200, headers: { 'X-Original': 'yes' } });
    const prototype = Object.create(Response.prototype);
    Object.setPrototypeOf(original, prototype);
    Object.defineProperty(prototype, 'clone', {
      configurable: true,
      get() {
        return function customClone(this: Response) {
          cloneCalls += 1;
          const result = Response.prototype.clone.call(this);
          result.headers.set('X-Custom-Clone', 'yes');
          return result;
        };
      },
    });
    class CloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        return hook === 'fetchWithTimeout' ? this.cloneResponse(response) : response;
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        return hook === 'fetchWithAuth' ? this.cloneResponse(response) : response;
      }
    }
    const transport = createWorkloadIdentityTransport(() => original);
    const client = new CloneClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const response = await client.get('/synthetic').asResponse();

    expect(cloneCalls).toBe(1);
    expect(response.headers.get('X-Custom-Clone')).toBe('yes');
    expect(Reflect.getOwnPropertyDescriptor(original, 'clone')).toBeUndefined();
  },
);

test.each(['fetchWithAuth', 'fetchWithTimeout'] as const)(
  'does not install clone tracking for a late delegated %s response',
  async (hook) => {
    const waiting = deferred();
    const first = new Response(null, { status: 200 });
    const late = new Response(null, { status: 200 });
    let sends = 0;
    let losing!: Promise<Response>;
    class HedgedClient extends OpenAI {
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (hook !== 'fetchWithAuth') {
          return super.fetchWithAuth(...args);
        }
        const winning = super.fetchWithAuth(...args);
        losing = super.fetchWithAuth(...args);
        return winning;
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (hook !== 'fetchWithTimeout') {
          return super.fetchWithTimeout(...args);
        }
        const winning = super.fetchWithTimeout(...args);
        losing = super.fetchWithTimeout(...args);
        return winning;
      }
    }
    const transport = createWorkloadIdentityTransport(async () => {
      sends += 1;
      if (sends === 1) {
        return first;
      }
      await waiting.promise;
      return late;
    });
    const client = new HedgedClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.get('/synthetic').asResponse();
    expect(Reflect.getOwnPropertyDescriptor(first, 'clone')).toBeUndefined();
    waiting.resolve();
    await losing;
    expect(Reflect.getOwnPropertyDescriptor(late, 'clone')).toBeUndefined();
  },
);

test('shares clone tracking safely across concurrent requests returning one Response', async () => {
  const shared = new Response(null, { status: 200 });
  const firstCloned = deferred();
  const releaseSecond = deferred();
  let entries = 0;
  const clones: Response[] = [];
  class SharedResponseClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      entries += 1;
      const index = entries;
      const response = await super.fetchWithTimeout(...args);
      if (index === 2) {
        await releaseSecond.promise;
      }
      const clone = this.cloneResponse(response);
      clones.push(clone);
      if (index === 1) {
        firstCloned.resolve();
      }
      return clone;
    }
  }
  const transport = createWorkloadIdentityTransport(() => shared);
  const client = new SharedResponseClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });
  const first = client.get('/first').asResponse();
  const second = client.get('/second').asResponse();

  await firstCloned.promise;
  await first;
  expect(Reflect.getOwnPropertyDescriptor(shared, 'clone')).toBeUndefined();
  releaseSecond.resolve();
  await second;

  expect(Reflect.getOwnPropertyDescriptor(shared, 'clone')).toBeUndefined();
  expect(clones.every((response) => Reflect.getOwnPropertyDescriptor(response, 'clone') === undefined)).toBe(
    true,
  );
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
        const clone = this.cloneResponse(response);
        await response.text();
        return clone;
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        if (hook !== 'fetchWithAuth') {
          return response;
        }
        const clone = this.cloneResponse(response);
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

test.each(['fetchWithTimeout', 'fetchWithAuth'] as const)(
  'does not wait for the unread source branch of an attributed %s clone',
  async (hook) => {
    let source: Response | undefined;
    class CloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (hook !== 'fetchWithTimeout') {
          return response;
        }
        source ??= response;
        return this.cloneResponse(response);
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        if (hook !== 'fetchWithAuth') {
          return response;
        }
        source ??= response;
        return this.cloneResponse(response);
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
    await source?.body?.cancel();
    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);

test.each(['fetchWithTimeout', 'fetchWithAuth'] as const)(
  'does not wait for an unread attributed %s clone branch before a status retry',
  async (hook) => {
    let source: Response | undefined;
    class CloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (hook !== 'fetchWithTimeout') {
          return response;
        }
        source ??= response;
        return this.cloneResponse(response);
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        if (hook !== 'fetchWithAuth') {
          return response;
        }
        source ??= response;
        return this.cloneResponse(response);
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: 'synthetic server failure' }, { status: 500 })
        : Response.json({ ok: true });
    });
    const client = new CloneClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 1,
    });

    await expect(client.post('/synthetic', { body: { synthetic: true } })).resolves.toEqual({ ok: true });
    await source?.body?.cancel();
    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(1);
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

test.each(['fetchWithTimeout', 'fetchWithAuth'] as const)(
  'leaves an independently returned %s response untracked',
  async (hook) => {
    let independentSends = 0;
    const independentFetch = () => {
      independentSends += 1;
      return Response.json({ error: 'independent unauthorized' }, { status: 401 });
    };
    class IndependentResponseClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (hook !== 'fetchWithTimeout') {
          return response;
        }
        await response.body?.cancel();
        return independentFetch();
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const response = await super.fetchWithAuth(...args);
        if (hook !== 'fetchWithAuth') {
          return response;
        }
        await response.body?.cancel();
        return independentFetch();
      }
    }
    let delegatedSends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      delegatedSends += 1;
      return Response.json({ ok: true });
    });
    const client = new IndependentResponseClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.post('/synthetic', { body: { synthetic: true } })).rejects.toMatchObject({
      status: 401,
    });
    expect(independentSends).toBe(1);
    expect(delegatedSends).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('does not restore wrapped-body ownership after mixed delegated credentials share a body', async () => {
  const { body } = Response.json({ error: 'shared unauthorized' });
  class SharedBodyClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, , context] = args;
      await super.fetchWithTimeout(url, init, timeout, new AbortController(), context);
      await super.fetchWithTimeout(
        url,
        { ...init, headers: { Authorization: 'Bearer independent' } },
        timeout,
        new AbortController(),
        context,
      );
      return wrapResponse(await super.fetchWithTimeout(url, init, timeout, new AbortController(), context));
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return new Response(body, { status: 401 });
  });
  const client = new SharedBodyClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { synthetic: true } })).rejects.toMatchObject({
    status: 401,
  });
  expect(sends).toBe(3);
  expect(transport.exchanges).toBe(1);
});
