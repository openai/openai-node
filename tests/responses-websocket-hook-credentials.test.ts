/* oxlint-disable eslint/max-classes-per-file -- These separate subclasses cover zero-argument delegation and independent hook-provided authentication. */
import { once } from 'node:events';
import type { ClientRequest } from 'node:http';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses authentication via subclass hooks', ({ Responses }) => {
  test('retains the reconnect-local credential through a zero-argument auth hook', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local WebSocket address');
    }
    const attempts: { authorization: string | undefined; requestID: string | string[] | undefined }[] = [];
    server.on('connection', (_peer, request) => {
      attempts.push({
        authorization: request.headers.authorization,
        requestID: request.headers['x-client-request-id'],
      });
    });
    let resolveReconnect!: (key: string) => void;
    const provider = vi
      .fn()
      .mockResolvedValueOnce('synthetic-A')
      .mockImplementationOnce(
        () =>
          // oxlint-disable-next-line promise/avoid-new -- Delay this refresh until a newer real client request commits.
          new Promise<string>((resolve) => {
            resolveReconnect = resolve;
          }),
      )
      .mockResolvedValue('synthetic-C');
    const client = new OpenAI({
      apiKey: provider,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      fetch: async (_input, init) =>
        Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
    });
    await client._callApiKey();
    // SAFETY: Stable and beta expose the same protected auth hook and lifecycle methods.
    class LegacyResponses extends (Responses as typeof StableResponsesWS) {
      protected override _authHeaders() {
        return { ...super._authHeaders(), 'X-Client-Request-ID': 'legacy-hook' };
      }
    }
    const initial = once(server, 'connection');
    const connection = new LegacyResponses(client, {
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    });
    connection.on('error', () => {});
    let successor: StableResponsesWS | BetaResponsesWS | undefined;
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      const reconnected = connection.emitted('reconnected');
      peer.close(1012);
      await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
      await expect(client.get('/newer')).resolves.toEqual({ authorization: 'Bearer synthetic-C' });
      const successorIncoming = once(server, 'connection');
      successor = new Responses(client);
      await successorIncoming;
      await once(successor.socket.platformSocket, 'open');
      resolveReconnect('synthetic-B');
      await reconnected;
      expect(attempts).toEqual([
        { authorization: 'Bearer synthetic-A', requestID: 'legacy-hook' },
        { authorization: 'Bearer synthetic-C', requestID: undefined },
        { authorization: 'Bearer synthetic-B', requestID: 'legacy-hook' },
      ]);
      expect(client.apiKey).toBe('synthetic-C');
      expect(provider).toHaveBeenCalledTimes(3);
    } finally {
      resolveReconnect?.('synthetic-B');
      connection.close();
      successor?.close();
      for (const peer of server.clients) {
        peer.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  test.each(['caller credential', 'augmented SDK key', 'SDK key copied to another header'] as const)(
    'respects the finishRequest authentication policy: %s',
    async (mode) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local WebSocket address');
      }
      const host = `127.0.0.1:${address.port}`;
      const attempts: {
        authorization: string | undefined;
        custom: string | string[] | undefined;
        host: string | undefined;
        url: string | undefined;
      }[] = [];
      server.on('connection', (_peer, req) => {
        attempts.push({
          authorization: req.headers.authorization,
          custom: req.headers['x-custom'],
          host: req.headers.host,
          url: req.url,
        });
      });
      let key = 'synthetic-A';
      const provider = vi.fn(async () => key);
      const client = new OpenAI({ apiKey: provider, baseURL: `http://${host}/v1` });
      await client._callApiKey();
      if (mode === 'caller credential') {
        provider.mockRejectedValue(new Error('An unused provider must not block hook authentication'));
      }
      const finishRequest = vi.fn((req: ClientRequest) => {
        // Complete asynchronously: authentication is settled only when the request is finished.
        setImmediate(() => {
          if (mode === 'caller credential') {
            req.removeHeader('Authorization');
            req.setHeader('X-Custom', 'synthetic-hook-key');
          } else if (mode === 'SDK key copied to another header') {
            const sdkKey = req.getHeader('Authorization');
            req.removeHeader('Authorization');
            req.setHeader('X-Custom', String(sdkKey));
          } else {
            req.setHeader('Authorization', `${req.getHeader('Authorization')}+transport`);
          }
          req.end();
        });
      });
      const initial = once(server, 'connection');
      // SAFETY: Stable and beta have the same connection lifecycle events.
      const connection = new Responses(client, {
        // Suppress the SDK bearer only for a hook that owns all WebSocket authentication.
        headers: mode === 'caller credential' ? { Authorization: '' } : {},
        finishRequest,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        key = 'synthetic-B';
        // oxlint-disable-next-line promise/avoid-new -- The failure must resolve without waiting for a timeout.
        const outcome = new Promise<string>((resolve) => {
          connection.once('reconnected', () => resolve('reconnected'));
          connection.once('close', (_code, reason) => resolve(reason));
        });
        peer.close(1012);
        expect(await outcome).toBe('reconnected');
        expect(finishRequest).toHaveBeenCalledTimes(2);
        expect(provider).toHaveBeenCalledTimes(mode === 'caller credential' ? 1 : 2);
        if (mode === 'caller credential') {
          expect(attempts).toEqual([
            { authorization: undefined, custom: 'synthetic-hook-key', host, url: '/v1/responses' },
            { authorization: undefined, custom: 'synthetic-hook-key', host, url: '/v1/responses' },
          ]);
        } else if (mode === 'augmented SDK key') {
          expect(attempts).toEqual([
            { authorization: 'Bearer synthetic-A+transport', custom: undefined, host, url: '/v1/responses' },
            { authorization: 'Bearer synthetic-B+transport', custom: undefined, host, url: '/v1/responses' },
          ]);
        } else {
          expect(attempts).toEqual([
            { authorization: undefined, custom: 'Bearer synthetic-A', host, url: '/v1/responses' },
            { authorization: undefined, custom: 'Bearer synthetic-B', host, url: '/v1/responses' },
          ]);
        }
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

  test.each(['authHeaders', 'createSocket'] as const)(
    'reconnects when only %s can supply credentials',
    async (hook) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local WebSocket address');
      }
      const attempts: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => attempts.push(request.headers.authorization));
      const provider = vi.fn().mockRejectedValue(new Error('unused provider is unavailable'));
      const client = new OpenAI({ apiKey: provider, baseURL: `http://127.0.0.1:${address.port}/v1` });
      // SAFETY: Stable and beta provide identical subclass authentication and transport hook signatures.
      class HookResponses extends (Responses as typeof StableResponsesWS) {
        protected override _authHeaders(apiKey?: string | null) {
          return hook === 'authHeaders'
            ? { Authorization: 'Bearer synthetic-hook' }
            : super._authHeaders(apiKey);
        }
        protected override _createSocket(url: URL, authHeaders: Record<string, string>) {
          return super._createSocket(
            url,
            hook === 'createSocket' ? { Authorization: 'Bearer synthetic-hook' } : authHeaders,
          );
        }
      }
      const initial = once(server, 'connection');
      const connection = new HookResponses(client, {
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      });
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        // oxlint-disable-next-line promise/avoid-new -- Observe failure as well as success without a test timeout.
        const outcome = new Promise<string>((resolve) => {
          connection.once('reconnected', () => resolve('reconnected'));
          connection.once('close', (_code, reason) => resolve(reason));
        });
        peer.close(1012);
        expect(await outcome).toBe('reconnected');
        expect(attempts).toEqual(['Bearer synthetic-hook', 'Bearer synthetic-hook']);
        expect(provider).not.toHaveBeenCalled();
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
