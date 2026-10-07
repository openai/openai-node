import { once } from 'node:events';
import { Agent, createServer } from 'node:https';
import { connect, TLSSocket } from 'node:tls';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { createX509TestLab } from './utils/x509-test-lab';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses TLS sessions on reconnect', ({ Responses }) => {
  test('uses the TLS session selected before credential refresh', async () => {
    const lab = createX509TestLab();
    const https = createServer({
      cert: lab.server.certificate,
      key: lab.server.privateKey,
      maxVersion: 'TLSv1.2',
    });
    const server = new WebSocketServer({ server: https });
    const listening = once(https, 'listening');
    https.listen(0, '127.0.0.1');
    await listening;
    const address = https.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local HTTPS address');
    }
    const requests: { authorization: string | undefined; reused: boolean }[] = [];
    server.on('connection', (_peer, request) => {
      requests.push({
        authorization: request.headers.authorization,
        reused: request.socket instanceof TLSSocket && request.socket.isSessionReused(),
      });
    });
    const prime = connect({
      host: '127.0.0.1',
      port: address.port,
      servername: 'localhost',
      ca: lab.certificateAuthority,
      maxVersion: 'TLSv1.2',
    });
    await once(prime, 'secureConnect');
    const session = prime.getSession();
    prime.end();
    if (!session) {
      throw new Error('The initial TLS connection did not issue a session');
    }
    let refresh!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Synchronize TLS session mutation with the real credential wait.
    const refreshing = new Promise<void>((resolve) => {
      refresh = resolve;
    });
    let release!: (key: string) => void;
    // oxlint-disable-next-line promise/avoid-new -- Only the reconnect provider waits for session mutation.
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
    const client = new OpenAI({ apiKey, baseURL: `https://127.0.0.1:${address.port}/v1` });
    await client._callApiKey();
    const initial = once(server, 'connection');
    const agent = new Agent({ maxCachedSessions: 0 });
    const options = {
      agent,
      ca: lab.certificateAuthority,
      servername: 'localhost',
      maxVersion: 'TLSv1.2' as const,
      session,
      reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
    };
    // SAFETY: The lifecycle methods used here are shared by stable and beta Responses.
    const connection = new Responses(client, options) as StableResponsesWS;
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
      session.fill(0);
      release('synthetic-B');
      expect(await terminal).toBe('reconnected');
      expect(requests).toEqual([
        { authorization: 'Bearer synthetic-A', reused: true },
        { authorization: 'Bearer synthetic-B', reused: true },
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
  });
});
