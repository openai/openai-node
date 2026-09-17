import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { OpenAIError } from 'openai/core/error';
import type { ResponseOutputItem } from 'openai/resources/responses/responses';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { WebSocketError } from 'openai/resources/responses/internal-base';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';

const limits = { maxLanes: 8, maxBufferedEvents: 16, maxBufferedBytes: 4096 };

describe.each([
  { name: 'stable', Connection: ResponsesWS },
  { name: 'beta', Connection: BetaResponsesWS },
])('$name session error handling', ({ Connection }) => {
  async function withSocket(
    run: (
      connection: ResponsesWS,
      peer: WebSocket,
      server: WebSocketServer,
      session: ResponsesWebSocketSession,
    ) => Promise<void>,
    beforeOpen?: (connection: ResponsesWS, session: ResponsesWebSocketSession) => void,
  ) {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local server address');
    }
    const incoming = once(server, 'connection');
    // SAFETY: The beta socket supports this runtime API; its generated request schema differs.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Exercise both public JavaScript entrypoints with the same session lifecycle assertions.
    const connection = new Connection(
      new OpenAI({ apiKey: 'synthetic-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
      {
        maxQueueSize: 1,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      },
    ) as unknown as ResponsesWS;
    const session = new ResponsesWebSocketSession(connection, limits);
    try {
      beforeOpen?.(connection, session);
      const [peer] = await incoming;
      await once(connection.socket.platformSocket, 'open');
      await run(connection, peer, server, session);
    } finally {
      session.close();
      connection.close();
      for (const socket of server.clients) {
        socket.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  }

  test.each([
    { event: null, message: 'invalid WebSocket event' },
    { event: { type: 'close' }, message: 'reserved WebSocket event type' },
  ])('keeps lanes usable after $message', async ({ event, message }) => {
    await withSocket(async (connection, peer, _server, session) => {
      const lane = session.lane();
      const other = session.lane('other');
      const diagnostic = connection.emitted('error');
      peer.send(JSON.stringify(event));
      const error = await diagnostic;
      expect(error.message).toContain(message);
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);
      peer.send(JSON.stringify({ type: 'response.completed', response: { id: 'default' } }));
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
      );
      expect(await lane.finalResponse()).toMatchObject({ id: 'default' });
      expect(await other.finalResponse()).toMatchObject({ id: 'other' });
    });
  });

  test('keeps lanes usable after a connecting send queue overflow', async () => {
    let lane: ReturnType<ResponsesWebSocketSession['lane']>;
    await withSocket(
      async (_connection, peer) => {
        peer.send(JSON.stringify({ type: 'response.completed', response: { id: 'after-overflow' } }));
        expect(await lane.finalResponse()).toMatchObject({ id: 'after-overflow' });
      },
      (connection, session) => {
        lane = session.lane();
        const errors: string[] = [];
        connection.on('error', (error) => errors.push(error.message));
        connection.send({ type: 'response.create', input: 'first' });
        connection.send({ type: 'response.create', input: 'discarded' });
        expect(errors).toEqual(['send queue is full, message discarded']);
      },
    );
  });

  test.each([
    { type: 'response.completed', response: undefined },
    { type: 'response.failed', response: null },
    { type: 'response.incomplete', response: [] },
    { type: 'response.completed', response: 'invalid' },
    { type: 'response.failed', response: 0 },
    { type: 'response.incomplete', response: false },
  ])('fails only the lane receiving $type with response $response', async (terminal) => {
    await withSocket(async (connection, peer, _server, session) => {
      const lane = session.lane('invalid');
      const other = session.lane('other');
      const failed = lane.finalResponse().catch((error: unknown) => error);
      peer.send(
        JSON.stringify({
          type: 'response.output_item.done',
          stream_id: 'invalid',
          output_index: 0,
          item: { type: 'message', id: 'item', role: 'assistant', status: 'completed', content: [] },
        }),
      );
      peer.send(JSON.stringify({ ...terminal, stream_id: 'invalid' }));
      const error = await failed;
      expect(error).toBeInstanceOf(OpenAIError);
      expect(error).toMatchObject({ message: 'Responses WebSocket terminal response must be an object' });
      const received = connection.emitted('event');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'invalid', response: { id: 'later' } }),
      );
      await received;
      await expect(lane.finalResponse()).rejects.toBe(error);
      expect(() => lane.create({ input: 'next' })).toThrow('terminal response must be an object');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
      );
      expect(await other.finalResponse()).toMatchObject({ id: 'other' });
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  test.each([
    { output: {}, output_text: '' },
    { output: {} },
    { output: [], output_text: 3 },
    { output: [{ type: 'message', content: null }] },
  ])('fails only the lane with malformed terminal fields %j', async (response) => {
    await withSocket(async (connection, peer, _server, session) => {
      const lane = session.lane('invalid');
      const other = session.lane('other');
      const failed = lane.finalResponse().catch((error: unknown) => error);
      peer.send(
        JSON.stringify({
          type: 'response.output_item.done',
          stream_id: 'invalid',
          output_index: 0,
          item: { type: 'message', id: 'item', role: 'assistant', status: 'completed', content: [] },
        }),
      );
      peer.send(JSON.stringify({ type: 'response.completed', stream_id: 'invalid', response }));
      const error = await failed;
      expect(error).toBeInstanceOf(OpenAIError);
      expect(error).toMatchObject({ message: 'Invalid Responses WebSocket terminal response' });
      await expect(lane.finalResponse()).rejects.toBe(error);
      expect(() => lane.create({ input: 'next' })).toThrow('Invalid Responses WebSocket terminal response');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
      );
      expect(await other.finalResponse()).toMatchObject({ id: 'other', output: [], output_text: '' });
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  test.each([{ item: null }, { item: false }, { item: 0 }, { item: 'invalid' }, { item: [] }])(
    'rejects a malformed completed output item $item',
    async ({ item }) => {
      await withSocket(async (connection, peer, _server, session) => {
        const lane = session.lane('invalid');
        const other = session.lane('other');
        const failed = lane.finalResponse().catch((error: unknown) => error);
        const rawItem = connection.emitted('response.output_item.done');
        peer.send(
          JSON.stringify({ type: 'response.output_item.done', stream_id: 'invalid', output_index: 0, item }),
        );
        peer.send(
          JSON.stringify({
            type: 'response.completed',
            stream_id: 'invalid',
            response: { id: 'invalid', output_text: '' },
          }),
        );
        expect(await rawItem).toMatchObject({ item });
        const error = await failed;
        expect(error).toBeInstanceOf(OpenAIError);
        expect(error).toMatchObject({ message: 'Responses WebSocket output item must be an object' });
        await expect(lane.finalResponse()).rejects.toBe(error);
        expect(() => lane.create({ input: 'next' })).toThrow('output item must be an object');
        peer.send(
          JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
        );
        expect(await other.finalResponse()).toMatchObject({ id: 'other', output: [], output_text: '' });
        expect(connection.socket.readyState).toBe(WebSocket.OPEN);
      });
    },
  );

  test('preserves a completed output item with a future type', async () => {
    await withSocket(async (_connection, peer, _server, session) => {
      const lane = session.lane();
      const item = { type: 'future_output_item', payload: { values: ['retained'] } };
      peer.send(JSON.stringify({ type: 'response.output_item.done', output_index: 0, item }));
      peer.send(JSON.stringify({ type: 'response.completed', response: { id: 'future', output_text: '' } }));
      expect(await lane.finalResponse()).toMatchObject({ id: 'future', output: [item], output_text: '' });
    });
  });

  test.each(['output_index', 'item', 'both'] as const)(
    'rejects inherited output-item fields when the wire omits %s',
    async (omitted) => {
      await withSocket(async (connection, peer, _server, session) => {
        const lane = session.lane('invalid', { maxBufferedBytes: 512 });
        const other = session.lane('other');
        const item = {
          type: 'function_call',
          id: 'call_1',
          call_id: 'call_1',
          name: 'lookup',
          arguments: '{}',
          status: 'completed',
        };
        const received = connection.emitted('response.completed');
        peer.send(
          JSON.stringify({
            type: 'response.output_item.done',
            stream_id: 'invalid',
            ...(omitted === 'item' ? { output_index: 0 } : {}),
            ...(omitted === 'output_index' ? { item } : {}),
          }),
        );
        peer.send(
          JSON.stringify({ type: 'response.completed', stream_id: 'invalid', response: { id: 'invalid' } }),
        );
        await received;
        const previousIndex = Object.getOwnPropertyDescriptor(Object.prototype, 'output_index');
        const previousItem = Object.getOwnPropertyDescriptor(Object.prototype, 'item');
        let result: unknown;
        try {
          // oxlint-disable-next-line eslint/no-extend-native -- Reproduce unaccounted inherited data while consuming actual queued wire events.
          Object.defineProperties(Object.prototype, {
            output_index: { configurable: true, value: 0 },
            item: { configurable: true, value: { ...item, arguments: 'x'.repeat(4096) } },
          });
          result = await lane.finalResponse({ maxResponseBytes: 512 }).catch((error: unknown) => error);
        } finally {
          for (const [key, descriptor] of [
            ['output_index', previousIndex],
            ['item', previousItem],
          ] as const) {
            if (descriptor) {
              // oxlint-disable-next-line eslint/no-extend-native -- Restore the exact descriptors after the synthetic pollution regression.
              Object.defineProperty(Object.prototype, key, descriptor);
            } else {
              Reflect.deleteProperty(Object.prototype, key);
            }
          }
        }
        expect(result).toBeInstanceOf(OpenAIError);
        expect(result).toMatchObject({
          message:
            omitted === 'item'
              ? 'Responses WebSocket output item must be an own property'
              : 'Responses WebSocket output index must be a nonnegative integer',
        });
        await expect(lane.finalResponse()).rejects.toBe(result);
        peer.send(
          JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
        );
        expect(await other.finalResponse()).toMatchObject({ id: 'other' });
        expect(connection.socket.readyState).toBe(WebSocket.OPEN);
      });
    },
  );

  test.each([
    { type: 'response.completed', output: undefined, outputText: undefined, expectedText: 'collected' },
    { type: 'response.failed', output: undefined, outputText: 'supplied', expectedText: 'supplied' },
    { type: 'response.incomplete', output: [], outputText: undefined, expectedText: '' },
    { type: 'response.completed', output: null, outputText: null, expectedText: 'collected' },
    { type: 'response.failed', output: undefined, outputText: '', expectedText: '' },
    { type: 'response.incomplete', output: [], outputText: '', expectedText: '' },
  ])(
    'ignores inherited terminal fields for $type with output $output and output_text $outputText',
    async ({ type, output, outputText, expectedText }) => {
      await withSocket(async (connection, peer, _server, session) => {
        const lane = session.lane('terminal', { maxBufferedBytes: 512 });
        const other = session.lane('other');
        const item: ResponseOutputItem = {
          type: 'message',
          id: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'collected', annotations: [] }],
        };
        const terminalWire = JSON.stringify({
          type,
          stream_id: 'terminal',
          response: { id: 'terminal', output, output_text: outputText },
        });
        const queued = connection.emitted('event');
        peer.send(
          JSON.stringify({ type: 'response.output_item.done', stream_id: 'terminal', output_index: 0, item }),
        );
        await queued;
        const completed = connection.emitted('event');
        peer.send(terminalWire);
        const rawTerminal = await completed;
        const previousOutput = Object.getOwnPropertyDescriptor(Object.prototype, 'output');
        const previousText = Object.getOwnPropertyDescriptor(Object.prototype, 'output_text');
        let result;
        try {
          // oxlint-disable-next-line eslint/no-extend-native -- Consume real queued wire events with inherited data larger than the response budget.
          Object.defineProperties(Object.prototype, {
            output: { configurable: true, value: [{ ...item, id: 'x'.repeat(4096) }] },
            output_text: { configurable: true, value: 'x'.repeat(4096) },
          });
          result = await lane.finalResponse({ maxResponseBytes: 512 });
        } finally {
          for (const [key, descriptor] of [
            ['output', previousOutput],
            ['output_text', previousText],
          ] as const) {
            if (descriptor) {
              // oxlint-disable-next-line eslint/no-extend-native -- Restore the exact descriptors after the synthetic pollution regression.
              Object.defineProperty(Object.prototype, key, descriptor);
            } else {
              Reflect.deleteProperty(Object.prototype, key);
            }
          }
        }
        expect(result).toMatchObject({ id: 'terminal', output: output ?? [item], output_text: expectedText });
        result.output_text = 'caller mutation';
        result.output.push(item);
        expect(result.output_text).toBe('caller mutation');
        expect(result.output).toEqual([...(output ?? [item]), item]);
        expect(rawTerminal).toEqual(JSON.parse(terminalWire));
        peer.send(
          JSON.stringify({ type: 'response.completed', stream_id: 'other', response: { id: 'other' } }),
        );
        expect(await other.finalResponse()).toMatchObject({ id: 'other', output: [], output_text: '' });
        expect(connection.socket.readyState).toBe(WebSocket.OPEN);
      });
    },
  );

  test('tracks only current transport errors after reconnect and releases its listener on close', async () => {
    await withSocket(async (connection, peer, server, session) => {
      const oldSocket = connection.socket.platformSocket;
      const reconnected = connection.emitted('reconnected');
      const incoming = once(server, 'connection');
      peer.close(1011);
      await reconnected;
      const [nextPeer] = await incoming;
      const lane = session.lane();
      oldSocket.emit('error', new Error('stale transport failure'));
      const request = once(nextPeer, 'message');
      lane.create({ input: 'after stale error' });
      await request;
      const received = connection.emitted('event');
      nextPeer.send(JSON.stringify({ type: 'response.completed', response: { id: 'queued-terminal' } }));
      await received;
      const waiting = session.lane('waiting');
      const cause = new Error('current transport failure');
      const rejected = expect(waiting.receive()).rejects.toMatchObject({
        message: cause.message,
        cause,
      });
      connection.socket.platformSocket.emit('error', cause);
      await rejected;
      expect(await lane.finalResponse()).toMatchObject({ id: 'queued-terminal' });
      await expect(lane.receive()).rejects.toBeInstanceOf(WebSocketError);
      const listeners = connection.socket.platformSocket.listenerCount('error');
      session.close();
      expect(connection.socket.platformSocket.listenerCount('error')).toBe(listeners - 1);
    });
  });
});
