import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';

describe.each(['primary', 'fork', 'sideband'] as const)('Live %s wire contract', (role) => {
  test.each(['', '?tenant=sample&scope=read&scope=write&trace=old&trace=older'])(
    'starts and updates through a custom base URL (%s)',
    async (baseQuery) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      const failures: unknown[] = [];
      let connections = 0;
      let requests = 0;
      const session = { id: 'live_fixture', model: 'gpt-live-1', status: 'active', expires_at: 123 };
      server.on('connection', (socket, request) => {
        connections += 1;
        try {
          if (!request.url) {
            throw new Error('Missing WebSocket request target');
          }
          const target = new URL(request.url, 'http://127.0.0.1');
          const suffix =
            role === 'primary' ? '' : `/stored%20%2F%3F%23%25/${role === 'fork' ? 'fork' : 'attach'}`;
          expect(target.pathname).toBe(`/v1/customer/live/sessions${suffix}`);
          expect(Object.fromEntries(target.searchParams)).toEqual({
            ...(baseQuery ? { tenant: 'sample', scope: 'write' } : {}),
            trace: 'role-contract',
            ...(role === 'sideband' ? { graceful_close: 'true' } : {}),
          });
          expect(target.searchParams.getAll('scope')).toEqual(baseQuery ? ['read', 'write'] : []);
          expect(target.searchParams.getAll('trace')).toEqual(['role-contract']);
          expect(request.headers.authorization).toBe('Bearer ek_fake_live');
        } catch (error) {
          failures.push(error);
        }
        socket.on('message', (data) => {
          requests += 1;
          try {
            if (role !== 'sideband' && requests === 1) {
              expect(JSON.parse(data.toString())).toEqual({
                type: 'session.start',
                event_id: 'caller-start',
                session: role === 'primary' ? { model: 'gpt-live-1' } : {},
              });
              socket.send(JSON.stringify({ type: 'session.started', event_id: 'started', session }));
            } else {
              expect(requests).toBe(role === 'sideband' ? 1 : 2);
              expect(JSON.parse(data.toString())).toEqual({
                type: 'session.update',
                event_id: 'caller-update',
                session: {},
              });
              socket.send(
                JSON.stringify({
                  type: 'session.updated',
                  event_id: 'updated',
                  client_event_id: 'caller-update',
                  session,
                }),
              );
            }
          } catch (error) {
            failures.push(error);
            socket.close();
          }
        });
        // An attached sideband is active without a fresh session.started.
        if (role === 'sideband') {
          socket.send(
            JSON.stringify({
              type: 'session.output_transcript.delta',
              event_id: 'first',
              delta: 'Attached',
              start_ms: 0,
              end_ms: 120,
            }),
          );
        }
      });
      const client = new OpenAI({
        apiKey: 'ek_fake_live',
        baseURL: `http://127.0.0.1:${address.port}/v1/customer${baseQuery}`,
        defaultQuery: { trace: 'role-contract' },
      });
      let connection: LiveWS | ForksWS | SidebandWS;
      if (role === 'primary') {
        connection = new LiveWS(client);
      } else if (role === 'fork') {
        connection = new ForksWS(client, { session_id: 'stored /?#%' });
      } else {
        connection = new SidebandWS(client, { session_id: 'stored /?#%', graceful_close: true });
      }
      const stream = connection.stream();
      try {
        if (connection instanceof LiveWS) {
          connection.send({
            type: 'session.start',
            event_id: 'caller-start',
            session: { model: 'gpt-live-1' },
          });
        } else if (connection instanceof ForksWS) {
          connection.send({ type: 'session.start', event_id: 'caller-start', session: {} });
        }
        let firstMessage = true;
        for await (const item of stream) {
          if (item.type === 'close') {
            throw new Error('Unexpected close before session update');
          }
          if (item.type === 'error') {
            throw item.error;
          }
          if (item.type !== 'message') {
            continue;
          }
          if (firstMessage) {
            expect(item.message.type).toBe(
              role === 'sideband' ? 'session.output_transcript.delta' : 'session.started',
            );
            firstMessage = false;
            connection.send({ type: 'session.update', event_id: 'caller-update', session: {} });
          } else {
            expect(item.message).toEqual({
              type: 'session.updated',
              event_id: 'updated',
              client_event_id: 'caller-update',
              session,
            });
            break;
          }
        }
        const closed = once(connection.socket.platformSocket, 'close');
        connection.close();
        await closed;
        expect(requests).toBe(role === 'sideband' ? 1 : 2);
        expect(connections).toBe(1);
        expect(failures).toEqual([]);
      } finally {
        await stream.return?.();
        connection.close();
        for (const socket of server.clients) {
          socket.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );
});

test('sideband exposes typed transport events and retains unknown events', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local server address');
  }
  const frames = [
    { type: 'session.input_audio.append', audio: 'AAE=' },
    { type: 'transport.dtmf.received', event_id: 'r1', event: '5' },
    { type: 'transport.dtmf.send', event_id: 's1', event: '#', client_event_id: 'command1' },
    { type: 'transport.ringing', event_id: 'r2', session_id: 'live_test' },
    { type: 'transport.answered', event_id: 'a1', session_id: 'live_test' },
    {
      type: 'transport.failed',
      event_id: 'f1',
      session_id: 'live_test',
      error: {
        type: 'call_error',
        code: 'provider_invite_failed',
        message: 'synthetic failure',
        param: null,
      },
    },
    // Null is outside the server schema; retain the existing lenient decode behavior.
    { type: 'transport.dtmf.send', event_id: 's2', event: '#', client_event_id: null },
    { type: 'transport.dtmf.send', event_id: 's3', event: '#' },
    { type: 'session.output_audio.delta', delta: 'AAE=', start_ms: 10, end_ms: 20 },
    { type: 'future.transport.event', marker: 42 },
  ];
  server.on('connection', (socket) => {
    for (const frame of frames) {
      socket.send(JSON.stringify(frame));
    }
  });
  const client = new OpenAI({ apiKey: 'synthetic', baseURL: `http://127.0.0.1:${address.port}/v1` });
  const connection = new SidebandWS(client, { session_id: 'live_test' });
  const stream = connection.stream();
  const typedValues = [];
  let received = 0;
  try {
    for await (const item of stream) {
      if (item.type === 'error') {
        throw item.error;
      }
      if (item.type === 'close') {
        throw new Error('Socket closed before events drained');
      }
      if (item.type !== 'message') {
        continue;
      }
      const event = item.message;
      expect(event).toEqual(frames[received]);
      received += 1;
      switch (event.type) {
        case 'session.input_audio.append': {
          typedValues.push(event.audio);
          break;
        }
        case 'session.output_audio.delta': {
          typedValues.push(event.delta, event.start_ms, event.end_ms);
          break;
        }
        case 'transport.dtmf.received': {
          typedValues.push(event.event);
          break;
        }
        case 'transport.dtmf.send': {
          typedValues.push(event.client_event_id);
          break;
        }
        case 'transport.ringing': {
          typedValues.push(event.session_id);
          break;
        }
        case 'transport.answered': {
          typedValues.push(event.session_id);
          break;
        }
        case 'transport.failed': {
          typedValues.push(event.error.message);
          break;
        }
        default: {
          expect(event).toEqual({ type: 'future.transport.event', marker: 42 });
        }
      }
      if (received === frames.length) {
        break;
      }
    }
    expect(typedValues).toEqual([
      'AAE=',
      '5',
      'command1',
      'live_test',
      'live_test',
      'synthetic failure',
      null,
      undefined,
      'AAE=',
      10,
      20,
    ]);
    const closed = once(connection.socket.platformSocket, 'close');
    connection.close();
    await closed;
  } finally {
    await stream.return?.();
    connection.close();
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
