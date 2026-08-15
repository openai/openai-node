import OpenAI from 'openai';
import { stringify } from 'openai/internal/qs';

describe('stringify() Unicode segment boundaries', () => {
  test.each([1022, 1023, 1024, 2046, 2047, 2048, 3071])(
    'preserves astral Unicode query values at UTF-16 offset %i',
    (offset) => {
      const value = `${'a'.repeat(offset)}😀b`;
      const query = stringify({ cursor: value });

      expect(query).toBe(`cursor=${encodeURIComponent(value)}`);
      expect(new URLSearchParams(query).get('cursor')).toBe(value);
    },
  );

  test.each([1022, 1023, 1024, 2046, 2047, 2048, 3071])(
    'preserves astral Unicode query keys at UTF-16 offset %i',
    (offset) => {
      const key = `${'a'.repeat(offset)}𐐷b`;
      const query = stringify({ [key]: 'value' });

      expect(query).toBe(`${encodeURIComponent(key)}=value`);
      expect(new URLSearchParams(query).get(key)).toBe('value');
    },
  );

  test.each(['😀', '𐐷', String.fromCodePoint(0x10_ff_ff)])(
    'preserves astral Unicode symbol %s and its following characters across a segment boundary',
    (symbol) => {
      const value = `${'a'.repeat(1023)}${symbol}b-é`;
      const query = stringify({ cursor: value });

      expect(query).toBe(`cursor=${encodeURIComponent(value)}`);
      expect(new URLSearchParams(query).get('cursor')).toBe(value);
    },
  );

  test('preserves multiple astral Unicode symbols across consecutive segment boundaries', () => {
    const value = `${'a'.repeat(1023)}😀${'b'.repeat(1023)}𐐷${'c'.repeat(1023)}🚀tail`;
    const query = stringify({ cursor: value, [value]: 'value' });
    const parameters = new URLSearchParams(query);

    expect(parameters.get('cursor')).toBe(value);
    expect(parameters.get(value)).toBe('value');
  });

  test('preserves multiple astral Unicode symbols at the original fixed segment boundaries', () => {
    const value = `${'a'.repeat(1023)}😀${'b'.repeat(1022)}𐐷${'c'.repeat(1022)}🚀tail`;
    const query = stringify({ cursor: value, [value]: 'value' });
    const parameters = new URLSearchParams(query);

    expect(parameters.get('cursor')).toBe(value);
    expect(parameters.get(value)).toBe('value');
  });

  test.each(['RFC1738', 'RFC3986'] as const)(
    'preserves astral Unicode across a segment boundary with %s formatting',
    (format) => {
      const prefix = 'a'.repeat(1023);
      const value = `${prefix}😀 b(é)`;
      const query = stringify({ cursor: value }, { format });
      const suffix = format === 'RFC1738' ? '+b(%C3%A9)' : '%20b%28%C3%A9%29';

      expect(query).toBe(`cursor=${prefix}%F0%9F%98%80${suffix}`);
      expect(new URLSearchParams(query).get('cursor')).toBe(value);
    },
  );

  test('preserves ASCII and BMP characters near a segment boundary', () => {
    const value = `${'a'.repeat(1023)}é€b`;

    expect(stringify({ cursor: value })).toBe(`cursor=${encodeURIComponent(value)}`);
  });

  test('preserves ISO-8859-1 numeric entities near a segment boundary', () => {
    const prefix = 'a'.repeat(1023);

    expect(stringify({ cursor: `${prefix}😀b` }, { charset: 'iso-8859-1' })).toBe(
      `cursor=${prefix}%26%2355357%3B%26%2356832%3Bb`,
    );
  });

  test.each([0xd8_00, 0xdc_00])('preserves lone surrogate behavior at a segment boundary: %i', (unit) => {
    const prefix = 'a'.repeat(1023);
    const value = `${prefix}${String.fromCodePoint(unit)}b`;

    expect(stringify({ cursor: value })).toBe(`cursor=${prefix}%F0%90%80%80b`);
  });

  test.each([
    [0xd8_00, '%F0%90%80%80'],
    [0xdb_ff, '%F4%8F%B0%80'],
    [0xdc_00, '%F0%90%80%80'],
    [0xdf_ff, '%F4%8F%B0%80'],
  ] as const)(
    'preserves lone surrogate behavior at later segment boundaries after an astral symbol: %i',
    (unit, encoded) => {
      const prefix = `${'a'.repeat(1023)}😀${'b'.repeat(1022)}`;
      const value = `${prefix}${String.fromCodePoint(unit)}Z`;

      expect(stringify({ cursor: value })).toBe(`cursor=${encodeURIComponent(prefix)}${encoded}Z`);
    },
  );

  test('preserves astral Unicode pagination cursors in public files.list requests', async () => {
    const expected = `${'a'.repeat(1023)}😀b`;
    let requestURL: URL | undefined;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async (url) => {
        requestURL = new URL(url.toString());
        return Response.json({ object: 'list', data: [], has_more: false });
      },
    });

    await client.files.list({ after: expected });

    expect(requestURL?.searchParams.get('after')).toBe(expected);
  });
});
