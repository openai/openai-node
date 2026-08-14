import { vi } from 'vitest';
import { Stream } from 'openai/core/streaming';
import { findDoubleNewlineIndex, LineDecoder } from 'openai/internal/decoders/line';
import { ReadableStreamFrom } from 'openai/internal/shims';

function decodeChunks(chunks: string[], options?: { flush: boolean }): string[] {
  const flush = options?.flush ?? false;
  const decoder = new LineDecoder();
  const lines: string[] = [];
  for (const chunk of chunks) {
    lines.push(...decoder.decode(chunk));
  }

  if (flush) {
    lines.push(...decoder.flush());
  }

  return lines;
}

describe('line decoder', () => {
  test('basic', () => {
    // baz is not included because the line hasn't ended yet
    expect(decodeChunks(['foo', ' bar\nbaz'])).toEqual(['foo bar']);
  });

  test('basic with \\r', () => {
    expect(decodeChunks(['foo', ' bar\r\nbaz'])).toEqual(['foo bar']);
    expect(decodeChunks(['foo', ' bar\r\nbaz'], { flush: true })).toEqual(['foo bar', 'baz']);
  });

  test('trailing new lines', () => {
    expect(decodeChunks(['foo', ' bar', 'baz\n', 'thing\n'])).toEqual(['foo barbaz', 'thing']);
  });

  test('trailing new lines with \\r', () => {
    expect(decodeChunks(['foo', ' bar', 'baz\r\n', 'thing\r\n'])).toEqual(['foo barbaz', 'thing']);
  });

  test('escaped new lines', () => {
    expect(decodeChunks(['foo', ' bar\\nbaz\n'])).toEqual(['foo bar\\nbaz']);
  });

  test('escaped new lines with \\r', () => {
    expect(decodeChunks(['foo', ' bar\\r\\nbaz\n'])).toEqual(['foo bar\\r\\nbaz']);
  });

  test('\\r & \\n split across multiple chunks', () => {
    expect(decodeChunks(['foo\r', '\n', 'bar'], { flush: true })).toEqual(['foo', 'bar']);
  });

  test('emits a trailing carriage return immediately and consumes its optional following newline', () => {
    const decoder = new LineDecoder();

    expect(decoder.decode('foo\r')).toEqual(['foo']);
    expect(decoder.decode(null)).toEqual([]);
    expect(decoder.decode('')).toEqual([]);
    expect(decoder.decode('\nbar\r')).toEqual(['bar']);
    expect(decoder.decode('\n')).toEqual([]);
    expect(decoder.flush()).toEqual([]);
  });

  test('preserves a real empty line after a fragmented carriage-return line ending', () => {
    expect(decodeChunks(['foo\r', '\n\n', 'bar\n'])).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo\r', '\n', '\nbar\n'])).toEqual(['foo', '', 'bar']);
  });

  test('single \\r', () => {
    expect(decodeChunks(['foo\r', 'bar'], { flush: true })).toEqual(['foo', 'bar']);
  });

  test('double \\r', () => {
    expect(decodeChunks(['foo\r', 'bar\r'], { flush: true })).toEqual(['foo', 'bar']);
    expect(decodeChunks(['foo\r', '\r', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo\r', '\r', 'bar'], { flush: false })).toEqual(['foo', '']);
  });

  test('double \\r then \\r\\n', () => {
    expect(decodeChunks(['foo\r', '\r', '\r', '\n', 'bar', '\n'])).toEqual(['foo', '', '', 'bar']);
    expect(decodeChunks(['foo\n', '\n', '\n', 'bar', '\n'])).toEqual(['foo', '', '', 'bar']);
  });

  test('double newline', () => {
    expect(decodeChunks(['foo\n\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo', '\n', '\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo\n', '\n', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo', '\n', '\n', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
  });

  test('multi-byte characters across chunks', () => {
    const decoder = new LineDecoder();

    // bytes taken from the string 'известни' and arbitrarily split
    // so that some multi-byte characters span multiple chunks
    expect(decoder.decode(new Uint8Array([0xd0]))).toHaveLength(0);
    expect(decoder.decode(new Uint8Array([0xb8, 0xd0, 0xb7, 0xd0]))).toHaveLength(0);
    expect(
      decoder.decode(new Uint8Array([0xb2, 0xd0, 0xb5, 0xd1, 0x81, 0xd1, 0x82, 0xd0, 0xbd, 0xd0, 0xb8])),
    ).toHaveLength(0);

    const decoded = decoder.decode(new Uint8Array([0xa]));
    expect(decoded).toEqual(['известни']);
  });

  test('copies a linear number of bytes for a line fragmented into single bytes', () => {
    const fragmentCount = 16 * 1024;
    const fragment = new Uint8Array([0x61]);
    const decoder = new LineDecoder();
    const originalSet = Uint8Array.prototype.set;
    let copiedBytes = 0;

    const setSpy = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function countCopiedBytes(
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ) {
      copiedBytes += source.length;
      originalSet.call(this, source, offset);
    });

    try {
      for (let index = 0; index < fragmentCount; index += 1) {
        decoder.decode(fragment);
      }

      expect(copiedBytes).toBeLessThanOrEqual(fragmentCount * 4);
    } finally {
      setSpy.mockRestore();
    }

    expect(decoder.flush()).toEqual(['a'.repeat(fragmentCount)]);
  });

  test('releases oversized backing buffers after completing a line', () => {
    const maximumRetainedBytes = 64 * 1024;
    const oversizedLine = new Uint8Array(maximumRetainedBytes * 4).fill(0x61);
    const newline = new Uint8Array([0x0a]);
    const smallLine = new Uint8Array([0x62, 0x0a]);
    const decoder = new LineDecoder();
    const originalSet = Uint8Array.prototype.set;
    let highWaterCapacity = 0;
    let retainedCapacity = 0;

    const setSpy = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function recordBackingCapacity(
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ) {
      if (source === oversizedLine || source === newline) {
        highWaterCapacity = Math.max(highWaterCapacity, this.buffer.byteLength);
      } else if (source === smallLine) {
        retainedCapacity = this.buffer.byteLength;
      }
      originalSet.call(this, source, offset);
    });

    try {
      expect(decoder.decode(oversizedLine)).toEqual([]);
      expect(decoder.decode(newline)).toEqual(['a'.repeat(oversizedLine.length)]);
      expect(decoder.decode(smallLine)).toEqual(['b']);

      expect(highWaterCapacity).toBeGreaterThan(maximumRetainedBytes);
      expect(retainedCapacity).toBeGreaterThan(0);
      expect(retainedCapacity).toBeLessThanOrEqual(maximumRetainedBytes);
    } finally {
      setSpy.mockRestore();
    }
  });

  test('only scans newly appended bytes while a fragmented line remains unfinished', () => {
    const fragmentCount = 2048;
    const maximumScannedBytes = fragmentCount * 4;
    const NativeUint8Array = Uint8Array;
    const fragment = new NativeUint8Array([0x61]);
    const trackedBuffers = new WeakMap<Uint8Array, Uint8Array>();
    let scannedBytes = 0;

    const trackBuffer = (buffer: Uint8Array): Uint8Array => {
      const proxy = new Proxy(buffer, {
        get(target, property) {
          if (typeof property === 'string') {
            const firstCharacter = property.codePointAt(0) ?? 0;
            if (firstCharacter >= 48 && firstCharacter <= 57) {
              scannedBytes += 1;
              if (scannedBytes > maximumScannedBytes) {
                throw new Error(`LineDecoder rescanned more than ${maximumScannedBytes} bytes`);
              }
            }
          }

          if (property === 'set') {
            return (source: ArrayLike<number>, offset?: number) => {
              target.set(trackedBuffers.get(source as Uint8Array) ?? source, offset);
            };
          }

          if (property === 'subarray') {
            return (start?: number, end?: number) => trackBuffer(target.subarray(start, end));
          }

          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      trackedBuffers.set(proxy, buffer);
      return proxy;
    };

    const constructorSpy = vi
      .spyOn(globalThis, 'Uint8Array')
      .mockImplementation(function createTrackedUint8Array(...args: unknown[]) {
        return trackBuffer(Reflect.construct(NativeUint8Array, args) as Uint8Array);
      } as unknown as typeof Uint8Array);

    try {
      const decoder = new LineDecoder();
      for (let index = 0; index < fragmentCount; index += 1) {
        decoder.decode(fragment);
      }

      expect(scannedBytes).toBeGreaterThan(0);
      expect(scannedBytes).toBeLessThanOrEqual(maximumScannedBytes);
    } finally {
      constructorSpy.mockRestore();
    }
  });

  test('preserves partial UTF-8 characters and split line endings when consumed bytes are compacted', () => {
    const decoder = new LineDecoder();
    const consumedLine = 'a'.repeat(4096);
    const pendingPrefix = 'b'.repeat(2048);
    const pendingSuffix = 'c'.repeat(4096);
    const trailingBytes = new TextEncoder().encode(`💙${pendingSuffix}\r`);

    expect(decoder.decode(`${consumedLine}\n${pendingPrefix}`)).toEqual([consumedLine]);
    expect(decoder.decode(trailingBytes.subarray(0, 2))).toEqual([]);

    const remainingBytes = new ArrayBuffer(trailingBytes.length - 2);
    new Uint8Array(remainingBytes).set(trailingBytes.subarray(2));
    expect(decoder.decode(remainingBytes)).toEqual([`${pendingPrefix}💙${pendingSuffix}`]);

    expect(decoder.decode(null)).toEqual([]);
    const absentChunks: string[] = [];
    expect(decoder.decode(absentChunks[0])).toEqual([]);
    expect(decoder.decode(new Uint8Array())).toEqual([]);
    expect(decoder.decode('\nnext\r')).toEqual(['next']);
    expect(decoder.decode(new Uint8Array([0x0a, 0x0a]))).toEqual(['']);
    expect(decoder.flush()).toEqual([]);
  });

  test('decodes public newline-delimited streams fragmented into individual bytes', async () => {
    const expected = [{ content: `${'a'.repeat(1024)}💙` }, { content: 'final unterminated line' }];
    const encoded = new TextEncoder().encode(
      `${JSON.stringify(expected[0])}\r\n${JSON.stringify(expected[1])}`,
    );
    const fragments = Array.from(encoded, (byte) => new Uint8Array([byte]));
    const stream = Stream.fromReadableStream<{ content: string }>(
      ReadableStreamFrom(fragments),
      new AbortController(),
    );
    const actual: { content: string }[] = [];

    for await (const item of stream) {
      actual.push(item);
    }

    expect(actual).toEqual(expected);
  });

  test('flushing trailing newlines', () => {
    expect(decodeChunks(['foo\n', '\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
  });

  test('flushing empty buffer', () => {
    expect(decodeChunks([], { flush: true })).toEqual([]);
  });
});

describe('findDoubleNewlineIndex', () => {
  test('finds \\n\\n', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\n\nbar'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\n\nbar'))).toBe(2);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\n\n'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\n\n'))).toBe(2);
  });

  test('finds \\r\\r', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\rbar'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\rbar'))).toBe(2);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\r'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\r'))).toBe(2);
  });

  test('finds \\r\\n\\r\\n', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r\nbar'))).toBe(7);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\n\r\nbar'))).toBe(4);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r\n'))).toBe(7);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\n\r\n'))).toBe(4);
  });

  test.each([
    ['\\n', '\n'],
    ['\\r', '\r'],
    ['\\r\\n', '\r\n'],
  ])('finds every second line ending after %s', (_description, firstEnding) => {
    for (const secondEnding of ['\n', '\r', '\r\n']) {
      if (firstEnding === '\r' && secondEnding === '\n') {
        continue;
      }

      const delimiter = firstEnding + secondEnding;
      const input = `foo${delimiter}bar`;

      expect(findDoubleNewlineIndex(new TextEncoder().encode(input))).toBe(3 + delimiter.length);
    }
  });

  test('returns -1 when no double newline found', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\nbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\rbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\nbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode(''))).toBe(-1);
  });

  test('recognizes standalone carriage returns at the end of a complete delimiter', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r'))).toBe(6);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\n\r'))).toBe(5);
  });

  test('handles incomplete patterns', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\nbar'))).toBe(-1);
  });
});
