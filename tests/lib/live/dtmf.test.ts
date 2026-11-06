import { once } from 'node:events';
import { expectTypeOf } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import type { LiveWS } from 'openai/resources/live/ws';

it('sends SIP DTMF commands and receives current and historical notifications', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address');
  }
  const commands = [
    { type: 'transport.dtmf.send' as const, event: '#' },
    { type: 'transport.dtmf.send' as const, event: '0', event_id: null },
    { type: 'transport.dtmf.send' as const, event: 'A', event_id: 'caller-1' },
  ];
  const received: unknown[] = [];
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const command = JSON.parse(data.toString());
      received.push(command);
      const notification = {
        event_id: `server-${received.length}`,
        event: command.event,
        ...(typeof command.event_id === 'string' ? { client_event_id: command.event_id } : {}),
      };
      socket.send(JSON.stringify({ ...notification, type: 'transport.dtmf.sent' }));
      socket.send(JSON.stringify({ ...notification, type: 'transport.dtmf.send' }));
    });
  });
  const client = new OpenAI({ apiKey: 'test-key', baseURL: `http://127.0.0.1:${address.port}/v1` });
  const connection = new SidebandWS(client, { session_id: 'sip-session' });
  const stream = connection.stream();
  try {
    await once(connection.socket.platformSocket, 'open');
    for (const command of commands) {
      connection.send(command);
    }
    const notifications = [];
    for await (const item of stream) {
      if (item.type === 'error') {
        throw item.error;
      }
      if (item.type === 'close') {
        throw new Error('Unexpected close');
      }
      if (item.type !== 'message') {
        continue;
      }
      const event = item.message;
      if (event.type !== 'transport.dtmf.sent' && event.type !== 'transport.dtmf.send') {
        throw new Error(`Unexpected event: ${event.type}`);
      }
      notifications.push({ type: event.type, event: event.event, client_event_id: event.client_event_id });
      if (notifications.length === 6) {
        break;
      }
    }
    expect(received).toEqual(commands);
    expect(notifications).toEqual(
      commands.flatMap((command) =>
        ['transport.dtmf.sent', 'transport.dtmf.send'].map((type) => ({
          type,
          event: command.event,
          client_event_id: command.event_id ?? undefined,
        })),
      ),
    );
  } finally {
    const closed = once(connection.socket.platformSocket, 'close');
    connection.close();
    await closed;
    await stream.return?.();
    const serverClosed = once(server, 'close');
    server.close();
    await serverClosed;
  }
});

it('keeps the SIP command out of primary Live socket inputs', () => {
  expectTypeOf<{ type: 'transport.dtmf.send'; event: '#' }>().not.toMatchTypeOf<
    Parameters<LiveWS['send']>[0]
  >();
});
