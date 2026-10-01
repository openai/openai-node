import { once } from 'node:events';
import { createServer } from 'node:https';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { createX509TestLab } from './utils/x509-test-lab';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses CRL on credential refresh', ({ Responses }) => {
  test('uses the revocation policy selected when reconnect starts', async () => {
    const lab = createX509TestLab();
    const https = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
    const server = new WebSocketServer({ server: https });
    const listening = once(https, 'listening');
    https.listen(0, '127.0.0.1');
    await listening;
    const address = https.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local HTTPS address');
    }
    const requests: (string | undefined)[] = [];
    server.on('connection', (_peer, request) => requests.push(request.headers.authorization));
    let refresh!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Synchronize policy rotation with the real credential wait.
    const refreshing = new Promise<void>((resolve) => {
      refresh = resolve;
    });
    let release!: (key: string) => void;
    // oxlint-disable-next-line promise/avoid-new -- Only the second callable-key resolution is held.
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
    const crl: Buffer[] = [];
    const client = new OpenAI({ apiKey, baseURL: `https://127.0.0.1:${address.port}/v1` });
    await client._callApiKey();
    const initial = once(server, 'connection');
    // SAFETY: Stable and beta expose identical lifecycle events.
    const connection = new Responses(client, {
      ca: lab.certificateAuthority,
      crl,
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    }) as StableResponsesWS;
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      const reconnected = connection.emitted('reconnected');
      peer.close(1012);
      await refreshing;
      // Rotating the caller's array during this attempt must not give OpenSSL
      // an unpublished, incomplete replacement CRL when the key arrives.
      crl.push(Buffer.from('incomplete synthetic CRL'));
      release('synthetic-B');
      await reconnected;
      expect(requests).toEqual(['Bearer synthetic-A', 'Bearer synthetic-B']);
    } finally {
      release('synthetic-B');
      connection.close();
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
  });
});
