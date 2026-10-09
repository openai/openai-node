import { once } from 'node:events';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { BedrockOpenAI } from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses rotating Bedrock credential', ({ Responses }) => {
  test('caller credentials do not read an unused Bedrock key during admission or reconnect', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local server address');
    }
    const provider = vi.fn().mockRejectedValue(new Error('Bedrock key must not be refreshed'));
    const client = new BedrockOpenAI({
      baseURL: `http://127.0.0.1:${address.port}/openai/v1`,
      bedrockTokenProvider: provider,
    });
    // Bedrock validates on read; an independent socket must not read this unused credential.
    client.apiKey = 'synthetic-invalid ';
    const received: (string | undefined)[] = [];
    server.on('connection', (_peer, request) => received.push(request.headers.authorization));
    // SAFETY: Stable and beta share this subclass hook and the lifecycle methods exercised below.
    class CallerResponses extends (Responses as typeof StableResponsesWS) {
      // oxlint-disable-next-line eslint/class-methods-use-this -- This existing instance hook must not read the unused client credential.
      protected override _authHeaders() {
        return { Authorization: 'Bearer synthetic-caller' };
      }
    }
    const initial = once(server, 'connection');
    const connection = new CallerResponses(client, {
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    });
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      const outcome = Promise.race([
        connection.emitted('reconnected').then(() => 'reconnected'),
        connection.emitted('close').then(() => 'closed'),
      ]);
      peer.close(1012);
      expect(await outcome).toBe('reconnected');
      expect(received).toEqual(['Bearer synthetic-caller', 'Bearer synthetic-caller']);
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
  });

  test.each([false, true])(
    'does not send or cache an invalid refresh (newer valid request cached: %s)',
    async (hasNewerRequest) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      let refreshing!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Gate the actual provider between two real handshakes.
      const started = new Promise<void>((resolve) => {
        refreshing = resolve;
      });
      let release!: (token: string) => void;
      // oxlint-disable-next-line promise/avoid-new -- Hold the older credential while the newer one completes.
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const provider = vi
        .fn()
        .mockResolvedValueOnce('synthetic-initial')
        .mockImplementationOnce(() => {
          refreshing();
          return pending;
        })
        .mockResolvedValueOnce('synthetic-current');
      const received: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => received.push(request.headers.authorization));
      const client = new BedrockOpenAI({
        baseURL: `http://127.0.0.1:${address.port}/openai/v1`,
        bedrockTokenProvider: provider,
      });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // SAFETY: Stable and beta expose identical lifecycle events.
      const connection = new Responses(client, {
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        // oxlint-disable-next-line promise/avoid-new -- Observe either possible reconnect result without a timeout.
        const outcome = new Promise<string>((resolve) => {
          connection.once('reconnected', () => resolve('reconnected'));
          connection.once('close', (_code, reason) => resolve(reason));
        });
        peer.close(1012);
        await started;
        if (hasNewerRequest) {
          await client._callApiKey();
        }
        const cached = hasNewerRequest ? 'synthetic-current' : 'synthetic-initial';
        expect(client.apiKey).toBe(cached);
        // Whitespace is silently normalized by HTTP headers if the SDK's Bedrock validator is bypassed.
        release('synthetic-invalid ');
        expect(await outcome).toMatch(/reconnect failed/u);
        expect(received).toEqual(['Bearer synthetic-initial']);
        expect(client.apiKey).toBe(cached);
      } finally {
        release('synthetic-invalid ');
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
