import { vi } from 'vitest';
import { findDoubleNewlineIndex, LineDecoder } from 'openai/internal/decoders/line';

const MAX_RETAINED_BYTES = 64 * 1024;

interface BufferOperations {
  copied: number;
  compacted: number;
  writes: { source: ArrayLike<number>; target: Uint8Array }[];
}

function inspectBuffers(check: (operations: BufferOperations) => void): void {
  const operations: BufferOperations = { copied: 0, compacted: 0, writes: [] };
  const nativeSet = Uint8Array.prototype.set;
  const nativeCopyWithin = Uint8Array.prototype.copyWithin;
  const setSpy = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function recordCopy(
    this: Uint8Array,
    source: ArrayLike<number>,
    offset?: number,
  ) {
    operations.copied += source.length;
    operations.writes.push({ source, target: this });
    nativeSet.call(this, source, offset);
  });
  const compactSpy = vi
    .spyOn(Uint8Array.prototype, 'copyWithin')
    .mockImplementation(function recordCompaction(
      this: Uint8Array,
      target: number,
      start: number,
      end?: number,
    ) {
      operations.compacted += 1;
      operations.copied += (end ?? this.length) - start;
      return nativeCopyWithin.call(this, target, start, end);
    });

  try {
    check(operations);
  } finally {
    compactSpy.mockRestore();
    setSpy.mockRestore();
  }
}

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

  test('copies and scans fragmented oversized lines in linear time', () => {
    const count = 96 * 1024;
    const NativeUint8Array = Uint8Array;
    const fragment = new NativeUint8Array([0x61]);
    let scanned = 0;

    inspectBuffers((operations) => {
      const constructorSpy = vi.spyOn(globalThis, 'Uint8Array').mockImplementation(function trackBuffer(
        ...args: unknown[]
      ) {
        const buffer = Reflect.construct(NativeUint8Array, args) as Uint8Array;
        return new Proxy(buffer, {
          get(target, property) {
            if (typeof property === 'string' && /^\d+$/u.test(property)) {
              scanned += 1;
              if (scanned > count * 4) {
                throw new Error('LineDecoder rescanned buffered bytes');
              }
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      } as unknown as typeof Uint8Array);

      try {
        const decoder = new LineDecoder();
        for (let index = 0; index < count; index += 1) {
          decoder.decode(fragment);
        }
        expect(scanned).toBeGreaterThan(0);
        expect(operations.copied).toBeLessThanOrEqual(count * 4);
        expect(decoder.flush()).toEqual(['a'.repeat(count)]);
      } finally {
        constructorSpy.mockRestore();
      }
    });
  });

  test.each([
    [0, 256, 0],
    [1, 256, 1],
    [MAX_RETAINED_BYTES - 1, MAX_RETAINED_BYTES, 1],
    [MAX_RETAINED_BYTES, MAX_RETAINED_BYTES, 1],
    [MAX_RETAINED_BYTES + 1, (MAX_RETAINED_BYTES + 1) * 2, 1],
    [MAX_RETAINED_BYTES * 2 - 1, (MAX_RETAINED_BYTES * 2 - 1) * 2, 1],
    [MAX_RETAINED_BYTES * 2, MAX_RETAINED_BYTES * 8, 0],
  ])('bounds oversized allocations with a %i-byte live suffix', (length, capacity, resizeCount) => {
    const line = new Uint8Array(MAX_RETAINED_BYTES * 4).fill(0x61);
    const suffix = new Uint8Array(length + 1).fill(0x62);
    const probe = new Uint8Array([0x63]);
    suffix[0] = 0x0a;
    const decoder = new LineDecoder();

    inspectBuffers(({ writes }) => {
      expect(decoder.decode(line)).toEqual([]);
      expect(decoder.decode(suffix)).toEqual(['a'.repeat(line.length)]);
      const resized = writes.filter(
        ({ source, target }) => source instanceof Uint8Array && source.buffer.byteLength > target.byteLength,
      );
      expect(resized).toHaveLength(resizeCount);
      if (length === 0) {
        expect(decoder.decode(probe)).toEqual([]);
      }
      const retained =
        resized[0]?.target ?? writes.find(({ source }) => source === (length ? suffix : probe))?.target;
      expect(retained?.byteLength).toBe(capacity);
      expect(decoder.flush()).toEqual([length ? 'b'.repeat(length) : 'c']);
    });
  });

  test.each([1, MAX_RETAINED_BYTES + 17])('reuses buffers with %i-byte live suffixes', (length) => {
    const suffix = new Uint8Array(length).fill(0x62);
    const cycle = new Uint8Array(length + 3);
    cycle.set([0x0a, 0x78, 0x0a]);
    cycle.set(suffix, 3);
    const oversized = length > MAX_RETAINED_BYTES;
    const prefix = oversized ? new Uint8Array(MAX_RETAINED_BYTES * 4).fill(0x61) : suffix;
    const decoder = new LineDecoder();

    inspectBuffers((operations) => {
      expect(decoder.decode(prefix)).toEqual([]);
      if (oversized) {
        expect(decoder.decode(cycle.subarray(2))).toEqual(['a'.repeat(prefix.length)]);
      }
      const initialCopies = operations.copied;
      for (let index = 0; index < 5; index += 1) {
        expect(decoder.decode(cycle)).toEqual(['b'.repeat(length), 'x']);
      }
      const buffers = new Set(
        operations.writes.filter(({ source }) => source === cycle).map(({ target }) => target),
      );
      expect(buffers.size).toBe(1);
      expect(operations.copied - initialCopies).toBeLessThanOrEqual(cycle.length * 20);
      if (oversized) {
        expect(operations.compacted).toBeGreaterThan(0);
        expect([...buffers][0]?.byteLength).toBe(length * 4);
      }

      expect(decoder.decode(new Uint8Array([0xf0, 0x9f]))).toEqual([]);
      expect(decoder.decode(new Uint8Array([0x92, 0x99, 0x0d]))).toEqual([`${'b'.repeat(length)}💙`]);
      expect(decoder.decode('\nnext\n')).toEqual(['next']);
      expect(decoder.flush()).toEqual([]);
    });
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
