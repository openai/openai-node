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
])('$name caller credentials from legacy headers', ({ Responses }) => {
  test.each(['Authorization', 'AUTHORIZATION', 'authorization'])(
    'honors an empty %s returned by the hook on each handshake',
    async (name) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing server address');
      }
      const upgrades: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => upgrades.push(request.headers.authorization));
      const apiKey = vi.fn(async () => {
        if (apiKey.mock.calls.length > 1) {
          throw new Error('synthetic provider offline');
        }
        return 'synthetic-cached-key';
      });
      class CallerHeaderClient extends OpenAI {
        headerName = name;
        override _buildWebSocketHeaders() {
          return { [this.headerName]: '' };
        }
      }
      const client = new CallerHeaderClient({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const finishRequest = vi.fn((request: ClientRequest) => {
        request.setHeader('Authorization', 'Bearer synthetic-caller-key');
        request.end();
      });
      const first = once(server, 'connection');
      // SAFETY: Only shared lifecycle events are inspected on either Responses surface.
      const connection = new Responses(client, {
        finishRequest,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await first;
        await once(connection.socket.platformSocket, 'open');
        const finished = Promise.race([connection.emitted('reconnected'), connection.emitted('close')]);
        peer.close(1012);
        await finished;
        expect(upgrades).toEqual(['Bearer synthetic-caller-key', 'Bearer synthetic-caller-key']);
        expect(finishRequest).toHaveBeenCalledTimes(2);
        expect(apiKey).toHaveBeenCalledTimes(1);
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
