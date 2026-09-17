import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';
import type { ResponsesClientEvent } from 'openai/resources/responses/responses';
import scenarios from './fixtures/websocket_scenarios.json';

describe('Responses WebSocket wire contract', () => {
  test.each(scenarios.scenarios)('$id', async (scenario) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (typeof address === 'string' || !address) {
      throw new Error('Missing local server address');
    }
    const failures: unknown[] = [];
    let connections = 0;
    let requests = 0;
    server.on('connection', (socket, request) => {
      connections += 1;
      try {
        expect(request.url).toBe('/v1/responses?contract=1');
        expect(request.headers.authorization).toBe('Bearer fake-contract-key');
        expect(request.headers['x-contract-test']).toBe('synthetic');
      } catch (error) {
        failures.push(error);
      }
      socket.on('message', (data) => {
        const turn = scenario.turns[requests];
        requests += 1;
        try {
          expect(turn).toBeDefined();
          expect(JSON.parse(data.toString())).toEqual(turn?.request);
          for (const frame of turn?.frames ?? []) {
            socket.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
          }
          if (requests === scenario.turns.length && 'close_code' in scenario) {
            socket.close(scenario.close_code);
          }
        } catch (error) {
          failures.push(error);
          socket.close();
        }
      });
    });
    const client = new OpenAI({
      apiKey: 'fake-contract-key',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      defaultQuery: { contract: '1' },
    });
    const connection = new ResponsesWS(client, { headers: { 'X-Contract-Test': 'synthetic' } });
    // Protocol errors are also preserved on the event stream.
    connection.on('error', () => {});
    const stream = connection.stream();
    try {
      for (const turn of scenario.turns) {
        // SAFETY: These synthetic JSON requests are the versioned cross-SDK wire corpus.
        connection.send(turn.request as ResponsesClientEvent);
        for (const frame of turn.frames) {
          for (;;) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Consume protocol frames in their wire order.
            const item = await stream.next();
            expect(item.done).toBe(false);
            if (!item.value) {
              throw new Error('Unexpected end of socket stream');
            }
            if (item.value.type === 'message') {
              expect(item.value.message).toEqual(frame);
              break;
            }
            if (item.value.type === 'raw') {
              // Legacy TypeScript surfaces malformed JSON as raw data.
              expect(String(item.value.data)).toBe(frame);
              break;
            }
            if (item.value.type === 'error') {
              expect(item.value.error.error).toEqual(frame);
              break;
            }
            if (item.value.type === 'close') {
              throw new Error('Socket closed before the expected event');
            }
          }
        }
      }
      if ('close_code' in scenario) {
        for await (const item of stream) {
          if (item.type === 'close') {
            expect(item.code).toBe(scenario.close_code);
          }
        }
      }
      expect(requests).toBe(scenario.turns.length);
      expect(connections).toBe(1);
      expect(failures).toEqual([]);
    } finally {
      await stream.return?.();
      connection.close();
      connection.close();
      for (const socket of server.clients) {
        socket.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });
});
