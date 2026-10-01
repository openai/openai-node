import { once } from 'node:events';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

class LegacyHeaderClient extends OpenAI {
  override _buildWebSocketHeaders(authHeaders: Record<string, string>) {
    return { ...super._buildWebSocketHeaders({ ...authHeaders }), 'x-request-id': 'synthetic-hook' };
  }
}

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses legacy client header overrides', ({ Responses }) => {
  test.each([
    { name: 'explicit removal', value: null, expected: [undefined, undefined], calls: 1 },
    {
      name: 'undefined header',
      value: undefined,
      expected: ['Bearer synthetic-A', 'Bearer synthetic-B'],
      calls: 2,
    },
  ])('preserves $name without rereading default headers', async ({ value, expected, calls }) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local server address');
    }
    const upgrades: (string | undefined)[] = [];
    const requestIDs: (string | string[] | undefined)[] = [];
    server.on('connection', (_peer, request) => {
      upgrades.push(request.headers.authorization);
      requestIDs.push(request.headers['x-request-id']);
    });
    const apiKey = vi.fn(async () => (apiKey.mock.calls.length === 1 ? 'synthetic-A' : 'synthetic-B'));
    const getAuthorization = vi.fn(() => value);
    const client = new LegacyHeaderClient({
      apiKey,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      defaultHeaders: {
        get Authorization() {
          return getAuthorization();
        },
      },
    });
    await client._callApiKey();
    const initial = once(server, 'connection');
    // SAFETY: Only shared lifecycle methods are exercised on both surfaces.
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
      expect(upgrades).toEqual(expected);
      expect(requestIDs).toEqual(['synthetic-hook', 'synthetic-hook']);
      expect(apiKey).toHaveBeenCalledTimes(calls);
      expect(getAuthorization).toHaveBeenCalledTimes(2);
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
});
