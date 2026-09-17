import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import type { ResponsesServerEvent } from 'openai/resources/responses/responses';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';

const limits = { maxLanes: 8, maxBufferedEvents: 16, maxBufferedBytes: 4096 };

class CustomResponsesWS extends ResponsesWS {
  emitCustomEvent(event: ResponsesServerEvent): void {
    this._emit('event', event);
  }
}

interface SocketConnection {
  socket: ResponsesWS['socket'];
  close: () => void;
  on: (event: 'error', listener: (error: Error) => void) => void;
  emitted: (event: 'event') => Promise<{ type: string }>;
}

async function withSocket<Connection extends SocketConnection>(
  ConnectionType: new (client: OpenAI) => Connection,
  run: (connection: Connection, peer: WebSocket) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local server address');
  }
  const incoming = once(server, 'connection');
  const connection = new ConnectionType(
    new OpenAI({ apiKey: 'synthetic-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
  );
  connection.on('error', () => {});
  const [peer] = await incoming;
  await once(connection.socket.platformSocket, 'open');
  try {
    await run(connection, peer);
  } finally {
    connection.close();
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
}

async function sendEvent(connection: SocketConnection, peer: WebSocket, event: unknown) {
  const received = connection.emitted('event');
  peer.send(JSON.stringify(event));
  await received;
}

function futureEvent(streamID: string, padding = '') {
  return { type: 'response.future_event', stream_id: streamID, padding };
}

test.each([undefined, 'original'])(
  'keeps custom event routing when Object.prototype.toJSON replaces stream_id %j',
  async (streamID) => {
    await withSocket(CustomResponsesWS, async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const original = session.lane(streamID);
      const redirected = session.lane('redirected');
      const event = {
        type: 'response.audio.transcript.delta' as const,
        delta: 'original',
        sequence_number: 0,
        ...(streamID === undefined ? {} : { stream_id: streamID }),
      };
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
      try {
        try {
          // oxlint-disable-next-line eslint/no-extend-native -- Reproduce inherited envelope replacement and restore it before asynchronous socket work.
          Object.defineProperty(Object.prototype, 'toJSON', {
            configurable: true,
            value: () => futureEvent('redirected', 'replacement'),
          });
          connection.emitCustomEvent(event);
        } finally {
          if (previous) {
            // oxlint-disable-next-line eslint/no-extend-native -- Restore the exact descriptor after the synthetic pollution regression.
            Object.defineProperty(Object.prototype, 'toJSON', previous);
          } else {
            Reflect.deleteProperty(Object.prototype, 'toJSON');
          }
        }
        const closed = once(connection.socket.platformSocket, 'close');
        peer.close();
        await closed;
        expect(await original.receive()).toEqual(event);
        await expect(redirected.receive()).rejects.toThrow('connection closed');
      } finally {
        session.close();
      }
    });
  },
);

test.each([128, 4096])(
  'preserves nested custom event data and its %i byte budget',
  async (maxBufferedBytes) => {
    await withSocket(CustomResponsesWS, async (connection) => {
      const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes });
      const lane = session.lane('nested');
      const other = session.lane('other');
      const event = {
        type: 'response.output_item.done' as const,
        stream_id: 'nested',
        sequence_number: 0,
        output_index: 0,
        item: {
          type: 'function_call' as const,
          id: 'item',
          call_id: 'call',
          name: 'lookup',
          arguments: 'x'.repeat(256),
        },
        payload: { nested: [{ value: 'original' }], timestamp: new Date('2026-01-01T00:00:00Z') },
      };
      const expected = {
        ...structuredClone(event),
        payload: { nested: [{ value: 'original' }], timestamp: '2026-01-01T00:00:00.000Z' },
      };
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
      try {
        try {
          // oxlint-disable-next-line eslint/no-extend-native -- Reproduce nested inherited serialization hooks and restore before assertions.
          Object.defineProperty(Object.prototype, 'toJSON', {
            configurable: true,
            value: () => ({ replaced: true }),
          });
          connection.emitCustomEvent(event);
        } finally {
          if (previous) {
            // oxlint-disable-next-line eslint/no-extend-native -- Restore the exact original descriptor.
            Object.defineProperty(Object.prototype, 'toJSON', previous);
          } else {
            Reflect.deleteProperty(Object.prototype, 'toJSON');
          }
        }
        if (maxBufferedBytes === 128) {
          await expect(lane.receive()).rejects.toThrow('buffer limit exceeded');
        } else {
          expect(await lane.receive()).toEqual(expected);
        }
        expect(event.payload.nested).toEqual([{ value: 'original' }]);
        expect(event.payload.timestamp).toBeInstanceOf(Date);
        expect(Object.getOwnPropertyDescriptor(event.item, 'toJSON')).toBeUndefined();
        // SAFETY: The wire contract permits omitted output fields on a terminal response.
        connection.emitCustomEvent({
          type: 'response.completed',
          stream_id: 'other',
          response: { id: 'other' },
        } as ResponsesServerEvent);
        expect(await other.finalResponse()).toMatchObject({ id: 'other' });
      } finally {
        session.close();
      }
    });
  },
);

test.each([
  { registered: undefined, mutation: 'assign' },
  { registered: undefined, mutation: 'redefine' },
  { registered: 'owned', mutation: 'assign' },
  { registered: 'owned', mutation: 'redefine' },
])('keeps registered routing after streamID $mutation for $registered', async ({ registered, mutation }) => {
  await withSocket(ResponsesWS, async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane(registered);
    const other = session.lane('other');
    try {
      if (mutation === 'assign') {
        Object.assign(lane, { streamID: 'other' });
      } else {
        Object.defineProperty(lane, 'streamID', { get: () => 'other' });
      }
      const request = once(peer, 'message');
      lane.create({ input: 'hello' });
      const [wire] = await request;
      expect(JSON.parse(String(wire))).toEqual({
        type: 'response.create',
        input: 'hello',
        ...(registered === undefined ? {} : { stream_id: registered }),
      });
      await sendEvent(connection, peer, {
        type: 'response.completed',
        stream_id: registered,
        response: { id: 'owned', status: 'completed' },
      });
      expect(await lane.finalResponse()).toMatchObject({ id: 'owned' });
      await sendEvent(connection, peer, {
        type: 'response.completed',
        stream_id: 'other',
        response: { id: 'other', status: 'completed' },
      });
      expect(await other.finalResponse()).toMatchObject({ id: 'other' });
    } finally {
      session.close();
    }
  });
});

test.each([
  { reason: new Error('cancel collection'), replaceOptions: false },
  { reason: 'cancel collection', replaceOptions: false },
  { reason: new Error('cancel after options reuse'), replaceOptions: true },
])(
  'fails a partially consumed final response after cancellation with $reason, options reused: $replaceOptions',
  async ({ reason, replaceOptions }) => {
    await withSocket(ResponsesWS, async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane('partial');
      const other = session.lane('other');
      const abort = new AbortController();
      const options: Parameters<typeof lane.finalResponse>[0] = { signal: abort.signal };
      const pending = lane.finalResponse(options);
      const rejected = expect(pending).rejects.toBe(reason);
      try {
        await sendEvent(connection, peer, {
          type: 'response.output_item.done',
          stream_id: 'partial',
          output_index: 0,
          item: {
            type: 'function_call',
            id: 'call_1',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '{}',
            status: 'completed',
          },
        });
        await setImmediate();
        if (replaceOptions) {
          delete options.signal;
        }
        abort.abort(reason);
        await rejected;
        await sendEvent(connection, peer, {
          type: 'response.completed',
          stream_id: 'partial',
          response: { id: 'partial', status: 'completed' },
        });
        await expect(lane.finalResponse()).rejects.toThrow('canceled after consuming events');
        expect(() => lane.create({ input: 'next' })).toThrow('canceled after consuming events');
        await sendEvent(connection, peer, {
          type: 'response.completed',
          stream_id: 'other',
          response: { id: 'other', status: 'completed' },
        });
        expect(await other.finalResponse()).toMatchObject({ id: 'other' });
      } finally {
        session.close();
      }
    });
  },
);

test.each([undefined, 'original'])(
  'snapshots beta socket routing before an observer replaces stream_id %j',
  async (streamID) => {
    await withSocket(BetaResponsesWS, async (connection, peer) => {
      connection.on('event', (event) => Object.assign(event, { stream_id: 'redirected' }));
      // SAFETY: JavaScript accepts beta sockets; generated beta request types differ from stable TypeScript types.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This regression deliberately calls the JavaScript API with the beta socket whose generated request types differ.
      const session = new ResponsesWebSocketSession(connection as unknown as ResponsesWS, limits);
      const original = session.lane(streamID);
      const redirected = session.lane('redirected');
      await sendEvent(connection, peer, {
        type: 'response.completed',
        stream_id: streamID,
        response: { id: 'original', status: 'completed' },
      });
      const closed = once(connection.socket.platformSocket, 'close');
      peer.close();
      await closed;
      expect(await original.finalResponse()).toMatchObject({ id: 'original' });
      await expect(redirected.receive()).rejects.toThrow('connection closed');
    });
  },
);

test('counts beta wire bytes before an observer shrinks the event', async () => {
  await withSocket(BetaResponsesWS, async (connection, peer) => {
    connection.on('event', (event) => Object.assign(event, { padding: '' }));
    // SAFETY: Exercise the beta socket accepted at the public JavaScript boundary.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The runtime accepts beta sockets even though their generated request types differ from stable.
    const session = new ResponsesWebSocketSession(connection as unknown as ResponsesWS, {
      ...limits,
      maxBufferedBytes: 256,
    });
    const lane = session.lane();
    try {
      await sendEvent(connection, peer, { type: 'response.future_event', padding: 'x'.repeat(512) });
      await expect(lane.receive()).rejects.toThrow('buffer limit exceeded');
    } finally {
      session.close();
    }
  });
});

test('remeasures a retained native event enlarged and re-emitted after dispatch', async () => {
  await withSocket(CustomResponsesWS, async (connection, peer) => {
    const retained = connection.emitted('event');
    peer.send(JSON.stringify({ type: 'response.future_event', padding: '' }));
    const event = await retained;
    Object.assign(event, { padding: 'x'.repeat(512) });
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 256 });
    const lane = session.lane();
    try {
      connection.emitCustomEvent(event);
      await expect(lane.receive()).rejects.toThrow('buffer limit exceeded');
    } finally {
      session.close();
    }
  });
});

test.each(['events', 'bytes'] as const)(
  'releases the largest existing %s backlog without failing an active lane',
  async (budget) => {
    await withSocket(ResponsesWS, async (connection, peer) => {
      const slowEvent = futureEvent('slow', 'x'.repeat(100));
      const activeEvent = futureEvent('live', 'active');
      const session = new ResponsesWebSocketSession(connection, {
        ...limits,
        ...(budget === 'events'
          ? { maxBufferedEvents: 2 }
          : { maxBufferedBytes: Buffer.byteLength(JSON.stringify(slowEvent)) * 2 }),
      });
      const slow = session.lane('slow');
      const active = session.lane('live');
      try {
        await sendEvent(connection, peer, slowEvent);
        await sendEvent(connection, peer, slowEvent);
        await sendEvent(connection, peer, activeEvent);
        expect(await active.receive()).toEqual(activeEvent);
        await expect(slow.receive()).rejects.toThrow('helper buffer limit exceeded');
        expect(() => session.lane('slow')).toThrow('already registered');
        await sendEvent(connection, peer, activeEvent);
        expect(await active.receive()).toEqual(activeEvent);
      } finally {
        session.close();
      }
    });
  },
);

test('releases multiple byte backlogs when one does not free enough capacity', async () => {
  await withSocket(ResponsesWS, async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 600 });
    const first = session.lane('first');
    const second = session.lane('other');
    const active = session.lane('live');
    const small = { type: 'response.future_event', padding: 'x'.repeat(170) };
    const large = { type: 'response.future_event', stream_id: 'live', padding: 'x'.repeat(410) };
    try {
      await sendEvent(connection, peer, { ...small, stream_id: 'first' });
      await sendEvent(connection, peer, { ...small, stream_id: 'other' });
      await sendEvent(connection, peer, large);
      expect(await active.receive()).toEqual(large);
      await expect(first.receive()).rejects.toThrow('helper buffer limit exceeded');
      await expect(second.receive()).rejects.toThrow('helper buffer limit exceeded');
    } finally {
      session.close();
    }
  });
});

test('breaks equal backlog ties by lane registration order', async () => {
  await withSocket(ResponsesWS, async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedEvents: 2 });
    const active = session.lane('live');
    const first = session.lane('first');
    const second = session.lane('second');
    try {
      await sendEvent(connection, peer, futureEvent('second'));
      await sendEvent(connection, peer, futureEvent('first'));
      await sendEvent(connection, peer, futureEvent('live'));
      expect(await active.receive()).toEqual(futureEvent('live'));
      await expect(first.receive()).rejects.toThrow('helper buffer limit exceeded');
      expect(await second.receive()).toEqual(futureEvent('second'));
    } finally {
      session.close();
    }
  });
});

test.each(['events', 'bytes'] as const)(
  'selects the largest backlog by the exhausted %s budget',
  async (budget) => {
    await withSocket(ResponsesWS, async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, {
        ...limits,
        maxBufferedEvents: 3,
        maxBufferedBytes: budget === 'bytes' ? 650 : limits.maxBufferedBytes,
      });
      const many = session.lane('many');
      const large = session.lane('large');
      const active = session.lane('live');
      const smallEvent = { type: 'response.future_event', stream_id: 'many' };
      const largeEvent = { type: 'response.future_event', stream_id: 'large', padding: 'x'.repeat(400) };
      const activeEvent = { type: 'response.future_event', stream_id: 'live', padding: 'x'.repeat(100) };
      try {
        await sendEvent(connection, peer, smallEvent);
        await sendEvent(connection, peer, smallEvent);
        await sendEvent(connection, peer, largeEvent);
        await sendEvent(connection, peer, activeEvent);
        expect(await active.receive()).toEqual(activeEvent);
        if (budget === 'bytes') {
          await expect(large.receive()).rejects.toThrow('helper buffer limit exceeded');
          expect(await many.receive()).toEqual(smallEvent);
          expect(await many.receive()).toEqual(smallEvent);
        } else {
          await expect(many.receive()).rejects.toThrow('helper buffer limit exceeded');
          expect(await large.receive()).toEqual(largeEvent);
        }
      } finally {
        session.close();
      }
    });
  },
);

test.each(['session', 'lane'] as const)(
  'keeps other backlogs when an incoming event exceeds its own %s cap',
  async (budget) => {
    await withSocket(ResponsesWS, async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 500 });
      const retained = session.lane('retained');
      const rejected = session.lane('rejected', budget === 'lane' ? { maxBufferedBytes: 100 } : {});
      const retainedEvent = {
        type: 'response.future_event',
        stream_id: 'retained',
        padding: 'x'.repeat(200),
      };
      try {
        await sendEvent(connection, peer, retainedEvent);
        await sendEvent(connection, peer, {
          type: 'response.future_event',
          stream_id: 'rejected',
          padding: 'x'.repeat(budget === 'lane' ? 200 : 500),
        });
        await expect(rejected.receive()).rejects.toThrow('buffer limit exceeded');
        expect(await retained.receive()).toEqual(retainedEvent);
      } finally {
        session.close();
      }
    });
  },
);
