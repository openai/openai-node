import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

import { vi } from 'vitest';

import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

const laterUpload = () => toStreamingFile(ReadableStream.from(['later']), 'later.txt');
const multipart = (body: Record<string, unknown>) => multipartFormRequestOptions({ body }, fetch);

describe('streaming multipart snapshots', () => {
  test.each(['substituted', null] as const)('snapshots Response.body before it becomes %s', async (later) => {
    const upload = new Response('original payload');
    const getBody = vi.fn().mockReturnValueOnce(upload.body);
    getBody.mockReturnValue(later === null ? null : new Response('attacker payload').body);
    Object.defineProperty(upload, 'body', { get: getBody });
    const options = await maybeMultipartFormRequestOptions({ body: { upload, later: laterUpload() } }, fetch);

    expect(getBody).not.toHaveBeenCalled();
    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain('original payload');
    expect(getBody).toHaveBeenCalledTimes(1);
  });

  test('reads 2 MiB legacy Blob buffers only as each multipart part is consumed', async () => {
    const uploads = [65, 66].map((byte) => {
      const read = vi.fn(Blob.prototype.arrayBuffer);
      const blob = new Blob([new Uint8Array(2 * 1024 * 1024).fill(byte)]);
      const upload = Object.assign(blob, { name: `${byte}.bin`, stream: undefined, arrayBuffer: read });
      return { upload, read };
    });
    const options = await multipart({ files: uploads.map(({ upload }) => upload), later: laterUpload() });
    const reader = (options.body as ReadableStream<Uint8Array>).getReader();
    await Promise.all([reader.read(), reader.read()]);

    expect(uploads[0]?.read).not.toHaveBeenCalled();
    const first = await reader.read();
    expect(first.value).toHaveLength(2 * 1024 * 1024);
    expect(uploads[0]?.read).toHaveBeenCalledTimes(1);
    expect(uploads[1]?.read).not.toHaveBeenCalled();
    await Promise.all([reader.read(), reader.read(), reader.read()]);
    expect(uploads[1]?.read).not.toHaveBeenCalled();
    const second = await reader.read();
    expect(second.value).toHaveLength(2 * 1024 * 1024);
    expect(uploads[1]?.read).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  test.each(['iterator', 'unlocked reader', 'locked reader'] as const)(
    'replays shared native streams only when the %s does not lock them',
    async (kind) => {
      const source = ReadableStream.from(['shared']);
      const acquire = vi.fn(function acquire(this: ReadableStream<string>) {
        const stream = kind === 'locked reader' ? this : ReadableStream.from(['shared']);
        return kind.endsWith('iterator')
          ? stream[Symbol.asyncIterator]()
          : ReadableStream.prototype.getReader.call(stream);
      });
      Object.defineProperty(source, kind === 'iterator' ? Symbol.asyncIterator : 'getReader', {
        value: acquire,
      });
      if (kind.endsWith('reader')) {
        Object.defineProperty(source, Symbol.asyncIterator, { value: undefined });
      }
      const options = await multipart({
        files: [toStreamingFile(source, 'first.txt'), toStreamingFile(source, 'second.txt')],
      });
      const body = await new Response(options.body as ReadableStream).text();

      expect(body.match(/\r\n\r\nshared\r\n/gu)).toHaveLength(kind === 'locked reader' ? 1 : 2);
      expect(body).toContain('filename="second.txt"');
      expect(acquire.mock.contexts).toEqual(kind === 'locked reader' ? [source] : [source, source]);
      expect(source.locked).toBe(false);
    },
  );

  test.each(['iterator', 'reader'] as const)(
    'serializes a shared forwarding native stream Proxy once through its %s',
    async (kind) => {
      const target = ReadableStream.from(['shared']);
      if (kind === 'reader') {
        Object.defineProperty(target, Symbol.asyncIterator, { value: undefined });
      }
      const acquisition = kind === 'iterator' ? Symbol.asyncIterator : 'getReader';
      const acquire = vi.fn();
      const source = new Proxy(target, {
        get(stream, key) {
          const member = Reflect.get(stream, key, stream);
          if (typeof member !== 'function') {
            return member;
          }
          if (key === acquisition) {
            return (...args: unknown[]) => {
              acquire();
              return Reflect.apply(member, stream, args);
            };
          }
          return member.bind(stream);
        },
      });
      const options = await multipart({
        files: [toStreamingFile(source, 'first.txt'), toStreamingFile(source, 'second.txt')],
      });
      const body = await new Response(options.body as ReadableStream).text();

      expect(body.match(/\r\n\r\nshared\r\n/gu)).toHaveLength(1);
      expect(body).toContain('filename="first.txt"');
      expect(body).toContain('filename="second.txt"');
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(target.locked).toBe(false);
    },
  );

  test('does not cache reusable duck sources that spoof native locked state', async () => {
    const acquire = vi.fn(() => ReadableStream.from(['reusable'])[Symbol.asyncIterator]());
    const source = { locked: true, [Symbol.asyncIterator]: acquire };
    const options = await multipart({
      files: [toStreamingFile(source, 'first.txt'), toStreamingFile(source, 'second.txt')],
    });
    const body = await new Response(options.body as ReadableStream).text();

    expect(body.match(/\r\n\r\nreusable\r\n/gu)).toHaveLength(2);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  test('guards hostile public lock accessors on forwarding stream proxies', async () => {
    const target = ReadableStream.from(['original']);
    const source = new Proxy(target, {
      get(stream, key) {
        if (key === 'locked') {
          throw new Error('hostile locked accessor');
        }
        const member = Reflect.get(stream, key, stream);
        return typeof member === 'function' ? member.bind(stream) : member;
      },
    });
    const options = await multipart({ upload: toStreamingFile(source, 'original.txt') });

    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain('original');
    expect(target.locked).toBe(false);
  });

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
    expect(getCleanup).toHaveBeenCalledTimes(throwing && outcome !== 'completion' ? 1 : 0);
    expect(substituted).not.toHaveBeenCalled();
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

  test('unlocks native readers when capturing read throws and cancellation rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancellation failed')));
    const source = new ReadableStream<string>({ cancel });
    Object.assign(source, {
      [Symbol.asyncIterator]: undefined,
      getReader() {
        return Object.defineProperty(ReadableStream.prototype.getReader.call(source), 'read', {
          get() {
            throw new Error('read accessor failed');
          },
        });
      },
    });
    const options = await multipart({ upload: source });

    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow('read accessor failed');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
  });

  test.each(['accessor', 'binding'] as const)(
    'releases a native reader when cancel %s throws during active cancellation',
    async (failure) => {
      const error = new Error(`cancel ${failure} failed`);
      const release = vi.fn();
      const source = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('original');
        },
      });
      Object.assign(source, {
        [Symbol.asyncIterator]: undefined,
        getReader() {
          const reader = ReadableStream.prototype.getReader.call(source);
          const releaseLock = reader.releaseLock.bind(reader);
          Object.defineProperties(reader, {
            cancel: {
              get() {
                if (failure === 'accessor') {
                  throw error;
                }
                return Object.defineProperty(() => Promise.resolve(), 'bind', {
                  get() {
                    throw error;
                  },
                });
              },
            },
            releaseLock: {
              value() {
                release();
                releaseLock();
              },
            },
          });
          return reader;
        },
      });
      const options = await multipart({ upload: toStreamingFile(source, 'original.txt') });
      const reader = (options.body as ReadableStream).getReader();
      await reader.read();
      await reader.read();
      await reader.read();

      expect(source.locked).toBe(true);
      await expect(reader.cancel()).rejects.toBe(error);
      expect(release).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    },
  );

  test.each(
    (['Blob', 'Response'] as const).flatMap((kind) =>
      (['consumption', 'cancellation', 'invalid filename'] as const).map(
        (outcome) => [kind, outcome] as const,
      ),
    ),
  )('handles rejected %s fallback reads during %s', async (kind, outcome) => {
    const error = new Error('fallback read failed');
    const read = vi.fn(async () => {
      await nextEventLoopTurn();
      throw error;
    });
    const upload =
      kind === 'Blob'
        ? Object.assign(new Blob(['fallback']), {
            name: 'fallback.bin',
            stream: undefined,
            arrayBuffer: read,
          })
        : Object.assign(new Response(null), { blob: read });
    const later = laterUpload();
    if (outcome === 'invalid filename') {
      Object.defineProperty(later, 'name', { value: undefined });
    }
    const unhandledRejection = vi.fn();
    process.once('unhandledRejection', unhandledRejection);

    try {
      const options = await multipart({ metadata: 'value', upload, later });
      if (outcome === 'consumption') {
        await expect(new Response(options.body as ReadableStream).text()).rejects.toBe(error);
      } else {
        const reader = (options.body as ReadableStream).getReader();
        if (outcome === 'cancellation') {
          await reader.read();
          await reader.cancel();
        } else {
          await expect(reader.read()).rejects.toThrow(/file.?name/iu);
        }
      }
      expect(read).toHaveBeenCalledTimes(outcome === 'consumption' || kind === 'Response' ? 1 : 0);
      await nextEventLoopTurn();
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandledRejection);
    }
  });
});
