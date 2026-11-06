import OpenAI from 'openai';
import { afterEach, expect, vi } from 'vitest';
import { onWebSocketEvent, setMockSocketReadyState, websocketVariants } from './helpers/websocket-variants';

afterEach(() => {
  setMockSocketReadyState(1);
  vi.useRealTimers();
});

describe.each(websocketVariants)('$name send compatibility', ({ create }) => {
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

  test('discards an uncertain attempted write and retains never-attempted successors', () => {
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
      expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', [{ type: 'raw', data: 'never attempted' }]);
    } finally {
      connection.close();
    }
  });

  test('a later automatic send follows the pending initial tail and any reentrant sends follow it', () => {
    setMockSocketReadyState(0);
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const errors = vi.fn();
    const close = vi.fn();
    const reconnecting = vi.fn();
    onWebSocketEvent(connection, 'error', errors);
    onWebSocketEvent(connection, 'close', close);
    onWebSocketEvent(connection, 'reconnecting', reconnecting);
    const sent: unknown[] = [];
    vi.mocked(connection.socket.platformSocket.send).mockImplementation((data) => {
      sent.push(data);
      if (data === 'attempted') {
        throw new Error('synthetic uncertain write');
      }
      if (data === '') {
        connection.sendRaw('reentrant-last');
      }
    });
    try {
      connection.sendRaw('attempted');
      connection.sendRaw('');
      Object.defineProperty(connection.socket.platformSocket, 'readyState', { value: 1, writable: true });
      connection.socket.platformSocket.emit('open');
      expect(sent).toEqual(['attempted']);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'could not send queued data' }),
      );
      connection.sendRaw('later');
      expect(sent).toEqual(['attempted', '', 'later', 'reentrant-last']);
      expect(reconnecting).not.toHaveBeenCalled();
      connection.close();
      expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', []);
    } finally {
      connection.close();
    }
  });

  test.each(['return', 'throw'] as const)(
    'full later raw send reports overflow and error observer can %s',
    (onError) => {
      setMockSocketReadyState(0);
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }), {
        maxQueueSize: 3,
      });
      const observerError = new Error('synthetic full-queue observer');
      const reported: unknown[] = [];
      onWebSocketEvent(connection, 'error', (event) => {
        reported.push(event);
        if (onError === 'throw' && reported.length > 1) {
          throw observerError;
        }
      });
      const sent: unknown[] = [];
      const close = vi.fn();
      onWebSocketEvent(connection, 'close', close);
      vi.mocked(connection.socket.platformSocket.send).mockImplementation((data) => {
        sent.push(data);
        if (data === 'A') {
          throw new Error('synthetic uncertain write');
        }
      });
      try {
        connection.sendRaw('A');
        connection.sendRaw('BC');
        Object.defineProperty(connection.socket.platformSocket, 'readyState', { value: 1, writable: true });
        connection.socket.platformSocket.emit('open');
        expect(sent).toEqual(['A']);
        if (onError === 'throw') {
          expect(() => connection.sendRaw('DD')).toThrow(observerError);
          expect(sent).toEqual(['A']);
          connection.close();
          expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', [{ type: 'raw', data: 'BC' }]);
        } else {
          connection.sendRaw('DD');
          expect(sent).toEqual(['A', 'BC']);
          connection.close();
          expect(close).toHaveBeenCalledExactlyOnceWith(1000, 'OK', []);
        }
        expect(reported).toMatchObject([
          { message: 'could not send queued data' },
          { message: 'send queue is full, message discarded' },
        ]);
      } finally {
        connection.close();
      }
    },
  );
});
