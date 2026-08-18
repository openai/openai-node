import { combine, merge, is_buffer, assign_single_source, has } from 'openai/internal/qs/utils';

describe('merge()', () => {
  // t.deepEqual(merge(null, true), [null, true], 'merges true into null');
  expect(merge(null, true)).toEqual([null, true]);

  // t.deepEqual(merge(null, [42]), [null, 42], 'merges null into an array');
  expect(merge(null, [42])).toEqual([null, 42]);

  // t.deepEqual(
  // 	merge({ a: 'b' }, { a: 'c' }),
  // 	{ a: ['b', 'c'] },
  // 	'merges two objects with the same key',
  // );
  expect(merge({ a: 'b' }, { a: 'c' })).toEqual({ a: ['b', 'c'] });

  const oneMerged = merge({ foo: 'bar' }, { foo: { first: '123' } });
  // t.deepEqual(
  // 	oneMerged,
  // 	{ foo: ['bar', { first: '123' }] },
  // 	'merges a standalone and an object into an array',
  // );
  expect(oneMerged).toEqual({ foo: ['bar', { first: '123' }] });

  const twoMerged = merge({ foo: ['bar', { first: '123' }] }, { foo: { second: '456' } });
  // t.deepEqual(
  // 	twoMerged,
  // 	{ foo: { 0: 'bar', 1: { first: '123' }, second: '456' } },
  // 	'merges a standalone and two objects into an array',
  // );
  expect(twoMerged).toEqual({ foo: { 0: 'bar', 1: { first: '123' }, second: '456' } });

  const sandwiched = merge({ foo: ['bar', { first: '123', second: '456' }] }, { foo: 'baz' });
  // t.deepEqual(
  // 	sandwiched,
  // 	{ foo: ['bar', { first: '123', second: '456' }, 'baz'] },
  // 	'merges an object sandwiched by two standalones into an array',
  // );
  expect(sandwiched).toEqual({ foo: ['bar', { first: '123', second: '456' }, 'baz'] });

  const nestedArrays = merge({ foo: ['baz'] }, { foo: ['bar', 'xyzzy'] });
  // t.deepEqual(nestedArrays, { foo: ['baz', 'bar', 'xyzzy'] });
  expect(nestedArrays).toEqual({ foo: ['baz', 'bar', 'xyzzy'] });

  const noOptionsNonObjectSource = merge({ foo: 'baz' }, 'bar');
  // t.deepEqual(noOptionsNonObjectSource, { foo: 'baz', bar: true });
  expect(noOptionsNonObjectSource).toEqual({ foo: 'baz', bar: true });

  (typeof Object.defineProperty === 'function' ? test : test.skip)(
    'avoids invoking array setters unnecessarily',
    () => {
      let setCount = 0;
      let getCount = 0;
      const observed: any[] = [];
      Object.defineProperty(observed, 0, {
        get() {
          getCount += 1;
          return { bar: 'baz' };
        },
        set() {
          setCount += 1;
        },
      });
      merge(observed, [null]);
      // st.equal(setCount, 0);
      // st.equal(getCount, 1);
      expect(setCount).toEqual(0);
      expect(getCount).toEqual(1);
      observed[0] = observed[0];
      // st.equal(setCount, 1);
      // st.equal(getCount, 2);
      expect(setCount).toEqual(1);
      expect(getCount).toEqual(2);
    },
  );
});

test('assign()', () => {
  const target = { a: 1, b: 2 };
  const source = { b: 3, c: 4 };
  const result = assign_single_source(target, source);

  expect(result).toEqual(target);
  expect(target).toEqual({ a: 1, b: 3, c: 4 });
  expect(source).toEqual({ b: 3, c: 4 });
});

describe('prototype-pollution safety', () => {
  test.each([
    {
      name: 'merge',
      apply: (target: Record<string, unknown>, source: Record<string, unknown>) => merge(target, source),
    },
    {
      name: 'assign_single_source',
      apply: (target: Record<string, unknown>, source: Record<string, unknown>) =>
        assign_single_source(target, source),
    },
  ])('$name preserves inherited properties while ignoring unsafe own source keys', ({ apply }) => {
    const inherited = { inherited: true };
    const target = Object.create(inherited);
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":"preserved"}',
    );

    expect(apply(target, source)).toBe(target);
    expect(Object.getPrototypeOf(target)).toBe(inherited);
    expect(target.inherited).toBe(true);
    expect(target.safe).toBe('preserved');
    expect(has(target, '__proto__')).toBe(false);
    expect(has(target, 'constructor')).toBe(false);
    expect(has(target, 'prototype')).toBe(false);
    expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined();
  });

  test('merge ignores unsafe keys in nested objects', () => {
    const target = { nested: {} };
    const source = JSON.parse(
      '{"nested":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":true}}',
    );

    expect(merge(target, source)).toBe(target);
    expect(Object.getPrototypeOf(target.nested)).toBe(Object.prototype);
    expect(target.nested).toEqual({ safe: true });
    expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined();
  });

  test('sanitizes newly adopted nested records without changing the source', () => {
    const source = JSON.parse(
      '{"nested":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":{"value":true}}}',
    );
    const result = merge({}, source);
    const destination = {};

    expect(result.nested).not.toBe(source.nested);
    expect(result.nested).toEqual({ safe: { value: true } });
    expect(Object.assign(destination, result.nested)).toBe(destination);
    expect(Object.getPrototypeOf(destination)).toBe(Object.prototype);
    expect(has(source.nested, '__proto__')).toBe(true);
    expect(has(source.nested, 'constructor')).toBe(true);
    expect(has(source.nested, 'prototype')).toBe(true);
  });

  test.each([
    {
      name: 'nested array entries',
      apply: (unsafe: Record<string, unknown>) => merge({}, { nested: [unsafe] }).nested[0],
    },
    {
      name: 'newly assigned array entries',
      apply: (unsafe: Record<string, unknown>) => merge([], [unsafe])[0],
    },
    {
      name: 'array entries appended after a scalar collision',
      apply: (unsafe: Record<string, unknown>) => merge(['existing'], [unsafe])[1],
    },
    {
      name: 'objects adopted after a scalar target',
      apply: (unsafe: Record<string, unknown>) => merge('existing', unsafe)[1],
    },
    {
      name: 'flattened array entries after a scalar target',
      apply: (unsafe: Record<string, unknown>) => merge('existing', [unsafe])[1],
    },
  ])('sanitizes $name', ({ apply }) => {
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":true}');
    const result = apply(unsafe);

    expect(result).toEqual({ safe: true });
    expect(has(result, '__proto__')).toBe(false);
    expect(has(unsafe, '__proto__')).toBe(true);
    const destination = {};
    expect(Object.assign(destination, result)).toBe(destination);
    expect(Object.getPrototypeOf(destination)).toBe(Object.prototype);
  });

  test('preserves safe adopted identities, array holes, and null prototypes', () => {
    const safe = Object.assign(Object.create(null), { value: true });
    const sparse: unknown[] = [];
    sparse[2] = safe;
    const result = merge({}, { safe, sparse });

    expect(result.safe).toBe(safe);
    expect(result.sparse).toBe(sparse);
    expect(0 in result.sparse).toBe(false);
    expect(1 in result.sparse).toBe(false);
    expect(Object.getPrototypeOf(result.safe)).toBeNull();
  });

  test('preserves cycles and shared references when sanitizing adopted records', () => {
    const unsafe: Record<string, any> = JSON.parse('{"__proto__":{"polluted":true},"safe":true}');
    unsafe['self'] = unsafe;
    const result = merge({}, { left: unsafe, right: unsafe });

    expect(result.left).toBe(result.right);
    expect(result.left.self).toBe(result.left);
    expect(result.left.safe).toBe(true);
    expect(has(result.left, '__proto__')).toBe(false);
    expect(unsafe['self']).toBe(unsafe);
    expect(has(unsafe, '__proto__')).toBe(true);
  });

  test('copies adopted getter descriptors without invoking untrusted getters', () => {
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":true}');
    let calls = 0;
    Object.defineProperty(unsafe, 'observed', {
      configurable: true,
      enumerable: true,
      get() {
        calls += 1;
        return 'value';
      },
    });
    const getter = Object.getOwnPropertyDescriptor(unsafe, 'observed')?.get;
    const result = merge({}, { nested: unsafe });

    expect(calls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(result.nested, 'observed')?.get).toBe(getter);
    expect(has(result.nested, '__proto__')).toBe(false);
  });

  test.each(['__proto__', 'constructor', 'prototype'])(
    'merge ignores unsafe scalar key %s when inherited property names are allowed',
    (key) => {
      const target = {};

      expect(merge(target, key, { allowPrototypes: true })).toBe(target);
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
      expect(has(target, key)).toBe(false);
    },
  );

  test('merge preserves explicitly allowed safe inherited property names', () => {
    expect(merge({}, 'toString', { allowPrototypes: true })).toEqual({ toString: true });
  });
});

describe('combine()', () => {
  test('both arrays', () => {
    const a = [1];
    const b = [2];
    const combined = combine(a, b);

    // st.deepEqual(a, [1], 'a is not mutated');
    // st.deepEqual(b, [2], 'b is not mutated');
    // st.notEqual(a, combined, 'a !== combined');
    // st.notEqual(b, combined, 'b !== combined');
    // st.deepEqual(combined, [1, 2], 'combined is a + b');
    expect(a).toEqual([1]);
    expect(b).toEqual([2]);
    expect(combined).toEqual([1, 2]);
    expect(a).not.toEqual(combined);
    expect(b).not.toEqual(combined);
  });

  test('one array, one non-array', () => {
    const aN = 1;
    const a = [aN];
    const bN = 2;
    const b = [bN];

    const combinedAnB = combine(aN, b);
    // st.deepEqual(b, [bN], 'b is not mutated');
    // st.notEqual(aN, combinedAnB, 'aN + b !== aN');
    // st.notEqual(a, combinedAnB, 'aN + b !== a');
    // st.notEqual(bN, combinedAnB, 'aN + b !== bN');
    // st.notEqual(b, combinedAnB, 'aN + b !== b');
    // st.deepEqual([1, 2], combinedAnB, 'first argument is array-wrapped when not an array');
    expect(b).toEqual([bN]);
    expect(combinedAnB).not.toEqual(aN);
    expect(combinedAnB).not.toEqual(a);
    expect(combinedAnB).not.toEqual(bN);
    expect(combinedAnB).not.toEqual(b);
    expect(combinedAnB).toEqual([1, 2]);

    const combinedABn = combine(a, bN);
    // st.deepEqual(a, [aN], 'a is not mutated');
    // st.notEqual(aN, combinedABn, 'a + bN !== aN');
    // st.notEqual(a, combinedABn, 'a + bN !== a');
    // st.notEqual(bN, combinedABn, 'a + bN !== bN');
    // st.notEqual(b, combinedABn, 'a + bN !== b');
    // st.deepEqual([1, 2], combinedABn, 'second argument is array-wrapped when not an array');
    expect(a).toEqual([aN]);
    expect(combinedABn).not.toEqual(aN);
    expect(combinedABn).not.toEqual(a);
    expect(combinedABn).not.toEqual(bN);
    expect(combinedABn).not.toEqual(b);
    expect(combinedABn).toEqual([1, 2]);
  });

  test('neither is an array', () => {
    const combined = combine(1, 2);
    // st.notEqual(1, combined, '1 + 2 !== 1');
    // st.notEqual(2, combined, '1 + 2 !== 2');
    // st.deepEqual([1, 2], combined, 'both arguments are array-wrapped when not an array');
    expect(combined).not.toEqual(1);
    expect(combined).not.toEqual(2);
    expect(combined).toEqual([1, 2]);
  });
});

test('is_buffer()', () => {
  for (const x of [null, undefined, true, false, '', 'abc', 42, 0, Number.NaN, {}, [], () => {}, /a/g]) {
    // t.equal(is_buffer(x), false, inspect(x) + ' is not a buffer');
    expect(is_buffer(x)).toEqual(false);
  }

  const fakeBuffer = { constructor: Buffer };
  // t.equal(is_buffer(fakeBuffer), false, 'fake buffer is not a buffer');
  expect(is_buffer(fakeBuffer)).toEqual(false);

  const saferBuffer = Buffer.from('abc');
  // t.equal(is_buffer(saferBuffer), true, 'SaferBuffer instance is a buffer');
  expect(is_buffer(saferBuffer)).toEqual(true);

  const buffer = Buffer.from('abc');
  // t.equal(is_buffer(buffer), true, 'real Buffer instance is a buffer');
  expect(is_buffer(buffer)).toEqual(true);
});
