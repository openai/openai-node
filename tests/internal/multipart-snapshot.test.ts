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
    'reuses shared native streams only when the %s proves native lock ownership',
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
      if (kind === 'locked reader') {
        const body = await new Response(options.body as ReadableStream).text();
        expect(body.match(/\r\n\r\nshared\r\n/gu)).toHaveLength(1);
        expect(body).toContain('filename="second.txt"');
      } else {
        await expect(new Response(options.body as ReadableStream).text()).rejects.toThrow(/reus|repeat/iu);
      }
      expect(acquire.mock.contexts).toEqual([source]);
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

  test.each(['plain', 'native prototype', 'inherited lock'] as const)(
    'rejects repeated %s sources that spoof native locked state before emission',
    async (kind) => {
      let locked = false;
      const acquire = vi.fn(() => {
        locked = true;
        return ReadableStream.from(['reusable'])[Symbol.asyncIterator]();
      });
      const source = { locked: true, [Symbol.asyncIterator]: acquire };
      if (kind !== 'plain') {
        const prototype =
          kind === 'inherited lock'
            ? Object.create(ReadableStream.prototype, { locked: { get: () => locked } })
            : ReadableStream.prototype;
        if (kind === 'inherited lock') {
          Reflect.deleteProperty(source, 'locked');
        }
        Object.setPrototypeOf(source, prototype);
        expect(source).toBeInstanceOf(ReadableStream);
      }
      const options = await multipart({
        files: [toStreamingFile(source, 'first.txt'), toStreamingFile(source, 'second.txt')],
      });
      await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/reus|repeat/iu);
      expect(acquire).toHaveBeenCalledTimes(1);
    },
  );

  test('rejects repeated mutable sources before emission or overlapping iterator lifetimes', async () => {
    let active = false;
    const next = vi.fn();
    const close = vi.fn(() => {
      active = false;
      return Promise.resolve({ done: true as const, value: undefined });
    });
    const factory = vi.fn(function factory(this: { currentBytes: string }) {
      if (active) {
        throw new Error('Overlapping iterator lifetime');
      }
      active = true;
      next.mockResolvedValue({ done: false, value: this.currentBytes });
      return { next, return: close };
    });
    const source = { currentBytes: 'original', [Symbol.asyncIterator]: factory };
    const replacement = vi.fn();
    const later = laterUpload();
    Object.defineProperty(later, 'name', {
      get() {
        source.currentBytes = 'attacker';
        source[Symbol.asyncIterator] = replacement;
        Object.defineProperty(factory, 'call', { value: replacement });
        return 'later.txt';
      },
    });
    const options = await multipart({
      first: toStreamingFile(source, 'first.txt'),
      later,
      second: toStreamingFile(source, 'second.txt'),
    });

    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/reus|repeat/iu);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    expect(source.currentBytes).toBe('attacker');
    expect(active).toBe(false);
  });

  test.each(['validation', 'cancellation'] as const)(
    'never acquires deferred shared resources during %s cleanup',
    async (outcome) => {
      const source = ReadableStream.from(['original']);
      const createIterator = source[Symbol.asyncIterator];
      const acquire = vi.fn(() => Reflect.apply(createIterator, source, []));
      Object.defineProperty(source, Symbol.asyncIterator, { value: acquire });
      const later = laterUpload();
      if (outcome === 'validation') {
        Object.defineProperty(later, 'name', { value: null });
      }
      const options = await multipart({
        files: [toStreamingFile(source, 'first.txt'), toStreamingFile(source, 'second.txt')],
        later,
      });
      const reader = (options.body as ReadableStream).getReader();
      if (outcome === 'validation') {
        await expect(reader.read()).rejects.toThrow(/file.?name/iu);
      } else {
        await reader.read();
        await reader.cancel();
      }

      expect(acquire).toHaveBeenCalledTimes(1);
      expect(source.locked).toBe(false);
    },
  );

  test.each(['iterator', 'reader', 'hybrid'] as const)(
    'invokes captured %s chunk methods without trusting their mutable call property',
    async (kind) => {
      const original = vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'authoritative' })
        .mockResolvedValue({ done: true });
      const replacement = vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'attacker' })
        .mockResolvedValue({ done: true });
      const receiver = {
        next: original,
        read: original,
        cancel: vi.fn().mockResolvedValue(null),
        releaseLock: vi.fn(),
      };
      const getReader = vi.fn(() => (kind === 'hybrid' ? { ...receiver, read: replacement } : receiver));
      const source =
        kind === 'reader'
          ? { getReader }
          : { [Symbol.asyncIterator]: () => receiver, ...(kind === 'hybrid' ? { getReader } : {}) };
      const later = laterUpload();
      Object.defineProperty(later, 'name', {
        get() {
          Object.defineProperty(original, 'call', { value: replacement });
          return 'later.txt';
        },
      });
      const options = await multipart({ upload: source, later });
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain('authoritative');
      expect(body).not.toContain('attacker');
      expect(original.mock.contexts).toEqual([receiver, receiver]);
      expect(replacement).not.toHaveBeenCalled();
      expect(getReader).toHaveBeenCalledTimes(kind === 'reader' ? 1 : 0);
    },
  );

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
