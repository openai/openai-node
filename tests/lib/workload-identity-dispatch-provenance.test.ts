/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected dispatch hooks. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(['Bearer independent', null] as const)(
  'classifies structural Headers from dispatched entries rather than get(): %j',
  async (authorization) => {
    const read = vi.fn<(name: string) => string>(() => 'Bearer access-token-1');
    const iterate = vi.fn(() =>
      (authorization === null ? [] : [['Authorization', authorization]])[Symbol.iterator](),
    );
    const StructuralHeaders = class Headers {
      // oxlint-disable-next-line class-methods-use-this -- The fixture requires descriptor-aligned prototype methods.
      get(name: string) {
        return read(name);
      }
      // oxlint-disable-next-line class-methods-use-this -- The fixture requires descriptor-aligned prototype methods.
      entries() {
        return iterate();
      }
    };
    Object.defineProperties(StructuralHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: StructuralHeaders.prototype.entries },
    });
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (args[1]) {
          args[1].headers = new StructuralHeaders() as unknown as Headers;
        }
        return super.fetchWithTimeout(...args);
      }
    }
    const dispatched: RequestInit['headers'][] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      dispatched.push(init?.headers);
      expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(Headers);
    expect(read).not.toHaveBeenCalled();
    expect(iterate).toHaveBeenCalledTimes(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('does not invoke a build-result get accessor before prepareRequest removes it', async () => {
  const read = vi.fn(() => {
    throw new Error('Premature header get accessor');
  });
  const prepared = vi.fn();
  class HookClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      const built = await super.buildRequest(...args);
      Object.defineProperty(built.req.headers, 'get', { configurable: true, get: read });
      return built;
    }
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      const [{ headers }] = args;
      if (!headers) {
        throw new Error('Expected built request headers');
      }
      Reflect.deleteProperty(headers, 'get');
      prepared();
      return super.prepareRequest(...args);
    }
  }
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
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

  expect(read).not.toHaveBeenCalled();
  expect(prepared).toHaveBeenCalledTimes(1);
  expect(calls).toBe(1);
});

test.skipIf(Number(process.versions.node.split('.')[0]) < 24).each([false, true])(
  'refreshes a foreign Headers build-result copy with its SDK request carrier removed: %s',
  async (removeCarrier) => {
    const { Headers: ForeignHeaders } = await import('undici');
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        built.req.headers = new ForeignHeaders([...built.req.headers]) as unknown as Headers;
        if (removeCarrier) {
          built.req = { method: built.req.method ?? 'GET', headers: built.req.headers };
        }
        return built;
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
  },
);

test.each([false, true])(
  'preserves independent preparation credentials through fetchWithAuth cloning: %s',
  async (clone) => {
    class HookClient extends OpenAI {
      protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
        args[0].headers = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
        return super.prepareRequest(...args);
      }
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (clone) {
          args[1] = { ...args[1], headers: new Headers(args[1].headers) } satisfies RequestInit;
        }
        return super.fetchWithAuth(...args);
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-1');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(calls).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(
  (['record replacement', 'Headers replacement', 'same object', 'SDK helper copy'] as const).flatMap((kind) =>
    [false, true].map((clone) => ({ kind, clone })),
  ),
)('refreshes unchanged preparation credentials across supported copies: %j', async ({ kind, clone }) => {
  class HookClient extends OpenAI {
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      const [request] = args;
      if (!(request.headers instanceof Headers)) {
        throw new Error('Expected native built request headers');
      }
      const authorization = request.headers.get('Authorization');
      if (authorization === null) {
        throw new Error('Expected the resolved workload credential');
      }
      request.headers.set('X-Custom', 'prepared');
      if (kind === 'record replacement') {
        request.headers = { Authorization: authorization, 'X-Custom': 'prepared' };
      } else if (kind === 'Headers replacement') {
        request.headers = new Headers(request.headers);
      } else if (kind === 'SDK helper copy') {
        request.headers = buildHeaders([request.headers]).values;
      }
      return super.prepareRequest(...args);
    }

    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      if (clone) {
        args[1] = { ...args[1], headers: new Headers(args[1].headers) } satisfies RequestInit;
      }
      return super.fetchWithAuth(...args);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    const headers = new Headers(init?.headers);
    sent.push(headers.get('Authorization'));
    expect(headers.get('X-Custom')).toBe('prepared');
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
});
