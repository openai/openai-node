/* oxlint-disable eslint/max-classes-per-file -- Separate subclasses exercise canceled WebSocket and HTTP capture behavior. */
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import OpenAI from 'openai';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name reconnect through a credential capture wrapper', ({ Responses }) => {
  test.each(
    ['none', 'successful', 'failed'].flatMap((laterRequest) =>
      ['synchronous', 'after await', 'before delegation', 'after await with wrapper'].map((wrapper) => ({
        laterRequest,
        wrapper,
      })),
    ),
  )(
    'canceled refresh cannot cache its key with a $laterRequest concurrent HTTP request and $wrapper capture',
    async ({ laterRequest, wrapper }) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      let refresh!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Gate the provider at the actual async credential boundary.
      const refreshing = new Promise<void>((resolve) => {
        refresh = resolve;
      });
      let release!: (key: string) => void;
      // oxlint-disable-next-line promise/avoid-new -- Keep the provider unresolved until the caller closes.
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const apiKey = vi
        .fn()
        .mockResolvedValueOnce('synthetic-A')
        .mockImplementationOnce(() => {
          refresh();
          return pending;
        });
      const upgrades: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => upgrades.push(request.headers.authorization));
      class WrappedOpenAI extends OpenAI {
        override async _callApiKey(capture?: (apiKey: string | null) => void): Promise<boolean> {
          if (wrapper === 'before delegation') {
            await Promise.resolve();
            return super._callApiKey(capture);
          }
          if (wrapper === 'after await with wrapper') {
            await Promise.resolve();
            return super._callApiKey((key) => capture?.(key));
          }
          if (wrapper === 'synchronous') {
            return super._callApiKey((key) => {
              capture?.(key);
            });
          }
          let resolved: string | null = null;
          const isProvider = await super._callApiKey((key) => {
            resolved = key;
          });
          await Promise.resolve();
          capture?.(resolved);
          return isProvider;
        }
      }
      const client = new WrappedOpenAI({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // SAFETY: Both Responses transports expose the same reconnect, close, and event lifecycle.
      const connection = new Responses(client, {
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        peer.close(1012);
        await refreshing;
        if (laterRequest === 'successful') {
          apiKey.mockResolvedValueOnce('synthetic-newer');
          await client._callApiKey();
        } else if (laterRequest === 'failed') {
          apiKey.mockRejectedValueOnce(new Error('later provider failure'));
          await expect(client._callApiKey()).rejects.toThrow('later provider failure');
        }
        const closed = connection.emitted('close');
        connection.close();
        await expect(
          Promise.race([closed.then(() => 'closed'), setImmediate().then(() => 'still pending')]),
        ).resolves.toBe('closed');
        release('synthetic-B');
        await setImmediate();
        expect(upgrades).toEqual(['Bearer synthetic-A']);
        const nextIncoming = once(server, 'connection');
        const successor = new Responses(client);
        try {
          await nextIncoming;
          await once(successor.socket.platformSocket, 'open');
          expect(upgrades).toEqual([
            'Bearer synthetic-A',
            laterRequest === 'successful' ? 'Bearer synthetic-newer' : 'Bearer synthetic-A',
          ]);
        } finally {
          successor.close();
        }
      } finally {
        release('synthetic-B');
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test('an HTTP request inside a delayed credential hook commits independently of canceled refresh', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local server address');
    }
    let release!: (key: string) => void;
    // oxlint-disable-next-line promise/avoid-new -- Pause only the actual WebSocket refresh provider.
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const apiKey = vi
      .fn()
      .mockResolvedValueOnce('synthetic-A')
      .mockResolvedValueOnce('synthetic-HTTP')
      .mockReturnValueOnce(pending);
    const upgrades: (string | undefined)[] = [];
    server.on('connection', (_peer, request) => upgrades.push(request.headers.authorization));
    let issueHTTPRequest = false;
    let httpResult: { authorization: string | null } | undefined;
    class NestedRequestOpenAI extends OpenAI {
      override async _callApiKey(capture?: (apiKey: string | null) => void): Promise<boolean> {
        await Promise.resolve();
        if (issueHTTPRequest) {
          issueHTTPRequest = false;
          httpResult = await this.get('/nested-request');
        }
        return super._callApiKey((key) => capture?.(key));
      }
    }
    const client = new NestedRequestOpenAI({
      apiKey,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      fetch: async (_url, init) =>
        Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
    });
    await client._callApiKey();
    const initial = once(server, 'connection');
    // SAFETY: Stable and beta expose identical reconnect and close event contracts.
    const connection = new Responses(client, {
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    }) as StableResponsesWS;
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      issueHTTPRequest = true;
      peer.close(1012);
      await vi.waitFor(() => expect(apiKey).toHaveBeenCalledTimes(3));
      expect(httpResult).toEqual({ authorization: 'Bearer synthetic-HTTP' });
      expect(client.apiKey).toBe('synthetic-HTTP');
      const closed = connection.emitted('close');
      connection.close();
      await closed;
      release('synthetic-canceled');
      await setImmediate();
      expect(client.apiKey).toBe('synthetic-HTTP');
      expect(upgrades).toEqual(['Bearer synthetic-A']);
    } finally {
      release('synthetic-canceled');
      connection.close();
      for (const peer of server.clients) {
        peer.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  test.each(
    ['passthrough', 'derived'].flatMap((mode) =>
      [false, true].map((awaitBeforeSuper) => ({ mode, awaitBeforeSuper })),
    ),
  )(
    'uses the $mode hook credential on reconnect while committing the provider cache independently (await before super: $awaitBeforeSuper)',
    async ({ mode, awaitBeforeSuper }) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      const apiKey = vi.fn().mockResolvedValueOnce('synthetic-A').mockResolvedValueOnce('synthetic-B');
      const upgrades: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => upgrades.push(request.headers.authorization));
      class SigningOpenAI extends OpenAI {
        override async _callApiKey(capture?: (apiKey: string | null) => void): Promise<boolean> {
          let resolved: string | null = null;
          if (awaitBeforeSuper) {
            await Promise.resolve();
          }
          const invoked = await super._callApiKey((key) => {
            resolved = key;
          });
          capture?.(resolved === null || mode === 'passthrough' ? resolved : `signed(${resolved})`);
          return invoked;
        }
      }
      const client = new SigningOpenAI({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
      let stored: string | null = null;
      Object.defineProperty(client, 'apiKey', {
        get: () => (stored === null ? null : `cache:${stored}`),
        set: (key: string | null) => {
          stored = key;
        },
      });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // SAFETY: Stable and beta expose identical reconnect and close event contracts.
      const connection = new Responses(client, {
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const reconnected = connection.emitted('reconnected');
        peer.close(1012);
        await reconnected;
        expect(upgrades).toEqual([
          'Bearer cache:synthetic-A',
          mode === 'derived' ? 'Bearer signed(synthetic-B)' : 'Bearer cache:synthetic-B',
        ]);
        expect(client.apiKey).toBe('cache:synthetic-B');
      } finally {
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );
});

test('an HTTP capture through a wrapper uses its cache accessor and writes only once', async () => {
  class WrappedOpenAI extends OpenAI {
    override _callApiKey(capture?: (apiKey: string | null) => void): Promise<boolean> {
      return super._callApiKey((key) => capture?.(key));
    }
  }
  const client = new WrappedOpenAI({
    apiKey: async () => 'synthetic-provider',
    fetch: async (_url, init) =>
      Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
  });
  let stored: string | null = null;
  const setter = vi.fn((value: string | null) => {
    stored = value;
  });
  Object.defineProperty(client, 'apiKey', {
    get: () => (stored === null ? null : `${stored}+accessor`),
    set: setter,
  });
  await expect(client.get('/credential-echo')).resolves.toEqual({
    authorization: 'Bearer synthetic-provider+accessor',
  });
  expect(setter).toHaveBeenCalledTimes(1);
});
