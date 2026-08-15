import { vi } from 'vitest';

import { multipartFormRequestOptions, toStreamingFile } from 'openai/internal/uploads';

const laterUpload = () => toStreamingFile(ReadableStream.from(['later']), 'later.txt');
const multipart = (body: Record<string, unknown>) => multipartFormRequestOptions({ body }, fetch);

describe('streaming multipart resource cleanup', () => {
  test.each([
    ['iterator', 'completion', null],
    ['iterator', 'cancellation', null],
    ['iterator', 'invalid filename', null],
    ['iterator', 'next accessor', null],
    ['proxy iterator', 'completion', null],
    ['proxy iterator', 'cancellation', null],
    ['proxy iterator', 'invalid filename', null],
    ['reader', 'completion', null],
    ['reader', 'cancellation', null],
    ['reader', 'invalid filename', null],
    ['iterator', 'completion', 'return'],
    ['iterator', 'invalid filename', 'return'],
    ['reader', 'invalid filename', 'cancel'],
    ['reader', 'invalid filename', 'releaseLock'],
  ] as const)('preserves %s cleanup during %s (throwing: %s)', async (kind, outcome, throwing) => {
    const error = new Error('next accessor failed');
    const source = new ReadableStream<string>({
      cancel: () => Promise.reject(new Error('cancellation failed')),
    });
    const next = vi.fn();
    next.mockResolvedValueOnce({ done: false, value: 'original' }).mockResolvedValue({ done: true });
    const original = { next, read: next, return: vi.fn(), cancel: vi.fn(), releaseLock: vi.fn() };
    original.return.mockResolvedValue({ done: true });
    original.cancel.mockResolvedValue(null);
    const substituted = vi.fn();
    const { return: originalReturn, ...withoutReturn } = original;
    const getReturn = vi.fn(() => originalReturn);
    let receiver =
      kind === 'proxy iterator'
        ? new Proxy(withoutReturn, {
            get(target, key, proxy) {
              return key === 'return' ? getReturn() : Reflect.get(target, key, proxy);
            },
          })
        : { ...original };
    const getCleanup = vi.fn(() => {
      throw new Error('cleanup accessor failed');
    });
    if (throwing) {
      Object.defineProperty(receiver, throwing, { get: getCleanup });
    }
    const earlier =
      kind === 'reader'
        ? { getReader: () => receiver }
        : {
            [Symbol.asyncIterator]() {
              if (outcome === 'next accessor') {
                const iterator = source[Symbol.asyncIterator]();
                const closeIterator = iterator.return;
                if (!closeIterator) {
                  throw new Error('Expected native iterator cleanup');
                }
                original.return.mockImplementation(closeIterator.bind(iterator));
                receiver = Object.assign(iterator, receiver);
                Object.defineProperty(receiver, 'next', {
                  get() {
                    throw error;
                  },
                });
              }
              return receiver;
            },
          };
    const later = laterUpload();
    Object.defineProperty(later, 'name', {
      get() {
        if (!throwing) {
          Object.assign(receiver, { return: substituted, cancel: substituted, releaseLock: substituted });
        }
        return outcome === 'invalid filename' ? undefined : 'later.txt';
      },
    });
    const options = await multipart(
      outcome === 'next accessor' ? { earlier: laterUpload(), later: earlier } : { earlier, later },
    );

    if (outcome === 'completion') {
      await expect(new Response(options.body as ReadableStream).text()).resolves.toContain('original');
    } else {
      const reader = (options.body as ReadableStream).getReader();
      if (outcome === 'cancellation') {
        await reader.read();
        await reader.cancel();
      } else if (outcome === 'next accessor') {
        await expect(reader.read()).rejects.toBe(error);
      } else {
        await expect(reader.read()).rejects.toThrow(/file.?name/iu);
      }
    }
    const cleaned = outcome === 'completion' ? [] : [receiver];
    expect(original.return.mock.contexts).toEqual(kind !== 'reader' && throwing !== 'return' ? cleaned : []);
    expect(original.cancel.mock.contexts).toEqual(kind === 'reader' && throwing !== 'cancel' ? cleaned : []);
    expect(original.releaseLock.mock.contexts).toEqual(
      kind === 'reader' && throwing !== 'releaseLock' ? [receiver] : [],
    );
    expect(getReturn).toHaveBeenCalledTimes(kind === 'proxy iterator' && outcome !== 'completion' ? 1 : 0);
    expect(getCleanup).toHaveBeenCalledTimes(
      throwing && (outcome !== 'completion' || throwing === 'return') ? 1 : 0,
    );
    expect(substituted).not.toHaveBeenCalled();
    expect(source.locked).toBe(false);
  });

  test.each(['own', 'inherited', 'stateful'] as const)(
    'retains %s accessor-backed iterator cleanup when a later filename mutates its source',
    async (kind) => {
      const source = ReadableStream.from(['original']);
      const iterator = source[Symbol.asyncIterator]();
      const close = iterator.return;
      if (!close) {
        throw new Error('Expected native iterator cleanup');
      }
      const replacement = vi.fn();
      const release = vi.fn(close);
      let originalCleanup = release;
      const original = vi.fn(() => originalCleanup);
      const owner = kind === 'inherited' ? Object.create(Object.getPrototypeOf(iterator)) : iterator;
      Object.defineProperty(owner, 'return', { configurable: true, get: original });
      if (kind === 'inherited') {
        Reflect.deleteProperty(iterator, 'return');
        Object.setPrototypeOf(iterator, owner);
      }
      const earlier = toStreamingFile({ [Symbol.asyncIterator]: () => iterator }, 'original.txt');
      const later = laterUpload();
      Object.defineProperty(later, 'name', {
        get() {
          if (kind === 'stateful') {
            originalCleanup = replacement;
          } else {
            Object.defineProperty(iterator, 'return', { configurable: true, get: replacement });
          }
          return null;
        },
      });
      const options = await multipart({ earlier, later });

      expect(original).not.toHaveBeenCalled();
      await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/file.?name/iu);
      expect(original.mock.contexts).toEqual([iterator]);
      expect(release.mock.contexts).toEqual([iterator]);
      expect(replacement).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
    },
  );

  test.each(['native', 'forwarding Proxy'] as const)(
    'captures %s iterator bytes before its return accessor can replace next',
    async (kind) => {
      const source = ReadableStream.from(['original']);
      const target = source[Symbol.asyncIterator]();
      const { next, return: close } = target;
      if (!close) {
        throw new Error('Expected native iterator cleanup');
      }
      const original = vi.fn(next);
      const replacement = vi.fn().mockResolvedValue({ done: false, value: 'attacker' });
      const release = vi.fn(close);
      Object.defineProperty(target, 'next', { configurable: true, value: original });
      const getReturn = vi.fn(() => {
        Object.defineProperty(target, 'next', { configurable: true, value: replacement });
        return release;
      });
      Object.defineProperty(target, 'return', { configurable: true, get: getReturn });
      const iterator =
        kind === 'native'
          ? target
          : new Proxy(target, {
              get(value, key) {
                const member = Reflect.get(value, key, value);
                return typeof member === 'function' ? member.bind(value) : member;
              },
            });
      const options = await multipart({
        upload: toStreamingFile({ [Symbol.asyncIterator]: () => iterator }, 'original.txt'),
      });
      const reader = (options.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      await reader.read();
      const chunk = await reader.read();
      await reader.cancel();

      expect(new TextDecoder().decode(chunk.value)).toBe('original');
      expect(original.mock.contexts).toEqual([target]);
      expect(getReturn.mock.contexts).toEqual([target]);
      expect(release.mock.contexts).toEqual([target]);
      expect(replacement).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
    },
  );

  test('cleans up accessor-backed native iterators through their forwarding Proxy receiver', async () => {
    const source = ReadableStream.from(['original']);
    const target = source[Symbol.asyncIterator]();
    const close = target.return;
    if (!close) {
      throw new Error('Expected native iterator cleanup');
    }
    const getReturn = vi.fn(function getReturn(this: typeof target) {
      if (this !== target) {
        throw new Error('Expected the native iterator receiver');
      }
      return close;
    });
    Object.defineProperty(target, 'return', { configurable: true, get: getReturn });
    const iterator = new Proxy(target, {
      get(original, key) {
        const member = Reflect.get(original, key, original);
        return typeof member === 'function' ? member.bind(original) : member;
      },
    });
    const later = laterUpload();
    Object.defineProperty(later, 'name', { value: null });
    const options = await multipart({
      earlier: toStreamingFile({ [Symbol.asyncIterator]: () => iterator }, 'original.txt'),
      later,
    });

    expect(getReturn).not.toHaveBeenCalled();
    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/file.?name/iu);
    expect(getReturn.mock.contexts).toEqual([target]);
    expect(source.locked).toBe(false);
  });

  test('runs a forwarding native async-generator Proxy finally during active cancellation', async () => {
    const finished = vi.fn();
    const getReturn = vi.fn();
    async function* chunks() {
      try {
        yield 'original';
      } finally {
        finished();
      }
    }
    const target = chunks();
    const iterator = new Proxy(target, {
      get(generator, key) {
        if (key === 'return') {
          getReturn();
        }
        const member = Reflect.get(generator, key, generator);
        return typeof member === 'function' ? member.bind(generator) : member;
      },
    });
    const source = { [Symbol.asyncIterator]: () => iterator };
    const options = await multipart({ upload: toStreamingFile(source, 'original.txt') });
    const reader = (options.body as ReadableStream).getReader();
    await reader.read();
    await reader.read();
    await reader.read();

    expect(finished).not.toHaveBeenCalled();
    await reader.cancel();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(getReturn).toHaveBeenCalledTimes(1);
  });
});
