import { vi } from 'vitest';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod/v4';
import { assertJSONSerializableSchema } from '../../src/helpers/zod-v3-strict-schema';

const strictHelpers = [
  {
    name: 'zodResponseFormat',
    create: (schema: z3.ZodTypeAny) => zodResponseFormat(schema, 'boundary'),
    schema: (schema: z3.ZodTypeAny) => zodResponseFormat(schema, 'boundary').json_schema.schema,
  },
  {
    name: 'zodTextFormat',
    create: (schema: z3.ZodTypeAny) => zodTextFormat(schema, 'boundary'),
    schema: (schema: z3.ZodTypeAny) => zodTextFormat(schema, 'boundary').schema,
  },
  {
    name: 'zodFunction',
    create: (schema: z3.ZodTypeAny) => zodFunction({ name: 'boundary', parameters: schema }),
    schema: (schema: z3.ZodTypeAny) =>
      zodFunction({ name: 'boundary', parameters: schema }).function.parameters,
  },
  {
    name: 'zodResponsesFunction',
    create: (schema: z3.ZodTypeAny) => zodResponsesFunction({ name: 'boundary', parameters: schema }),
    schema: (schema: z3.ZodTypeAny) =>
      zodResponsesFunction({ name: 'boundary', parameters: schema }).parameters,
  },
];

const numericStatus = { 0: 'Ready', 1: 'Done', Ready: 0, Done: 1 } as const;
const mixedStatus = { 0: 'Ready', Ready: 0, Done: 'done' } as const;

const unsupportedSchemas = [
  { name: 'native dates', schema: () => z3.date(), kind: 'ZodDate' },
  { name: 'coerced dates', schema: () => z3.coerce.date(), kind: 'ZodDate' },
  { name: 'native BigInts', schema: () => z3.bigint(), kind: 'ZodBigInt' },
  { name: 'coerced BigInts', schema: () => z3.coerce.bigint(), kind: 'ZodBigInt' },
  { name: 'native sets', schema: () => z3.set(z3.string()), kind: 'ZodSet' },
  { name: 'native maps', schema: () => z3.map(z3.string(), z3.number()), kind: 'ZodMap' },
  { name: 'promises', schema: () => z3.promise(z3.string()), kind: 'ZodPromise' },
  {
    name: 'opaque transforms',
    schema: () => z3.string().transform((value) => value.length),
    kind: 'ZodEffects',
  },
  {
    name: 'opaque refinements',
    schema: () => z3.string().refine((value) => value.length > 1),
    kind: 'ZodEffects',
  },
  {
    name: 'preprocessors',
    schema: () => z3.preprocess(String, z3.string()),
    kind: 'ZodEffects',
  },
  {
    name: 'pipelines',
    schema: () => z3.string().pipe(z3.string()),
    kind: 'ZodPipeline',
  },
  {
    name: 'intersections',
    schema: () => z3.intersection(z3.object({ first: z3.string() }), z3.object({ second: z3.number() })),
    kind: 'ZodIntersection',
  },
];

describe.each(strictHelpers)('$name strict JSON boundary', ({ create, schema }) => {
  it.each([
    { name: 'unbounded coercion', number: () => z3.coerce.number() },
    { name: 'minimum-only coercion', number: () => z3.coerce.number().min(0) },
    { name: 'maximum-only coercion', number: () => z3.coerce.number().max(10) },
    { name: 'readonly coercion', number: () => z3.coerce.number().readonly() },
    { name: 'nested array coercion', number: () => z3.array(z3.coerce.number()) },
  ])('rejects $name that can produce non-finite numbers', ({ number }) => {
    expect(() => create(z3.object({ value: number() }))).toThrow(/ZodNumber.*finite/u);
  });

  it.each([
    { name: 'explicit finite check', number: () => z3.coerce.number().finite() },
    { name: 'integer check', number: () => z3.coerce.number().int() },
    { name: 'finite lower and upper bounds', number: () => z3.coerce.number().min(0).max(10) },
    { name: 'safe integer bounds', number: () => z3.coerce.number().safe() },
  ])('preserves coercion with a provable $name', ({ number }) => {
    const result = create(z3.object({ value: number() }));

    expect(result.$parseRaw('{"value":"7"}')).toEqual({ value: 7 });
    expect(() => result.$parseRaw('{"value":"Infinity"}')).toThrow();
    expect(() => result.$parseRaw('{"value":"-Infinity"}')).toThrow();
  });

  it.each([
    { name: 'any', inner: () => z3.any() },
    { name: 'unknown', inner: () => z3.unknown() },
    { name: 'unbounded number', inner: () => z3.number() },
    { name: 'unconstrained array item', inner: () => z3.array(z3.any()) },
    { name: 'unsafe nested object field', inner: () => z3.object({ value: z3.unknown() }) },
  ])('rejects an unsafe $name default factory before invoking it', ({ inner }) => {
    const factory = vi.fn(() => 1n);
    const unsafe = inner() as z3.ZodTypeAny;

    expect(() => create(z3.object({ value: unsafe.default(factory) }))).toThrow(/ZodDefault.*JSON-native/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects a mutable any default that would change after schema construction', () => {
    let calls = 0;
    const factory = vi.fn(() => {
      calls += 1;
      return calls === 1 ? 'safe' : 1n;
    });

    expect(() => create(z3.object({ value: z3.any().default(factory) }))).toThrow(/ZodDefault.*JSON-native/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'string',
      value: () => z3.string().default('safe'),
      expected: 'safe',
    },
    {
      name: 'boolean',
      value: () => z3.boolean().default(false),
      expected: false,
    },
    {
      name: 'finite number',
      value: () => z3.number().finite().default(7),
      expected: 7,
    },
    {
      name: 'enum',
      value: () => z3.enum(['safe', 'other']).default('safe'),
      expected: 'safe',
    },
    {
      name: 'nullable literal',
      value: () => z3.literal(null).nullable().default(null),
      expected: null,
    },
    {
      name: 'typed array',
      value: () => z3.array(z3.string()).default(['safe']),
      expected: ['safe'],
    },
    {
      name: 'closed typed object',
      value: () => z3.object({ value: z3.string() }).default({ value: 'safe' }),
      expected: { value: 'safe' },
    },
  ])('preserves a provably JSON-native $name default', ({ value, expected }) => {
    const result = create(z3.object({ value: value() }));

    expect(result.$parseRaw('{}')).toEqual({ value: expected });
  });

  it('rejects hidden typed-object default serializers without invoking them', () => {
    const serializer = vi.fn(() => 1n);
    const value = Object.defineProperty({ safe: 'visible' }, 'toJSON', {
      enumerable: false,
      value: serializer,
    });

    expect(() => create(z3.object({ value: z3.object({ safe: z3.string() }).default(value) }))).toThrow(
      /toJSON|serialization hook/iu,
    );
    expect(serializer).not.toHaveBeenCalled();
  });

  it('rejects inherited typed-array default serializers without invoking them', () => {
    const serializer = vi.fn(() => 1n);
    const value = ['safe'];
    const inherited = Object.defineProperty({}, 'toJSON', {
      enumerable: false,
      value: serializer,
    });
    Object.setPrototypeOf(inherited, Object.getPrototypeOf(value));
    Object.setPrototypeOf(value, inherited);

    expect(() => create(z3.object({ value: z3.array(z3.string()).default(value) }))).toThrow(
      /toJSON|serialization hook/iu,
    );
    expect(serializer).not.toHaveBeenCalled();
  });

  it('rejects own and inherited serializer accessors without invoking their getters', () => {
    const getter = vi.fn(() => {
      throw new Error('must never run');
    });
    const object = Object.defineProperty({ safe: 'visible' }, 'toJSON', { get: getter });
    const array = ['safe'];
    const inherited = Object.defineProperty({}, 'toJSON', { get: getter });
    Object.setPrototypeOf(inherited, Object.getPrototypeOf(array));
    Object.setPrototypeOf(array, inherited);

    expect(() => assertJSONSerializableSchema(object, '$.default')).toThrow(/toJSON|serialization hook/iu);
    expect(() => assertJSONSerializableSchema(array, '$.default')).toThrow(/toJSON|serialization hook/iu);
    expect(getter).not.toHaveBeenCalled();
  });

  it('preserves harmless hidden metadata and non-callable serializer values', () => {
    const value = Object.defineProperties(
      { safe: 'visible' },
      {
        internal: { enumerable: false, value: 1n },
        toJSON: { enumerable: false, value: 'ignored' },
        [Symbol('metadata')]: { value: () => 1n },
      },
    );
    const result = create(z3.object({ value: z3.object({ safe: z3.string() }).default(value) }));

    expect(result.$parseRaw('{}')).toEqual({ value: { safe: 'visible' } });
  });

  it('rejects sparse arrays without invoking inherited indexed getters', () => {
    const getter = vi.fn(() => {
      throw new Error('must never run');
    });
    const inherited = Object.defineProperty(Object.create(null) as object, '0', {
      enumerable: true,
      get: getter,
    });
    const sparse: string[] = [];
    sparse.length = 1;
    Object.setPrototypeOf(sparse, inherited);

    expect(() => assertJSONSerializableSchema(sparse, '$.default')).toThrow(/sparse.*array|array.*sparse/iu);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects indexed array accessors without invoking hostile getters', () => {
    const getter = vi.fn(() => {
      throw new Error('must never run');
    });
    const values = ['safe'];
    Object.defineProperty(values, '0', { enumerable: true, get: getter });

    expect(() => assertJSONSerializableSchema(values, '$.default')).toThrow(/accessor/u);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects sparse typed-array defaults before sending a request', () => {
    const sparse: string[] = [];
    sparse.length = 1;

    expect(() => create(z3.object({ value: z3.array(z3.string()).default(sparse) }))).toThrow(
      /sparse.*array|array.*sparse/iu,
    );
  });

  it('retains dense nested typed-array defaults', () => {
    const result = create(
      z3.object({ value: z3.array(z3.array(z3.string())).default([['first'], ['second']]) }),
    );

    expect(result.$parseRaw('{}')).toEqual({ value: [['first'], ['second']] });
  });

  it.each([
    {
      name: 'nested literal union',
      options: () => [z3.union([z3.literal('first'), z3.literal('second')]), z3.literal('third')] as const,
      values: ['first', 'second', 'third'],
    },
    {
      name: 'nested primitive union',
      options: () => [z3.union([z3.string(), z3.number()]), z3.boolean()] as const,
      values: ['safe', 7, true],
    },
    {
      name: 'readonly nested union',
      options: () =>
        [z3.union([z3.literal('first'), z3.literal('second')]).readonly(), z3.literal('third')] as const,
      values: ['first', 'third'],
    },
  ])('expands provably disjoint $name domains recursively', ({ options, values }) => {
    const result = create(z3.object({ value: z3.union(options()) }));

    for (const value of values) {
      expect(result.$parseRaw(JSON.stringify({ value }))).toEqual({ value });
    }
  });

  it('continues rejecting overlap hidden in a nested union', () => {
    const value = z3.union([z3.union([z3.literal('first'), z3.literal('second')]), z3.literal('second')]);

    expect(() => create(z3.object({ value }))).toThrow(/ambiguous.*union/iu);
  });

  it.each([
    {
      name: 'string enum and literal',
      first: () => z3.object({ kind: z3.enum(['first', 'second']), value: z3.string() }),
      second: () => z3.object({ kind: z3.literal('third'), value: z3.number() }),
      one: { kind: 'first', value: 'safe' },
      two: { kind: 'third', value: 7 },
    },
    {
      name: 'numeric native enum and string literal',
      first: () => z3.object({ kind: z3.nativeEnum(numericStatus), value: z3.string() }),
      second: () => z3.object({ kind: z3.literal('Ready'), value: z3.number() }),
      one: { kind: 0, value: 'safe' },
      two: { kind: 'Ready', value: 7 },
    },
    {
      name: 'mixed native enum and disjoint literal',
      first: () => z3.object({ kind: z3.nativeEnum(mixedStatus), value: z3.string() }),
      second: () => z3.object({ kind: z3.literal('other'), value: z3.number() }),
      one: { kind: 'done', value: 'safe' },
      two: { kind: 'other', value: 7 },
    },
  ])('recognizes finite $name object discriminators', ({ first, second, one, two }) => {
    const result = create(z3.object({ value: z3.union([first(), second()]) }));

    expect(result.$parseRaw(JSON.stringify({ value: one }))).toEqual({ value: one });
    expect(result.$parseRaw(JSON.stringify({ value: two }))).toEqual({ value: two });
  });

  it('continues rejecting overlapping finite object discriminators', () => {
    const value = z3.union([
      z3.object({ kind: z3.enum(['first', 'second']), value: z3.string() }),
      z3.object({ kind: z3.literal('second'), value: z3.number() }),
    ]);

    expect(() => create(z3.object({ value }))).toThrow(/ambiguous.*union/iu);
  });

  it.each([
    { name: 'native Date', catchall: () => z3.date(), kind: 'ZodDate' },
    { name: 'native BigInt', catchall: () => z3.bigint(), kind: 'ZodBigInt' },
    {
      name: 'opaque transform',
      catchall: () => z3.string().transform((value) => value.length),
      kind: 'ZodEffects',
    },
  ])('traverses a $name object catchall at its exact path', ({ catchall, kind }) => {
    const object = z3.object({ declared: z3.string() }).catchall(catchall());

    expect(() => create(z3.object({ nested: object }))).toThrow(
      new RegExp(String.raw`nested\.<catchall>.*${kind}`, 'u'),
    );
  });

  it.each([
    {
      name: 'JSON-native catchall',
      object: () => z3.object({ declared: z3.string() }).catchall(z3.string()),
    },
    {
      name: 'passthrough object',
      object: () => z3.object({ declared: z3.string() }).passthrough(),
    },
    {
      name: 'readonly open object',
      object: () => z3.object({ declared: z3.string() }).catchall(z3.number()).readonly(),
    },
  ])('rejects an open $name instead of emitting additionalProperties', ({ object }) => {
    expect(() => create(z3.object({ nested: object() }))).toThrow(/nested.*ZodObject.*additionalProperties/u);
  });

  it('retains ordinary stripped and explicitly strict closed objects', () => {
    const result = create(
      z3.object({
        stripped: z3.object({ value: z3.string() }),
        strict: z3.object({ value: z3.string() }).strict(),
      }),
    );

    expect(result.$parseRaw('{"stripped":{"value":"safe"},"strict":{"value":"safe"}}')).toEqual({
      stripped: { value: 'safe' },
      strict: { value: 'safe' },
    });
  });

  it.each([
    { name: 'non-finite number', caught: () => z3.number().catch(Infinity) },
    { name: 'native BigInt', caught: () => z3.any().catch(1n) },
    { name: 'ordinary JSON fallback', caught: () => z3.string().catch('safe') },
    { name: 'readonly fallback', caught: () => z3.string().catch('safe').readonly() },
  ])('rejects a $name catch fallback as unprovable', ({ caught }) => {
    expect(() => create(z3.object({ nested: z3.object({ value: caught() }) }))).toThrow(
      /nested\.value.*ZodCatch/u,
    );
  });

  it('rejects function-valued catch fallbacks without invoking them', () => {
    const fallback = vi.fn(() => Infinity);

    expect(() => create(z3.object({ value: z3.number().catch(fallback) }))).toThrow(/ZodCatch/u);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'fixed tuple', tuple: () => z3.tuple([z3.string(), z3.number()]) },
    { name: 'empty tuple', tuple: () => z3.tuple([]) },
    { name: 'rest tuple', tuple: () => z3.tuple([z3.string()]).rest(z3.number()) },
    { name: 'readonly tuple', tuple: () => z3.tuple([z3.string()]).readonly() },
    { name: 'nested array tuple', tuple: () => z3.array(z3.tuple([z3.string()])) },
  ])('rejects unsupported Draft 7 $name item arrays', ({ tuple }) => {
    expect(() => create(z3.object({ nested: z3.object({ value: tuple() }) }))).toThrow(
      /nested\.value.*ZodTuple/u,
    );
  });

  it.each([
    { name: 'open string-key record', record: () => z3.record(z3.string()) },
    { name: 'enum-key record', record: () => z3.record(z3.enum(['first', 'second']), z3.number()) },
    { name: 'readonly record', record: () => z3.record(z3.string()).readonly() },
    { name: 'nested array record', record: () => z3.array(z3.record(z3.string())) },
  ])('rejects an unsupported $name additionalProperties schema', ({ record }) => {
    expect(() => create(z3.object({ nested: z3.object({ value: record() }) }))).toThrow(
      /nested\.value.*ZodRecord/u,
    );
  });

  it.each([
    {
      name: 'numeric enum and any string',
      options: () => [z3.nativeEnum(numericStatus), z3.string()] as const,
      first: 0,
      second: 'Ready',
    },
    {
      name: 'numeric enum and reverse-mapping literal',
      options: () => [z3.nativeEnum(numericStatus), z3.literal('Ready')] as const,
      first: 0,
      second: 'Ready',
    },
    {
      name: 'numeric enum and disjoint numeric literal',
      options: () => [z3.nativeEnum(numericStatus), z3.literal(7)] as const,
      first: 0,
      second: 7,
    },
    {
      name: 'mixed enum and disjoint boolean',
      options: () => [z3.nativeEnum(mixedStatus), z3.boolean()] as const,
      first: 'done',
      second: true,
    },
  ])('preserves genuinely disjoint $name domains', ({ options, first, second }) => {
    const result = create(z3.object({ value: z3.union(options()) }));

    expect(result.$parseRaw(JSON.stringify({ value: first }))).toEqual({ value: first });
    expect(result.$parseRaw(JSON.stringify({ value: second }))).toEqual({ value: second });
  });

  it.each([
    {
      name: 'numeric enum and a matching number',
      options: () => [z3.nativeEnum(numericStatus), z3.number()] as const,
    },
    {
      name: 'numeric enum and a matching literal',
      options: () => [z3.nativeEnum(numericStatus), z3.literal(0)] as const,
    },
    {
      name: 'mixed enum and a matching string',
      options: () => [z3.nativeEnum(mixedStatus), z3.string()] as const,
    },
  ])('continues rejecting overlapping $name domains', ({ options }) => {
    expect(() => create(z3.object({ value: z3.union(options()) }))).toThrow(/ambiguous.*union/iu);
  });

  it.each(unsupportedSchemas)('rejects $name at its field path', ({ schema: unsupported, kind }) => {
    expect(() => create(z3.object({ nested: z3.object({ value: unsupported() }) }))).toThrow(
      new RegExp(`nested\\.value.*${kind}`, 'u'),
    );
  });

  it('rejects nullable and union shortcuts that hide non-JSON-native values', () => {
    expect(() => create(z3.object({ value: z3.bigint().nullable() }))).toThrow(/ZodBigInt/u);
    expect(() => create(z3.object({ value: z3.union([z3.coerce.bigint(), z3.number()]) }))).toThrow(
      /ZodBigInt/u,
    );
  });

  it('rejects literal values without a finite JSON representation', () => {
    expect(() => create(z3.object({ value: z3.literal(globalThis.undefined) }))).toThrow(/literal/iu);
    expect(() => create(z3.object({ value: z3.literal(1n) }))).toThrow(/literal/iu);
    expect(() => create(z3.object({ value: z3.literal(Number.POSITIVE_INFINITY) }))).toThrow(/literal/iu);
  });

  it('rejects ambiguous unions instead of guessing branch behavior', () => {
    expect(() => create(z3.object({ value: z3.union([z3.string(), z3.string().min(1)]) }))).toThrow(
      /ambiguous.*union/iu,
    );
  });

  it('accepts disjoint primitive and literal unions', () => {
    expect(() =>
      create(
        z3.object({
          primitive: z3.union([z3.string(), z3.number(), z3.null()]),
          literal: z3.union([z3.literal('first'), z3.literal('second')]),
        }),
      ),
    ).not.toThrow();
  });

  it('accepts object unions with explicit non-overlapping discriminators', () => {
    const options = [
      z3.object({ kind: z3.literal('first'), value: z3.string() }),
      z3.object({ kind: z3.literal('second'), value: z3.number() }),
    ] as const;

    expect(() => create(z3.object({ value: z3.discriminatedUnion('kind', options) }))).not.toThrow();
    expect(() => create(z3.object({ value: z3.union(options) }))).not.toThrow();
  });

  it('preserves arbitrarily large integers as decimal strings on the JSON boundary', () => {
    const value = '900719925474099312345678901234567890';
    const format = create(z3.object({ value: z3.string().regex(/^-?(?:0|[1-9][0-9]*)$/u) }));

    expect(format.$parseRaw(JSON.stringify({ value }))).toEqual({ value });
    expect(BigInt(format.$parseRaw(JSON.stringify({ value })).value)).toBe(
      900_719_925_474_099_312_345_678_901_234_567_890n,
    );
    expect(schema(z3.object({ value: z3.string().regex(/^-?(?:0|[1-9][0-9]*)$/u) }))).toMatchObject({
      properties: { value: { type: 'string', pattern: '^-?(?:0|[1-9][0-9]*)$' } },
    });
  });

  it('rejects non-JSON-native defaults before a request can serialize them', () => {
    expect(() => create(z3.object({ value: z3.any().default(1n) }))).toThrow(/default.*bigint/iu);
  });

  it.each([
    { name: 'native bigint', output: () => 1n, message: /bigint/iu },
    { name: 'positive infinity', output: () => Number.POSITIVE_INFINITY, message: /non-JSON number/iu },
    { name: 'negative infinity', output: () => Number.NEGATIVE_INFINITY, message: /non-JSON number/iu },
    { name: 'native object', output: () => new Date(0), message: /native object/iu },
  ])('rejects a stateful lazy schema that later produces $name', ({ output, message }) => {
    let unsafe = false;
    const getter = vi.fn(() => (unsafe ? z3.string().transform(() => output()) : z3.string()));
    const result = create(z3.object({ value: z3.lazy(getter) }));
    const callsDuringConstruction = getter.mock.calls.length;

    unsafe = true;

    expect(() => result.$parseRaw('{"value":"safe"}')).toThrow(message);
    expect(getter).toHaveBeenCalledTimes(callsDuringConstruction + 1);
  });

  it('rejects hidden serializers produced by a stateful lazy schema without invoking them', () => {
    let unsafe = false;
    const serializer = vi.fn(() => 1n);
    const value = Object.defineProperty({ safe: 'visible' }, 'toJSON', {
      enumerable: false,
      value: serializer,
    });
    const lazy = z3.lazy(() => (unsafe ? z3.string().transform(() => value) : z3.string()));
    const result = create(z3.object({ value: lazy }));

    unsafe = true;

    expect(() => result.$parseRaw('{"value":"safe"}')).toThrow(/toJSON|serialization hook/iu);
    expect(serializer).not.toHaveBeenCalled();
  });

  it('retains shared and recursive JSON-native schemas', () => {
    interface Node {
      value: string;
      children: Node[];
    }
    const node: z3.ZodType<Node> = z3.lazy(() => z3.object({ value: z3.string(), children: z3.array(node) }));
    const shared = z3.object({ id: z3.string() });
    const result = create(node);
    const expected = { value: 'parent', children: [{ value: 'child', children: [] }] };

    expect(result.$parseRaw(JSON.stringify(expected))).toEqual(expected);
    expect(() => create(z3.object({ first: shared, second: shared }))).not.toThrow();
  });
});

it('rejects unsupported registered definitions without mutating the caller', () => {
  const definitions = Object.freeze({ hidden: z3.object({ value: z3.bigint() }) });

  expect(() =>
    zodResponseFormat(z3.object({ value: z3.string() }), 'boundary', {
      schemaDefinitions: definitions,
    }),
  ).toThrow(/hidden.*ZodBigInt/u);
  expect(Object.isFrozen(definitions)).toBe(true);
});

it('keeps non-strict Realtime Zod v3 behavior unchanged', () => {
  const tool = zodRealtimeFunction({
    name: 'realtime',
    parameters: z3.object({
      date: z3.date(),
      pipeline: z3.string().transform(Number).pipe(z3.number()),
    }),
  });

  expect(tool.parameters).toMatchObject({
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date-time' },
      pipeline: { type: 'string' },
    },
  });
});

it('leaves the native Zod v4 converter responsible for its supported subset', () => {
  expect(() =>
    zodResponseFormat(
      z4.object({
        value: z4.string(),
        choice: z4.union([z4.string(), z4.number()]),
      }),
      'boundary',
    ),
  ).not.toThrow();
});
