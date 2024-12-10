import { combine, merge, is_buffer, assign_single_source } from 'openai/internal/qs/utils';

describe('merge()', function () {
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

  var oneMerged = merge({ foo: 'bar' }, { foo: { first: '123' } });
  // t.deepEqual(
  // 	oneMerged,
  // 	{ foo: ['bar', { first: '123' }] },
  // 	'merges a standalone and an object into an array',
  // );
  expect(oneMerged).toEqual({ foo: ['bar', { first: '123' }] });

  var twoMerged = merge({ foo: ['bar', { first: '123' }] }, { foo: { second: '456' } });
  // t.deepEqual(
  // 	twoMerged,
  // 	{ foo: { 0: 'bar', 1: { first: '123' }, second: '456' } },
  // 	'merges a standalone and two objects into an array',
  // );
  expect(twoMerged).toEqual({ foo: { 0: 'bar', 1: { first: '123' }, second: '456' } });

  var sandwiched = merge({ foo: ['bar', { first: '123', second: '456' }] }, { foo: 'baz' });
  // t.deepEqual(
  // 	sandwiched,
  // 	{ foo: ['bar', { first: '123', second: '456' }, 'baz'] },
  // 	'merges an object sandwiched by two standalones into an array',
  // );
  expect(sandwiched).toEqual({ foo: ['bar', { first: '123', second: '456' }, 'baz'] });

  var nestedArrays = merge({ foo: ['baz'] }, { foo: ['bar', 'xyzzy'] });
  // t.deepEqual(nestedArrays, { foo: ['baz', 'bar', 'xyzzy'] });
  expect(nestedArrays).toEqual({ foo: ['baz', 'bar', 'xyzzy'] });

  var noOptionsNonObjectSource = merge({ foo: 'baz' }, 'bar');
  // t.deepEqual(noOptionsNonObjectSource, { foo: 'baz', bar: true });
  expect(noOptionsNonObjectSource).toEqual({ foo: 'baz', bar: true });

  (typeof Object.defineProperty !== 'function' ? test.skip : test)(
    'avoids invoking array setters unnecessarily',
    function () {
      var setCount = 0;
      var getCount = 0;
      var observed: any[] = [];
      Object.defineProperty(observed, 0, {
        get: function () {
          getCount += 1;
          return { bar: 'baz' };
        },
        set: function () {
          setCount += 1;
        },
      });
      merge(observed, [null]);
      // st.equal(setCount, 0);
      // st.equal(getCount, 1);
      expect(setCount).toEqual(0);
      expect(getCount).toEqual(1);
      observed[0] = observed[0]; // eslint-disable-line no-self-assign
      // st.equal(setCount, 1);
      // st.equal(getCount, 2);
      expect(setCount).toEqual(1);
      expect(getCount).toEqual(2);
    },
  );
});

test('assign()', function () {
  var target = { a: 1, b: 2 };
  var source = { b: 3, c: 4 };
  var result = assign_single_source(target, source);

  expect(result).toEqual(target);
  expect(target).toEqual({ a: 1, b: 3, c: 4 });
  expect(source).toEqual({ b: 3, c: 4 });
});

describe('combine()', function () {
  test('both arrays', function () {
    var a = [1];
    var b = [2];
    var combined = combine(a, b);

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

  test('one array, one non-array', function () {
    var aN = 1;
    var a = [aN];
    var bN = 2;
    var b = [bN];

    var combinedAnB = combine(aN, b);
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

    var combinedABn = combine(a, bN);
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

  test('neither is an array', function () {
    var combined = combine(1, 2);
    // st.notEqual(1, combined, '1 + 2 !== 1');
    // st.notEqual(2, combined, '1 + 2 !== 2');
    // st.deepEqual([1, 2], combined, 'both arguments are array-wrapped when not an array');
    expect(combined).not.toEqual(1);
    expect(combined).not.toEqual(2);
    expect(combined).toEqual([1, 2]);
  });
});

test('is_buffer()', function () {
  for (const x of [null, undefined, true, false, '', 'abc', 42, 0, NaN, {}, [], function () {}, /a/g]) {
    // t.equal(is_buffer(x), false, inspect(x) + ' is not a buffer');
    expect(is_buffer(x)).toEqual(false);
  }

  var fakeBuffer = { constructor: Buffer };
  // t.equal(is_buffer(fakeBuffer), false, 'fake buffer is not a buffer');
  expect(is_buffer(fakeBuffer)).toEqual(false);

  var saferBuffer = Buffer.from('abc');
  // t.equal(is_buffer(saferBuffer), true, 'SaferBuffer instance is a buffer');
  expect(is_buffer(saferBuffer)).toEqual(true);

  var buffer = Buffer.from('abc');
  // t.equal(is_buffer(buffer), true, 'real Buffer instance is a buffer');
  expect(is_buffer(buffer)).toEqual(true);
});
