import { vi } from 'vitest';

import { Stream } from 'openai/core/streaming';
import { LineDecoder } from 'openai/internal/decoders/line';
import * as bytes from 'openai/internal/utils/bytes';

const originalLineLimit = process.env['OPENAI_MAX_NDJSON_LINE_BYTES'];

afterEach(() => {
  if (originalLineLimit === undefined) {
    delete process.env['OPENAI_MAX_NDJSON_LINE_BYTES'];
  } else {
    process.env['OPENAI_MAX_NDJSON_LINE_BYTES'] = originalLineLimit;
  }
  vi.restoreAllMocks();
});

describe('bounded incremental line decoding', () => {
  test('rejects one oversized byte chunk before allocating, compacting, or copying it', () => {
    const decoder = new LineDecoder({ maxLineBytes: 16 });
    const oversized = new Uint8Array(17).fill(0x61);
    const NativeUint8Array = Uint8Array;
    const copies = vi.spyOn(NativeUint8Array.prototype, 'set');
    const compactions = vi.spyOn(NativeUint8Array.prototype, 'copyWithin');
    const allocations = vi.spyOn(globalThis, 'Uint8Array').mockImplementation(function trackAllocation(
      ...args: unknown[]
    ) {
      return Reflect.construct(NativeUint8Array, args) as Uint8Array;
    } as unknown as typeof Uint8Array);

    expect(() => decoder.decode(oversized)).toThrow(/line.*16.*bytes/iu);
    expect(allocations).not.toHaveBeenCalled();
    expect(copies).not.toHaveBeenCalled();
    expect(compactions).not.toHaveBeenCalled();
  });

  test('rejects an oversized ArrayBuffer without copying its contents', () => {
    const decoder = new LineDecoder({ maxLineBytes: 8 });
    const oversized = new Uint8Array(9).fill(0x61).buffer;
    const copies = vi.spyOn(Uint8Array.prototype, 'set');

    expect(() => decoder.decode(oversized)).toThrow(/line.*8.*bytes/iu);
    expect(copies).not.toHaveBeenCalled();
  });

  test('rejects an oversized text chunk before allocating its UTF-8 representation', () => {
    const decoder = new LineDecoder({ maxLineBytes: 8 });
    const encode = vi.spyOn(bytes, 'encodeUTF8');

    expect(() => decoder.decode('a'.repeat(9))).toThrow(/line.*8.*bytes/iu);
    expect(encode).not.toHaveBeenCalled();
  });

  test('rejects a line assembled from many one-byte chunks before the overflowing copy', () => {
    const decoder = new LineDecoder({ maxLineBytes: 16 });
    const chunk = Uint8Array.of(0x61);

    for (let index = 0; index < 16; index += 1) {
      expect(decoder.decode(chunk)).toEqual([]);
    }

    const copies = vi.spyOn(Uint8Array.prototype, 'set');
    const compactions = vi.spyOn(Uint8Array.prototype, 'copyWithin');

    expect(() => decoder.decode(chunk)).toThrow(/line.*16.*bytes/iu);
    expect(copies).not.toHaveBeenCalled();
    expect(compactions).not.toHaveBeenCalled();
  });

  test('rejects a line assembled from many tiny string chunks before UTF-8 encoding', () => {
    const decoder = new LineDecoder({ maxLineBytes: 4 });

    expect(decoder.decode('ab')).toEqual([]);
    expect(decoder.decode('cd')).toEqual([]);

    const encode = vi.spyOn(bytes, 'encodeUTF8');
    expect(() => decoder.decode('e')).toThrow(/line.*4.*bytes/iu);
    expect(encode).not.toHaveBeenCalled();
  });

  test('counts UTF-8 bytes, including surrogate pairs and incomplete byte fragments', () => {
    const decoder = new LineDecoder({ maxLineBytes: 4 });

    expect(decoder.decode('💙')).toEqual([]);
    expect(() => decoder.decode('é')).toThrow(/line.*4.*bytes/iu);
    expect(decoder.flush()).toEqual(['💙']);

    const fragments = new LineDecoder({ maxLineBytes: 4 });
    expect(fragments.decode(Uint8Array.of(0xf0, 0x9f))).toEqual([]);
    expect(fragments.decode(Uint8Array.of(0x92, 0x99))).toEqual([]);
    expect(fragments.decode('\n')).toEqual(['💙']);
  });

  test('accepts exactly the configured payload limit with CRLF and unterminated lines', () => {
    const terminated = new LineDecoder({ maxLineBytes: 4 });
    expect(terminated.decode('abcd\r\n')).toEqual(['abcd']);

    const unterminated = new LineDecoder({ maxLineBytes: 4 });
    expect(unterminated.decode('abcd')).toEqual([]);
    expect(unterminated.flush()).toEqual(['abcd']);
  });

  test('accepts large byte chunks containing only short lines without oversized backing allocations', () => {
    const decoder = new LineDecoder({ maxLineBytes: 4 });
    const chunk = new TextEncoder().encode('abcd\n'.repeat(20));
    const NativeUint8Array = Uint8Array;
    const allocations = vi.spyOn(globalThis, 'Uint8Array').mockImplementation(function trackAllocation(
      ...args: unknown[]
    ) {
      return Reflect.construct(NativeUint8Array, args) as Uint8Array;
    } as unknown as typeof Uint8Array);

    expect(decoder.decode(chunk)).toEqual(Array.from({ length: 20 }, () => 'abcd'));
    expect(allocations).toHaveBeenCalled();
    expect(
      allocations.mock.calls.every((args) => {
        const [length] = args as unknown[];
        return typeof length !== 'number' || length <= 6;
      }),
    ).toBe(true);
  });

  test('encodes large text chunks containing short lines in independently bounded pieces', () => {
    const decoder = new LineDecoder({ maxLineBytes: 4 });
    const encode = vi.spyOn(bytes, 'encodeUTF8');

    expect(decoder.decode('éé\r\n'.repeat(20))).toEqual(Array.from({ length: 20 }, () => 'éé'));
    expect(encode.mock.calls.length).toBeGreaterThan(1);
    expect(encode.mock.calls.every(([chunk]) => new TextEncoder().encode(chunk).length <= 6)).toBe(true);
  });

  test('preserves CRLF continuations across internally segmented oversized chunks', () => {
    const decoder = new LineDecoder({ maxLineBytes: 1 });

    expect(decoder.decode('a\r\na\r\na\r\n')).toEqual(['a', 'a', 'a']);
    expect(decoder.flush()).toEqual([]);
  });

  test('reads the NDJSON-specific environment limit and lets explicit limits override it', () => {
    process.env['OPENAI_MAX_NDJSON_LINE_BYTES'] = '3';

    expect(() => new LineDecoder().decode('four')).toThrow(/line.*3.*bytes/iu);
    expect(new LineDecoder({ maxLineBytes: 4 }).decode('four\n')).toEqual(['four']);
  });

  test('rejects invalid explicit line limits', () => {
    for (const maxLineBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new LineDecoder({ maxLineBytes })).toThrow(RangeError);
    }
  });

  test('uses a conservative 8 MiB default when no override is configured', () => {
    delete process.env['OPENAI_MAX_NDJSON_LINE_BYTES'];
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1).fill(0x61);
    const copies = vi.spyOn(Uint8Array.prototype, 'set');

    expect(() => new LineDecoder().decode(oversized)).toThrow(/line.*8388608.*bytes/iu);
    expect(copies).not.toHaveBeenCalled();
  });
});

describe('newline-delimited stream cleanup after a line exceeds its limit', () => {
  test.each([
    {
      description: 'one oversized chunk',
      chunks: [new Uint8Array(17).fill(0x61)],
    },
    {
      description: 'many tiny chunks',
      chunks: Array.from({ length: 17 }, () => Uint8Array.of(0x61)),
    },
  ])('cancels and aborts the upstream reader for $description', async ({ chunks }) => {
    process.env['OPENAI_MAX_NDJSON_LINE_BYTES'] = '16';
    const pending = [...chunks];
    const reader = {
      read: vi.fn(async () => {
        const value = pending.shift();
        return value ? { done: false, value } : { done: true };
      }),
      cancel: vi.fn().mockResolvedValue(null),
      releaseLock: vi.fn(),
    };
    const controller = new AbortController();
    const stream = Stream.fromReadableStream({ getReader: () => reader } as any, controller);

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(/line.*16.*bytes/iu);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
  });
});
