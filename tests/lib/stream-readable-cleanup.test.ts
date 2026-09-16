import { vi } from 'vitest';
import { Stream } from 'openai/core/streaming';

function unserializable(error: Error) {
  return {
    toJSON() {
      throw error;
    },
  };
}

describe('Stream.toReadableStream error cleanup', () => {
  test('closes a suspended source after serialization fails', async () => {
    const failure = new Error('serialization failed');
    const finalized = vi.fn();
    const controller = new AbortController();
    async function* values() {
      try {
        yield unserializable(failure);
        yield { text: 'unused' };
      } finally {
        finalized();
      }
    }
    const reader = new Stream(values, controller).toReadableStream().getReader();

    await expect(reader.read()).rejects.toBe(failure);
    await vi.waitFor(() => expect(finalized).toHaveBeenCalledTimes(1));
    expect(controller.signal.aborted).toBe(true);
    reader.releaseLock();
  });

  test.each(['throws', 'rejects', 'stalls'] as const)(
    'preserves the serialization error when source cleanup %s',
    async (behavior) => {
      const failure = new Error('serialization failed');
      const cleanupFailure = new Error('cleanup failed');
      const next = vi.fn(async () => ({ value: unserializable(failure), done: false as const }));
      const close = vi.fn((): Promise<IteratorResult<unknown>> => {
        if (behavior === 'throws') {
          throw cleanupFailure;
        }
        return behavior === 'rejects' ? Promise.reject(cleanupFailure) : Promise.race([]);
      });
      const controller = new AbortController();
      const source = new Stream(() => ({ next, return: close }), controller);
      const reader = source.toReadableStream().getReader();

      await expect(reader.read()).rejects.toBe(failure);
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      expect(controller.signal.aborted).toBe(true);
      await expect(reader.read()).rejects.toBe(failure);
      expect(next).toHaveBeenCalledTimes(1);
      reader.releaseLock();
    },
  );

  test('releases a custom iterator when next rejects', async () => {
    const failure = new Error('source read failed');
    const close = vi.fn(async () => ({ value: undefined, done: true as const }));
    const controller = new AbortController();
    const source = new Stream(
      () => ({
        next: async () => {
          throw failure;
        },
        return: close,
      }),
      controller,
    );
    const reader = source.toReadableStream().getReader();

    await expect(reader.read()).rejects.toBe(failure);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(controller.signal.aborted).toBe(true);
    reader.releaseLock();
  });

  test('retires only the failed tee branch and lets its sibling finish', async () => {
    const failure = new Error('serialization failed');
    const value = unserializable(failure);
    const finalized = vi.fn();
    const controller = new AbortController();
    async function* values() {
      try {
        yield value;
        yield { text: 'next' };
      } finally {
        finalized();
      }
    }
    const [left, right] = new Stream(values, controller).tee();
    const reader = left.toReadableStream().getReader();
    await expect(reader.read()).rejects.toBe(failure);
    await expect(left[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined });
    expect(controller.signal.aborted).toBe(false);
    expect(finalized).not.toHaveBeenCalled();

    const received = [];
    for await (const item of right) {
      received.push(item);
    }
    expect(received).toEqual([value, { text: 'next' }]);
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(false);
    reader.releaseLock();
  });

  test('closes the source when the other tee branch is canceled after a serialization error', async () => {
    const failure = new Error('serialization failed');
    const finalized = vi.fn();
    const controller = new AbortController();
    async function* values() {
      try {
        yield unserializable(failure);
        yield { text: 'unused' };
      } finally {
        finalized();
      }
    }
    const [left, right] = new Stream(values, controller).tee();
    const reader = left.toReadableStream().getReader();
    await expect(reader.read()).rejects.toBe(failure);
    await right[Symbol.asyncIterator]().return?.();

    expect(finalized).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    reader.releaseLock();
  });

  test('does not close twice when cancellation races a pending pull', async () => {
    let resolveNext!: (result: IteratorResult<{ toJSON: () => { text: string } }>) => void;
    // oxlint-disable-next-line promise/avoid-new -- Control the in-flight read/cancel interleaving.
    const pending = new Promise<IteratorResult<{ toJSON: () => { text: string } }>>((resolve) => {
      resolveNext = resolve;
    });
    const next = vi.fn(() => pending);
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const serialize = vi.fn(() => ({ text: 'late result' }));
    const reader = new Stream(() => ({ next, return: close }), new AbortController())
      .toReadableStream()
      .getReader();
    const read = reader.read();
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    await reader.cancel();
    resolveNext({ done: false, value: { toJSON: serialize } });
    await vi.waitFor(() => expect(serialize).toHaveBeenCalledTimes(1));
    await expect(read).resolves.toEqual({ done: true, value: undefined });
    expect(close).toHaveBeenCalledTimes(1);
    reader.releaseLock();
  });

  test('does not cancel an exhausted source', async () => {
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const controller = new AbortController();
    const source = new Stream(
      () => ({ next: async () => ({ done: true as const, value: undefined }), return: close }),
      controller,
    );
    const reader = source.toReadableStream().getReader();

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(close).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    reader.releaseLock();
  });
});
