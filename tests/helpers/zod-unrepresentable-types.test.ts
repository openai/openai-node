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
  { name: 'zodResponseFormat', create: (schema: z3.ZodTypeAny) => zodResponseFormat(schema, 'strict') },
  { name: 'zodTextFormat', create: (schema: z3.ZodTypeAny) => zodTextFormat(schema, 'strict') },
  {
    name: 'zodFunction',
    create: (schema: z3.ZodTypeAny) => zodFunction({ name: 'strict', parameters: schema }),
  },
  {
    name: 'zodResponsesFunction',
    create: (schema: z3.ZodTypeAny) => zodResponsesFunction({ name: 'strict', parameters: schema }),
  },
];

const unrepresentableTypes = [
  { name: 'ZodDate', schema: () => z3.date(), v4: () => z4.date() },
  { name: 'ZodSet', schema: () => z3.set(z3.string()), v4: () => z4.set(z4.string()) },
  {
    name: 'ZodMap',
    schema: () => z3.map(z3.string(), z3.number()),
    v4: () => z4.map(z4.string(), z4.number()),
  },
  { name: 'ZodBigInt', schema: () => z3.bigint(), v4: () => z4.bigint() },
];

const preprocessDateValue = (value: unknown) => (typeof value === 'string' ? new Date(value) : value);

const preprocessedTypes = [
  {
    name: 'ZodDate',
    schema: () => z3.preprocess(preprocessDateValue, z3.date()),
    input: '2026-08-17T00:00:00.000Z',
    expected: () => new Date('2026-08-17T00:00:00.000Z'),
  },
  {
    name: 'ZodBigInt',
    schema: () => z3.preprocess((value) => (typeof value === 'number' ? BigInt(value) : value), z3.bigint()),
    input: 7,
    expected: () => 7n,
  },
  {
    name: 'ZodSet',
    schema: () =>
      z3.preprocess((value) => (Array.isArray(value) ? new Set(value) : value), z3.set(z3.string())),
    input: ['value'],
    expected: () => new Set(['value']),
  },
  {
    name: 'ZodMap',
    schema: () =>
      z3.preprocess(
        (value) => (Array.isArray(value) ? new Map(value as [string, number][]) : value),
        z3.map(z3.string(), z3.number()),
      ),
    input: [['value', 7]],
    expected: () => new Map([['value', 7]]),
  },
];

describe.each(strictHelpers)('$name with Zod v3 non-JSON-native types', ({ create }) => {
  it.each(unrepresentableTypes)(
    'rejects nested $name fields before creating a request',
    ({ name, schema }) => {
      const root = z3.object({ payload: z3.object({ value: schema() }) });

      expect(() => create(root)).toThrow(
        `Zod field at \`#/definitions/strict/properties/payload/properties/value\` uses \`${name}\``,
      );
    },
  );

  it('preserves JSON-parseable Date and BigInt coercions', () => {
    const schema = z3.object({
      date: z3.coerce.date(),
      count: z3.coerce.bigint(),
    });
    const result = create(schema);

    expect(result.$parseRaw('{"date":"2026-08-17T00:00:00.000Z","count":7}')).toEqual({
      date: new Date('2026-08-17T00:00:00.000Z'),
      count: 7n,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('preserves JSON-input transformations to non-JSON output values', () => {
    const schema = z3.object({
      date: z3.string().transform((value) => new Date(value)),
    });

    expect(create(schema).$parseRaw('{"date":"2026-08-17T00:00:00.000Z"}')).toEqual({
      date: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it.each(preprocessedTypes)(
    'preserves JSON-input preprocessors that construct $name values',
    ({ schema, input, expected }) => {
      const result = create(z3.object({ value: schema() }));

      expect(result.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: expected() });
      expect(() => JSON.stringify(result)).not.toThrow();
    },
  );

  it.each([
    { name: 'nullable BigInt', schema: () => z3.bigint().nullable() },
    { name: 'primitive BigInt union', schema: () => z3.union([z3.bigint(), z3.string()]) },
    { name: 'BigInt literal', schema: () => z3.literal(1n) },
    { name: 'BigInt literal union', schema: () => z3.union([z3.literal(1n), z3.literal('value')]) },
  ])('rejects $name before primitive fast paths or serialization', ({ schema }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow(/Zod(?:BigInt|Literal)/u);
  });

  it('does not allow an unprocessed schema after its shared definition was preprocessed', () => {
    const native = z3.date();
    const converted = z3.preprocess((value) => (typeof value === 'string' ? new Date(value) : value), native);

    expect(() => create(z3.object({ converted, native }))).toThrow('#/definitions/strict/properties/native');
  });

  it('keeps shared native definitions inside their separate preprocessor contexts', () => {
    const native = z3.date();
    const first = z3.preprocess(preprocessDateValue, native);
    const second = z3.preprocess(preprocessDateValue, native);
    const result = create(z3.object({ first, second }));

    expect(
      result.$parseRaw('{"first":"2026-08-17T00:00:00.000Z","second":"2026-08-18T00:00:00.000Z"}'),
    ).toEqual({
      first: new Date('2026-08-17T00:00:00.000Z'),
      second: new Date('2026-08-18T00:00:00.000Z'),
    });
  });

  it('normalizes JSON-compatible preprocessed BigInt literals', () => {
    const value = z3.preprocess(
      (input) => (typeof input === 'number' ? BigInt(input) : input),
      z3.literal(7n),
    );
    const result = create(z3.object({ value }));

    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('rejects unsafe preprocessed BigInt literals before serialization', () => {
    const value = z3.preprocess(
      (input) => (typeof input === 'number' ? BigInt(input) : input),
      z3.literal(9_007_199_254_740_992n),
    );

    expect(() => create(z3.object({ value }))).toThrow(
      'cannot represent the `const` value as a safe JSON integer',
    );
  });

  it.each([
    {
      name: 'minimum',
      schema: () => z3.coerce.bigint().min(9_007_199_254_740_992n),
    },
    {
      name: 'maximum',
      schema: () => z3.coerce.bigint().max(-9_007_199_254_740_992n),
    },
    {
      name: 'multipleOf',
      schema: () => z3.coerce.bigint().multipleOf(9_007_199_254_740_992n),
    },
    {
      name: 'default',
      schema: () => z3.coerce.bigint().default(9_007_199_254_740_992n),
    },
  ])('rejects unsafe BigInt $name values before JSON serialization', ({ name, schema }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow(
      `cannot represent the \`${name}\` value as a safe JSON integer`,
    );
  });
});

describe('Zod v3 BigInt coercion JSON Schema serialization', () => {
  it('bounds every JSON-coerced BigInt branch to the safe integer range', () => {
    const schema = z3.object({
      direct: z3.coerce.bigint(),
      minimum: z3.coerce.bigint().min(1n),
      maximum: z3.coerce.bigint().max(9n),
      nullable: z3.coerce.bigint().nullable(),
      stringUnion: z3.union([z3.coerce.bigint(), z3.string()]),
      numberUnion: z3.union([z3.coerce.bigint(), z3.number()]),
      numberFirstUnion: z3.union([z3.number(), z3.coerce.bigint()]),
      preprocessed: z3.preprocess(
        (value) => (typeof value === 'number' ? BigInt(value) : value),
        z3.bigint(),
      ),
    });
    const format = zodResponseFormat(schema, 'strict');
    const safeInteger = {
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    };

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        direct: { type: 'integer', ...safeInteger },
        minimum: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        maximum: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: 9 },
        nullable: { anyOf: [{ type: 'integer', ...safeInteger }, { type: 'null' }] },
        stringUnion: { anyOf: [{ type: 'integer', ...safeInteger }, { type: 'string' }] },
        numberUnion: {
          anyOf: [
            { type: 'integer', ...safeInteger },
            { type: 'number', ...safeInteger },
          ],
        },
        numberFirstUnion: {
          anyOf: [{ type: 'number' }, { type: 'integer', ...safeInteger }],
        },
        preprocessed: { type: 'integer', ...safeInteger },
      },
    });
    expect(() => JSON.stringify(format.json_schema.schema)).not.toThrow();
  });

  it('serializes safe constraints and defaults as JSON numbers', () => {
    const schema = z3.object({
      bounded: z3.coerce.bigint().min(2n).max(8n).multipleOf(2n),
      exclusive: z3.coerce.bigint().gt(1n).lt(9n),
      defaulted: z3.coerce.bigint().default(4n),
    });
    const format = zodResponseFormat(schema, 'strict');

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        bounded: { type: 'integer', minimum: 2, maximum: 8, multipleOf: 2 },
        exclusive: { type: 'integer', exclusiveMinimum: 1, exclusiveMaximum: 9 },
        defaulted: { type: 'integer', default: 4 },
      },
    });
    expect(() => JSON.stringify(format.json_schema.schema)).not.toThrow();
    expect(format.$parseRaw('{"bounded":4,"exclusive":3,"defaulted":6}')).toEqual({
      bounded: 4n,
      exclusive: 3n,
      defaulted: 6n,
    });
  });

  it('normalizes safe BigInt constraints inside shared schema definitions', () => {
    const shared = z3.object({ count: z3.coerce.bigint().min(1n) });
    const schema = z3.object({ first: shared, second: shared });
    const format = zodResponseFormat(schema, 'strict', {
      schemaDefinitions: { Shared: shared },
    });

    expect(format.json_schema.schema).toMatchObject({
      definitions: {
        Shared: {
          properties: { count: { type: 'integer', minimum: 1 } },
        },
      },
    });
    expect(() => JSON.stringify(format.json_schema.schema)).not.toThrow();
    expect(format.$parseRaw('{"first":{"count":2},"second":{"count":3}}')).toEqual({
      first: { count: 2n },
      second: { count: 3n },
    });
  });
});

describe('Zod v3 non-JSON-native compatibility boundaries', () => {
  it.each(unrepresentableTypes)('matches Zod v4 fail-fast behavior for $name', ({ name, schema, v4 }) => {
    expect(() => zodResponseFormat(z3.object({ value: schema() }), 'strict')).toThrow(name);
    expect(() => zodResponseFormat(z4.object({ value: v4() }), 'strict')).toThrow(
      'cannot be represented in JSON Schema',
    );
  });

  it('rejects non-JSON-native types underneath defaults', () => {
    expect(() =>
      zodResponseFormat(
        z3.object({ value: z3.date().default(new Date('2026-08-17T00:00:00.000Z')) }),
        'strict',
      ),
    ).toThrow('uses `ZodDate`');
  });

  it('reports the materialized definition path for registered unsupported schemas', () => {
    const shared = z3.date();

    expect(() =>
      zodResponseFormat(z3.object({ value: shared }), 'strict', {
        schemaDefinitions: { Shared: shared },
      }),
    ).toThrow('Zod field at `#/definitions/Shared` uses `ZodDate`');
  });

  it.each(unrepresentableTypes)('keeps non-strict Realtime $name schemas unchanged', ({ schema }) => {
    const tool = zodRealtimeFunction({
      name: 'realtime',
      parameters: z3.object({ value: schema() }),
    });

    expect(tool).not.toHaveProperty('strict');
    expect(tool.parameters).toHaveProperty('properties.value.type');
  });

  it('does not rewrite native BigInt constraints in non-strict Realtime schemas', () => {
    const tool = zodRealtimeFunction({
      name: 'realtime',
      parameters: z3.object({ value: z3.coerce.bigint().min(2n) }),
    });

    expect(tool.parameters).toMatchObject({
      properties: { value: { minimum: 2n } },
    });
  });
});
