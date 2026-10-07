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
