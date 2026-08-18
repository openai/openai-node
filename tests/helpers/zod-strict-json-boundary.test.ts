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

  it('retains shared and recursive JSON-native schemas', () => {
    interface Node {
      value: string;
      children: Node[];
    }
    const node: z3.ZodType<Node> = z3.lazy(() => z3.object({ value: z3.string(), children: z3.array(node) }));
    const shared = z3.object({ id: z3.string() });

    expect(() => create(node)).not.toThrow();
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
