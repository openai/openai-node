import { vi } from 'vitest';

import { OpenAIError } from 'openai/core/error';
import { buildHeaders } from 'openai/internal/headers';
import { FallbackEncoder } from 'openai/internal/request-options';
import { concatBytes, decodeUTF8, encodeUTF8 } from 'openai/internal/utils/bytes';
import { readEnv } from 'openai/internal/utils/env';
import { stringifyQuery } from 'openai/internal/utils/query';
import { sleep } from 'openai/internal/utils/sleep';
import { uuid4 } from 'openai/internal/utils/uuid';
import {
  coerceBoolean,
  coerceFloat,
  coerceInteger,
  ensurePresent,
  hasOwn,
  isAbsoluteURL,
  isArray,
  isEmptyObj,
  isObj,
  isReadonlyArray,
  maybeCoerceBoolean,
  maybeCoerceFloat,
  maybeCoerceInteger,
  maybeObj,
  safeJSON,
  validatePositiveInteger,
} from 'openai/internal/utils/values';

describe('byte utilities', () => {
  test('concatenates empty and populated byte arrays without mutating inputs', () => {
    const first = new Uint8Array([1, 2]);
    const second = new Uint8Array([3]);

    expect(concatBytes([])).toEqual(new Uint8Array());
    expect(concatBytes([first, new Uint8Array(), second])).toEqual(new Uint8Array([1, 2, 3]));
    expect(first).toEqual(new Uint8Array([1, 2]));
    expect(second).toEqual(new Uint8Array([3]));
  });

  test('round-trips multibyte UTF-8 and reuses cached encoders', () => {
    const value = 'OpenAI ✓ 🌍';

    expect(decodeUTF8(encodeUTF8(value))).toBe(value);
    expect(decodeUTF8(encodeUTF8('second call'))).toBe('second call');
  });
});

describe('environment and request utilities', () => {
  const environmentVariable = 'OPENAI_NODE_UNIT_TEST_ENV';

  afterEach(() => {
    delete process.env[environmentVariable];
  });

  test('trims environment variables and treats empty or missing values as absent', () => {
    process.env[environmentVariable] = '  value  ';
    expect(readEnv(environmentVariable)).toBe('value');

    process.env[environmentVariable] = '   ';
    expect(readEnv(environmentVariable)).toBeUndefined();

    delete process.env[environmentVariable];
    expect(readEnv(environmentVariable)).toBeUndefined();
  });

  test('encodes array query parameters using bracket notation', () => {
    expect(stringifyQuery({ item: ['first', 'second'], limit: 2 })).toBe(
      'item%5B%5D=first&item%5B%5D=second&limit=2',
    );
  });

  test('encodes fallback request bodies as JSON', () => {
    expect(FallbackEncoder({ headers: buildHeaders([]), body: { enabled: true } })).toEqual({
      bodyHeaders: { 'content-type': 'application/json' },
      body: '{"enabled":true}',
    });
  });

  test('generates RFC 4122 version 4 UUIDs', () => {
    expect(uuid4()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  });

  test('resolves after the requested timeout', async () => {
    vi.useFakeTimers();

    try {
      const completed = vi.fn();
      const pending = sleep(25).then(completed);

      vi.advanceTimersByTime(24);
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await pending;
      expect(completed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('value utilities', () => {
  test.each([
    ['https://example.com', true],
    ['CUSTOM+scheme:value', true],
    ['/relative/path', false],
    ['//example.com/path', false],
  ])('detects whether %s has an absolute URL scheme', (value, expected) => {
    expect(isAbsoluteURL(value)).toBe(expected);
  });

  test('recognizes mutable and readonly arrays', () => {
    expect(isArray([])).toBe(true);
    expect(isArray({ length: 0 })).toBe(false);
    expect(isReadonlyArray(Object.freeze(['item']))).toBe(true);
    expect(isReadonlyArray('item')).toBe(false);
  });

  test('normalizes non-objects while preserving objects and arrays', () => {
    const object = { value: true };
    const array: string[] = [];

    expect(maybeObj(object)).toBe(object);
    expect(maybeObj(array)).toBe(array);
    expect(maybeObj(null)).toEqual({});
    expect(maybeObj(undefined)).toEqual({});
    expect(maybeObj('value')).toEqual({});
  });

  test('detects inherited enumerable properties when checking emptiness', () => {
    expect(isEmptyObj(null)).toBe(true);
    expect(isEmptyObj(undefined)).toBe(true);
    expect(isEmptyObj({})).toBe(true);
    expect(isEmptyObj({ value: undefined })).toBe(false);
    expect(isEmptyObj(Object.create({ inherited: true }))).toBe(false);
  });

  test('checks own properties without trusting an overwritten hasOwnProperty method', () => {
    const object = Object.create({ inherited: true }) as Record<string, unknown>;
    object['own'] = true;
    object['hasOwnProperty'] = undefined;

    expect(hasOwn(object, 'own')).toBe(true);
    expect(hasOwn(object, 'inherited')).toBe(false);
  });

  test.each([
    [{ value: true }, true],
    [new Date(), true],
    [[], false],
    [null, false],
    ['value', false],
  ])('recognizes non-array objects', (value, expected) => {
    expect(isObj(value)).toBe(expected);
  });

  test('requires non-null values but preserves falsey values', () => {
    expect(ensurePresent(0)).toBe(0);
    expect(ensurePresent(false)).toBe(false);
    expect(ensurePresent('')).toBe('');
    expect(() => ensurePresent(null)).toThrow('received null instead');
    expect(() => ensurePresent(undefined)).toThrow('received undefined instead');
  });

  test('validates non-negative integers and rejects non-integers', () => {
    expect(validatePositiveInteger('limit', 0)).toBe(0);
    expect(validatePositiveInteger('limit', 3)).toBe(3);
    expect(() => validatePositiveInteger('limit', -1)).toThrow('limit must be a positive integer');
    expect(() => validatePositiveInteger('limit', 1.5)).toThrow('limit must be an integer');
    expect(() => validatePositiveInteger('limit', '3')).toThrow(OpenAIError);
  });

  test('coerces and optionally coerces integers', () => {
    expect(coerceInteger(1.8)).toBe(2);
    expect(coerceInteger('12.9')).toBe(12);
    expect(() => coerceInteger(true)).toThrow('Could not coerce true (type: boolean) into a number');
    expect(maybeCoerceInteger(null)).toBeUndefined();
    expect(maybeCoerceInteger(undefined)).toBeUndefined();
    expect(maybeCoerceInteger('7')).toBe(7);
  });

  test('coerces and optionally coerces floats', () => {
    expect(coerceFloat(1.25)).toBe(1.25);
    expect(coerceFloat('12.5ms')).toBe(12.5);
    expect(() => coerceFloat(false)).toThrow('Could not coerce false (type: boolean) into a number');
    expect(maybeCoerceFloat(null)).toBeUndefined();
    expect(maybeCoerceFloat(undefined)).toBeUndefined();
    expect(maybeCoerceFloat('2.5')).toBe(2.5);
  });

  test('coerces and optionally coerces booleans', () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
    expect(coerceBoolean('true')).toBe(true);
    expect(coerceBoolean('false')).toBe(false);
    expect(coerceBoolean(1)).toBe(true);
    expect(coerceBoolean(0)).toBe(false);
    expect(maybeCoerceBoolean(null)).toBeUndefined();
    expect(maybeCoerceBoolean(undefined)).toBeUndefined();
    expect(maybeCoerceBoolean('true')).toBe(true);
  });

  test('parses valid JSON without throwing for malformed input', () => {
    expect(safeJSON('{"value":true}')).toEqual({ value: true });
    expect(safeJSON('null')).toBeNull();
    expect(safeJSON('{invalid')).toBeUndefined();
  });
});
