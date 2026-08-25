import { assert, json, property } from 'fast-check';
import { vi } from 'vitest';
import { partialParse } from 'openai/internal/partial-json';

describe('partial JSON parsing', () => {
  test('matches native JSON.parse for complete JSON', () => {
    assert(
      property(json({ depthSize: 'large', noUnicodeString: false }), (input) => {
        expect(partialParse(input)).toEqual(JSON.parse(input));
      }),
    );
  });

  test.each([
    ['an incomplete object key', '{"field', {}],
    ['a missing object value', '{"field":', {}],
    ['a partially populated object', '{"field":true,"next', { field: true }],
    ['an incomplete nested object', '{"field":true,"next":{', { field: true, next: {} }],
    ['an incomplete nested array', '{"items":[{"name":"item', { items: [{ name: 'item' }] }],
    ['a trailing object comma', '{"field":true,', { field: true }],
    ['a trailing array comma', '[1,2,', [1, 2]],
    ['a completed object with a trailing comma', '{"field":true,}', { field: true }],
    ['a completed array with a trailing comma', '[1,2,]', [1, 2]],
    ['whitespace after a completed trailing comma', '[1,2, ]', [1, 2]],
    ['a nested array with a trailing comma', '{"items":[1,],"next":2}', { items: [1], next: 2 }],
    ['a nested object with a trailing comma', '[{"field":true,},2]', [{ field: true }, 2]],
    ['an incomplete root string', '"', ''],
    ['an incomplete object string', '{"field":"value', { field: 'value' }],
    ['a dangling escape', '{"field":"value\\', { field: 'value' }],
    ['a complete escaped backslash', '{"field":"value\\\\', { field: 'value\\' }],
    ['an incomplete Unicode escape', '{"field":"value\\u12', { field: 'value' }],
    ['a complete Unicode escape', '{"field":"value\\u0041', { field: 'valueA' }],
    ['a Unicode surrogate pair', '{"field":"\\uD83D\\uDE00', { field: '😀' }],
    ['a partial true literal', '{"field":t', { field: true }],
    ['a partial false literal', '{"field":fal', { field: false }],
    ['a partial null literal', '{"field":nu', { field: null }],
    ['a top-level partial boolean', 'tr', true],
    ['a top-level partial null', 'n', null],
    ['an unterminated array number', '[2,3,4', [2, 3]],
    ['an unterminated object number', '{"field":12', {}],
    ['an incomplete exponent', '[1,2e', [1]],
    ['an incomplete negative number', '[1,-', [1]],
    ['a completed object number', '{"field":12}', { field: 12 }],
    ['a completed top-level number', '-12.5e+2', -1250],
    ['surrounding JSON whitespace', '\n {"field":"value"} \t', { field: 'value' }],
  ] as const)('completes %s', (_name, input, expected) => {
    expect(partialParse(input)).toEqual(expected);
  });

  test('preserves dangerous property names as ordinary own JSON properties', () => {
    const input = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}';
    const parsed = partialParse(input);

    expect(parsed).toEqual(JSON.parse(input));
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Expected a parsed JSON object');
    }

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(parsed, '__proto__')).toEqual({
      value: { polluted: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(parsed, 'constructor')?.value).toEqual({
      prototype: { polluted: true },
    });
  });

  test('preserves safe own properties while completing incomplete JSON', () => {
    const parsed = partialParse('{"__proto__":{"polluted":true},"field":"value');

    expect(parsed).toEqual(JSON.parse('{"__proto__":{"polluted":true},"field":"value"}'));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Expected a parsed JSON object');
    }
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value).toEqual({ polluted: true });
  });

  test('repairs many nested trailing commas with linear string-copy work', () => {
    const count = 512;
    const input = `[${Array.from({ length: count }, () => '[0,]').join(',')}]`;
    const nativeSlice = String.prototype.slice;
    let copiedCharacters = 0;
    const copyString = vi.spyOn(String.prototype, 'slice').mockImplementation(function recordCopiedCharacters(
      this: string,
      start?: number,
      end?: number,
    ): string {
      const copied = nativeSlice.call(this, start, end);
      copiedCharacters += copied.length;
      return copied;
    });

    let parsed: unknown;
    try {
      parsed = partialParse(input);
    } finally {
      copyString.mockRestore();
    }

    expect(parsed).toEqual(Array.from({ length: count }, () => [0]));
    expect(copiedCharacters).toBeLessThan(input.length * 8);
  });

  test.each([
    ['an incomplete top-level negative number', '-'],
    ['an incomplete top-level decimal', '1.'],
    ['an incomplete top-level exponent', '1e+'],
    ['a non-JSON NaN value', '{"field":NaN}'],
    ['a non-JSON infinity value', '{"field":Infinity}'],
    ['trailing non-JSON content', '{} trailing'],
    ['an invalid escaped string', '{"field":"\\x"}'],
    ['a malformed object separator', '{"field" true}'],
  ] as const)('rejects %s', (_name, input) => {
    expect(() => partialParse(input)).toThrow(SyntaxError);
  });

  test('accepts every prefix of valid JSON except incomplete top-level numbers', () => {
    assert(
      property(
        json({ depthSize: 'small', noUnicodeString: false }).filter((input) => input.length <= 512),
        (input) => {
          const complete = JSON.parse(input);
          for (let index = 1; index < input.length; index += 1) {
            const prefix = input.slice(0, index);
            if (typeof complete === 'number' && /[e+.-]$/u.test(prefix)) {
              expect(() => partialParse(prefix)).toThrow(SyntaxError);
            } else {
              const parsed = partialParse(prefix);
              expect(partialParse(JSON.stringify(parsed))).toEqual(parsed);
            }
          }
        },
      ),
      { numRuns: 100, seed: 64_819 },
    );
  });
});
