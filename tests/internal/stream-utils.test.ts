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
    const stream = (async function* () {
      yield 'value';
    })();

    expect(adapt(stream)).toBe(stream);
  });

  test('reads values and releases the reader lock when the stream ends', async () => {
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'first' })
        .mockResolvedValueOnce({ done: true }),
      releaseLock: jest.fn(),
      cancel: jest.fn(),
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
      read: jest.fn().mockRejectedValue(failure),
      releaseLock: jest.fn(),
      cancel: jest.fn(),
    };

    await expect(adapt({ getReader: () => reader }).next()).rejects.toBe(failure);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  test('cancels the reader and releases its lock when iteration ends early', async () => {
    const reader = {
      read: jest.fn(),
      releaseLock: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    await expect(adapt({ getReader: () => reader }).return?.()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
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
      (async function* () {
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
    const returned = jest.fn().mockResolvedValue({ done: true, value: undefined });
    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          next: jest.fn().mockResolvedValue({ done: false, value: 'first' }),
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
    const returned = jest.fn().mockResolvedValue({ done: true, value: undefined });

    await CancelReadableStream({ [Symbol.asyncIterator]: () => ({ return: returned }) });

    expect(returned).toHaveBeenCalledTimes(1);
  });

  test('cancels reader-based streams and releases their locks', async () => {
    const reader = {
      cancel: jest.fn().mockResolvedValue(undefined),
      releaseLock: jest.fn(),
    };

    await CancelReadableStream({ getReader: () => reader });

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
