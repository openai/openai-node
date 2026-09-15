import OpenAI from 'openai';
import { dispatchFrame, websocketVariants } from './helpers/websocket-variants';

const BACKLOG_SIZE = 4096;

function measureElementMovement<T>(operation: () => T): { result: T; elementMoves: number } {
  const originalShift = Array.prototype.shift;
  const originalSplice = Array.prototype.splice;
  const originalSlice = Array.prototype.slice;
  let elementMoves = 0;

  function trackedShift(this: unknown[]) {
    elementMoves += this.length;
    return originalShift.call(this);
  }

  function trackedSplice(this: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
    // Count both the returned elements and the tail moved by front deletion.
    if (start === 0) {
      elementMoves += this.length;
    }
    if (deleteCount === undefined) {
      return Reflect.apply(originalSplice, this, [start]);
    }
    return originalSplice.call(this, start, deleteCount, ...items);
  }

  function trackedSlice(this: unknown[], start?: number, end?: number) {
    const result = originalSlice.call(this, start, end);
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'shift', trackedShift);
  Reflect.set(Array.prototype, 'splice', trackedSplice);
  Reflect.set(Array.prototype, 'slice', trackedSlice);
  try {
    // All measured calls run synchronously; restore before awaiting promises or assertions.
    const result = operation();
    return { result, elementMoves };
  } finally {
    Reflect.set(Array.prototype, 'slice', originalSlice);
    Reflect.set(Array.prototype, 'splice', originalSplice);
    Reflect.set(Array.prototype, 'shift', originalShift);
  }
}

describe.each(websocketVariants)('$name public stream buffering', ({ create, event }) => {
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
