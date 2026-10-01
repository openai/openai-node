import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

function sign(authorization: string): string {
  return `Gateway ${createHmac('sha256', 'synthetic-gateway-secret').update(authorization).digest('base64url')}`;
}

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket transport credential transforms', ({ Responses }) => {
  test.each([
    'Authorization',
    'X-Gateway-Authorization',
    'raw key in X-API-Key',
    'replace without reading',
    'spread and replace',
    'read retained headers after open',
    'cached zero-argument auth hook',
  ])('reconnects with the correct credential source: %s', async (headerName) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local WebSocket address');
    }
    const attempts: (string | string[] | undefined)[][] = [];
    server.on('connection', (_peer, request) => {
      attempts.push([
        request.headers.authorization,
        request.headers['x-gateway-authorization'],
        request.headers['x-api-key'],
      ]);
    });
    const callerCredential =
      headerName === 'replace without reading' ||
      headerName === 'spread and replace' ||
      headerName === 'read retained headers after open' ||
      headerName === 'cached zero-argument auth hook';
    const provider = vi.fn().mockResolvedValueOnce('synthetic-A');
    if (callerCredential) {
      provider.mockRejectedValue(new Error('An independent credential must not refresh the provider'));
    } else {
      provider.mockResolvedValueOnce('synthetic-B');
    }
    const client = new OpenAI({ apiKey: provider, baseURL: `http://127.0.0.1:${address.port}/v1` });
    await client._callApiKey();
    let retainedHeaders: Record<string, string> | undefined;
    // SAFETY: The stable and beta transports implement the same lifecycle and protected socket hook.
    class GatewayResponses extends (Responses as typeof StableResponsesWS) {
      protected override _usesSDKAPIKey(authHeaders: Record<string, string>) {
        return (
          headerName === 'Authorization' ||
          headerName === 'X-Gateway-Authorization' ||
          super._usesSDKAPIKey(authHeaders)
        );
      }

      protected override _authHeaders(...args: [apiKey?: string | null]) {
        if (headerName === 'cached zero-argument auth hook') {
          if (args.length) {
            throw new Error('A cached caller credential must use the zero-argument hook');
          }
          return { Authorization: 'Bearer synthetic-independent' };
        }
        return super._authHeaders(...args);
      }

      protected override _createSocket(url: URL, authHeaders: Record<string, string>) {
        if (headerName === 'cached zero-argument auth hook') {
          return super._createSocket(url, authHeaders);
        }
        if (headerName === 'read retained headers after open') {
          retainedHeaders ??= authHeaders;
          return super._createSocket(url, { Authorization: 'Bearer synthetic-independent' });
        }
        if (headerName === 'replace without reading') {
          authHeaders['Authorization'] = 'Bearer synthetic-independent';
          return super._createSocket(url, authHeaders);
        }
        if (headerName === 'spread and replace') {
          return super._createSocket(url, { ...authHeaders, Authorization: 'Bearer synthetic-independent' });
        }
        if (headerName === 'raw key in X-API-Key') {
          return super._createSocket(url, {
            'X-API-Key': authHeaders['Authorization']?.slice('Bearer '.length) ?? '',
          });
        }
        return super._createSocket(url, { [headerName]: sign(authHeaders['Authorization'] ?? '') });
      }
    }
    const initial = once(server, 'connection');
    const connection = new GatewayResponses(client, {
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    });
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      if (headerName === 'read retained headers after open') {
        expect(retainedHeaders?.['Authorization']).toBe('Bearer synthetic-A');
      }
      // oxlint-disable-next-line promise/avoid-new -- Observe either reconnect or permanent close when a dead provider is called.
      const outcome = new Promise<string>((resolve) => {
        connection.once('reconnected', () => resolve('reconnected'));
        connection.once('close', (_code, reason) => resolve(reason));
      });
      peer.close(1012);
      expect(await outcome).toBe('reconnected');
      if (callerCredential) {
        expect(attempts).toEqual([
          ['Bearer synthetic-independent', undefined, undefined],
          ['Bearer synthetic-independent', undefined, undefined],
        ]);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(client.apiKey).toBe('synthetic-A');
      } else {
        if (headerName === 'raw key in X-API-Key') {
          expect(attempts).toEqual([
            [undefined, undefined, 'synthetic-A'],
            [undefined, undefined, 'synthetic-B'],
          ]);
        } else {
          const expected = [sign('Bearer synthetic-A'), sign('Bearer synthetic-B')];
          expect(attempts).toEqual(
            expected.map((value) =>
              headerName === 'Authorization' ? [value, undefined, undefined] : [undefined, value, undefined],
            ),
          );
        }
        expect(provider).toHaveBeenCalledTimes(2);
        expect(client.apiKey).toBe('synthetic-B');
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
  });
});
