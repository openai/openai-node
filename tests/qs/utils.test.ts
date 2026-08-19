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
  const graphOperations = [
    {
      name: 'merge',
      apply: (target: Record<string, any>, source: Record<string, any>) => merge(target, source),
    },
    {
      name: 'assign_single_source',
      apply: (target: Record<string, any>, source: Record<string, any>) =>
        assign_single_source(target, source),
    },
  ];

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

  test('snapshots mutable adopted records while preserving array holes and null prototypes', () => {
    const safe = Object.assign(Object.create(null), { value: true });
    const sparse: unknown[] = [];
    sparse[2] = safe;
    const result = merge({}, { safe, sparse });

    expect(result.safe).not.toBe(safe);
    expect(result.sparse).not.toBe(sparse);
    expect(result.sparse[2]).toBe(result.safe);
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

  test('revalidates and replaces every alias after a source getter mutates a safe record', () => {
    const shared: Record<string, unknown> = { safe: true };
    let getterCalls = 0;
    const source = {
      first: shared,
      get mutate() {
        getterCalls += 1;
        Object.defineProperty(shared, '__proto__', {
          configurable: true,
          enumerable: true,
          value: { polluted: true },
        });
        return true;
      },
      second: shared,
    };
    const result = merge({}, source);

    expect(getterCalls).toBe(1);
    expect(result.first).toBe(result.second);
    expect(result.first).not.toBe(shared);
    expect(has(result.first, '__proto__')).toBe(false);
    expect(has(result.second, '__proto__')).toBe(false);
    expect(has(shared, '__proto__')).toBe(true);
  });

  test('shares sanitized aliases across recursive collisions and new adoptions', () => {
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":true}');
    const result = merge({ first: 'existing' }, { first: unsafe, second: unsafe });

    expect(result.first).toEqual(['existing', { safe: true }]);
    expect(result.first[1]).toBe(result.second);
    expect(has(result.second, '__proto__')).toBe(false);
    expect(has(unsafe, '__proto__')).toBe(true);
  });

  test.each([
    { name: 'Date', create: () => new Date('2026-08-18T00:00:00.000Z') },
    { name: 'Map', create: () => new Map([['safe', true]]) },
    { name: 'Set', create: () => new Set(['safe']) },
    { name: 'typed array', create: () => new Uint8Array([1, 2]) },
    {
      name: 'private-field instance',
      create: () =>
        new (class {
          #value = true;
          child = { safe: true };

          getValue() {
            return this.#value;
          }
        })(),
    },
  ])(
    'preserves safe $name identity and rejects unsafe values without forging internal slots',
    ({ create }) => {
      const value = create();

      expect(merge({}, { safe: value }).safe).toBe(value);
      Object.defineProperty(value, '__proto__', {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });
      expect(() => merge({}, { unsafe: value })).toThrow(/safely sanitize|unsupported prototype/iu);
      expect(has(value, '__proto__')).toBe(true);
    },
  );

  test('iteratively snapshots adopted records deeper than the JavaScript call stack', () => {
    const root: Record<string, any> = {};
    let current = root;
    for (let index = 0; index < 6000; index += 1) {
      current['next'] = {};
      current = current['next'];
    }

    const result = merge({}, { nested: root });
    expect(result.nested === root).toBe(false);
    expect(typeof result.nested.next).toBe('object');
  });

  test('fails closed when adopted records exceed the bounded traversal budget', () => {
    const root: Record<string, any> = {};
    let current = root;
    for (let index = 0; index < 10_001; index += 1) {
      current['next'] = {};
      current = current['next'];
    }

    expect(() => merge({}, { nested: root })).toThrow(/adopted record|traversal|limit/iu);
  });

  test('detaches earlier aliases before later proxy descriptor traps can mutate source records', () => {
    const shared: Record<string, unknown> = { safe: true };
    let inspections = 0;
    const later = new Proxy(
      { value: true },
      {
        ownKeys(value) {
          inspections += 1;
          if (inspections === 2) {
            Object.defineProperty(shared, '__proto__', {
              configurable: true,
              enumerable: true,
              value: { polluted: true },
            });
          }
          return Reflect.ownKeys(value);
        },
      },
    );
    const result = merge({}, { first: shared, second: later });

    expect(has(result.first, '__proto__')).toBe(false);
    const destination = {};
    expect(Object.assign(destination, result.first)).toBe(destination);
    expect(Object.getPrototypeOf(destination)).toBe(Object.prototype);
    expect(inspections).toBe(1);
  });

  test('keeps unpublished snapshots safe when a later proxy mutates the original alias', () => {
    const shared: Record<string, unknown> = { safe: true };
    const later = new Proxy(
      { value: true },
      {
        ownKeys(value) {
          Object.defineProperty(shared, '__proto__', {
            configurable: true,
            enumerable: true,
            value: { polluted: true },
          });
          return Reflect.ownKeys(value);
        },
      },
    );
    const result = merge({}, { first: shared, second: later });

    expect(result.first).not.toBe(shared);
    expect(has(result.first, '__proto__')).toBe(false);
    expect(has(shared, '__proto__')).toBe(true);
  });

  test('snapshots two thousand aliases to a shared two-thousand-record graph only once', () => {
    let inspections = 0;
    const root: Record<string, any> = new Proxy(
      {},
      {
        ownKeys(value) {
          inspections += 1;
          if (inspections > 4) {
            throw new Error('Shared adopted graph was rescanned.');
          }
          return Reflect.ownKeys(value);
        },
      },
    );
    let current = root;
    for (let index = 0; index < 1999; index += 1) {
      current['next'] = {};
      current = current['next'];
    }
    const source: Record<string, unknown> = {};
    for (let index = 0; index < 2000; index += 1) {
      source[`alias-${index}`] = root;
    }
    const result = merge({}, source);

    expect(result['alias-0']).toBe(result['alias-1999']);
    expect(result['alias-0']).not.toBe(root);
    expect(inspections).toBeLessThanOrEqual(4);
  });

  test.each([
    {
      name: 'ordinary function',
      create: () => {
        const safe = true;
        return function value() {
          return safe;
        };
      },
    },
    { name: 'arrow function', create: () => () => true },
    { name: 'bound function', create: () => Object.prototype.hasOwnProperty.bind({}) },
  ])('preserves safe $name identity but rejects enumerable unsafe callable records', ({ create }) => {
    const callable = create();

    expect(merge({}, { safe: callable }).safe).toBe(callable);
    Object.defineProperty(callable, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
    });
    expect(() => merge({}, { unsafe: callable })).toThrow(/safely sanitize|unsupported|callable/iu);
    expect(has(callable, '__proto__')).toBe(true);
  });

  test('assign_single_source safely snapshots nested records and shared aliases', () => {
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":true}');
    const inherited = { inherited: true };
    const target = Object.create(inherited);
    const result = assign_single_source(target, { first: unsafe, second: unsafe });

    expect(result).toBe(target);
    expect(Object.getPrototypeOf(result)).toBe(inherited);
    expect(result.first).toBe(result.second);
    expect(result.first).toEqual({ safe: true });
    expect(has(unsafe, '__proto__')).toBe(true);
  });

  test('assign_single_source rejects unsafe callable records without invoking them', () => {
    let calls = 0;
    const unsafe = () => {
      calls += 1;
    };
    Object.defineProperty(unsafe, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
    });

    expect(() => assign_single_source({}, { unsafe })).toThrow(/safely sanitize|unsupported|callable/iu);
    expect(calls).toBe(0);
  });

  test.each(graphOperations)(
    '$name rejects unsupported unsafe keys even when a proxy changes their enumerability',
    ({ apply }) => {
      const unsupported = Object.create({ inherited: true }) as Record<string, unknown>;
      Object.defineProperty(unsupported, '__proto__', {
        configurable: true,
        enumerable: false,
        value: { polluted: true },
      });
      const unstable = new Proxy(unsupported, {
        getPrototypeOf(value) {
          Object.defineProperty(value, '__proto__', {
            configurable: true,
            enumerable: true,
            value: { polluted: true },
          });
          return Reflect.getPrototypeOf(value);
        },
      });
      const target = { original: true };

      expect(() => apply(target, { value: unstable })).toThrow(/safely sanitize|unsupported|callable/iu);
      expect(target).toEqual({ original: true });
    },
  );

  test.each(graphOperations)(
    '$name leaves the caller target untouched when sanitation rejects',
    ({ apply }) => {
      const unsafe = new Date('2026-08-18T00:00:00.000Z');
      Object.defineProperty(unsafe, '__proto__', {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });
      const target = { original: true };

      expect(() => apply(target, { first: 'must not commit', unsafe })).toThrow(
        /safely sanitize|unsupported|callable/iu,
      );
      expect(target).toEqual({ original: true });
    },
  );

  test.each(graphOperations)(
    '$name snapshots source getters exactly once before committing any target property',
    ({ apply }) => {
      const unsafe = new Date('2026-08-18T00:00:00.000Z');
      Object.defineProperty(unsafe, '__proto__', {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
      });
      let getterCalls = 0;
      const source = {
        first: 'must not commit',
        get unsafe() {
          getterCalls += 1;
          return unsafe;
        },
      };
      const target = { original: true };

      expect(() => apply(target, source)).toThrow(/safely sanitize|unsupported|callable/iu);
      expect(getterCalls).toBe(1);
      expect(target).toEqual({ original: true });
    },
  );

  test('merge snapshots recursive collision getters before mutating the caller target', () => {
    const unsafe = new Date('2026-08-18T00:00:00.000Z');
    Object.defineProperty(unsafe, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
    });
    let getterCalls = 0;
    const child = { existing: true };
    const target = { child };
    const source = {
      first: 'must not commit',
      child: {
        get unsafe() {
          getterCalls += 1;
          return unsafe;
        },
      },
    };

    expect(() => merge(target, source)).toThrow(/safely sanitize|unsupported|callable/iu);
    expect(getterCalls).toBe(1);
    expect(Object.keys(target)).toEqual(['child']);
    expect(target.child).toBe(child);
    expect(child).toEqual({ existing: true });
  });

  test.each(graphOperations)(
    '$name leaves the caller target untouched when a descriptor trap fails',
    ({ apply }) => {
      const unsafe = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('descriptor inspection failed');
          },
        },
      );
      const target = { original: true };

      expect(() => apply(target, { first: 'must not commit', unsafe })).toThrow(
        'descriptor inspection failed',
      );
      expect(target).toEqual({ original: true });
    },
  );

  test.each(graphOperations)(
    '$name leaves the caller target untouched when the traversal budget is exceeded',
    ({ apply }) => {
      const oversized: Record<string, unknown> = {};
      for (let index = 0; index <= 10_000; index += 1) {
        oversized[`value-${index}`] = index;
      }
      const target = { original: true };

      expect(() => apply(target, { first: 'must not commit', oversized })).toThrow(
        /adopted record|traversal|limit/iu,
      );
      expect(target).toEqual({ original: true });
    },
  );

  test.each(graphOperations)('$name preserves safe inherited instances with mutable fields', ({ apply }) => {
    const instance = Object.assign(
      Object.create({
        getValue() {
          return true;
        },
      }),
      { child: { safe: true } },
    );
    const date = Object.assign(new Date('2026-08-18T00:00:00.000Z'), { child: { safe: true } });
    const callable = Object.assign(() => true, { child: { safe: true } });
    const result = apply({}, { instance, date, callable });

    expect(result.instance).toBe(instance);
    expect(result.instance.getValue()).toBe(true);
    expect(result.date).toBe(date);
    expect(result.date.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(result.callable).toBe(callable);
    expect(result.callable()).toBe(true);
    expect(result.instance.child).toBe(instance.child);
    expect(result.date.child).toBe(date.child);
    expect(result.callable.child).toBe(callable.child);
  });

  test('merge preserves caller-owned nested target records and arrays', () => {
    const nested = { existing: true };
    const arrayEntry = { existing: true };
    const array = [arrayEntry];
    const target = { nested, array };

    expect(merge(target, { nested: { added: true }, array: [{ added: true }] })).toBe(target);
    expect(target.nested).toBe(nested);
    expect(target.nested).toEqual({ existing: true, added: true });
    expect(target.array).toBe(array);
    expect(target.array[0]).toBe(arrayEntry);
    expect(target.array[0]).toEqual({ existing: true, added: true });
  });

  test.each(graphOperations)('$name preserves sealed, non-extensible, and frozen integrity', ({ apply }) => {
    const sealed = Object.seal({ value: true });
    const nonExtensible = Object.preventExtensions({ value: true });
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":true}') as Record<string, unknown>;
    const frozen = Object.freeze({ child: unsafe });
    const result = apply({}, { sealed, nonExtensible, frozen });

    expect(result.sealed).not.toBe(sealed);
    expect(Object.isSealed(result.sealed)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.sealed, 'value')?.writable).toBe(true);
    expect(result.nonExtensible).not.toBe(nonExtensible);
    expect(Object.isExtensible(result.nonExtensible)).toBe(false);
    expect(Object.isSealed(result.nonExtensible)).toBe(false);
    expect(result.frozen).not.toBe(frozen);
    expect(Object.isFrozen(result.frozen)).toBe(true);
    expect(has(result.frozen.child, '__proto__')).toBe(false);
  });

  test.each(graphOperations)(
    '$name rejects retained inherited parents polluted by a later child Proxy trap',
    ({ apply }) => {
      const parent = Object.create({ inherited: true }) as Record<string, unknown>;
      let inspections = 0;
      parent['child'] = new Proxy(
        { safe: true },
        {
          ownKeys(value) {
            inspections += 1;
            Object.defineProperty(parent, '__proto__', {
              configurable: true,
              enumerable: true,
              value: { polluted: true },
            });
            return Reflect.ownKeys(value);
          },
        },
      );
      const target = { original: true };

      expect(() => apply(target, { first: 'must not commit', parent })).toThrow(
        /safely sanitize|unsupported|callable/iu,
      );
      expect(inspections).toBe(1);
      expect(target).toEqual({ original: true });
    },
  );

  test.each(graphOperations)(
    '$name rejects an oversized root or adopted record before inspecting any descriptors',
    ({ apply }) => {
      for (const position of ['root', 'adopted']) {
        const wide: Record<string, unknown> = {};
        for (let index = 0; index <= 10_000; index += 1) {
          wide[`value-${index}`] = index;
        }
        let descriptorCalls = 0;
        let keyEnumerations = 0;
        const hostile = new Proxy(wide, {
          ownKeys(value) {
            keyEnumerations += 1;
            return Reflect.ownKeys(value);
          },
          getOwnPropertyDescriptor(value, key) {
            descriptorCalls += 1;
            return Object.getOwnPropertyDescriptor(value, key);
          },
        });
        const target = { original: true };
        const source = position === 'root' ? hostile : { first: 'must not commit', hostile };

        expect(() => apply(target, source)).toThrow(/adopted record|traversal|limit/iu);
        expect(keyEnumerations).toBe(1);
        expect(descriptorCalls).toBe(0);
        expect(target).toEqual({ original: true });
      }
    },
  );

  test('merge coerces a stateful callable scalar key exactly once before default lookup', () => {
    let coercions = 0;
    const callable = () => coercions >= 0;
    Object.defineProperty(callable, Symbol.toPrimitive, {
      value() {
        coercions += 1;
        return coercions === 1 ? 'safe' : 'constructor';
      },
    });
    const target: Record<string, unknown> = {};

    expect(merge(target, callable)).toBe(target);
    expect(coercions).toBe(1);
    expect(target).toEqual({ safe: true });
    expect(has(target, 'constructor')).toBe(false);
    expect(has(target, 'prototype')).toBe(false);
  });

  test.each(['__proto__', 'constructor', 'prototype'])(
    'merge rejects coerced unsafe callable key %s when inherited names are allowed',
    (unsafeKey) => {
      let coercions = 0;
      const callable = () => coercions >= 0;
      Object.defineProperty(callable, Symbol.toPrimitive, {
        value() {
          coercions += 1;
          return unsafeKey;
        },
      });
      const target: Record<string, unknown> = {};

      expect(merge(target, callable, { allowPrototypes: true })).toBe(target);
      expect(coercions).toBe(1);
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
      expect(has(target, unsafeKey)).toBe(false);
    },
  );

  test('merge preserves a callable scalar key whose primitive value is a symbol', () => {
    const safe = Symbol('safe');
    let coercions = 0;
    const callable = () => coercions >= 0;
    Object.defineProperty(callable, Symbol.toPrimitive, {
      value() {
        coercions += 1;
        return safe;
      },
    });
    const target: Record<PropertyKey, unknown> = {};

    expect(merge(target, callable, { allowPrototypes: true })).toBe(target);
    expect(coercions).toBe(1);
    expect(target[safe]).toBe(true);
  });

  test('preserves transitively frozen safe records without invoking their accessors', () => {
    const child = Object.freeze({ value: true });
    const frozen = Object.freeze({ child });

    expect(merge({}, { nested: frozen }).nested).toBe(frozen);
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
