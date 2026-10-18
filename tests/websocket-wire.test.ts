import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import OpenAI from 'openai';
import { OpenAIRealtimeTranslationWS } from 'openai/realtime/translations/ws';
import { LiveWS } from 'openai/resources/live/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { createX509TestLab } from './utils/x509-test-lab';

async function within<T>(promise: Promise<T>): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(5000, undefined, { signal: timer.signal }).then(() => {
        throw new Error('WebSocket test timed out');
      }),
    ]);
  } finally {
    timer.abort();
  }
}

const lab = createX509TestLab();
const tls = { cert: lab.server.certificate, key: lab.server.privateKey };
interface WireOptions {
  ca: string | Buffer;
  headers?: Record<string, string>;
  followRedirects?: boolean;
  handshakeTimeout?: number;
}
interface WireConnection {
  socket: { platformSocket: WebSocket };
  close: () => void;
  send: (event: { type: 'session.close' }) => void;
  emitted: (event: 'error' | 'event') => Promise<Error | { type: string }>;
  on: (event: 'error', listener: (error: Error) => void) => void;
}
const variants: {
  name: string;
  connect: (client: OpenAI, options: WireOptions) => WireConnection | Promise<WireConnection>;
}[] = [
  { name: 'Live', connect: (client: OpenAI, options: WireOptions) => new LiveWS(client, options) },
  {
    name: 'fork',
    connect: (client: OpenAI, options: WireOptions) => new ForksWS(client, { session_id: 'test' }, options),
  },
  {
    name: 'sideband',
    connect: (client: OpenAI, options: WireOptions) =>
      new SidebandWS(client, { session_id: 'test' }, options),
  },
  {
    name: 'Translation',
    connect: (client: OpenAI, options: WireOptions) =>
      OpenAIRealtimeTranslationWS.create(client, { model: 'test', options }),
  },
];

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local address');
  }
  return `https://127.0.0.1:${address.port}`;
}

async function stop(server: Server): Promise<void> {
  const stopped = once(server, 'close', { signal: AbortSignal.timeout(5000) });
  server.close();
  server.closeAllConnections();
  await stopped;
}

describe.each(variants)('$name real handshakes', ({ name, connect }) => {
  test('does not follow a cross-origin redirect', async () => {
    let targetHits = 0;
    const seen: (string | undefined)[] = [];
    const target = createServer(tls, (_request, response) => {
      targetHits += 1;
      response.writeHead(400).end();
    });
    const targetURL = await listen(target);
    const source = createServer(tls, (request, response) => {
      seen.push(request.headers.authorization);
      response.writeHead(307, { Location: `${targetURL}/final` }).end();
    });
    const baseURL = `${await listen(source)}/v1`;
    const client = new OpenAI({ baseURL, apiKey: 'fake-wire-key' });
    try {
      const connection = await connect(client, {
        ca: lab.certificateAuthority,
        handshakeTimeout: 2000,
        followRedirects: true,
      });
      try {
        await within(connection.emitted('error'));
        expect(seen).toEqual(['Bearer fake-wire-key']);
        expect(targetHits).toBe(0);
      } finally {
        connection.close();
      }
    } finally {
      await stop(source);
      await stop(target);
    }
  });

  test('refreshes credentials for new connections, preserves explicit headers, and closes the peer', async () => {
    const server = createServer(tls);
    const peers = new WebSocketServer({ server });
    const baseURL = `${await listen(server)}/v1`;
    let calls = 0;
    const client = new OpenAI({
      baseURL,
      apiKey:
        name === 'Translation'
          ? async () => {
              calls += 1;
              return `fake-wire-${calls}`;
            }
          : 'fake-wire-1',
    });
    try {
      // Each connection must close before changing the shared client credential.
      /* oxlint-disable no-await-in-loop -- Exercise consecutive connection attempts and cleanup. */
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        // Live constructors remain synchronous and use the client's current key.
        if (name !== 'Translation') {
          client.apiKey = `fake-wire-${attempt}`;
        }
        const incoming = once(peers, 'connection', { signal: AbortSignal.timeout(5000) });
        const connection = await connect(client, {
          ca: lab.certificateAuthority,
          headers: attempt === 3 ? { Authorization: 'Bearer fake-explicit' } : {},
        });
        connection.on('error', (error) => {
          throw error;
        });
        try {
          const opened = once(connection.socket.platformSocket, 'open', {
            signal: AbortSignal.timeout(5000),
          });
          const [peer, request] = await incoming;
          await opened;
          expect(request.headers.authorization).toBe(
            attempt === 3 ? 'Bearer fake-explicit' : `Bearer fake-wire-${attempt}`,
          );
          const sent = once(peer, 'message', { signal: AbortSignal.timeout(5000) });
          connection.send({ type: 'session.close' });
          const [message] = await sent;
          expect(JSON.parse(String(message))).toEqual({ type: 'session.close' });
          const received = connection.emitted('event');
          peer.send('{"type":"future.event","marker":42}');
          expect(await within(received)).toMatchObject({ type: 'future.event', marker: 42 });
          const closed = once(peer, 'close', { signal: AbortSignal.timeout(5000) });
          connection.close();
          await closed;
        } finally {
          connection.close();
        }
      }
      /* oxlint-enable no-await-in-loop */
    } finally {
      for (const peer of peers.clients) {
        peer.terminate();
      }
      const closed = once(peers, 'close', { signal: AbortSignal.timeout(5000) });
      peers.close();
      await closed;
      await stop(server);
    }
  });
});
