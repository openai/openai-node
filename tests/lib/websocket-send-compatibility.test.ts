import OpenAI from 'openai';
import { afterEach, expect, vi } from 'vitest';
import { onWebSocketEvent, setMockSocketReadyState, websocketVariants } from './helpers/websocket-variants';

afterEach(() => {
  setMockSocketReadyState(1);
  vi.useRealTimers();
});

describe.each(websocketVariants)('$name send compatibility', ({ name, create }) => {
  test.each(['abort', 'throw'] as const)(
    'keeps the socket close code when a reconnect handler mutates its event then %s',
    (action) => {
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }), {
        reconnect: {
          onReconnecting: (event) => {
            Object.defineProperty(event, 'closeCode', { value: 1000 });
            if (action === 'throw') {
              throw new Error('synthetic callback failure');
            }
            return { abort: true };
          },
        },
      });
      const close = vi.fn();
      onWebSocketEvent(connection, 'close', close);
      onWebSocketEvent(connection, 'error', vi.fn());
      try {
        connection.socket.platformSocket.emit('close', 1006, Buffer.from('synthetic interruption'));
        expect(close).toHaveBeenCalledExactlyOnceWith(
          1006,
          action === 'throw' ? 'onReconnecting callback threw' : 'reconnect aborted by handler',
          [],
        );
      } finally {
        connection.close();
      }
    },
  );

  test('queues a send when reading the public socket starts a reconnect', async () => {
    vi.useFakeTimers();
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }), {
      reconnect: { onReconnecting: () => {}, initialDelay: 10, maxRetries: 1 },
    });
    const { socket } = connection;
    const errors = vi.fn();
    const close = vi.fn();
    onWebSocketEvent(connection, 'error', errors);
    onWebSocketEvent(connection, 'close', close);
    let interrupted = false;
    Object.defineProperty(connection, 'socket', {
      configurable: true,
      get() {
        if (!interrupted) {
          interrupted = true;
          Object.defineProperty(socket.platformSocket, 'readyState', { value: 3, writable: true });
          socket.platformSocket.emit('close', 1006, Buffer.from('synthetic interruption'));
        }
        return socket;
      },
    });
    try {
      connection.sendRaw('queued during reconnect');
      expect(errors).not.toHaveBeenCalled();
      connection.close();
      await vi.runAllTimersAsync();
      expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', [
        { type: 'raw', data: 'queued during reconnect' },
      ]);
    } finally {
      connection.close();
      await vi.runAllTimersAsync();
    }
  });

  test('uses the current public socket after a ready-state accessor replaces it', () => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' });
    const connection = create(client);
    const replacement = create(client);
    const originalSocket = connection.socket;
    Object.defineProperty(originalSocket, 'readyState', {
      configurable: true,
      get() {
        connection.socket = replacement.socket;
        return 1;
      },
    });
    try {
      connection.sendRaw('synthetic message');
      expect(originalSocket.platformSocket.send).not.toHaveBeenCalled();
      expect(replacement.socket.platformSocket.send).toHaveBeenCalledExactlyOnceWith('synthetic message');
    } finally {
      connection.socket = originalSocket;
      connection.close();
      replacement.close();
    }
  });

  test('preserves which queued messages remain unsent after a failed write', () => {
    setMockSocketReadyState(0);
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const error = new Error('synthetic write failure');
    const errors = vi.fn();
    const close = vi.fn();
    onWebSocketEvent(connection, 'error', errors);
    onWebSocketEvent(connection, 'close', close);
    connection.sendRaw('attempted');
    connection.sendRaw('never attempted');
    vi.spyOn(connection.socket.platformSocket, 'send').mockImplementationOnce(() => {
      throw error;
    });
    try {
      Object.defineProperty(connection.socket.platformSocket, 'readyState', { value: 1, writable: true });
      connection.socket.platformSocket.emit('open');
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'could not send queued data', cause: error }),
      );
      connection.close();
      const pending = name.endsWith('Responses') ? ['attempted', 'never attempted'] : ['never attempted'];
      expect(close).toHaveBeenCalledExactlyOnceWith(
        1000,
        'OK',
        pending.map((data) => ({ type: 'raw', data })),
      );
    } finally {
      connection.close();
    }
  });
});
