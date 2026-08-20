import { LineDecoder } from 'openai/internal/decoders/line';

const encoder = new TextEncoder();
const MiB = 1024 * 1024;

describe('large incremental lines', () => {
  test.each(['bytes', 'array-buffer', 'text'] as const)('accepts a large %s line', (kind) => {
    const text = `${'x'.repeat(8 * MiB + 1)}😀é`;
    const bytes = encoder.encode(`${text}\r\n`);
    let chunk: string | ArrayBuffer | Uint8Array = bytes;
    if (kind === 'text') {
      chunk = `${text}\r\n`;
    } else if (kind === 'array-buffer') {
      chunk = bytes.buffer;
    }
    expect(new LineDecoder().decode(chunk)).toEqual([text]);
  });

  test('accepts a large fragmented, unterminated line', () => {
    const decoder = new LineDecoder();
    const chunk = new Uint8Array(MiB).fill(0x61);
    for (let index = 0; index < 9; index += 1) {
      expect(decoder.decode(chunk)).toEqual([]);
    }
    const lines = decoder.flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBe(9 * MiB);
    expect(decoder.flush()).toEqual([]);
  });

  test('preserves fragmented UTF-8 and CRLF after a large line', () => {
    const decoder = new LineDecoder();
    expect(decoder.decode('x'.repeat(8 * MiB + 1))).toEqual([]);
    expect(decoder.decode(Uint8Array.of(0xf0, 0x9f))).toEqual([]);
    const lines = decoder.decode(Uint8Array.of(0x98, 0x80, 0x0d));
    expect(lines[0]?.endsWith('😀')).toBe(true);
    expect(decoder.decode('\nnext\r')).toEqual(['next']);
    expect(decoder.decode('\n')).toEqual([]);
    expect(decoder.flush()).toEqual([]);
  });
});
