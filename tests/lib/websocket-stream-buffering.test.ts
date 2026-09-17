import OpenAI, { OpenAIError } from 'openai';
import { vi } from 'vitest';
import { measureElementMovement } from './helpers/measure-element-movement';
import {
  dispatchFrame,
  onWebSocketEvent,
  setMockSocketReadyState,
  websocketVariants,
} from './helpers/websocket-variants';

const BACKLOG_SIZE = 4096;

describe.each(websocketVariants)('$name public stream buffering', ({ create, event }) => {
  test('preserves FIFO and raw identity at the snapshotted limit, regardless of payload size', async () => {
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const options = { maxBufferedEvents: 2 };
    const stream = connection.stream(options);
    const raw = vi.fn();
    onWebSocketEvent(connection, 'raw', raw);
    try {
      await stream.next();
      options.maxBufferedEvents = 1;
      dispatchFrame(connection, Buffer.alloc(1024 * 1024), true);
      dispatchFrame(connection, JSON.stringify(event(0)));
      const first = await stream.next();
      expect(first.done).toBe(false);
      expect(raw).toHaveBeenCalledTimes(1);
      expect(first.value?.type === 'raw' && first.value.data).toBe(raw.mock.calls[0]?.[0]);
      await expect(stream.next()).resolves.toEqual({
        value: { type: 'message', message: event(0) },
        done: false,
      });
      // Consumed array slots must not count toward the next batch's capacity.
      const events = Array.from({ length: 80 }, (_, index) => event(index + 1));
      const deliveries = events.map((message) => {
        dispatchFrame(connection, JSON.stringify(message));
        return stream.next();
      });
      expect(await Promise.all(deliveries)).toEqual(
        events.map((message) => ({ value: { type: 'message', message }, done: false })),
      );
    } finally {
      await stream.return?.();
      connection.close();
    }
  });

  test('an opt-in event limit terminates only the overflowing iterator', async () => {
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const limited = connection.stream({ maxBufferedEvents: 1 });
    const unlimited = connection.stream({ maxBufferedEvents: undefined });
    const off = vi.spyOn(connection, 'off');
    try {
      await limited.next();
      await unlimited.next();
      dispatchFrame(connection, JSON.stringify(event(0)));
      dispatchFrame(connection, Buffer.from('synthetic binary data'), true);

      await expect(limited.next()).rejects.toThrow('maxBufferedEvents (1)');
      await expect(limited.next()).rejects.toThrow('maxBufferedEvents (1)');
      expect(off.mock.calls.map(([name]) => name)).toEqual(['event', 'raw', 'error']);
      expect(connection.socket.readyState).toBe(1);
      await expect(unlimited.next()).resolves.toEqual({
        value: { type: 'message', message: event(0) },
        done: false,
      });
      await expect(unlimited.next()).resolves.toEqual({
        value: { type: 'raw', data: Buffer.from('synthetic binary data') },
        done: false,
      });
      dispatchFrame(connection, JSON.stringify(event(1)));
      await expect(unlimited.next()).resolves.toEqual({
        value: { type: 'message', message: event(1) },
        done: false,
      });
      await expect(limited.return?.()).resolves.toEqual({ value: undefined, done: true });
      await expect(limited.return?.()).resolves.toEqual({ value: undefined, done: true });
    } finally {
      await limited.return?.();
      await unlimited.return?.();
      connection.close();
    }
  });

  test.each([0, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '1', true])(
    'rejects invalid maxBufferedEvents %s before attaching listeners',
    (maxBufferedEvents) => {
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
      const on = vi.spyOn(connection, 'on');
      try {
        expect(() => {
          // @ts-expect-error Exercise invalid JavaScript options rejected by the runtime boundary.
          connection.stream({ maxBufferedEvents });
        }).toThrow('positive safe integer');
        expect(on).not.toHaveBeenCalled();
      } finally {
        connection.close();
      }
    },
  );

  test.each(['initial state', 'close', 'error'] as const)(
    'counts %s records toward the limit',
    async (kind) => {
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
      const stream = connection.stream({ maxBufferedEvents: 1 });
      try {
        if (kind !== 'initial state') {
          await stream.next();
        }
        dispatchFrame(connection, JSON.stringify(event(0)));
        if (kind === 'close') {
          connection.close();
        }
        if (kind === 'error') {
          connection.socket.platformSocket.emit('error', new Error('synthetic error'));
        }
        await expect(stream.next()).rejects.toMatchObject({
          message: 'WebSocket stream exceeded maxBufferedEvents (1)',
          error: undefined,
        });
        await expect(stream.next()).rejects.toBeInstanceOf(OpenAIError);
      } finally {
        await stream.return?.();
        connection.close();
      }
    },
  );

  test.each(['close', 'return'] as const)('settles waiting readers at capacity one on %s', async (finish) => {
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const stream = connection.stream({ maxBufferedEvents: 1 });
    try {
      await stream.next();
      const pending = Array.from({ length: 4 }, () => stream.next());
      dispatchFrame(connection, JSON.stringify(event(0)));
      if (finish === 'close') {
        connection.close();
      } else {
        await stream.return?.();
      }
      const results = await Promise.all(pending);
      expect(results[0]).toEqual({ value: { type: 'message', message: event(0) }, done: false });
      if (finish === 'close') {
        expect(results[1]).toEqual({
          value: { type: 'close', code: 1000, reason: 'OK', unsent: [] },
          done: false,
        });
      }
      expect(results.slice(finish === 'close' ? 2 : 1)).toEqual(
        Array.from({ length: finish === 'close' ? 2 : 3 }, () => ({ value: undefined, done: true })),
      );
    } finally {
      await stream.return?.();
      connection.close();
    }
  });

  test.each([false, true])(
    'retains limits and detaches across reconnects (failed attempt: %s)',
    async (failFirst) => {
      vi.useFakeTimers();
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }), {
        reconnect: { onReconnecting() {}, maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });
      const original = connection.socket.platformSocket;
      const existing = connection.stream({ maxBufferedEvents: 1 });
      const retained = connection.stream({ maxBufferedEvents: 4 });
      let duringReconnect: ReturnType<typeof connection.stream> | undefined;
      try {
        await existing.next();
        await retained.next();
        setMockSocketReadyState(0);
        connection.socket.platformSocket.emit('close', 1006, Buffer.from('synthetic reconnect'));
        await vi.runAllTimersAsync();
        if (failFirst) {
          connection.socket.platformSocket.emit('close', 1006, Buffer.from('synthetic failed attempt'));
          await vi.runAllTimersAsync();
        }
        const replacement = connection.socket.platformSocket;
        duringReconnect = connection.stream({ maxBufferedEvents: 2 });
        await expect(duringReconnect.next()).resolves.toMatchObject({ value: { type: 'reconnecting' } });
        Reflect.set(replacement, 'readyState', 1);
        replacement.emit('open');
        await vi.runAllTimersAsync();
        // Existing iterator has unread reconnecting + reconnected records.
        await expect(existing.next()).rejects.toThrow('maxBufferedEvents (1)');
        await expect(duringReconnect.next()).resolves.toEqual({ value: { type: 'open' }, done: false });
        await expect(duringReconnect.next()).resolves.toEqual({
          value: { type: 'reconnected' },
          done: false,
        });
        dispatchFrame(connection, JSON.stringify(event(0)));
        dispatchFrame(connection, JSON.stringify(event(1)));
        dispatchFrame(connection, JSON.stringify(event(2)));
        await expect(duringReconnect.next()).rejects.toThrow('maxBufferedEvents (2)');
        await expect(retained.next()).rejects.toThrow('maxBufferedEvents (4)');
        expect(original.listenerCount('open')).toBe(1);
        // Only the connection's own send-queue listener remains after both iterators detach.
        expect(replacement.listenerCount('open')).toBe(1);
        expect(connection.socket.readyState).toBe(1);
      } finally {
        await existing.return?.();
        await retained.return?.();
        await duringReconnect?.return?.();
        connection.close();
        setMockSocketReadyState(1);
        vi.useRealTimers();
      }
    },
  );

  test.each(['open', 'closed'] as const)(
    'return discards queued data while the socket is %s',
    async (state) => {
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
      const stream = connection.stream();
      try {
        await stream.next();
        dispatchFrame(connection, JSON.stringify(event(0)));
        dispatchFrame(connection, JSON.stringify(event(1)));
        dispatchFrame(connection, Buffer.from('synthetic binary data'), true);
        await expect(stream.next()).resolves.toEqual({
          value: { type: 'message', message: event(0) },
          done: false,
        });
        if (state === 'closed') {
          connection.close();
        }

        await expect(stream.return?.()).resolves.toEqual({ value: undefined, done: true });
        await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
        await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
      } finally {
        await stream.return?.();
        connection.close();
      }
    },
  );

  test('return leaves other iterators attached and their backlogs intact', async () => {
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const cancelled = connection.stream();
    const active = connection.stream();
    try {
      await cancelled.next();
      await active.next();
      dispatchFrame(connection, JSON.stringify(event(0)));
      await cancelled.return?.();
      await expect(active.next()).resolves.toEqual({
        value: { type: 'message', message: event(0) },
        done: false,
      });

      dispatchFrame(connection, JSON.stringify(event(1)));
      await expect(active.next()).resolves.toEqual({
        value: { type: 'message', message: event(1) },
        done: false,
      });
      await expect(cancelled.next()).resolves.toEqual({ value: undefined, done: true });
    } finally {
      await cancelled.return?.();
      await active.return?.();
      connection.close();
    }
  });

  test('delivers a large interleaved backlog in FIFO order with linear element movement', async () => {
    const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
    const stream = connection.stream();
    const events = Array.from({ length: BACKLOG_SIZE * 2 }, (_, index) => event(index));
    const frames = events.map((payload) => JSON.stringify(payload));
    try {
      await expect(stream.next()).resolves.toEqual({ value: { type: 'open' }, done: false });

      const { result: pending, elementMoves } = measureElementMovement(() => {
        for (const frame of frames.slice(0, BACKLOG_SIZE)) {
          dispatchFrame(connection, frame);
        }
        // Drain beyond a compaction boundary, then append to the remaining backlog.
        const deliveries = Array.from({ length: BACKLOG_SIZE / 2 + 3 }, () => stream.next());
        for (const frame of frames.slice(BACKLOG_SIZE)) {
          dispatchFrame(connection, frame);
        }
        while (deliveries.length < events.length) {
          deliveries.push(stream.next());
        }
        connection.close();
        deliveries.push(stream.next(), stream.next());
        return deliveries;
      });

      expect(await Promise.all(pending)).toEqual([
        ...events.map((message) => ({ value: { type: 'message', message }, done: false })),
        { value: { type: 'close', code: 1000, reason: 'OK', unsent: [] }, done: false },
        { value: undefined, done: true },
      ]);
      expect(elementMoves).toBeLessThanOrEqual(events.length * 8);
    } finally {
      await stream.return?.();
      connection.close();
    }
  });

  test.each(['close', 'return'] as const)(
    'settles thousands of pending next calls in FIFO order on %s with linear element movement',
    async (finish) => {
      const connection = create(new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.test/v1' }));
      const stream = connection.stream();
      const events = Array.from({ length: BACKLOG_SIZE / 2 + 3 }, (_, index) => event(index));
      const frames = events.map((payload) => JSON.stringify(payload));
      try {
        await expect(stream.next()).resolves.toEqual({ value: { type: 'open' }, done: false });
        const pending = Array.from({ length: BACKLOG_SIZE }, () => stream.next());
        const { result: termination, elementMoves } = measureElementMovement(() => {
          for (const frame of frames) {
            dispatchFrame(connection, frame);
          }
          return finish === 'close' ? connection.close() : stream.return?.();
        });

        await termination;
        const settled = await Promise.all(pending);
        expect(settled.slice(0, events.length)).toEqual(
          events.map((message) => ({ value: { type: 'message', message }, done: false })),
        );
        if (finish === 'close') {
          expect(settled[events.length]).toEqual({
            value: { type: 'close', code: 1000, reason: 'OK', unsent: [] },
            done: false,
          });
        }
        const completed = settled.slice(events.length + (finish === 'close' ? 1 : 0));
        expect(completed).toHaveLength(BACKLOG_SIZE - events.length - (finish === 'close' ? 1 : 0));
        expect(completed.every((result) => result.done && result.value === undefined)).toBe(true);
        expect(elementMoves).toBeLessThanOrEqual(BACKLOG_SIZE * 8);

        dispatchFrame(connection, JSON.stringify(event(BACKLOG_SIZE)));
        await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
      } finally {
        await stream.return?.();
        connection.close();
      }
    },
  );
});
