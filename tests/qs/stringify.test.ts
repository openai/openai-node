import iconv from 'iconv-lite';
import { stringify } from 'openai/internal/qs';
import { encode } from 'openai/internal/qs/utils';
import { StringifyOptions } from 'openai/internal/qs/types';
import { empty_test_cases } from './empty-keys-cases';
import assert from 'assert';

describe('stringify()', function () {
  test('stringifies a querystring object', function () {
    expect(stringify({ a: 'b' })).toBe('a=b');
    expect(stringify({ a: 1 })).toBe('a=1');
    expect(stringify({ a: 1, b: 2 })).toBe('a=1&b=2');
    expect(stringify({ a: 'A_Z' })).toBe('a=A_Z');
    expect(stringify({ a: '€' })).toBe('a=%E2%82%AC');
    expect(stringify({ a: '' })).toBe('a=%EE%80%80');
    expect(stringify({ a: 'א' })).toBe('a=%D7%90');
    expect(stringify({ a: '𐐷' })).toBe('a=%F0%90%90%B7');
  });

  test('stringifies falsy values', function () {
    expect(stringify(undefined)).toBe('');
    expect(stringify(null)).toBe('');
    expect(stringify(null, { strictNullHandling: true })).toBe('');
    expect(stringify(false)).toBe('');
    expect(stringify(0)).toBe('');
  });

  test('stringifies symbols', function () {
    expect(stringify(Symbol.iterator)).toBe('');
    expect(stringify([Symbol.iterator])).toBe('0=Symbol%28Symbol.iterator%29');
    expect(stringify({ a: Symbol.iterator })).toBe('a=Symbol%28Symbol.iterator%29');
    expect(stringify({ a: [Symbol.iterator] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe(
      'a[]=Symbol%28Symbol.iterator%29',
    );
  });

  test('stringifies bigints', function () {
    var three = BigInt(3);
    // @ts-expect-error
    var encodeWithN = function (value, defaultEncoder, charset) {
      var result = defaultEncoder(value, defaultEncoder, charset);
      return typeof value === 'bigint' ? result + 'n' : result;
    };

    expect(stringify(three)).toBe('');
    expect(stringify([three])).toBe('0=3');
    expect(stringify([three], { encoder: encodeWithN })).toBe('0=3n');
    expect(stringify({ a: three })).toBe('a=3');
    expect(stringify({ a: three }, { encoder: encodeWithN })).toBe('a=3n');
    expect(stringify({ a: [three] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe('a[]=3');
    expect(
      stringify({ a: [three] }, { encodeValuesOnly: true, encoder: encodeWithN, arrayFormat: 'brackets' }),
    ).toBe('a[]=3n');
  });

  test('encodes dot in key of object when encodeDotInKeys and allowDots is provided', function () {
    expect(
      stringify({ 'name.obj': { first: 'John', last: 'Doe' } }, { allowDots: false, encodeDotInKeys: false }),
    ).toBe('name.obj%5Bfirst%5D=John&name.obj%5Blast%5D=Doe');
    expect(
      stringify({ 'name.obj': { first: 'John', last: 'Doe' } }, { allowDots: true, encodeDotInKeys: false }),
    ).toBe('name.obj.first=John&name.obj.last=Doe');
    expect(
      stringify({ 'name.obj': { first: 'John', last: 'Doe' } }, { allowDots: false, encodeDotInKeys: true }),
    ).toBe('name%252Eobj%5Bfirst%5D=John&name%252Eobj%5Blast%5D=Doe');
    expect(
      stringify({ 'name.obj': { first: 'John', last: 'Doe' } }, { allowDots: true, encodeDotInKeys: true }),
    ).toBe('name%252Eobj.first=John&name%252Eobj.last=Doe');

    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ allowDots: false, encodeDotInKeys: false },
    // 	),
    // 	'name.obj.subobject%5Bfirst.godly.name%5D=John&name.obj.subobject%5Blast%5D=Doe',
    // 	'with allowDots false and encodeDotInKeys false',
    // );
    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ allowDots: true, encodeDotInKeys: false },
    // 	),
    // 	'name.obj.subobject.first.godly.name=John&name.obj.subobject.last=Doe',
    // 	'with allowDots false and encodeDotInKeys false',
    // );
    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ allowDots: false, encodeDotInKeys: true },
    // 	),
    // 	'name%252Eobj%252Esubobject%5Bfirst.godly.name%5D=John&name%252Eobj%252Esubobject%5Blast%5D=Doe',
    // 	'with allowDots false and encodeDotInKeys true',
    // );
    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ allowDots: true, encodeDotInKeys: true },
    // 	),
    // 	'name%252Eobj%252Esubobject.first%252Egodly%252Ename=John&name%252Eobj%252Esubobject.last=Doe',
    // 	'with allowDots true and encodeDotInKeys true',
    // );
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { allowDots: false, encodeDotInKeys: false },
      ),
    ).toBe('name.obj.subobject%5Bfirst.godly.name%5D=John&name.obj.subobject%5Blast%5D=Doe');
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { allowDots: true, encodeDotInKeys: false },
      ),
    ).toBe('name.obj.subobject.first.godly.name=John&name.obj.subobject.last=Doe');
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { allowDots: false, encodeDotInKeys: true },
      ),
    ).toBe('name%252Eobj%252Esubobject%5Bfirst.godly.name%5D=John&name%252Eobj%252Esubobject%5Blast%5D=Doe');
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { allowDots: true, encodeDotInKeys: true },
      ),
    ).toBe('name%252Eobj%252Esubobject.first%252Egodly%252Ename=John&name%252Eobj%252Esubobject.last=Doe');
  });

  test('should encode dot in key of object, and automatically set allowDots to `true` when encodeDotInKeys is true and allowDots in undefined', function () {
    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ encodeDotInKeys: true },
    // 	),
    // 	'name%252Eobj%252Esubobject.first%252Egodly%252Ename=John&name%252Eobj%252Esubobject.last=Doe',
    // 	'with allowDots undefined and encodeDotInKeys true',
    // );
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { encodeDotInKeys: true },
      ),
    ).toBe('name%252Eobj%252Esubobject.first%252Egodly%252Ename=John&name%252Eobj%252Esubobject.last=Doe');
  });

  test('should encode dot in key of object when encodeDotInKeys and allowDots is provided, and nothing else when encodeValuesOnly is provided', function () {
    // st.equal(
    // 	stringify(
    // 		{ 'name.obj': { first: 'John', last: 'Doe' } },
    // 		{
    // 			encodeDotInKeys: true,
    // 			allowDots: true,
    // 			encodeValuesOnly: true,
    // 		},
    // 	),
    // 	'name%2Eobj.first=John&name%2Eobj.last=Doe',
    // );
    expect(
      stringify(
        { 'name.obj': { first: 'John', last: 'Doe' } },
        {
          encodeDotInKeys: true,
          allowDots: true,
          encodeValuesOnly: true,
        },
      ),
    ).toBe('name%2Eobj.first=John&name%2Eobj.last=Doe');

    // st.equal(
    // 	stringify(
    // 		{ 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
    // 		{ allowDots: true, encodeDotInKeys: true, encodeValuesOnly: true },
    // 	),
    // 	'name%2Eobj%2Esubobject.first%2Egodly%2Ename=John&name%2Eobj%2Esubobject.last=Doe',
    // );
    expect(
      stringify(
        { 'name.obj.subobject': { 'first.godly.name': 'John', last: 'Doe' } },
        { allowDots: true, encodeDotInKeys: true, encodeValuesOnly: true },
      ),
    ).toBe('name%2Eobj%2Esubobject.first%2Egodly%2Ename=John&name%2Eobj%2Esubobject.last=Doe');
  });

  test('throws when `commaRoundTrip` is not a boolean', function () {
    // st['throws'](
    // 	function () {
    // 		stringify({}, { commaRoundTrip: 'not a boolean' });
    // 	},
    // 	TypeError,
    // 	'throws when `commaRoundTrip` is not a boolean',
    // );
    expect(() => {
      // @ts-expect-error
      stringify({}, { commaRoundTrip: 'not a boolean' });
    }).toThrow(TypeError);
  });

  test('throws when `encodeDotInKeys` is not a boolean', function () {
    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { encodeDotInKeys: 'foobar' });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { encodeDotInKeys: 'foobar' });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { encodeDotInKeys: 0 });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { encodeDotInKeys: 0 });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { encodeDotInKeys: NaN });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { encodeDotInKeys: NaN });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { encodeDotInKeys: null });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { encodeDotInKeys: null });
    }).toThrow(TypeError);
  });

  test('adds query prefix', function () {
    // st.equal(stringify({ a: 'b' }, { addQueryPrefix: true }), '?a=b');
    expect(stringify({ a: 'b' }, { addQueryPrefix: true })).toBe('?a=b');
  });

  test('with query prefix, outputs blank string given an empty object', function () {
    // st.equal(stringify({}, { addQueryPrefix: true }), '');
    expect(stringify({}, { addQueryPrefix: true })).toBe('');
  });

  test('stringifies nested falsy values', function () {
    // st.equal(stringify({ a: { b: { c: null } } }), 'a%5Bb%5D%5Bc%5D=');
    // st.equal(
    // 	stringify({ a: { b: { c: null } } }, { strictNullHandling: true }),
    // 	'a%5Bb%5D%5Bc%5D',
    // );
    // st.equal(stringify({ a: { b: { c: false } } }), 'a%5Bb%5D%5Bc%5D=false');
    expect(stringify({ a: { b: { c: null } } })).toBe('a%5Bb%5D%5Bc%5D=');
    expect(stringify({ a: { b: { c: null } } }, { strictNullHandling: true })).toBe('a%5Bb%5D%5Bc%5D');
    expect(stringify({ a: { b: { c: false } } })).toBe('a%5Bb%5D%5Bc%5D=false');
  });

  test('stringifies a nested object', function () {
    // st.equal(stringify({ a: { b: 'c' } }), 'a%5Bb%5D=c');
    // st.equal(stringify({ a: { b: { c: { d: 'e' } } } }), 'a%5Bb%5D%5Bc%5D%5Bd%5D=e');
    expect(stringify({ a: { b: 'c' } })).toBe('a%5Bb%5D=c');
    expect(stringify({ a: { b: { c: { d: 'e' } } } })).toBe('a%5Bb%5D%5Bc%5D%5Bd%5D=e');
  });

  test('`allowDots` option: stringifies a nested object with dots notation', function () {
    // st.equal(stringify({ a: { b: 'c' } }, { allowDots: true }), 'a.b=c');
    // st.equal(stringify({ a: { b: { c: { d: 'e' } } } }, { allowDots: true }), 'a.b.c.d=e');
    expect(stringify({ a: { b: 'c' } }, { allowDots: true })).toBe('a.b=c');
    expect(stringify({ a: { b: { c: { d: 'e' } } } }, { allowDots: true })).toBe('a.b.c.d=e');
  });

  test('stringifies an array value', function () {
    // st.equal(
    // 	stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'indices' }),
    // 	'a%5B0%5D=b&a%5B1%5D=c&a%5B2%5D=d',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'brackets' }),
    // 	'a%5B%5D=b&a%5B%5D=c&a%5B%5D=d',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'comma' }),
    // 	'a=b%2Cc%2Cd',
    // 	'comma => comma',
    // );
    // st.equal(
    // 	stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'comma', commaRoundTrip: true }),
    // 	'a=b%2Cc%2Cd',
    // 	'comma round trip => comma',
    // );
    // st.equal(
    // 	stringify({ a: ['b', 'c', 'd'] }),
    // 	'a%5B0%5D=b&a%5B1%5D=c&a%5B2%5D=d',
    // 	'default => indices',
    // );
    expect(stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'indices' })).toBe(
      'a%5B0%5D=b&a%5B1%5D=c&a%5B2%5D=d',
    );
    expect(stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'brackets' })).toBe(
      'a%5B%5D=b&a%5B%5D=c&a%5B%5D=d',
    );
    expect(stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'comma' })).toBe('a=b%2Cc%2Cd');
    expect(stringify({ a: ['b', 'c', 'd'] }, { arrayFormat: 'comma', commaRoundTrip: true })).toBe(
      'a=b%2Cc%2Cd',
    );
    expect(stringify({ a: ['b', 'c', 'd'] })).toBe('a%5B0%5D=b&a%5B1%5D=c&a%5B2%5D=d');
  });

  test('`skipNulls` option', function () {
    // st.equal(
    // 	stringify({ a: 'b', c: null }, { skipNulls: true }),
    // 	'a=b',
    // 	'omits nulls when asked',
    // );
    expect(stringify({ a: 'b', c: null }, { skipNulls: true })).toBe('a=b');

    // st.equal(
    // 	stringify({ a: { b: 'c', d: null } }, { skipNulls: true }),
    // 	'a%5Bb%5D=c',
    // 	'omits nested nulls when asked',
    // );
    expect(stringify({ a: { b: 'c', d: null } }, { skipNulls: true })).toBe('a%5Bb%5D=c');
  });

  test('omits array indices when asked', function () {
    // st.equal(stringify({ a: ['b', 'c', 'd'] }, { indices: false }), 'a=b&a=c&a=d');
    expect(stringify({ a: ['b', 'c', 'd'] }, { indices: false })).toBe('a=b&a=c&a=d');
  });

  test('omits object key/value pair when value is empty array', function () {
    // st.equal(stringify({ a: [], b: 'zz' }), 'b=zz');
    expect(stringify({ a: [], b: 'zz' })).toBe('b=zz');
  });

  test('should not omit object key/value pair when value is empty array and when asked', function () {
    // st.equal(stringify({ a: [], b: 'zz' }), 'b=zz');
    // st.equal(stringify({ a: [], b: 'zz' }, { allowEmptyArrays: false }), 'b=zz');
    // st.equal(stringify({ a: [], b: 'zz' }, { allowEmptyArrays: true }), 'a[]&b=zz');
    expect(stringify({ a: [], b: 'zz' })).toBe('b=zz');
    expect(stringify({ a: [], b: 'zz' }, { allowEmptyArrays: false })).toBe('b=zz');
    expect(stringify({ a: [], b: 'zz' }, { allowEmptyArrays: true })).toBe('a[]&b=zz');
  });

  test('should throw when allowEmptyArrays is not of type boolean', function () {
    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { allowEmptyArrays: 'foobar' });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { allowEmptyArrays: 'foobar' });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { allowEmptyArrays: 0 });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { allowEmptyArrays: 0 });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { allowEmptyArrays: NaN });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { allowEmptyArrays: NaN });
    }).toThrow(TypeError);

    // st['throws'](function () {
    // 	stringify({ a: [], b: 'zz' }, { allowEmptyArrays: null });
    // }, TypeError);
    expect(() => {
      // @ts-expect-error
      stringify({ a: [], b: 'zz' }, { allowEmptyArrays: null });
    }).toThrow(TypeError);
  });

  test('allowEmptyArrays + strictNullHandling', function () {
    // st.equal(
    // 	stringify({ testEmptyArray: [] }, { strictNullHandling: true, allowEmptyArrays: true }),
    // 	'testEmptyArray[]',
    // );
    expect(stringify({ testEmptyArray: [] }, { strictNullHandling: true, allowEmptyArrays: true })).toBe(
      'testEmptyArray[]',
    );
  });

  describe('stringifies an array value with one item vs multiple items', function () {
    test('non-array item', function () {
      // s2t.equal(
      // 	stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
      // 	'a=c',
      // );
      // s2t.equal(
      // 	stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
      // 	'a=c',
      // );
      // s2t.equal(stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'comma' }), 'a=c');
      // s2t.equal(stringify({ a: 'c' }, { encodeValuesOnly: true }), 'a=c');
      expect(stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe('a=c');
      expect(stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe('a=c');
      expect(stringify({ a: 'c' }, { encodeValuesOnly: true, arrayFormat: 'comma' })).toBe('a=c');
      expect(stringify({ a: 'c' }, { encodeValuesOnly: true })).toBe('a=c');
    });

    test('array with a single item', function () {
      // s2t.equal(
      // 	stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
      // 	'a[0]=c',
      // );
      // s2t.equal(
      // 	stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
      // 	'a[]=c',
      // );
      // s2t.equal(
      // 	stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'comma' }),
      // 	'a=c',
      // );
      // s2t.equal(
      // 	stringify(
      // 		{ a: ['c'] },
      // 		{ encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true },
      // 	),
      // 	'a[]=c',
      // ); // so it parses back as an array
      // s2t.equal(stringify({ a: ['c'] }, { encodeValuesOnly: true }), 'a[0]=c');
      expect(stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe('a[0]=c');
      expect(stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe('a[]=c');
      expect(stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'comma' })).toBe('a=c');
      expect(
        stringify({ a: ['c'] }, { encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true }),
      ).toBe('a[]=c');
      expect(stringify({ a: ['c'] }, { encodeValuesOnly: true })).toBe('a[0]=c');
    });

    test('array with multiple items', function () {
      // s2t.equal(
      // 	stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
      // 	'a[0]=c&a[1]=d',
      // );
      // s2t.equal(
      // 	stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
      // 	'a[]=c&a[]=d',
      // );
      // s2t.equal(
      // 	stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'comma' }),
      // 	'a=c,d',
      // );
      // s2t.equal(
      // 	stringify(
      // 		{ a: ['c', 'd'] },
      // 		{ encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true },
      // 	),
      // 	'a=c,d',
      // );
      // s2t.equal(stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true }), 'a[0]=c&a[1]=d');
      expect(stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe(
        'a[0]=c&a[1]=d',
      );
      expect(stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe(
        'a[]=c&a[]=d',
      );
      expect(stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'comma' })).toBe('a=c,d');
      expect(
        stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true }),
      ).toBe('a=c,d');
      expect(stringify({ a: ['c', 'd'] }, { encodeValuesOnly: true })).toBe('a[0]=c&a[1]=d');
    });

    test('array with multiple items with a comma inside', function () {
      // s2t.equal(
      // 	stringify({ a: ['c,d', 'e'] }, { encodeValuesOnly: true, arrayFormat: 'comma' }),
      // 	'a=c%2Cd,e',
      // );
      // s2t.equal(stringify({ a: ['c,d', 'e'] }, { arrayFormat: 'comma' }), 'a=c%2Cd%2Ce');
      expect(stringify({ a: ['c,d', 'e'] }, { encodeValuesOnly: true, arrayFormat: 'comma' })).toBe(
        'a=c%2Cd,e',
      );
      expect(stringify({ a: ['c,d', 'e'] }, { arrayFormat: 'comma' })).toBe('a=c%2Cd%2Ce');

      // s2t.equal(
      // 	stringify(
      // 		{ a: ['c,d', 'e'] },
      // 		{ encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true },
      // 	),
      // 	'a=c%2Cd,e',
      // );
      // s2t.equal(
      // 	stringify({ a: ['c,d', 'e'] }, { arrayFormat: 'comma', commaRoundTrip: true }),
      // 	'a=c%2Cd%2Ce',
      // );
      expect(
        stringify(
          { a: ['c,d', 'e'] },
          { encodeValuesOnly: true, arrayFormat: 'comma', commaRoundTrip: true },
        ),
      ).toBe('a=c%2Cd,e');
      expect(stringify({ a: ['c,d', 'e'] }, { arrayFormat: 'comma', commaRoundTrip: true })).toBe(
        'a=c%2Cd%2Ce',
      );
    });
  });

  test('stringifies a nested array value', function () {
    expect(stringify({ a: { b: ['c', 'd'] } }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe(
      'a[b][0]=c&a[b][1]=d',
    );
    expect(stringify({ a: { b: ['c', 'd'] } }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe(
      'a[b][]=c&a[b][]=d',
    );
    expect(stringify({ a: { b: ['c', 'd'] } }, { encodeValuesOnly: true, arrayFormat: 'comma' })).toBe(
      'a[b]=c,d',
    );
    expect(stringify({ a: { b: ['c', 'd'] } }, { encodeValuesOnly: true })).toBe('a[b][0]=c&a[b][1]=d');
  });

  test('stringifies comma and empty array values', function () {
    // st.equal(
    // 	stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'indices' }),
    // 	'a[0]=,&a[1]=&a[2]=c,d%',
    // );
    // st.equal(
    // 	stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'brackets' }),
    // 	'a[]=,&a[]=&a[]=c,d%',
    // );
    // st.equal(
    // 	stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'comma' }),
    // 	'a=,,,c,d%',
    // );
    // st.equal(
    // 	stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'repeat' }),
    // 	'a=,&a=&a=c,d%',
    // );
    expect(stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'indices' })).toBe(
      'a[0]=,&a[1]=&a[2]=c,d%',
    );
    expect(stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'brackets' })).toBe(
      'a[]=,&a[]=&a[]=c,d%',
    );
    expect(stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'comma' })).toBe('a=,,,c,d%');
    expect(stringify({ a: [',', '', 'c,d%'] }, { encode: false, arrayFormat: 'repeat' })).toBe(
      'a=,&a=&a=c,d%',
    );

    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a[0]=%2C&a[1]=&a[2]=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a[]=%2C&a[]=&a[]=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'comma' },
    // 	),
    // 	'a=%2C,,c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a=%2C&a=&a=c%2Cd%25',
    // );
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'indices' }),
    ).toBe('a%5B0%5D=%2C&a%5B1%5D=&a%5B2%5D=c%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe('a[]=%2C&a[]=&a[]=c%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'comma' }),
    ).toBe('a=%2C%2C%2Cc%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' }),
    ).toBe('a=%2C&a=&a=c%2Cd%25');

    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'indices' },
    // 	),
    // 	'a%5B0%5D=%2C&a%5B1%5D=&a%5B2%5D=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'brackets' },
    // 	),
    // 	'a%5B%5D=%2C&a%5B%5D=&a%5B%5D=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'comma' },
    // 	),
    // 	'a=%2C%2C%2Cc%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [',', '', 'c,d%'] },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' },
    // 	),
    // 	'a=%2C&a=&a=c%2Cd%25',
    // );
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' }),
    ).toBe('a=%2C&a=&a=c%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'indices' }),
    ).toBe('a%5B0%5D=%2C&a%5B1%5D=&a%5B2%5D=c%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe('a[]=%2C&a[]=&a[]=c%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'comma' }),
    ).toBe('a=%2C%2C%2Cc%2Cd%25');
    expect(
      stringify({ a: [',', '', 'c,d%'] }, { encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' }),
    ).toBe('a=%2C&a=&a=c%2Cd%25');
  });

  test('stringifies comma and empty non-array values', function () {
    // st.equal(
    // 	stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'indices' }),
    // 	'a=,&b=&c=c,d%',
    // );
    // st.equal(
    // 	stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'brackets' }),
    // 	'a=,&b=&c=c,d%',
    // );
    // st.equal(
    // 	stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'comma' }),
    // 	'a=,&b=&c=c,d%',
    // );
    // st.equal(
    // 	stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'repeat' }),
    // 	'a=,&b=&c=c,d%',
    // );
    expect(stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'indices' })).toBe(
      'a=,&b=&c=c,d%',
    );
    expect(stringify({ a: ',', b: '', c: 'c,d%' }, { encode: false, arrayFormat: 'brackets' })).toBe(
      'a=,&b=&c=c,d%',
    );

    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'comma' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: true, arrayFormat: 'indices' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: true, arrayFormat: 'brackets' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify({ a: ',', b: '', c: 'c,d%' }, { encode: true, encodeValuesOnly: true, arrayFormat: 'comma' }),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: true, arrayFormat: 'repeat' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');

    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'indices' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'brackets' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'comma' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: ',', b: '', c: 'c,d%' },
    // 		{ encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' },
    // 	),
    // 	'a=%2C&b=&c=c%2Cd%25',
    // );
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: false, arrayFormat: 'indices' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: false, arrayFormat: 'brackets' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: false, arrayFormat: 'comma' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
    expect(
      stringify(
        { a: ',', b: '', c: 'c,d%' },
        { encode: true, encodeValuesOnly: false, arrayFormat: 'repeat' },
      ),
    ).toBe('a=%2C&b=&c=c%2Cd%25');
  });

  test('stringifies a nested array value with dots notation', function () {
    // st.equal(
    // 	stringify(
    // 		{ a: { b: ['c', 'd'] } },
    // 		{ allowDots: true, encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a.b[0]=c&a.b[1]=d',
    // 	'indices: stringifies with dots + indices',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: { b: ['c', 'd'] } },
    // 		{ allowDots: true, encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a.b[]=c&a.b[]=d',
    // 	'brackets: stringifies with dots + brackets',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: { b: ['c', 'd'] } },
    // 		{ allowDots: true, encodeValuesOnly: true, arrayFormat: 'comma' },
    // 	),
    // 	'a.b=c,d',
    // 	'comma: stringifies with dots + comma',
    // );
    // st.equal(
    // 	stringify({ a: { b: ['c', 'd'] } }, { allowDots: true, encodeValuesOnly: true }),
    // 	'a.b[0]=c&a.b[1]=d',
    // 	'default: stringifies with dots + indices',
    // );
    expect(
      stringify(
        { a: { b: ['c', 'd'] } },
        { allowDots: true, encodeValuesOnly: true, arrayFormat: 'indices' },
      ),
    ).toBe('a.b[0]=c&a.b[1]=d');
    expect(
      stringify(
        { a: { b: ['c', 'd'] } },
        { allowDots: true, encodeValuesOnly: true, arrayFormat: 'brackets' },
      ),
    ).toBe('a.b[]=c&a.b[]=d');
    expect(
      stringify({ a: { b: ['c', 'd'] } }, { allowDots: true, encodeValuesOnly: true, arrayFormat: 'comma' }),
    ).toBe('a.b=c,d');
    expect(stringify({ a: { b: ['c', 'd'] } }, { allowDots: true, encodeValuesOnly: true })).toBe(
      'a.b[0]=c&a.b[1]=d',
    );
  });

  test('stringifies an object inside an array', function () {
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'indices', encodeValuesOnly: true }),
    // 	'a[0][b]=c',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'repeat', encodeValuesOnly: true }),
    // 	'a[b]=c',
    // 	'repeat => repeat',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'brackets', encodeValuesOnly: true }),
    // 	'a[][b]=c',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { encodeValuesOnly: true }),
    // 	'a[0][b]=c',
    // 	'default => indices',
    // );
    expect(stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'indices', encodeValuesOnly: true })).toBe(
      'a[0][b]=c',
    );
    expect(stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'repeat', encodeValuesOnly: true })).toBe('a[b]=c');
    expect(stringify({ a: [{ b: 'c' }] }, { arrayFormat: 'brackets', encodeValuesOnly: true })).toBe(
      'a[][b]=c',
    );
    expect(stringify({ a: [{ b: 'c' }] }, { encodeValuesOnly: true })).toBe('a[0][b]=c');

    // st.equal(
    // 	stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'indices', encodeValuesOnly: true }),
    // 	'a[0][b][c][0]=1',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'repeat', encodeValuesOnly: true }),
    // 	'a[b][c]=1',
    // 	'repeat => repeat',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'brackets', encodeValuesOnly: true }),
    // 	'a[][b][c][]=1',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: { c: [1] } }] }, { encodeValuesOnly: true }),
    // 	'a[0][b][c][0]=1',
    // 	'default => indices',
    // );
    expect(stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'indices', encodeValuesOnly: true })).toBe(
      'a[0][b][c][0]=1',
    );
    expect(stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'repeat', encodeValuesOnly: true })).toBe(
      'a[b][c]=1',
    );
    expect(stringify({ a: [{ b: { c: [1] } }] }, { arrayFormat: 'brackets', encodeValuesOnly: true })).toBe(
      'a[][b][c][]=1',
    );
    expect(stringify({ a: [{ b: { c: [1] } }] }, { encodeValuesOnly: true })).toBe('a[0][b][c][0]=1');
  });

  test('stringifies an array with mixed objects and primitives', function () {
    // st.equal(
    // 	stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    // 	'a[0][b]=1&a[1]=2&a[2]=3',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    // 	'a[][b]=1&a[]=2&a[]=3',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'comma' }),
    // 	'???',
    // 	'brackets => brackets',
    // 	{ skip: 'TODO: figure out what this should do' },
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true }),
    // 	'a[0][b]=1&a[1]=2&a[2]=3',
    // 	'default => indices',
    // );
    expect(stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe(
      'a[0][b]=1&a[1]=2&a[2]=3',
    );
    expect(stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe(
      'a[][b]=1&a[]=2&a[]=3',
    );
    // !Skipped: Figure out what this should do
    // expect(
    // 	stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true, arrayFormat: 'comma' }),
    // ).toBe('???');
    expect(stringify({ a: [{ b: 1 }, 2, 3] }, { encodeValuesOnly: true })).toBe('a[0][b]=1&a[1]=2&a[2]=3');
  });

  test('stringifies an object inside an array with dots notation', function () {
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { allowDots: true, encode: false, arrayFormat: 'indices' }),
    // 	'a[0].b=c',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [{ b: 'c' }] },
    // 		{ allowDots: true, encode: false, arrayFormat: 'brackets' },
    // 	),
    // 	'a[].b=c',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: 'c' }] }, { allowDots: true, encode: false }),
    // 	'a[0].b=c',
    // 	'default => indices',
    // );
    expect(stringify({ a: [{ b: 'c' }] }, { allowDots: true, encode: false, arrayFormat: 'indices' })).toBe(
      'a[0].b=c',
    );
    expect(stringify({ a: [{ b: 'c' }] }, { allowDots: true, encode: false, arrayFormat: 'brackets' })).toBe(
      'a[].b=c',
    );
    expect(stringify({ a: [{ b: 'c' }] }, { allowDots: true, encode: false })).toBe('a[0].b=c');

    // st.equal(
    // 	stringify(
    // 		{ a: [{ b: { c: [1] } }] },
    // 		{ allowDots: true, encode: false, arrayFormat: 'indices' },
    // 	),
    // 	'a[0].b.c[0]=1',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [{ b: { c: [1] } }] },
    // 		{ allowDots: true, encode: false, arrayFormat: 'brackets' },
    // 	),
    // 	'a[].b.c[]=1',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: [{ b: { c: [1] } }] }, { allowDots: true, encode: false }),
    // 	'a[0].b.c[0]=1',
    // 	'default => indices',
    // );
    expect(
      stringify({ a: [{ b: { c: [1] } }] }, { allowDots: true, encode: false, arrayFormat: 'indices' }),
    ).toBe('a[0].b.c[0]=1');
    expect(
      stringify({ a: [{ b: { c: [1] } }] }, { allowDots: true, encode: false, arrayFormat: 'brackets' }),
    ).toBe('a[].b.c[]=1');
    expect(stringify({ a: [{ b: { c: [1] } }] }, { allowDots: true, encode: false })).toBe('a[0].b.c[0]=1');
  });

  test('does not omit object keys when indices = false', function () {
    // st.equal(stringify({ a: [{ b: 'c' }] }, { indices: false }), 'a%5Bb%5D=c');
    expect(stringify({ a: [{ b: 'c' }] }, { indices: false })).toBe('a%5Bb%5D=c');
  });

  test('uses indices notation for arrays when indices=true', function () {
    // st.equal(stringify({ a: ['b', 'c'] }, { indices: true }), 'a%5B0%5D=b&a%5B1%5D=c');
    expect(stringify({ a: ['b', 'c'] }, { indices: true })).toBe('a%5B0%5D=b&a%5B1%5D=c');
  });

  test('uses indices notation for arrays when no arrayFormat is specified', function () {
    // st.equal(stringify({ a: ['b', 'c'] }), 'a%5B0%5D=b&a%5B1%5D=c');
    expect(stringify({ a: ['b', 'c'] })).toBe('a%5B0%5D=b&a%5B1%5D=c');
  });

  test('uses indices notation for arrays when arrayFormat=indices', function () {
    // st.equal(stringify({ a: ['b', 'c'] }, { arrayFormat: 'indices' }), 'a%5B0%5D=b&a%5B1%5D=c');
    expect(stringify({ a: ['b', 'c'] }, { arrayFormat: 'indices' })).toBe('a%5B0%5D=b&a%5B1%5D=c');
  });

  test('uses repeat notation for arrays when arrayFormat=repeat', function () {
    // st.equal(stringify({ a: ['b', 'c'] }, { arrayFormat: 'repeat' }), 'a=b&a=c');
    expect(stringify({ a: ['b', 'c'] }, { arrayFormat: 'repeat' })).toBe('a=b&a=c');
  });

  test('uses brackets notation for arrays when arrayFormat=brackets', function () {
    // st.equal(stringify({ a: ['b', 'c'] }, { arrayFormat: 'brackets' }), 'a%5B%5D=b&a%5B%5D=c');
    expect(stringify({ a: ['b', 'c'] }, { arrayFormat: 'brackets' })).toBe('a%5B%5D=b&a%5B%5D=c');
  });

  test('stringifies a complicated object', function () {
    // st.equal(stringify({ a: { b: 'c', d: 'e' } }), 'a%5Bb%5D=c&a%5Bd%5D=e');
    expect(stringify({ a: { b: 'c', d: 'e' } })).toBe('a%5Bb%5D=c&a%5Bd%5D=e');
  });

  test('stringifies an empty value', function () {
    // st.equal(stringify({ a: '' }), 'a=');
    // st.equal(stringify({ a: null }, { strictNullHandling: true }), 'a');
    expect(stringify({ a: '' })).toBe('a=');
    expect(stringify({ a: null }, { strictNullHandling: true })).toBe('a');

    // st.equal(stringify({ a: '', b: '' }), 'a=&b=');
    // st.equal(stringify({ a: null, b: '' }, { strictNullHandling: true }), 'a&b=');
    expect(stringify({ a: '', b: '' })).toBe('a=&b=');
    expect(stringify({ a: null, b: '' }, { strictNullHandling: true })).toBe('a&b=');

    // st.equal(stringify({ a: { b: '' } }), 'a%5Bb%5D=');
    // st.equal(stringify({ a: { b: null } }, { strictNullHandling: true }), 'a%5Bb%5D');
    // st.equal(stringify({ a: { b: null } }, { strictNullHandling: false }), 'a%5Bb%5D=');
    expect(stringify({ a: { b: '' } })).toBe('a%5Bb%5D=');
    expect(stringify({ a: { b: null } }, { strictNullHandling: true })).toBe('a%5Bb%5D');
    expect(stringify({ a: { b: null } }, { strictNullHandling: false })).toBe('a%5Bb%5D=');
  });

  test('stringifies an empty array in different arrayFormat', function () {
    // st.equal(stringify({ a: [], b: [null], c: 'c' }, { encode: false }), 'b[0]=&c=c');
    expect(stringify({ a: [], b: [null], c: 'c' }, { encode: false })).toBe('b[0]=&c=c');
    // arrayFormat default
    // st.equal(
    // 	stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'indices' }),
    // 	'b[0]=&c=c',
    // );
    // st.equal(
    // 	stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'brackets' }),
    // 	'b[]=&c=c',
    // );
    // st.equal(
    // 	stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'repeat' }),
    // 	'b=&c=c',
    // );
    // st.equal(
    // 	stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'comma' }),
    // 	'b=&c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'comma', commaRoundTrip: true },
    // 	),
    // 	'b[]=&c=c',
    // );
    expect(stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'indices' })).toBe(
      'b[0]=&c=c',
    );
    expect(stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'brackets' })).toBe(
      'b[]=&c=c',
    );
    expect(stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'repeat' })).toBe('b=&c=c');
    expect(stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'comma' })).toBe('b=&c=c');
    expect(
      stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'comma', commaRoundTrip: true }),
    ).toBe('b[]=&c=c');

    // with strictNullHandling
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'indices', strictNullHandling: true },
    // 	),
    // 	'b[0]&c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'brackets', strictNullHandling: true },
    // 	),
    // 	'b[]&c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'repeat', strictNullHandling: true },
    // 	),
    // 	'b&c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'comma', strictNullHandling: true },
    // 	),
    // 	'b&c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'comma', strictNullHandling: true, commaRoundTrip: true },
    // 	),
    // 	'b[]&c=c',
    // );

    expect(
      stringify(
        { a: [], b: [null], c: 'c' },
        { encode: false, arrayFormat: 'indices', strictNullHandling: true },
      ),
    ).toBe('b[0]&c=c');
    expect(
      stringify(
        { a: [], b: [null], c: 'c' },
        { encode: false, arrayFormat: 'brackets', strictNullHandling: true },
      ),
    ).toBe('b[]&c=c');
    expect(
      stringify(
        { a: [], b: [null], c: 'c' },
        { encode: false, arrayFormat: 'repeat', strictNullHandling: true },
      ),
    ).toBe('b&c=c');
    expect(
      stringify(
        { a: [], b: [null], c: 'c' },
        { encode: false, arrayFormat: 'comma', strictNullHandling: true },
      ),
    ).toBe('b&c=c');
    expect(
      stringify(
        { a: [], b: [null], c: 'c' },
        { encode: false, arrayFormat: 'comma', strictNullHandling: true, commaRoundTrip: true },
      ),
    ).toBe('b[]&c=c');

    // with skipNulls
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'indices', skipNulls: true },
    // 	),
    // 	'c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'brackets', skipNulls: true },
    // 	),
    // 	'c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'repeat', skipNulls: true },
    // 	),
    // 	'c=c',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [], b: [null], c: 'c' },
    // 		{ encode: false, arrayFormat: 'comma', skipNulls: true },
    // 	),
    // 	'c=c',
    // );
    expect(
      stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'indices', skipNulls: true }),
    ).toBe('c=c');
    expect(
      stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'brackets', skipNulls: true }),
    ).toBe('c=c');
    expect(
      stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'repeat', skipNulls: true }),
    ).toBe('c=c');
    expect(
      stringify({ a: [], b: [null], c: 'c' }, { encode: false, arrayFormat: 'comma', skipNulls: true }),
    ).toBe('c=c');
  });

  test('stringifies a null object', function () {
    var obj = Object.create(null);
    obj.a = 'b';
    // st.equal(stringify(obj), 'a=b');
    expect(stringify(obj)).toBe('a=b');
  });

  test('returns an empty string for invalid input', function () {
    // st.equal(stringify(undefined), '');
    // st.equal(stringify(false), '');
    // st.equal(stringify(null), '');
    // st.equal(stringify(''), '');
    expect(stringify(undefined)).toBe('');
    expect(stringify(false)).toBe('');
    expect(stringify(null)).toBe('');
    expect(stringify('')).toBe('');
  });

  test('stringifies an object with a null object as a child', function () {
    var obj = { a: Object.create(null) };

    obj.a.b = 'c';
    // st.equal(stringify(obj), 'a%5Bb%5D=c');
    expect(stringify(obj)).toBe('a%5Bb%5D=c');
  });

  test('drops keys with a value of undefined', function () {
    // st.equal(stringify({ a: undefined }), '');
    expect(stringify({ a: undefined })).toBe('');

    // st.equal(
    // 	stringify({ a: { b: undefined, c: null } }, { strictNullHandling: true }),
    // 	'a%5Bc%5D',
    // );
    // st.equal(
    // 	stringify({ a: { b: undefined, c: null } }, { strictNullHandling: false }),
    // 	'a%5Bc%5D=',
    // );
    // st.equal(stringify({ a: { b: undefined, c: '' } }), 'a%5Bc%5D=');
    expect(stringify({ a: { b: undefined, c: null } }, { strictNullHandling: true })).toBe('a%5Bc%5D');
    expect(stringify({ a: { b: undefined, c: null } }, { strictNullHandling: false })).toBe('a%5Bc%5D=');
    expect(stringify({ a: { b: undefined, c: '' } })).toBe('a%5Bc%5D=');
  });

  test('url encodes values', function () {
    // st.equal(stringify({ a: 'b c' }), 'a=b%20c');
    expect(stringify({ a: 'b c' })).toBe('a=b%20c');
  });

  test('stringifies a date', function () {
    var now = new Date();
    var str = 'a=' + encodeURIComponent(now.toISOString());
    // st.equal(stringify({ a: now }), str);
    expect(stringify({ a: now })).toBe(str);
  });

  test('stringifies the weird object from qs', function () {
    // st.equal(
    // 	stringify({ 'my weird field': '~q1!2"\'w$5&7/z8)?' }),
    // 	'my%20weird%20field=~q1%212%22%27w%245%267%2Fz8%29%3F',
    // );
    expect(stringify({ 'my weird field': '~q1!2"\'w$5&7/z8)?' })).toBe(
      'my%20weird%20field=~q1%212%22%27w%245%267%2Fz8%29%3F',
    );
  });

  // TODO: Investigate how to to intercept in vitest
  // TODO(rob)
  test('skips properties that are part of the object prototype', function () {
    // st.intercept(Object.prototype, 'crash', { value: 'test' });
    // @ts-expect-error
    Object.prototype.crash = 'test';

    // st.equal(stringify({ a: 'b' }), 'a=b');
    // st.equal(stringify({ a: { b: 'c' } }), 'a%5Bb%5D=c');
    expect(stringify({ a: 'b' })).toBe('a=b');
    expect(stringify({ a: { b: 'c' } })).toBe('a%5Bb%5D=c');
  });

  test('stringifies boolean values', function () {
    // st.equal(stringify({ a: true }), 'a=true');
    // st.equal(stringify({ a: { b: true } }), 'a%5Bb%5D=true');
    // st.equal(stringify({ b: false }), 'b=false');
    // st.equal(stringify({ b: { c: false } }), 'b%5Bc%5D=false');
    expect(stringify({ a: true })).toBe('a=true');
    expect(stringify({ a: { b: true } })).toBe('a%5Bb%5D=true');
    expect(stringify({ b: false })).toBe('b=false');
    expect(stringify({ b: { c: false } })).toBe('b%5Bc%5D=false');
  });

  test('stringifies buffer values', function () {
    // st.equal(stringify({ a: Buffer.from('test') }), 'a=test');
    // st.equal(stringify({ a: { b: Buffer.from('test') } }), 'a%5Bb%5D=test');
  });

  test('stringifies an object using an alternative delimiter', function () {
    // st.equal(stringify({ a: 'b', c: 'd' }, { delimiter: ';' }), 'a=b;c=d');
    expect(stringify({ a: 'b', c: 'd' }, { delimiter: ';' })).toBe('a=b;c=d');
  });

  // We dont target environments which dont even have Buffer
  // test('does not blow up when Buffer global is missing', function () {
  // 	var restore = mockProperty(global, 'Buffer', { delete: true });

  // 	var result = stringify({ a: 'b', c: 'd' });

  // 	restore();

  // 	st.equal(result, 'a=b&c=d');
  // 	st.end();
  // });

  test('does not crash when parsing circular references', function () {
    var a: any = {};
    a.b = a;

    // st['throws'](
    // 	function () {
    // 		stringify({ 'foo[bar]': 'baz', 'foo[baz]': a });
    // 	},
    // 	/RangeError: Cyclic object value/,
    // 	'cyclic values throw',
    // );
    expect(() => {
      stringify({ 'foo[bar]': 'baz', 'foo[baz]': a });
    }).toThrow('Cyclic object value');

    var circular: any = {
      a: 'value',
    };
    circular.a = circular;
    // st['throws'](
    // 	function () {
    // 		stringify(circular);
    // 	},
    // 	/RangeError: Cyclic object value/,
    // 	'cyclic values throw',
    // );
    expect(() => {
      stringify(circular);
    }).toThrow('Cyclic object value');

    var arr = ['a'];
    // st.doesNotThrow(function () {
    // 	stringify({ x: arr, y: arr });
    // }, 'non-cyclic values do not throw');
    expect(() => {
      stringify({ x: arr, y: arr });
    }).not.toThrow();
  });

  test('non-circular duplicated references can still work', function () {
    var hourOfDay = {
      function: 'hour_of_day',
    };

    var p1 = {
      function: 'gte',
      arguments: [hourOfDay, 0],
    };
    var p2 = {
      function: 'lte',
      arguments: [hourOfDay, 23],
    };

    // st.equal(
    // 	stringify(
    // 		{ filters: { $and: [p1, p2] } },
    // 		{ encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'filters[$and][0][function]=gte&filters[$and][0][arguments][0][function]=hour_of_day&filters[$and][0][arguments][1]=0&filters[$and][1][function]=lte&filters[$and][1][arguments][0][function]=hour_of_day&filters[$and][1][arguments][1]=23',
    // );
    // st.equal(
    // 	stringify(
    // 		{ filters: { $and: [p1, p2] } },
    // 		{ encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'filters[$and][][function]=gte&filters[$and][][arguments][][function]=hour_of_day&filters[$and][][arguments][]=0&filters[$and][][function]=lte&filters[$and][][arguments][][function]=hour_of_day&filters[$and][][arguments][]=23',
    // );
    // st.equal(
    // 	stringify(
    // 		{ filters: { $and: [p1, p2] } },
    // 		{ encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'filters[$and][function]=gte&filters[$and][arguments][function]=hour_of_day&filters[$and][arguments]=0&filters[$and][function]=lte&filters[$and][arguments][function]=hour_of_day&filters[$and][arguments]=23',
    // );
    expect(
      stringify({ filters: { $and: [p1, p2] } }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    ).toBe(
      'filters[$and][0][function]=gte&filters[$and][0][arguments][0][function]=hour_of_day&filters[$and][0][arguments][1]=0&filters[$and][1][function]=lte&filters[$and][1][arguments][0][function]=hour_of_day&filters[$and][1][arguments][1]=23',
    );
    expect(
      stringify({ filters: { $and: [p1, p2] } }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe(
      'filters[$and][][function]=gte&filters[$and][][arguments][][function]=hour_of_day&filters[$and][][arguments][]=0&filters[$and][][function]=lte&filters[$and][][arguments][][function]=hour_of_day&filters[$and][][arguments][]=23',
    );
    expect(
      stringify({ filters: { $and: [p1, p2] } }, { encodeValuesOnly: true, arrayFormat: 'repeat' }),
    ).toBe(
      'filters[$and][function]=gte&filters[$and][arguments][function]=hour_of_day&filters[$and][arguments]=0&filters[$and][function]=lte&filters[$and][arguments][function]=hour_of_day&filters[$and][arguments]=23',
    );
  });

  test('selects properties when filter=array', function () {
    // st.equal(stringify({ a: 'b' }, { filter: ['a'] }), 'a=b');
    // st.equal(stringify({ a: 1 }, { filter: [] }), '');
    expect(stringify({ a: 'b' }, { filter: ['a'] })).toBe('a=b');
    expect(stringify({ a: 1 }, { filter: [] })).toBe('');

    // st.equal(
    // 	stringify(
    // 		{ a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' },
    // 		{ filter: ['a', 'b', 0, 2], arrayFormat: 'indices' },
    // 	),
    // 	'a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B2%5D=3',
    // 	'indices => indices',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' },
    // 		{ filter: ['a', 'b', 0, 2], arrayFormat: 'brackets' },
    // 	),
    // 	'a%5Bb%5D%5B%5D=1&a%5Bb%5D%5B%5D=3',
    // 	'brackets => brackets',
    // );
    // st.equal(
    // 	stringify({ a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' }, { filter: ['a', 'b', 0, 2] }),
    // 	'a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B2%5D=3',
    // 	'default => indices',
    // );
    expect(stringify({ a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' }, { filter: ['a', 'b', 0, 2] })).toBe(
      'a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B2%5D=3',
    );
    expect(
      stringify(
        { a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' },
        { filter: ['a', 'b', 0, 2], arrayFormat: 'indices' },
      ),
    ).toBe('a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B2%5D=3');
    expect(
      stringify(
        { a: { b: [1, 2, 3, 4], c: 'd' }, c: 'f' },
        { filter: ['a', 'b', 0, 2], arrayFormat: 'brackets' },
      ),
    ).toBe('a%5Bb%5D%5B%5D=1&a%5Bb%5D%5B%5D=3');
  });

  test('supports custom representations when filter=function', function () {
    var calls = 0;
    var obj = { a: 'b', c: 'd', e: { f: new Date(1257894000000) } };
    var filterFunc: StringifyOptions['filter'] = function (prefix, value) {
      calls += 1;
      if (calls === 1) {
        // st.equal(prefix, '', 'prefix is empty');
        // st.equal(value, obj);
        expect(prefix).toBe('');
        expect(value).toBe(obj);
      } else if (prefix === 'c') {
        return void 0;
      } else if (value instanceof Date) {
        // st.equal(prefix, 'e[f]');
        expect(prefix).toBe('e[f]');
        return value.getTime();
      }
      return value;
    };

    // st.equal(stringify(obj, { filter: filterFunc }), 'a=b&e%5Bf%5D=1257894000000');
    // st.equal(calls, 5);
    expect(stringify(obj, { filter: filterFunc })).toBe('a=b&e%5Bf%5D=1257894000000');
    expect(calls).toBe(5);
  });

  test('can disable uri encoding', function () {
    // st.equal(stringify({ a: 'b' }, { encode: false }), 'a=b');
    // st.equal(stringify({ a: { b: 'c' } }, { encode: false }), 'a[b]=c');
    // st.equal(
    // 	stringify({ a: 'b', c: null }, { strictNullHandling: true, encode: false }),
    // 	'a=b&c',
    // );
    expect(stringify({ a: 'b' }, { encode: false })).toBe('a=b');
    expect(stringify({ a: { b: 'c' } }, { encode: false })).toBe('a[b]=c');
    expect(stringify({ a: 'b', c: null }, { strictNullHandling: true, encode: false })).toBe('a=b&c');
  });

  test('can sort the keys', function () {
    // @ts-expect-error
    var sort: NonNullable<StringifyOptions['sort']> = function (a: string, b: string) {
      return a.localeCompare(b);
    };
    // st.equal(stringify({ a: 'c', z: 'y', b: 'f' }, { sort: sort }), 'a=c&b=f&z=y');
    // st.equal(
    // 	stringify({ a: 'c', z: { j: 'a', i: 'b' }, b: 'f' }, { sort: sort }),
    // 	'a=c&b=f&z%5Bi%5D=b&z%5Bj%5D=a',
    // );
    expect(stringify({ a: 'c', z: 'y', b: 'f' }, { sort: sort })).toBe('a=c&b=f&z=y');
    expect(stringify({ a: 'c', z: { j: 'a', i: 'b' }, b: 'f' }, { sort: sort })).toBe(
      'a=c&b=f&z%5Bi%5D=b&z%5Bj%5D=a',
    );
  });

  test('can sort the keys at depth 3 or more too', function () {
    // @ts-expect-error
    var sort: NonNullable<StringifyOptions['sort']> = function (a: string, b: string) {
      return a.localeCompare(b);
    };
    // st.equal(
    // 	stringify(
    // 		{ a: 'a', z: { zj: { zjb: 'zjb', zja: 'zja' }, zi: { zib: 'zib', zia: 'zia' } }, b: 'b' },
    // 		{ sort: sort, encode: false },
    // 	),
    // 	'a=a&b=b&z[zi][zia]=zia&z[zi][zib]=zib&z[zj][zja]=zja&z[zj][zjb]=zjb',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: 'a', z: { zj: { zjb: 'zjb', zja: 'zja' }, zi: { zib: 'zib', zia: 'zia' } }, b: 'b' },
    // 		{ sort: null, encode: false },
    // 	),
    // 	'a=a&z[zj][zjb]=zjb&z[zj][zja]=zja&z[zi][zib]=zib&z[zi][zia]=zia&b=b',
    // );
    expect(
      stringify(
        { a: 'a', z: { zj: { zjb: 'zjb', zja: 'zja' }, zi: { zib: 'zib', zia: 'zia' } }, b: 'b' },
        { sort: sort, encode: false },
      ),
    ).toBe('a=a&b=b&z[zi][zia]=zia&z[zi][zib]=zib&z[zj][zja]=zja&z[zj][zjb]=zjb');
    expect(
      stringify(
        { a: 'a', z: { zj: { zjb: 'zjb', zja: 'zja' }, zi: { zib: 'zib', zia: 'zia' } }, b: 'b' },
        { sort: null, encode: false },
      ),
    ).toBe('a=a&z[zj][zjb]=zjb&z[zj][zja]=zja&z[zi][zib]=zib&z[zi][zia]=zia&b=b');
  });

  test('can stringify with custom encoding', function () {
    // st.equal(
    // 	stringify(
    // 		{ 県: '大阪府', '': '' },
    // 		{
    // 			encoder: function (str) {
    // 				if (str.length === 0) {
    // 					return '';
    // 				}
    // 				var buf = iconv.encode(str, 'shiftjis');
    // 				var result = [];
    // 				for (var i = 0; i < buf.length; ++i) {
    // 					result.push(buf.readUInt8(i).toString(16));
    // 				}
    // 				return '%' + result.join('%');
    // 			},
    // 		},
    // 	),
    // 	'%8c%a7=%91%e5%8d%e3%95%7b&=',
    // );
    expect(
      stringify(
        { 県: '大阪府', '': '' },
        {
          encoder: function (str) {
            if (str.length === 0) {
              return '';
            }
            var buf = iconv.encode(str, 'shiftjis');
            var result = [];
            for (var i = 0; i < buf.length; ++i) {
              result.push(buf.readUInt8(i).toString(16));
            }
            return '%' + result.join('%');
          },
        },
      ),
    ).toBe('%8c%a7=%91%e5%8d%e3%95%7b&=');
  });

  test('receives the default encoder as a second argument', function () {
    // stringify(
    // 	{ a: 1, b: new Date(), c: true, d: [1] },
    // 	{
    // 		encoder: function (str) {
    // 			st.match(typeof str, /^(?:string|number|boolean)$/);
    // 			return '';
    // 		},
    // 	},
    // );

    stringify(
      { a: 1, b: new Date(), c: true, d: [1] },
      {
        encoder: function (str) {
          // st.match(typeof str, /^(?:string|number|boolean)$/);
          assert.match(typeof str, /^(?:string|number|boolean)$/);
          return '';
        },
      },
    );
  });

  test('receives the default encoder as a second argument', function () {
    // stringify(
    // 	{ a: 1 },
    // 	{
    // 		encoder: function (str, defaultEncoder) {
    // 			st.equal(defaultEncoder, utils.encode);
    // 		},
    // 	},
    // );

    stringify(
      { a: 1 },
      {
        // @ts-ignore
        encoder: function (_str, defaultEncoder) {
          expect(defaultEncoder).toBe(encode);
        },
      },
    );
  });

  test('throws error with wrong encoder', function () {
    // st['throws'](function () {
    // 	stringify({}, { encoder: 'string' });
    // }, new TypeError('Encoder has to be a function.'));
    // st.end();
    expect(() => {
      // @ts-expect-error
      stringify({}, { encoder: 'string' });
    }).toThrow(TypeError);
  });

  (typeof Buffer === 'undefined' ? test.skip : test)(
    'can use custom encoder for a buffer object',
    function () {
      // st.equal(
      // 	stringify(
      // 		{ a: Buffer.from([1]) },
      // 		{
      // 			encoder: function (buffer) {
      // 				if (typeof buffer === 'string') {
      // 					return buffer;
      // 				}
      // 				return String.fromCharCode(buffer.readUInt8(0) + 97);
      // 			},
      // 		},
      // 	),
      // 	'a=b',
      // );
      expect(
        stringify(
          { a: Buffer.from([1]) },
          {
            encoder: function (buffer) {
              if (typeof buffer === 'string') {
                return buffer;
              }
              return String.fromCharCode(buffer.readUInt8(0) + 97);
            },
          },
        ),
      ).toBe('a=b');

      // st.equal(
      // 	stringify(
      // 		{ a: Buffer.from('a b') },
      // 		{
      // 			encoder: function (buffer) {
      // 				return buffer;
      // 			},
      // 		},
      // 	),
      // 	'a=a b',
      // );
      expect(
        stringify(
          { a: Buffer.from('a b') },
          {
            encoder: function (buffer) {
              return buffer;
            },
          },
        ),
      ).toBe('a=a b');
    },
  );

  test('serializeDate option', function () {
    var date = new Date();
    // st.equal(
    // 	stringify({ a: date }),
    // 	'a=' + date.toISOString().replace(/:/g, '%3A'),
    // 	'default is toISOString',
    // );
    expect(stringify({ a: date })).toBe('a=' + date.toISOString().replace(/:/g, '%3A'));

    var mutatedDate = new Date();
    mutatedDate.toISOString = function () {
      throw new SyntaxError();
    };
    // st['throws'](function () {
    // 	mutatedDate.toISOString();
    // }, SyntaxError);
    expect(() => {
      mutatedDate.toISOString();
    }).toThrow(SyntaxError);
    // st.equal(
    // 	stringify({ a: mutatedDate }),
    // 	'a=' + Date.prototype.toISOString.call(mutatedDate).replace(/:/g, '%3A'),
    // 	'toISOString works even when method is not locally present',
    // );
    expect(stringify({ a: mutatedDate })).toBe(
      'a=' + Date.prototype.toISOString.call(mutatedDate).replace(/:/g, '%3A'),
    );

    var specificDate = new Date(6);
    // st.equal(
    // 	stringify(
    // 		{ a: specificDate },
    // 		{
    // 			serializeDate: function (d) {
    // 				return d.getTime() * 7;
    // 			},
    // 		},
    // 	),
    // 	'a=42',
    // 	'custom serializeDate function called',
    // );
    expect(
      stringify(
        { a: specificDate },
        {
          // @ts-ignore
          serializeDate: function (d) {
            return d.getTime() * 7;
          },
        },
      ),
    ).toBe('a=42');

    // st.equal(
    // 	stringify(
    // 		{ a: [date] },
    // 		{
    // 			serializeDate: function (d) {
    // 				return d.getTime();
    // 			},
    // 			arrayFormat: 'comma',
    // 		},
    // 	),
    // 	'a=' + date.getTime(),
    // 	'works with arrayFormat comma',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [date] },
    // 		{
    // 			serializeDate: function (d) {
    // 				return d.getTime();
    // 			},
    // 			arrayFormat: 'comma',
    // 			commaRoundTrip: true,
    // 		},
    // 	),
    // 	'a%5B%5D=' + date.getTime(),
    // 	'works with arrayFormat comma',
    // );
    expect(
      stringify(
        { a: [date] },
        {
          // @ts-expect-error
          serializeDate: function (d) {
            return d.getTime();
          },
          arrayFormat: 'comma',
        },
      ),
    ).toBe('a=' + date.getTime());
    expect(
      stringify(
        { a: [date] },
        {
          // @ts-expect-error
          serializeDate: function (d) {
            return d.getTime();
          },
          arrayFormat: 'comma',
          commaRoundTrip: true,
        },
      ),
    ).toBe('a%5B%5D=' + date.getTime());
  });

  test('RFC 1738 serialization', function () {
    // st.equal(stringify({ a: 'b c' }, { format: formats.RFC1738 }), 'a=b+c');
    // st.equal(stringify({ 'a b': 'c d' }, { format: formats.RFC1738 }), 'a+b=c+d');
    // st.equal(
    // 	stringify({ 'a b': Buffer.from('a b') }, { format: formats.RFC1738 }),
    // 	'a+b=a+b',
    // );
    expect(stringify({ a: 'b c' }, { format: 'RFC1738' })).toBe('a=b+c');
    expect(stringify({ 'a b': 'c d' }, { format: 'RFC1738' })).toBe('a+b=c+d');
    expect(stringify({ 'a b': Buffer.from('a b') }, { format: 'RFC1738' })).toBe('a+b=a+b');

    // st.equal(stringify({ 'foo(ref)': 'bar' }, { format: formats.RFC1738 }), 'foo(ref)=bar');
    expect(stringify({ 'foo(ref)': 'bar' }, { format: 'RFC1738' })).toBe('foo(ref)=bar');
  });

  test('RFC 3986 spaces serialization', function () {
    // st.equal(stringify({ a: 'b c' }, { format: formats.RFC3986 }), 'a=b%20c');
    // st.equal(stringify({ 'a b': 'c d' }, { format: formats.RFC3986 }), 'a%20b=c%20d');
    // st.equal(
    // 	stringify({ 'a b': Buffer.from('a b') }, { format: formats.RFC3986 }),
    // 	'a%20b=a%20b',
    // );
    expect(stringify({ a: 'b c' }, { format: 'RFC3986' })).toBe('a=b%20c');
    expect(stringify({ 'a b': 'c d' }, { format: 'RFC3986' })).toBe('a%20b=c%20d');
    expect(stringify({ 'a b': Buffer.from('a b') }, { format: 'RFC3986' })).toBe('a%20b=a%20b');
  });

  test('Backward compatibility to RFC 3986', function () {
    // st.equal(stringify({ a: 'b c' }), 'a=b%20c');
    // st.equal(stringify({ 'a b': Buffer.from('a b') }), 'a%20b=a%20b');
    expect(stringify({ a: 'b c' })).toBe('a=b%20c');
    expect(stringify({ 'a b': Buffer.from('a b') })).toBe('a%20b=a%20b');
  });

  test('Edge cases and unknown formats', function () {
    ['UFO1234', false, 1234, null, {}, []].forEach(function (format) {
      // st['throws'](function () {
      // 	stringify({ a: 'b c' }, { format: format });
      // }, new TypeError('Unknown format option provided.'));
      expect(() => {
        // @ts-expect-error
        stringify({ a: 'b c' }, { format: format });
      }).toThrow(TypeError);
    });
  });

  test('encodeValuesOnly', function () {
    // st.equal(
    // 	stringify(
    // 		{ a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a=b&c[0]=d&c[1]=e%3Df&f[0][0]=g&f[1][0]=h',
    // 	'encodeValuesOnly + indices',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a=b&c[]=d&c[]=e%3Df&f[][]=g&f[][]=h',
    // 	'encodeValuesOnly + brackets',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a=b&c=d&c=e%3Df&f=g&f=h',
    // 	'encodeValuesOnly + repeat',
    // );
    expect(
      stringify(
        { a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
        { encodeValuesOnly: true, arrayFormat: 'indices' },
      ),
    ).toBe('a=b&c[0]=d&c[1]=e%3Df&f[0][0]=g&f[1][0]=h');
    expect(
      stringify(
        { a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
        { encodeValuesOnly: true, arrayFormat: 'brackets' },
      ),
    ).toBe('a=b&c[]=d&c[]=e%3Df&f[][]=g&f[][]=h');
    expect(
      stringify(
        { a: 'b', c: ['d', 'e=f'], f: [['g'], ['h']] },
        { encodeValuesOnly: true, arrayFormat: 'repeat' },
      ),
    ).toBe('a=b&c=d&c=e%3Df&f=g&f=h');

    // st.equal(
    // 	stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'indices' }),
    // 	'a=b&c%5B0%5D=d&c%5B1%5D=e&f%5B0%5D%5B0%5D=g&f%5B1%5D%5B0%5D=h',
    // 	'no encodeValuesOnly + indices',
    // );
    // st.equal(
    // 	stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'brackets' }),
    // 	'a=b&c%5B%5D=d&c%5B%5D=e&f%5B%5D%5B%5D=g&f%5B%5D%5B%5D=h',
    // 	'no encodeValuesOnly + brackets',
    // );
    // st.equal(
    // 	stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'repeat' }),
    // 	'a=b&c=d&c=e&f=g&f=h',
    // 	'no encodeValuesOnly + repeat',
    // );
    expect(stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'indices' })).toBe(
      'a=b&c%5B0%5D=d&c%5B1%5D=e&f%5B0%5D%5B0%5D=g&f%5B1%5D%5B0%5D=h',
    );
    expect(stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'brackets' })).toBe(
      'a=b&c%5B%5D=d&c%5B%5D=e&f%5B%5D%5B%5D=g&f%5B%5D%5B%5D=h',
    );
    expect(stringify({ a: 'b', c: ['d', 'e'], f: [['g'], ['h']] }, { arrayFormat: 'repeat' })).toBe(
      'a=b&c=d&c=e&f=g&f=h',
    );
  });

  test('encodeValuesOnly - strictNullHandling', function () {
    // st.equal(
    // 	stringify({ a: { b: null } }, { encodeValuesOnly: true, strictNullHandling: true }),
    // 	'a[b]',
    // );
    expect(stringify({ a: { b: null } }, { encodeValuesOnly: true, strictNullHandling: true })).toBe('a[b]');
  });

  test('throws if an invalid charset is specified', function () {
    // st['throws'](function () {
    // 	stringify({ a: 'b' }, { charset: 'foobar' });
    // }, new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined'));
    expect(() => {
      // @ts-expect-error
      stringify({ a: 'b' }, { charset: 'foobar' });
    }).toThrow(TypeError);
  });

  test('respects a charset of iso-8859-1', function () {
    // st.equal(stringify({ æ: 'æ' }, { charset: 'iso-8859-1' }), '%E6=%E6');
    expect(stringify({ æ: 'æ' }, { charset: 'iso-8859-1' })).toBe('%E6=%E6');
  });

  test('encodes unrepresentable chars as numeric entities in iso-8859-1 mode', function () {
    // st.equal(stringify({ a: '☺' }, { charset: 'iso-8859-1' }), 'a=%26%239786%3B');
    expect(stringify({ a: '☺' }, { charset: 'iso-8859-1' })).toBe('a=%26%239786%3B');
  });

  test('respects an explicit charset of utf-8 (the default)', function () {
    // st.equal(stringify({ a: 'æ' }, { charset: 'utf-8' }), 'a=%C3%A6');
    expect(stringify({ a: 'æ' }, { charset: 'utf-8' })).toBe('a=%C3%A6');
  });

  test('`charsetSentinel` option', function () {
    // st.equal(
    // 	stringify({ a: 'æ' }, { charsetSentinel: true, charset: 'utf-8' }),
    // 	'utf8=%E2%9C%93&a=%C3%A6',
    // 	'adds the right sentinel when instructed to and the charset is utf-8',
    // );
    expect(stringify({ a: 'æ' }, { charsetSentinel: true, charset: 'utf-8' })).toBe(
      'utf8=%E2%9C%93&a=%C3%A6',
    );

    // st.equal(
    // 	stringify({ a: 'æ' }, { charsetSentinel: true, charset: 'iso-8859-1' }),
    // 	'utf8=%26%2310003%3B&a=%E6',
    // 	'adds the right sentinel when instructed to and the charset is iso-8859-1',
    // );
    expect(stringify({ a: 'æ' }, { charsetSentinel: true, charset: 'iso-8859-1' })).toBe(
      'utf8=%26%2310003%3B&a=%E6',
    );
  });

  test('does not mutate the options argument', function () {
    var options = {};
    stringify({}, options);
    // st.deepEqual(options, {});
    expect(options).toEqual({});
  });

  test('strictNullHandling works with custom filter', function () {
    // @ts-expect-error
    var filter = function (_prefix, value) {
      return value;
    };

    var options = { strictNullHandling: true, filter: filter };
    // st.equal(stringify({ key: null }, options), 'key');
    expect(stringify({ key: null }, options)).toBe('key');
  });

  test('strictNullHandling works with null serializeDate', function () {
    var serializeDate = function () {
      return null;
    };
    var options = { strictNullHandling: true, serializeDate: serializeDate };
    var date = new Date();
    // st.equal(stringify({ key: date }, options), 'key');
    // @ts-expect-error
    expect(stringify({ key: date }, options)).toBe('key');
  });

  test('allows for encoding keys and values differently', function () {
    // @ts-expect-error
    var encoder = function (str, defaultEncoder, charset, type) {
      if (type === 'key') {
        return defaultEncoder(str, defaultEncoder, charset, type).toLowerCase();
      }
      if (type === 'value') {
        return defaultEncoder(str, defaultEncoder, charset, type).toUpperCase();
      }
      throw 'this should never happen! type: ' + type;
    };

    // st.deepEqual(stringify({ KeY: 'vAlUe' }, { encoder: encoder }), 'key=VALUE');
    expect(stringify({ KeY: 'vAlUe' }, { encoder: encoder })).toBe('key=VALUE');
  });

  test('objects inside arrays', function () {
    var obj = { a: { b: { c: 'd', e: 'f' } } };
    var withArray = { a: { b: [{ c: 'd', e: 'f' }] } };

    // st.equal(
    // 	stringify(obj, { encode: false }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'no array, no arrayFormat',
    // );
    // st.equal(
    // 	stringify(obj, { encode: false, arrayFormat: 'brackets' }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'no array, bracket',
    // );
    // st.equal(
    // 	stringify(obj, { encode: false, arrayFormat: 'indices' }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'no array, indices',
    // );
    // st.equal(
    // 	stringify(obj, { encode: false, arrayFormat: 'repeat' }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'no array, repeat',
    // );
    // st.equal(
    // 	stringify(obj, { encode: false, arrayFormat: 'comma' }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'no array, comma',
    // );
    expect(stringify(obj, { encode: false })).toBe('a[b][c]=d&a[b][e]=f');
    expect(stringify(obj, { encode: false, arrayFormat: 'brackets' })).toBe('a[b][c]=d&a[b][e]=f');
    expect(stringify(obj, { encode: false, arrayFormat: 'indices' })).toBe('a[b][c]=d&a[b][e]=f');
    expect(stringify(obj, { encode: false, arrayFormat: 'repeat' })).toBe('a[b][c]=d&a[b][e]=f');
    expect(stringify(obj, { encode: false, arrayFormat: 'comma' })).toBe('a[b][c]=d&a[b][e]=f');

    // st.equal(
    // 	stringify(withArray, { encode: false }),
    // 	'a[b][0][c]=d&a[b][0][e]=f',
    // 	'array, no arrayFormat',
    // );
    // st.equal(
    // 	stringify(withArray, { encode: false, arrayFormat: 'brackets' }),
    // 	'a[b][][c]=d&a[b][][e]=f',
    // 	'array, bracket',
    // );
    // st.equal(
    // 	stringify(withArray, { encode: false, arrayFormat: 'indices' }),
    // 	'a[b][0][c]=d&a[b][0][e]=f',
    // 	'array, indices',
    // );
    // st.equal(
    // 	stringify(withArray, { encode: false, arrayFormat: 'repeat' }),
    // 	'a[b][c]=d&a[b][e]=f',
    // 	'array, repeat',
    // );
    // st.equal(
    // 	stringify(withArray, { encode: false, arrayFormat: 'comma' }),
    // 	'???',
    // 	'array, comma',
    // 	{ skip: 'TODO: figure out what this should do' },
    // );
    expect(stringify(withArray, { encode: false })).toBe('a[b][0][c]=d&a[b][0][e]=f');
    expect(stringify(withArray, { encode: false, arrayFormat: 'brackets' })).toBe('a[b][][c]=d&a[b][][e]=f');
    expect(stringify(withArray, { encode: false, arrayFormat: 'indices' })).toBe('a[b][0][c]=d&a[b][0][e]=f');
    expect(stringify(withArray, { encode: false, arrayFormat: 'repeat' })).toBe('a[b][c]=d&a[b][e]=f');
    // !TODo: Figure out what this should do
    // expect(stringify(withArray, { encode: false, arrayFormat: 'comma' })).toBe(
    // 	'a[b][c]=d&a[b][e]=f',
    // );
  });

  test('stringifies sparse arrays', function () {
    // st.equal(
    // 	stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    // 	'a[1]=2&a[4]=1',
    // );
    // st.equal(
    // 	stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    // 	'a[]=2&a[]=1',
    // );
    // st.equal(
    // 	stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'repeat' }),
    // 	'a=2&a=1',
    // );
    expect(stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'indices' })).toBe(
      'a[1]=2&a[4]=1',
    );
    expect(stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'brackets' })).toBe(
      'a[]=2&a[]=1',
    );
    expect(stringify({ a: [, '2', , , '1'] }, { encodeValuesOnly: true, arrayFormat: 'repeat' })).toBe(
      'a=2&a=1',
    );

    // st.equal(
    // 	stringify(
    // 		{ a: [, { b: [, , { c: '1' }] }] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a[1][b][2][c]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, { b: [, , { c: '1' }] }] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a[][b][][c]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, { b: [, , { c: '1' }] }] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a[b][c]=1',
    // );
    expect(
      stringify({ a: [, { b: [, , { c: '1' }] }] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    ).toBe('a[1][b][2][c]=1');
    expect(
      stringify({ a: [, { b: [, , { c: '1' }] }] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe('a[][b][][c]=1');
    expect(
      stringify({ a: [, { b: [, , { c: '1' }] }] }, { encodeValuesOnly: true, arrayFormat: 'repeat' }),
    ).toBe('a[b][c]=1');

    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: '1' }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a[1][2][3][c]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: '1' }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a[][][][c]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: '1' }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a[c]=1',
    // );
    expect(
      stringify({ a: [, [, , [, , , { c: '1' }]]] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    ).toBe('a[1][2][3][c]=1');
    expect(
      stringify({ a: [, [, , [, , , { c: '1' }]]] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe('a[][][][c]=1');
    expect(
      stringify({ a: [, [, , [, , , { c: '1' }]]] }, { encodeValuesOnly: true, arrayFormat: 'repeat' }),
    ).toBe('a[c]=1');

    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: [, '1'] }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'indices' },
    // 	),
    // 	'a[1][2][3][c][1]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: [, '1'] }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'brackets' },
    // 	),
    // 	'a[][][][c][]=1',
    // );
    // st.equal(
    // 	stringify(
    // 		{ a: [, [, , [, , , { c: [, '1'] }]]] },
    // 		{ encodeValuesOnly: true, arrayFormat: 'repeat' },
    // 	),
    // 	'a[c]=1',
    // );
    expect(
      stringify({ a: [, [, , [, , , { c: [, '1'] }]]] }, { encodeValuesOnly: true, arrayFormat: 'indices' }),
    ).toBe('a[1][2][3][c][1]=1');
    expect(
      stringify({ a: [, [, , [, , , { c: [, '1'] }]]] }, { encodeValuesOnly: true, arrayFormat: 'brackets' }),
    ).toBe('a[][][][c][]=1');
    expect(
      stringify({ a: [, [, , [, , , { c: [, '1'] }]]] }, { encodeValuesOnly: true, arrayFormat: 'repeat' }),
    ).toBe('a[c]=1');
  });

  test('encodes a very long string', function () {
    var chars = [];
    var expected = [];
    for (var i = 0; i < 5e3; i++) {
      chars.push(' ' + i);

      expected.push('%20' + i);
    }

    var obj = {
      foo: chars.join(''),
    };

    // st.equal(
    // 	stringify(obj, { arrayFormat: 'bracket', charset: 'utf-8' }),
    // 	'foo=' + expected.join(''),
    // );
    // @ts-expect-error
    expect(stringify(obj, { arrayFormat: 'bracket', charset: 'utf-8' })).toBe('foo=' + expected.join(''));
  });
});

describe('stringifies empty keys', function () {
  empty_test_cases.forEach(function (testCase) {
    test('stringifies an object with empty string key with ' + testCase.input, function () {
      // st.deepEqual(
      // 	stringify(testCase.withEmptyKeys, { encode: false, arrayFormat: 'indices' }),
      // 	testCase.stringifyOutput.indices,
      // 	'test case: ' + testCase.input + ', indices',
      // );
      // st.deepEqual(
      // 	stringify(testCase.withEmptyKeys, { encode: false, arrayFormat: 'brackets' }),
      // 	testCase.stringifyOutput.brackets,
      // 	'test case: ' + testCase.input + ', brackets',
      // );
      // st.deepEqual(
      // 	stringify(testCase.withEmptyKeys, { encode: false, arrayFormat: 'repeat' }),
      // 	testCase.stringifyOutput.repeat,
      // 	'test case: ' + testCase.input + ', repeat',
      // );
      expect(stringify(testCase.with_empty_keys, { encode: false, arrayFormat: 'indices' })).toBe(
        testCase.stringify_output.indices,
      );
      expect(stringify(testCase.with_empty_keys, { encode: false, arrayFormat: 'brackets' })).toBe(
        testCase.stringify_output.brackets,
      );
      expect(stringify(testCase.with_empty_keys, { encode: false, arrayFormat: 'repeat' })).toBe(
        testCase.stringify_output.repeat,
      );
    });
  });

  test('edge case with object/arrays', function () {
    // st.deepEqual(stringify({ '': { '': [2, 3] } }, { encode: false }), '[][0]=2&[][1]=3');
    // st.deepEqual(
    // 	stringify({ '': { '': [2, 3], a: 2 } }, { encode: false }),
    // 	'[][0]=2&[][1]=3&[a]=2',
    // );
    // st.deepEqual(
    // 	stringify({ '': { '': [2, 3] } }, { encode: false, arrayFormat: 'indices' }),
    // 	'[][0]=2&[][1]=3',
    // );
    // st.deepEqual(
    // 	stringify({ '': { '': [2, 3], a: 2 } }, { encode: false, arrayFormat: 'indices' }),
    // 	'[][0]=2&[][1]=3&[a]=2',
    // );
    expect(stringify({ '': { '': [2, 3] } }, { encode: false })).toBe('[][0]=2&[][1]=3');
    expect(stringify({ '': { '': [2, 3], a: 2 } }, { encode: false })).toBe('[][0]=2&[][1]=3&[a]=2');
    expect(stringify({ '': { '': [2, 3] } }, { encode: false, arrayFormat: 'indices' })).toBe(
      '[][0]=2&[][1]=3',
    );
    expect(stringify({ '': { '': [2, 3], a: 2 } }, { encode: false, arrayFormat: 'indices' })).toBe(
      '[][0]=2&[][1]=3&[a]=2',
    );
  });
});
