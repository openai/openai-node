import { once } from 'node:events';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses client header transformations', ({ Responses }) => {
  test.each([
    'replace authorization',
    'move authorization',
    'companion signature',
    'companion with empty socket override',
  ])('refreshes a callable key before the client header hook can %s', async (mode) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local WebSocket address');
    }
    const requests: {
      authorization: string | undefined;
      gateway: string | string[] | undefined;
      signature: string | string[] | undefined;
      requestID: string | string[] | undefined;
    }[] = [];
    server.on('connection', (_peer, request) => {
      requests.push({
        authorization: request.headers.authorization,
        gateway: request.headers['x-gateway-token'],
        signature: request.headers['x-signature'],
        requestID: request.headers['x-request-id'],
      });
    });
    let refresh!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Rotate caller headers at the real credential wait.
    const refreshing = new Promise<void>((resolve) => {
      refresh = resolve;
    });
    let release!: (key: string) => void;
    // oxlint-disable-next-line promise/avoid-new -- Hold only the reconnect credential.
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const apiKey = vi
      .fn()
      .mockResolvedValueOnce('synthetic-A')
      .mockImplementation(() => {
        refresh();
        return pending;
      });
    let requestID = 'initial-route';
    const readRequestID = vi.fn(() => requestID);
    class SigningClient extends OpenAI {
      override _buildWebSocketHeaders(authHeaders: Record<string, string>) {
        const headers = super._buildWebSocketHeaders(authHeaders);
        const credential = headers['authorization'];
        if (mode.startsWith('companion')) {
          headers['x-signature'] = credential ? `Signed(${credential})` : '';
        } else if (credential) {
          delete headers['authorization'];
          headers[mode === 'move authorization' ? 'x-gateway-token' : 'authorization'] =
            `Signed(${credential})`;
        }
        return headers;
      }
    }
    const client = new SigningClient({
      apiKey,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      defaultHeaders: {
        get 'X-Request-ID'() {
          return readRequestID();
        },
      },
    });
    await client._callApiKey();
    const initial = once(server, 'connection');
    // SAFETY: Only the lifecycle methods shared by stable and beta Responses are used.
    const connection = new Responses(client, {
      headers: mode === 'companion with empty socket override' ? { 'X-Signature': '' } : {},
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    }) as StableResponsesWS;
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      const terminal = Promise.race([
        connection.emitted('reconnected').then(() => 'reconnected'),
        connection.emitted('close').then(() => 'closed'),
      ]);
      requestID = 'selected-route';
      peer.close(1012);
      expect(await Promise.race([refreshing.then(() => 'refreshing'), terminal])).toBe('refreshing');
      requestID = 'later-route';
      release('synthetic-B');
      expect(await terminal).toBe('reconnected');
      expect(requests).toEqual(
        ['A', 'B'].map((key, index) => {
          const bearer = `Bearer synthetic-${key}`;
          const authorization = mode === 'replace authorization' ? `Signed(${bearer})` : bearer;
          const signature = mode === 'companion signature' ? `Signed(${bearer})` : '';
          return {
            authorization: mode === 'move authorization' ? undefined : authorization,
            gateway: mode === 'move authorization' ? `Signed(${bearer})` : undefined,
            signature: mode.startsWith('companion') ? signature : undefined,
            requestID: index === 0 ? 'initial-route' : 'selected-route',
          };
        }),
      );
      expect(apiKey).toHaveBeenCalledTimes(2);
      expect(readRequestID).toHaveBeenCalledTimes(2);
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
  });
});
