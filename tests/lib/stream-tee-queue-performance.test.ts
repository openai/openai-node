import { vi } from 'vitest';
import { Stream } from 'openai/core/streaming';

const QUEUE_SIZE = 4096;

function createNumberedStream(length: number, controller = new AbortController()) {
  let value = 0;
  const next = vi.fn((): Promise<IteratorResult<number>> => {
    if (value >= length) {
      return Promise.resolve({ done: true, value: undefined });
    }

    const result = Promise.resolve({ done: false as const, value });
    value += 1;
    return result;
  });

  return { stream: new Stream(() => ({ next }), controller), next, controller };
}

function measureArrayMovement<T>(operation: () => T): {
  result: T;
  elementMoves: number;
  shiftCalls: number;
  compactions: number;
} {
  const originalShift = Array.prototype.shift;
  const originalSlice = Array.prototype.slice;
  let elementMoves = 0;
  let shiftCalls = 0;
  let compactions = 0;

  function trackedShift(this: unknown[]) {
    shiftCalls += 1;
    elementMoves += Math.max(this.length - 1, 0);
    return originalShift.call(this);
  }

  function trackedSlice(this: unknown[], start?: number, end?: number) {
    const result = originalSlice.call(this, start, end);
    compactions += 1;
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'shift', trackedShift);
  Reflect.set(Array.prototype, 'slice', trackedSlice);

  try {
    const result = operation();
    return { result, elementMoves, shiftCalls, compactions };
  } finally {
    Reflect.set(Array.prototype, 'slice', originalSlice);
    Reflect.set(Array.prototype, 'shift', originalShift);
  }
}

function capturePromiseQueues<T>(operation: () => T): { result: T; queues: Set<unknown[]> } {
  const originalPush = Array.prototype.push;
  const queues = new Set<unknown[]>();

  function trackedPush(this: unknown[], ...values: unknown[]) {
    if (values.length === 1 && values[0] instanceof Promise) {
      queues.add(this);
    }
    return originalPush.apply(this, values);
  }

  Reflect.set(Array.prototype, 'push', trackedPush);
  try {
    return { result: operation(), queues };
  } finally {
    Reflect.set(Array.prototype, 'push', originalPush);
  }
}

describe('Stream.tee queue performance', () => {
  test.each([0, 1] as const)(
    'drains a lagging reader in linear time when reader %i leads',
    async (leaderIndex) => {
      const { stream, next } = createNumberedStream(QUEUE_SIZE);
      const [left, right] = stream.tee();
      const leader = (leaderIndex === 0 ? left : right)[Symbol.asyncIterator]();
      const follower = (leaderIndex === 0 ? right : left)[Symbol.asyncIterator]();
      const expected = Array.from({ length: QUEUE_SIZE }, (_, value) => value);

      const leading = await Promise.all(Array.from({ length: QUEUE_SIZE }, () => leader.next()));
      expect(leading.map(({ value }) => value)).toEqual(expected);
      expect(next).toHaveBeenCalledTimes(QUEUE_SIZE);

      const {
        result: pending,
        elementMoves,
        shiftCalls,
        compactions,
      } = measureArrayMovement(() => Array.from({ length: QUEUE_SIZE }, () => follower.next()));
      const received = await Promise.all(pending);

      expect(received).toHaveLength(QUEUE_SIZE);
      expect(received.map(({ value }) => value)).toEqual(expected);
      expect(elementMoves).toBeLessThanOrEqual(QUEUE_SIZE * 2);
      expect(shiftCalls).toBe(0);
      expect(compactions).toBeGreaterThan(0);
      expect(next).toHaveBeenCalledTimes(QUEUE_SIZE);

      const leaderCompletion = leader.next();
      const followerCompletion = follower.next();
      expect(leaderCompletion).toBe(followerCompletion);
      await expect(leaderCompletion).resolves.toEqual({ done: true, value: undefined });
      expect(next).toHaveBeenCalledTimes(QUEUE_SIZE + 1);
    },
  );

  test('releases consumed buffered promises before compacting the remaining queue', async () => {
    const { stream, next } = createNumberedStream(QUEUE_SIZE);
    const [left, right] = stream.tee();
    const leader = left[Symbol.asyncIterator]();
    const follower = right[Symbol.asyncIterator]();

    const { result: first, queues } = capturePromiseQueues(() => leader.next());
    await expect(first).resolves.toEqual({ done: false, value: 0 });
    const buffered = [...queues].find((queue) => queue[0] === first);
    if (!buffered) {
      throw new Error('Expected to capture the lagging reader queue');
    }

    await Promise.all(Array.from({ length: QUEUE_SIZE - 1 }, () => leader.next()));
    expect(buffered).toHaveLength(QUEUE_SIZE);

    const consumed = await Promise.all(Array.from({ length: 1024 }, () => follower.next()));
    expect(consumed.map(({ value }) => value)).toEqual(Array.from({ length: 1024 }, (_, value) => value));

    expect(buffered[0]).toBeUndefined();
    expect(buffered[1023]).toBeUndefined();
    expect(buffered[1024]).toBeInstanceOf(Promise);
    expect(next).toHaveBeenCalledTimes(QUEUE_SIZE);
  });

  test.each([false, true])(
    'releases canceled queues while a sibling keeps reading (nested: %s)',
    async (nested) => {
      const { stream, controller } = createNumberedStream(QUEUE_SIZE + 4);
      const [left, right] = stream.tee();
      const sibling = right[Symbol.asyncIterator]();
      const { result: first, queues } = capturePromiseQueues(() => sibling.next());
      await first;
      const buffered = [...queues].find((queue) => queue[0] === first);
      if (!buffered) {
        throw new Error('Expected to capture the lagging reader queue');
      }
      await Promise.all(Array.from({ length: 3 }, () => sibling.next()));
      expect(buffered).toHaveLength(4);
      const branches = nested ? left.tee() : [left];
      const readers = branches.map((branch) => branch.toReadableStream().getReader());

      try {
        await Promise.all(readers.map((reader) => reader.read()));
        await Promise.all(readers.map((reader) => reader.cancel()));
        expect(buffered).toHaveLength(0);

        const results = await Promise.all(Array.from({ length: QUEUE_SIZE }, () => sibling.next()));
        expect(results.map(({ value }) => value)).toEqual(
          Array.from({ length: QUEUE_SIZE }, (_, index) => index + 4),
        );
        expect(buffered).toHaveLength(0);
        expect(controller.signal.aborted).toBe(false);
      } finally {
        controller.abort();
        await Promise.all(readers.map((reader) => reader.cancel()));
        for (const reader of readers) {
          reader.releaseLock();
        }
      }
    },
  );

  test('replays values independently for interleaved readers without extra source pulls', async () => {
    const { stream, next } = createNumberedStream(6);
    const [left, right] = stream.tee();
    const first = left[Symbol.asyncIterator]();
    const second = right[Symbol.asyncIterator]();

    await expect(first.next()).resolves.toEqual({ done: false, value: 0 });
    await expect(second.next()).resolves.toEqual({ done: false, value: 0 });
    await expect(second.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(second.next()).resolves.toEqual({ done: false, value: 2 });
    await expect(first.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(first.next()).resolves.toEqual({ done: false, value: 2 });
    await expect(first.next()).resolves.toEqual({ done: false, value: 3 });
    await expect(second.next()).resolves.toEqual({ done: false, value: 3 });
    expect(next).toHaveBeenCalledTimes(4);
  });

  test('shares source promises across concurrent readers and asynchronous completion', async () => {
    const next = vi
      .fn<() => Promise<IteratorResult<number>>>()
      .mockResolvedValueOnce({ done: false, value: 10 })
      .mockResolvedValueOnce({ done: false, value: 11 })
      .mockResolvedValueOnce({ done: true, value: undefined });
    const [left, right] = new Stream(() => ({ next }), new AbortController()).tee();
    const first = left[Symbol.asyncIterator]();
    const second = right[Symbol.asyncIterator]();

    const firstValue = first.next();
    const secondValue = first.next();
    expect(second.next()).toBe(firstValue);
    expect(second.next()).toBe(secondValue);
    expect(next).toHaveBeenCalledTimes(2);

    await expect(firstValue).resolves.toEqual({ done: false, value: 10 });
    await expect(secondValue).resolves.toEqual({ done: false, value: 11 });

    const firstDone = first.next();
    const secondDone = second.next();
    expect(firstDone).toBe(secondDone);
    expect(next).toHaveBeenCalledTimes(3);
    await expect(firstDone).resolves.toEqual({ done: true, value: undefined });
  });

  test('replays the identical asynchronous source rejection to both readers', async () => {
    const failure = new Error('source failed');
    const next = vi.fn<() => Promise<IteratorResult<number>>>().mockRejectedValue(failure);
    const [left, right] = new Stream(() => ({ next }), new AbortController()).tee();
    const first = left[Symbol.asyncIterator]().next();
    const second = right[Symbol.asyncIterator]().next();

    expect(first).toBe(second);
    expect(next).toHaveBeenCalledTimes(1);
    await Promise.all([expect(first).rejects.toBe(failure), expect(second).rejects.toBe(failure)]);
  });

  test('preserves explicit shared-controller cancellation and independent reader teardown', async () => {
    const controller = new AbortController();
    const next = vi.fn(async () => ({ done: false as const, value: 1 }));
    const returnSource = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source = new Stream(() => ({ next, return: returnSource }), controller);
    const [left, right] = source.tee();

    expect(left.controller).toBe(controller);
    expect(right.controller).toBe(controller);
    expect(typeof left[Symbol.asyncIterator]().return).toBe('function');

    for await (const value of left) {
      if (value === 1) {
        break;
      }
    }

    expect(returnSource).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    await expect(right[Symbol.asyncIterator]().next()).resolves.toEqual({ done: false, value: 1 });

    right.controller.abort();
    expect(left.controller.signal.aborted).toBe(true);
  });
});
