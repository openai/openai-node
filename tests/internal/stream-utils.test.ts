import { vi } from 'vitest';

import { ReadableStreamToAsyncIterable as adaptStandaloneReadableStream } from 'openai/internal/stream-utils';
import {
  CancelReadableStream,
  ReadableStreamFrom,
  ReadableStreamToAsyncIterable as adaptShimReadableStream,
} from 'openai/internal/shims';

describe.each([
  ['standalone stream adapter', adaptStandaloneReadableStream],
  ['runtime shim stream adapter', adaptShimReadableStream],
])('%s', (_name, adapt) => {
  test('returns streams that are already asynchronously iterable unchanged', () => {
    const stream = (async function* stream() {
      yield 'value';
    })();

    expect(adapt(stream)).toBe(stream);
  });

  test('reads values and releases the reader lock when the stream ends', async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'first' })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: vi.fn(),
      cancel: vi.fn(),
    };
    const iterator = adapt<string>({ getReader: () => reader });

    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'first' });
    await expect(iterator.next()).resolves.toEqual({ done: true });
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  test('releases the reader lock when reading fails', async () => {
    const failure = new Error('stream failed');
    const reader = {
      read: vi.fn().mockRejectedValue(failure),
      releaseLock: vi.fn(),
      cancel: vi.fn(),
    };

    await expect(adapt({ getReader: () => reader }).next()).rejects.toBe(failure);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  test('cancels the reader and releases its lock when iteration ends early', async () => {
    const reader = {
      read: vi.fn(),
      releaseLock: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    await expect(adapt({ getReader: () => reader }).return?.()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});

describe('standalone readable stream adapter', () => {
  test('returns an actual async iterator for native Web ReadableStreams', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('value');
        controller.close();
      },
    });

    const iterator = adaptStandaloneReadableStream<string>(stream);

    expect(iterator).not.toBe(stream);
    expect(typeof iterator.next).toBe('function');
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'value' });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(stream.locked).toBe(false);
  });

  test('makes extracted async iterators iterable when they do not expose Symbol.asyncIterator', async () => {
    const sourceIterator = {
      next: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'first' })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const stream = { [Symbol.asyncIterator]: () => sourceIterator };

    const iterator = adaptStandaloneReadableStream<string>(stream);
    const values: string[] = [];
    for await (const value of iterator) {
      values.push(value);
    }

    expect(iterator).not.toBe(sourceIterator);
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
    expect(values).toEqual(['first']);
    expect(sourceIterator.next.mock.contexts).toEqual([sourceIterator, sourceIterator]);
    expect(iterator.return).toBeUndefined();
    expect(iterator.throw).toBeUndefined();
  });

  test('preserves cancellation and error delegation for extracted async iterators', async () => {
    const sourceIterator = {
      next: vi.fn().mockResolvedValue({ done: false, value: 'first' }),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      throw: vi.fn().mockResolvedValue({ done: true, value: 'recovered' }),
    };
    const stream = { [Symbol.asyncIterator]: () => sourceIterator };
    const iterator = adaptStandaloneReadableStream<string>(stream);

    for await (const _value of iterator) {
      break;
    }

    expect(sourceIterator.return).toHaveBeenCalledTimes(1);
    expect(sourceIterator.return.mock.contexts).toEqual([sourceIterator]);

    const failure = new Error('stream failed');
    await expect(iterator.throw?.(failure)).resolves.toEqual({ done: true, value: 'recovered' });
    expect(sourceIterator.throw).toHaveBeenCalledWith(failure);
    expect(sourceIterator.throw.mock.contexts).toEqual([sourceIterator]);
  });
});

describe('ReadableStreamFrom', () => {
  test('consumes synchronous and asynchronous iterables', async () => {
    const synchronous: number[] = [];
    for await (const value of ReadableStreamFrom([1, 2])) {
      synchronous.push(value);
    }

    const asynchronous: string[] = [];
    for await (const value of ReadableStreamFrom(
      (async function* chunks() {
        yield 'first';
        yield 'second';
      })(),
    )) {
      asynchronous.push(value);
    }

    expect(synchronous).toEqual([1, 2]);
    expect(asynchronous).toEqual(['first', 'second']);
  });

  test('closes the source iterator when the readable stream is canceled', async () => {
    const returned = vi.fn().mockResolvedValue({ done: true, value: undefined });
    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          next: vi.fn().mockResolvedValue({ done: false, value: 'first' }),
          return: returned,
        };
      },
    };

    await ReadableStreamFrom(iterable).cancel();

    expect(returned).toHaveBeenCalledTimes(1);
  });
});

describe('CancelReadableStream', () => {
  test('ignores absent and non-object streams', async () => {
    await expect(CancelReadableStream(null)).resolves.toBeUndefined();
    await expect(CancelReadableStream(undefined)).resolves.toBeUndefined();
    await expect(CancelReadableStream('stream')).resolves.toBeUndefined();
  });

  test('closes asynchronously iterable streams through their iterator', async () => {
    const returned = vi.fn().mockResolvedValue({ done: true, value: undefined });

    await CancelReadableStream({ [Symbol.asyncIterator]: () => ({ return: returned }) });

    expect(returned).toHaveBeenCalledTimes(1);
  });

  test('cancels reader-based streams and releases their locks', async () => {
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };

    await CancelReadableStream({ getReader: () => reader });

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
