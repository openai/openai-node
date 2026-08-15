import { expectTypeOf, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
import { ReadyState } from 'openai/internal/ws-adapter';
import type { WebSocketLike } from 'openai/internal/ws-adapter';
import { ResponsesWSBase as StableResponsesWSBase } from 'openai/resources/responses/ws-base';
import type { ResponsesWSBaseOptions } from 'openai/resources/responses/ws-base';
import { ResponsesWSBase as BetaResponsesWSBase } from 'openai/resources/beta/responses/ws-base';
import type { ResponsesWSBaseOptions as BetaResponsesWSBaseOptions } from 'openai/resources/beta/responses/ws-base';
import { WebSocketError as StableWebSocketError } from 'openai/resources/responses/internal-base';
import { WebSocketError as BetaWebSocketError } from 'openai/resources/beta/responses/internal-base';
import type { ResponsesServerEvent as StableResponsesServerEvent } from 'openai/resources/responses/responses';
import type { BetaResponsesServerEvent } from 'openai/resources/beta/responses/responses';

class FakeResponseSocket extends EventEmitter implements WebSocketLike {
  readyState: number = ReadyState.CONNECTING;
  readonly send = vi.fn();
  readonly close = vi.fn((code = 1000, reason = 'OK') => {
    this.readyState = ReadyState.CLOSED;
    this.emit('close', code, reason);
  });

  open() {
    this.readyState = ReadyState.OPEN;
    this.emit('open');
  }
}

const variants = [
  ['stable', StableResponsesWSBase, StableWebSocketError],
  ['beta', BetaResponsesWSBase, BetaWebSocketError],
] as const;

const websocketAPIErrorCases = [
  [
    'nested protocol',
    {
      type: 'error',
      error: {
        code: 'invalid_request',
        message: 'nested request failed',
        param: null,
        type: 'invalid_request_error',
      },
      status: 400,
      stream_id: 'stream_nested',
    } satisfies StableResponsesServerEvent.ResponseWsError & BetaResponsesServerEvent.BetaResponseWsError,
    'nested request failed',
  ],
  [
    'flat streaming',
    {
      type: 'error',
      code: 'invalid_request',
      message: 'flat stream failed',
      param: null,
      sequence_number: 7,
      stream_id: 'stream_flat',
    } satisfies StableResponsesServerEvent.ResponseWsStreamingError &
      BetaResponsesServerEvent.BetaResponseWsStreamingError,
    'flat stream failed',
  ],
] as const;

test('public WebSocket error types preserve flat and nested server events', () => {
  type StableErrorEvent = Extract<StableResponsesServerEvent, { type: 'error' }>;
  type BetaErrorEvent = Extract<BetaResponsesServerEvent, { type: 'error' }>;

  expectTypeOf<StableErrorEvent>().toEqualTypeOf<
    StableResponsesServerEvent.ResponseWsError | StableResponsesServerEvent.ResponseWsStreamingError
  >();
  expectTypeOf<BetaErrorEvent>().toEqualTypeOf<
    BetaResponsesServerEvent.BetaResponseWsError | BetaResponsesServerEvent.BetaResponseWsStreamingError
  >();
  expectTypeOf<StableWebSocketError['error']>().toEqualTypeOf<StableErrorEvent | undefined>();
  expectTypeOf<BetaWebSocketError['error']>().toEqualTypeOf<BetaErrorEvent | undefined>();
});

describe.each(variants)('%s Responses WebSocket', (_version, Base, WebSocketError) => {
  const BaseClass = Base as typeof StableResponsesWSBase;

  class TestResponsesWebSocket extends BaseClass<FakeResponseSocket> {
    readonly connections: FakeResponseSocket[] = [];
    readonly connectionHeaders: Record<string, string>[] = [];

    constructor(client: OpenAI, options?: ResponsesWSBaseOptions | BetaResponsesWSBaseOptions | undefined) {
      super(client, options);
      this._connectInitial();
    }

    protected _createSocket(_url: URL, headers: Record<string, string>): FakeResponseSocket {
      const socket = new FakeResponseSocket();
      this.connections.push(socket);
      this.connectionHeaders.push(headers);
      return socket;
    }
  }

  function createWebSocket(options?: ResponsesWSBaseOptions) {
    const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' });
    return new TestResponsesWebSocket(client, options);
  }

  async function waitForConnection(websocket: TestResponsesWebSocket, count: number) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (websocket.connections.length >= count) {
        return websocket.connections[count - 1]!;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Expected ${count} WebSocket connections`);
  }

  test('builds the authenticated WebSocket endpoint', () => {
    const websocket = createWebSocket();

    expect(websocket.url.toString()).toBe('wss://example.com/v1/responses');
    expect(websocket.connectionHeaders).toEqual([{ Authorization: 'Bearer test-key' }]);
  });

  test('rejects operations before its socket has been initialized', () => {
    const websocket = createWebSocket();
    (websocket as any).socket = undefined;

    expect(() => websocket.send({ type: 'response.create' } as any)).toThrow('failed to initialize socket');
    expect(() => websocket.sendRaw('message')).toThrow('failed to initialize socket');
    expect(() => websocket.close()).toThrow('failed to initialize socket');
    expect(() => websocket.stream()).toThrow('failed to initialize socket');
  });

  test('sends JSON and raw messages immediately once connected', () => {
    const websocket = createWebSocket();
    const socket = websocket.socket;
    socket.open();

    websocket.send({ type: 'response.create' } as any);
    websocket.sendRaw([new Uint8Array([1]), new Uint8Array([2])]);

    expect(socket.send).toHaveBeenNthCalledWith(1, '{"type":"response.create"}');
    expect(socket.send).toHaveBeenNthCalledWith(2, new Uint8Array([1, 2]));
  });

  test('queues JSON and raw messages while the connection opens', () => {
    const websocket = createWebSocket();

    websocket.send({ type: 'response.create' } as any);
    websocket.sendRaw('raw-message');
    expect(websocket.socket.send).not.toHaveBeenCalled();

    websocket.socket.open();

    expect(websocket.socket.send).toHaveBeenNthCalledWith(1, '{"type":"response.create"}');
    expect(websocket.socket.send).toHaveBeenNthCalledWith(2, 'raw-message');
  });

  test('reports queue overflows and disconnected sends to registered error listeners', () => {
    const websocket = createWebSocket({ maxQueueSize: 1 });
    const listener = vi.fn();
    websocket.on('error', listener);

    websocket.send({ type: 'first' } as any);
    websocket.send({ type: 'second' } as any);
    websocket.sendRaw('third');
    websocket.socket.readyState = ReadyState.CLOSED;
    websocket.send({ type: 'closed' } as any);
    websocket.sendRaw('closed');

    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener.mock.calls.map(([error]) => error.message)).toEqual([
      'send queue is full, message discarded',
      'send queue is full, message discarded',
      'cannot send on a closed WebSocket',
      'cannot send on a closed WebSocket',
    ]);
    expect(listener.mock.calls[0]![0]).toBeInstanceOf(WebSocketError);
  });

  test('reports socket failures while sending, flushing, and closing', () => {
    const websocket = createWebSocket();
    const listener = vi.fn();
    websocket.on('error', listener);
    websocket.socket.open();
    websocket.socket.send.mockImplementation(() => {
      throw new Error('send failed');
    });

    websocket.send({ type: 'response.create' } as any);
    websocket.sendRaw('raw-message');

    websocket.socket.close.mockImplementationOnce(() => {
      throw new Error('close failed');
    });
    websocket.close({ code: 1001, reason: 'going away' });

    expect(listener.mock.calls.map(([error]) => error.message)).toEqual([
      'could not send data',
      'could not send data',
      'could not close the connection',
    ]);
    expect(listener.mock.calls[0]![0].cause.message).toBe('send failed');
  });

  test('dispatches JSON, typed events, binary data, invalid JSON, and API errors', () => {
    const websocket = createWebSocket();
    const events = vi.fn();
    const typed = vi.fn();
    const raw = vi.fn();
    const errors = vi.fn();
    websocket.on('event', events);
    websocket.on('response.created', typed as any);
    websocket.on('raw', raw);
    websocket.on('error', errors);
    const event = { type: 'response.created', response: { id: 'resp_123' } };
    const apiError = { type: 'error', error: { message: 'request failed' } };

    websocket.socket.emit('message', JSON.stringify(event), false);
    websocket.socket.emit('message', 'not json', false);
    websocket.socket.emit('message', Uint8Array.from([1, 2]), true);
    websocket.socket.emit('message', JSON.stringify(apiError), false);
    websocket.socket.emit('error', new Error('socket failed'));

    expect(events).toHaveBeenNthCalledWith(1, event);
    expect(events).toHaveBeenNthCalledWith(2, apiError);
    expect(typed).toHaveBeenCalledWith(event);
    expect(raw).toHaveBeenNthCalledWith(1, 'not json');
    expect(raw).toHaveBeenNthCalledWith(2, Uint8Array.from([1, 2]));
    expect(errors.mock.calls.map(([error]) => error.message)).toEqual(['request failed', 'socket failed']);
  });

  test.each(websocketAPIErrorCases)('dispatches %s API errors', (_shape, apiError, expectedMessage) => {
    const websocket = createWebSocket();
    const events = vi.fn();
    const errors = vi.fn();
    websocket.on('event', events);
    websocket.on('error', errors);

    websocket.socket.emit('message', JSON.stringify(apiError), false);

    expect(events).toHaveBeenCalledWith(apiError);
    expect(errors).toHaveBeenCalledTimes(1);
    const [error] = errors.mock.calls[0]!;
    expect(error).toBeInstanceOf(WebSocketError);
    expect(error.message).toBe(expectedMessage);
    expect(error.error).toEqual(apiError);
    expect(error.error.stream_id).toBe(apiError.stream_id);
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'dispatches Object.prototype event type %s without crashing',
    (eventType) => {
      const websocket = createWebSocket();
      const events = vi.fn();
      const event = { type: eventType };
      websocket.on('event', events);

      expect(() => websocket.socket.emit('message', JSON.stringify(event), false)).not.toThrow();
      expect(events).toHaveBeenCalledWith(event);
    },
  );

  test.each([
    [ReadyState.CONNECTING, 'connecting'],
    [ReadyState.OPEN, 'open'],
    [ReadyState.CLOSING, 'closing'],
  ] as const)('starts async iteration with the current socket lifecycle state', async (state, expected) => {
    const websocket = createWebSocket();
    websocket.socket.readyState = state;
    const iterator = websocket.stream();

    await expect(iterator.next()).resolves.toEqual({ value: { type: expected }, done: false });
    await expect(iterator.return?.()).resolves.toEqual({ value: undefined, done: true });
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
  });

  test('immediately finishes iteration when the underlying socket is already closed', async () => {
    const websocket = createWebSocket();
    websocket.socket.readyState = ReadyState.CLOSED;
    const iterator = websocket.stream();

    await expect(iterator.next()).resolves.toEqual({
      value: { type: 'close', code: 1006, reason: '', unsent: [] },
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('streams messages, raw frames, errors, opens, and permanent close events', async () => {
    const websocket = createWebSocket();
    const iterator = websocket.stream();
    await iterator.next();

    const message = { type: 'response.created', response: { id: 'resp_123' } };
    websocket.socket.emit('message', JSON.stringify(message), false);
    websocket.socket.emit('message', 'raw-frame', false);
    websocket.socket.emit('error', new Error('network error'));
    websocket.socket.open();
    websocket.socket.close(1000, 'complete');

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'message', message } });
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'raw', data: 'raw-frame' } });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'error', error: expect.objectContaining({ message: 'network error' }) },
    });
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'open' } });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'close', code: 1000, reason: 'complete', unsent: [] },
    });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('finishes pending iterator reads when consumers return early', async () => {
    const websocket = createWebSocket();
    websocket.socket.open();
    const iterator = websocket.stream();
    await iterator.next();
    const pending = iterator.next();

    await iterator.return?.();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  test('intentionally closes sockets using default or explicit close information', () => {
    const defaultClose = createWebSocket();
    const customClose = createWebSocket();
    const listener = vi.fn();
    customClose.on('close', listener);

    defaultClose.close();
    customClose.close({ code: 1001, reason: 'going away' });

    expect(defaultClose.socket.close).toHaveBeenCalledWith(1000, 'OK');
    expect(customClose.socket.close).toHaveBeenCalledWith(1001, 'going away');
    expect(listener).toHaveBeenCalledWith(1001, 'going away', []);
  });

  test('reconnects after recoverable closes and flushes queued messages', async () => {
    const reconnect = vi.fn(() => ({ parameters: { starting_after: 'event_123' } }));
    const websocket = createWebSocket({
      reconnect: { onReconnecting: reconnect, maxRetries: 1, initialDelay: 0, maxDelay: 0 },
    });
    const reconnected = vi.fn();
    websocket.on('error', vi.fn());
    websocket.on('reconnected', reconnected);
    const original = websocket.socket;

    original.readyState = ReadyState.CLOSED;
    original.emit('close', 1006, 'network interrupted');
    websocket.send({ type: 'queued-during-reconnect' } as any);

    const replacement = await waitForConnection(websocket, 2);
    replacement.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 1, closeCode: 1006 }),
    );
    expect(websocket.url.toString()).toBe('wss://example.com/v1/responses?starting_after=event_123');
    expect(replacement.send).toHaveBeenCalledWith('{"type":"queued-during-reconnect"}');
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  test('emits a permanent close when a reconnect callback aborts', async () => {
    const websocket = createWebSocket({
      reconnect: {
        onReconnecting: () => ({ abort: true }),
        maxRetries: 1,
        initialDelay: 0,
      },
    });
    const closed = vi.fn();
    websocket.on('close', closed);

    websocket.socket.readyState = ReadyState.CLOSED;
    websocket.socket.emit('close', 1006, 'network interrupted');
    await Promise.resolve();

    expect(closed).toHaveBeenCalledWith(1006, 'reconnect aborted by handler', []);
    expect(websocket.connections).toHaveLength(1);
  });

  test('surfaces exceptions raised by reconnect handlers', async () => {
    const websocket = createWebSocket({
      reconnect: {
        onReconnecting: () => {
          throw new Error('handler failed');
        },
        maxRetries: 1,
      },
    });
    const errors = vi.fn();
    const closed = vi.fn();
    websocket.on('error', errors);
    websocket.on('close', closed);

    websocket.socket.readyState = ReadyState.CLOSED;
    websocket.socket.emit('close', 1006, 'network interrupted');
    await Promise.resolve();

    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'onReconnecting callback threw', cause: expect.any(Error) }),
    );
    expect(closed).toHaveBeenCalledWith(1006, 'onReconnecting callback threw', []);
  });

  test.each([1000, 1002, 1008])('does not reconnect after non-recoverable close %i', (code) => {
    const reconnect = vi.fn();
    const websocket = createWebSocket({ reconnect: { onReconnecting: reconnect } });
    const closed = vi.fn();
    websocket.on('close', closed);

    websocket.socket.readyState = ReadyState.CLOSED;
    websocket.socket.emit('close', code, 'terminal close');

    expect(reconnect).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(code, 'terminal close', []);
  });
});
