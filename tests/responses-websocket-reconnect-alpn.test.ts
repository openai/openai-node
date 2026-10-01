import { once } from 'node:events';
import { Agent, createServer } from 'node:https';
import { TLSSocket } from 'node:tls';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { createX509TestLab } from './utils/x509-test-lab';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses ALPN on credential refresh', ({ Responses }) => {
  test.each(['protocol list', 'Buffer', 'Uint8Array slice'] as const)(
    'pins the protocol negotiation before credential refresh: %s',
    async (material) => {
      const lab = createX509TestLab();
      const https = createServer({
        cert: lab.server.certificate,
        key: lab.server.privateKey,
        ALPNProtocols: ['http/1.1', 'http/1.0'],
      });
      const server = new WebSocketServer({ server: https });
      const listening = once(https, 'listening');
      https.listen(0, '127.0.0.1');
      await listening;
      const address = https.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local HTTPS address');
      }
      const requests: { authorization: string | undefined; protocol: TLSSocket['alpnProtocol'] | false }[] =
        [];
      server.on('connection', (_peer, request) => {
        requests.push({
          authorization: request.headers.authorization,
          protocol: request.socket instanceof TLSSocket && request.socket.alpnProtocol,
        });
      });
      let refresh!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Mutate TLS options at the actual credential-refresh boundary.
      const refreshing = new Promise<void>((resolve) => {
        refresh = resolve;
      });
      let release!: (key: string) => void;
      // oxlint-disable-next-line promise/avoid-new -- Only reconnect waits for mutation of the caller's original settings.
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
      const encoded = Buffer.concat([Buffer.from([8]), Buffer.from('http/1.1')]);
      const backing = new Uint8Array(encoded.length + 8);
      backing.set(encoded, 4);
      let ALPNProtocols: string[] | Uint8Array;
      if (material === 'protocol list') {
        ALPNProtocols = ['http/1.1'];
      } else if (material === 'Buffer') {
        ALPNProtocols = encoded;
      } else {
        ALPNProtocols = backing.subarray(4, 4 + encoded.length);
      }
      const agent = new Agent({ maxCachedSessions: 0 });
      const client = new OpenAI({ apiKey, baseURL: `https://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // ws forwards TLS settings even where its ClientOptions type doesn't declare them.
      const transportOptions = {
        agent,
        ca: lab.certificateAuthority,
        ALPNProtocols,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      };
      // SAFETY: Stable and beta expose identical connection lifecycle methods.
      const connection = new Responses(client, transportOptions) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const terminal = Promise.race([
          connection.emitted('reconnected').then(() => 'reconnected'),
          connection.emitted('close').then(() => 'closed'),
        ]);
        peer.close(1012);
        await refreshing;
        if (Array.isArray(ALPNProtocols)) {
          ALPNProtocols[0] = 'http/1.0';
        } else {
          ALPNProtocols.set(Buffer.concat([Buffer.from([8]), Buffer.from('http/1.0')]));
        }
        release('synthetic-B');
        expect(await terminal).toBe('reconnected');
        expect(requests).toEqual([
          { authorization: 'Bearer synthetic-A', protocol: 'http/1.1' },
          { authorization: 'Bearer synthetic-B', protocol: 'http/1.1' },
        ]);
        expect(apiKey).toHaveBeenCalledTimes(2);
      } finally {
        release('synthetic-B');
        connection.close();
        agent.destroy();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
        const stopped = once(https, 'close');
        https.close();
        await stopped;
      }
    },
  );
});
