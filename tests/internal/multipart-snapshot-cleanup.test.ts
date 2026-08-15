import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

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
    expect(getReturn).toHaveBeenCalledTimes(kind === 'proxy iterator' ? 1 : 0);
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

  test.each([
    ['accessor', 'invalid filename'],
    ['getOwnPropertyDescriptor', 'invalid filename'],
    ['getPrototypeOf', 'cancellation'],
    ['descriptorless', 'invalid filename'],
    ['descriptorless', 'cancellation'],
  ] as const)('cleans up %s native iterator proxies during %s', async (kind, outcome) => {
    const source = ReadableStream.from(['original']);
    const target = source[Symbol.asyncIterator]();
    const close = target.return;
    if (!close) {
      throw new Error('Expected native iterator cleanup');
    }
    const original = vi.fn(close);
    const replacement = vi.fn(async () => ({ done: true as const, value: undefined }));
    let cleanup: typeof close = original;
    const getReturn = vi.fn(function getReturn(this: typeof target) {
      if (this !== target) {
        throw new Error('Expected the native iterator receiver');
      }
      return cleanup;
    });
    if (kind === 'accessor') {
      Object.defineProperty(target, 'return', { configurable: true, get: getReturn });
    } else {
      Reflect.deleteProperty(target, 'return');
      Object.setPrototypeOf(target, null);
    }
    const iterator = new Proxy(target, {
      get(receiver, key) {
        const member =
          kind === 'accessor' || key !== 'return'
            ? Reflect.get(receiver, key, receiver)
            : Reflect.apply(getReturn, receiver, []);
        return typeof member === 'function' ? member.bind(receiver) : member;
      },
      [kind]() {
        throw new Error('Opaque iterator metadata');
      },
    });
    const later = laterUpload();
    Object.defineProperty(later, 'name', {
      get() {
        cleanup = replacement;
        return outcome === 'invalid filename' ? null : 'later.txt';
      },
    });
    const options = await multipart({
      earlier: toStreamingFile({ [Symbol.asyncIterator]: () => iterator }, 'original.txt'),
      later,
    });
    const reader = (options.body as ReadableStream).getReader();
    if (outcome === 'invalid filename') {
      await expect(reader.read()).rejects.toThrow(/file.?name/iu);
    } else {
      await reader.read();
      await reader.cancel();
    }

    expect(getReturn.mock.contexts).toEqual([target]);
    expect(original.mock.contexts).toEqual([target]);
    expect(replacement).not.toHaveBeenCalled();
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

  test.each([
    ['iterator', 'cancellation'],
    ['iterator', 'invalid filename'],
    ['reader', 'cancellation'],
    ['reader', 'invalid filename'],
  ] as const)(
    'awaits unused %s cleanup only for %s without delaying primary errors',
    async (kind, outcome) => {
      let locked = false;
      const cleanup = new ReadableStream<void>().getReader();
      const release = vi.fn(async () => {
        await cleanup.read();
        locked = false;
      });
      const iterator = {
        next: vi.fn(),
        return: vi.fn(async () => {
          await release();
          return { done: true as const, value: undefined };
        }),
      };
      const source =
        kind === 'reader'
          ? Object.assign(
              new ReadableStream<string>({
                start() {
                  locked = true;
                },
                cancel: release,
              }),
              { [Symbol.asyncIterator]: undefined },
            )
          : {
              [Symbol.asyncIterator]() {
                locked = true;
                return iterator;
              },
            };
      const later = laterUpload();
      if (outcome === 'invalid filename') {
        Object.defineProperty(later, 'name', { value: null });
      }
      const options = await multipart({ earlier: toStreamingFile(source, 'earlier.txt'), later });
      const reader = (options.body as ReadableStream).getReader();
      let cancellation: Promise<void> | undefined;

      if (outcome === 'cancellation') {
        await reader.read();
        cancellation = reader.cancel();
        let settled = false;
        void cancellation.then(() => {
          settled = true;
        });
        await nextEventLoopTurn();
        expect(settled).toBe(false);
      } else {
        await expect(reader.read()).rejects.toThrow(/file.?name/iu);
      }
      expect(locked).toBe(true);
      if (source instanceof ReadableStream) {
        expect(source.locked).toBe(false);
      }
      await cleanup.cancel();
      await cancellation;
      expect(locked).toBe(false);
      expect(iterator.next).not.toHaveBeenCalled();
      expect(iterator.return).toHaveBeenCalledTimes(kind === 'iterator' ? 1 : 0);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );
});
