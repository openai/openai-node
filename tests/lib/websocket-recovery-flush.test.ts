import { expect, vi } from 'vitest';
import OpenAI from 'openai';
import { onWebSocketEvent, setMockSocketReadyState, websocketVariants } from './helpers/websocket-variants';

afterEach(() => setMockSocketReadyState(1));

describe.each(websocketVariants)('$name automatic recovery flush', ({ create }) => {
  test.each([1, 2])(
    'a failed write consumes a replacement attempt from maxRetries=%i',
    async (maxRetries) => {
      const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
      const attempts: number[] = [];
      const connection = create(client, {
        reconnect: {
          initialDelay: 1,
          maxDelay: 1,
          maxRetries,
          onReconnecting: ({ attempt }) => {
            attempts.push(attempt);
            if (attempt === 1) {
              connection.sendRaw('uncertain-first');
              connection.sendRaw('waiting-second');
            }
          },
        },
      });
      const errors: unknown[] = [];
      const closes: { code: unknown; unsent: unknown }[] = [];
      let reconnected = false;
      onWebSocketEvent(connection, 'error', (event) => errors.push(event));
      onWebSocketEvent(connection, 'reconnected', () => {
        reconnected = true;
      });
      onWebSocketEvent(connection, 'close', (code, _reason, unsent) => closes.push({ code, unsent }));
      const initial = connection.socket;
      initial.platformSocket.close(1012, 'synthetic restart');
      await expect.poll(() => connection.socket).not.toBe(initial);
      const failed = connection.socket;
      const firstWrites: unknown[] = [];
      vi.mocked(failed.platformSocket.send).mockImplementation((data) => {
        firstWrites.push(data);
        connection.sendRaw('accepted-during-write');
        throw new Error('synthetic uncertain write');
      });
      failed.platformSocket.emit('open');
      if (maxRetries === 1) {
        await expect.poll(() => reconnected || closes.length > 0).toBe(true);
        expect(reconnected).toBe(false);
        expect(closes).toEqual([
          {
            code: 1012,
            unsent: [
              { type: 'raw', data: 'waiting-second' },
              { type: 'raw', data: 'accepted-during-write' },
            ],
          },
        ]);
        expect(errors).toMatchObject([
          { message: 'could not send queued data' },
          { message: 'WebSocket reconnect failed after 1 attempts (close code: 1012)' },
        ]);
      } else {
        await expect.poll(() => reconnected || connection.socket !== failed).toBe(true);
        expect(reconnected).toBe(false);
        const recovered = connection.socket;
        expect(recovered).not.toBe(failed);
        expect(failed.readyState).toBe(3);
        recovered.platformSocket.emit('open');
        await expect.poll(() => reconnected).toBe(true);
        expect(vi.mocked(recovered.platformSocket.send).mock.calls.map(([data]) => data)).toEqual([
          'waiting-second',
          'accepted-during-write',
        ]);
        expect(errors).toMatchObject([{ message: 'could not send queued data' }]);
        expect(closes).toEqual([]);
      }
      expect(firstWrites).toEqual(['uncertain-first']);
      expect(attempts).toEqual(maxRetries === 1 ? [1] : [1, 2]);
      connection.close();
    },
  );

  test.each([1000, 1008, 1013])('uses close code %i received during a flush', async (code) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const retryCodes: number[] = [];
    const connection = create(client, {
      reconnect: {
        initialDelay: 1,
        maxDelay: 1,
        maxRetries: 2,
        onReconnecting: ({ closeCode, attempt }) => {
          retryCodes.push(closeCode);
          if (attempt === 1) {
            connection.sendRaw('attempted');
            connection.sendRaw('waiting');
          }
        },
      },
    });
    const closes: { code: unknown; unsent: unknown }[] = [];
    let reconnected = false;
    onWebSocketEvent(connection, 'error', () => {});
    onWebSocketEvent(connection, 'reconnected', () => {
      reconnected = true;
    });
    onWebSocketEvent(connection, 'close', (closedCode, _reason, unsent) =>
      closes.push({ code: closedCode, unsent }),
    );
    const initial = connection.socket;
    initial.platformSocket.close(1012, 'synthetic restart');
    await expect.poll(() => connection.socket).not.toBe(initial);
    const first = connection.socket;
    vi.mocked(first.platformSocket.send).mockImplementation(() => {
      first.platformSocket.close(code, 'synthetic close during send');
    });
    first.platformSocket.emit('open');
    await expect.poll(() => reconnected || closes.length > 0 || connection.socket !== first).toBe(true);
    expect(reconnected).toBe(false);
    if (code === 1013) {
      expect(connection.socket).not.toBe(first);
      connection.socket.platformSocket.emit('open');
      await expect.poll(() => reconnected).toBe(true);
      expect(vi.mocked(connection.socket.platformSocket.send).mock.calls.map(([data]) => data)).toEqual([
        'waiting',
      ]);
      expect(retryCodes).toEqual([1012, 1013]);
    } else {
      expect(retryCodes).toEqual([1012]);
      expect(closes).toEqual([{ code, unsent: [{ type: 'raw', data: 'waiting' }] }]);
    }
    connection.close();
  });

  test.each(['send', 'error'])('honors explicit close from a %s observer during recovery', async (from) => {
    const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.example/v1' });
    const attempts: number[] = [];
    const connection = create(client, {
      reconnect: {
        initialDelay: 1,
        maxDelay: 1,
        maxRetries: 2,
        onReconnecting: ({ attempt }) => {
          attempts.push(attempt);
          connection.sendRaw('attempted');
          connection.sendRaw('waiting');
        },
      },
    });
    const closes: { code: unknown; unsent: unknown }[] = [];
    const errors: unknown[] = [];
    let reconnected = false;
    onWebSocketEvent(connection, 'error', (event) => {
      errors.push(event);
      if (from === 'error') {
        connection.close();
      }
    });
    onWebSocketEvent(connection, 'reconnected', () => {
      reconnected = true;
    });
    onWebSocketEvent(connection, 'close', (code, _reason, unsent) => closes.push({ code, unsent }));
    const initial = connection.socket;
    initial.platformSocket.close(1012, 'synthetic restart');
    await expect.poll(() => connection.socket).not.toBe(initial);
    const failed = connection.socket;
    vi.mocked(failed.platformSocket.send).mockImplementation(() => {
      if (from === 'send') {
        connection.close();
      } else {
        throw new Error('synthetic failed write');
      }
    });
    failed.platformSocket.emit('open');
    await expect.poll(() => reconnected || closes.length > 0).toBe(true);
    expect(reconnected).toBe(false);
    expect(attempts).toEqual([1]);
    expect(closes).toEqual([{ code: 1000, unsent: [{ type: 'raw', data: 'waiting' }] }]);
    expect(errors).toMatchObject(from === 'error' ? [{ message: 'could not send queued data' }] : []);
  });
});
