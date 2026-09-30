import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';

describe.each(['primary', 'fork', 'sideband'] as const)('Live %s delivery uncertainty', (role) => {
  test('retries only never-attempted pre-open commands after an opt-in reconnect', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback address');
    }
    const received: { socket: number; wire: string }[] = [];
    let connections = 0;
    server.on('connection', (peer) => {
      connections += 1;
      const socket = connections;
      peer.on('message', (data) => {
        const wire = String(data);
        received.push({ socket, wire });
        if (socket === 1) {
          peer.close(1011, 'synthetic disconnect after delivery');
        } else if (wire.includes('never_attempted')) {
          peer.close(1000, 'received remaining');
        }
      });
    });
    const client = new OpenAI({
      apiKey: 'ek_synthetic_live',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
    });
    const options = {
      reconnect: { onReconnecting: () => ({}), maxRetries: 1, initialDelay: 0, maxDelay: 0 },
    };
    let connection: LiveWS | ForksWS | SidebandWS;
    if (role === 'primary') {
      connection = new LiveWS(client, options);
    } else if (role === 'fork') {
      connection = new ForksWS(client, { session_id: 'stored-synthetic' }, options);
    } else {
      connection = new SidebandWS(client, { session_id: 'signaling-synthetic' }, options);
    }
    const stream = connection.stream();
    const actualSend = connection.socket.send.bind(connection.socket);
    // Send over the real wire before reporting failure, as can happen after a
    // transport has accepted bytes. Only the first socket is fault-injected.
    const injectedFailure = new Error('synthetic error after sending to server');
    connection.socket.send = (data) => {
      actualSend(data);
      throw injectedFailure;
    };
    const attempted = { type: 'session.update', event_id: 'already_attempted', session: {} } as const;
    const pending = { type: 'session.update', event_id: 'never_attempted', session: {} } as const;
    connection.send(attempted);
    connection.sendRaw(JSON.stringify(pending));
    const errors: Error[] = [];
    try {
      for await (const item of stream) {
        if (item.type === 'error') {
          errors.push(item.error);
        }
        if (item.type === 'close') {
          expect(item.code).toBe(1000);
          expect(item.unsent).toEqual([]);
        }
      }
      expect(connections).toBe(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ message: 'could not send queued data', cause: injectedFailure });
      expect(received).toEqual([
        { socket: 1, wire: JSON.stringify(attempted) },
        { socket: 2, wire: JSON.stringify(pending) },
      ]);
    } finally {
      await stream.return?.();
      connection.close();
      for (const peer of server.clients) {
        peer.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  test('detaching one consumer preserves future events, storage failure and closure for another', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback address');
    }
    let connections = 0;
    const future = { type: 'session.future', event_id: 'future_event', extra: null };
    server.on('connection', (peer) => {
      connections += 1;
      peer.send(JSON.stringify(future));
      peer.send(
        JSON.stringify({
          type: 'error',
          event_id: 'storage_problem',
          error: {
            type: 'server_error',
            code: 'session_storage_failed',
            message: 'Synthetic recording not finalized',
          },
        }),
      );
      peer.send(
        JSON.stringify({ type: 'session.closed', event_id: 'closed_after_storage', session: { id: 's_1' } }),
      );
      peer.close(1000, 'finished');
    });
    const client = new OpenAI({
      apiKey: 'ek_synthetic_live',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
    });
    let connection: LiveWS | ForksWS | SidebandWS;
    if (role === 'primary') {
      connection = new LiveWS(client);
    } else if (role === 'fork') {
      connection = new ForksWS(client, { session_id: 'stored-synthetic' });
    } else {
      connection = new SidebandWS(client, { session_id: 'signaling-synthetic' });
    }
    const stream = connection.stream();
    const detached = connection.stream();
    await detached.return?.();
    expect(await detached.next()).toEqual({ done: true, value: undefined });
    const seen: string[] = [];
    const messages: unknown[] = [];
    try {
      for await (const item of stream) {
        if (item.type === 'error') {
          expect(item.error).toMatchObject({
            message: 'Synthetic recording not finalized',
          });
          expect(item.error.error).toMatchObject({
            type: 'error',
            event_id: 'storage_problem',
            error: { code: 'session_storage_failed' },
          });
          seen.push('storage_failed');
        } else if (item.type === 'message') {
          seen.push(item.message.type);
          messages.push(item.message);
        } else if (item.type === 'close') {
          seen.push(item.type);
        }
      }
      expect(seen).toEqual(['session.future', 'storage_failed', 'session.closed', 'close']);
      expect(messages).toEqual([
        future,
        { type: 'session.closed', event_id: 'closed_after_storage', session: { id: 's_1' } },
      ]);
      expect(connections).toBe(1);
    } finally {
      await stream.return?.();
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
