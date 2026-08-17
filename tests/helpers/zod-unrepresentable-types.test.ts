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

const getStrictHelperSchema = (helper: ReturnType<(typeof strictHelpers)[number]['create']>) => {
  if ('json_schema' in helper) {
    return helper.json_schema.schema;
  }
  if ('schema' in helper) {
    return helper.schema;
  }
  if ('function' in helper) {
    return helper.function.parameters;
  }

  return helper.parameters;
};

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
    {
      name: 'ZodDate',
      schema: () =>
        z3
          .string()
          .transform((value) => new Date(value))
          .pipe(z3.date()),
      input: '2026-08-17T00:00:00.000Z',
      expected: (): Date => new Date('2026-08-17T00:00:00.000Z'),
    },
    {
      name: 'ZodBigInt',
      schema: () => z3.number().transform(BigInt).pipe(z3.bigint()),
      input: 7,
      expected: (): bigint => 7n,
    },
    {
      name: 'ZodSet',
      schema: () =>
        z3
          .array(z3.string())
          .transform((value) => new Set(value))
          .pipe(z3.set(z3.string())),
      input: ['value'],
      expected: (): Set<string> => new Set(['value']),
    },
  ])('preserves pipeline transforms that construct $name values', ({ schema, input, expected }) => {
    const result = create(z3.object({ value: schema() }));

    expect(result.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: expected() });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('does not treat a refinement-only pipeline as native-value conversion', () => {
    const value = z3
      .string()
      .refine((input) => input.length > 0)
      .pipe(z3.date());

    expect(() => create(z3.object({ value }))).toThrow('ZodDate');
  });

  it.each([
    { name: 'coerced string to Date', schema: () => z3.coerce.string().pipe(z3.date()), native: 'ZodDate' },
    { name: 'coerced number to Date', schema: () => z3.coerce.number().pipe(z3.date()), native: 'ZodDate' },
    {
      name: 'coerced string to BigInt',
      schema: () => z3.coerce.string().pipe(z3.bigint()),
      native: 'ZodBigInt',
    },
  ])('rejects incompatible built-in $name pipeline coercion', ({ schema, native }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow(native);
  });

  it('preserves built-in pipeline coercions that produce their native output type', () => {
    const schema = z3.object({
      date: z3.coerce.date().pipe(z3.date()),
      count: z3.coerce.bigint().pipe(z3.bigint()),
    });
    const result = create(schema);

    expect(result.$parseRaw('{"date":"2026-08-17T00:00:00.000Z","count":7}')).toEqual({
      date: new Date('2026-08-17T00:00:00.000Z'),
      count: 7n,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

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

  it('preserves preprocessing context for shared native-value containers', () => {
    const shared = z3.object({ when: z3.date() });
    const convert = (value: unknown) => {
      if (typeof value !== 'object' || value === null) {
        return value;
      }

      const input = value as { when?: unknown };
      return { ...input, when: preprocessDateValue(input.when) };
    };
    const first = z3.preprocess(convert, shared);
    const second = z3.preprocess(convert, shared);
    const result = create(z3.object({ first, second }));

    expect(
      result.$parseRaw(
        '{"first":{"when":"2026-08-17T00:00:00.000Z"},"second":{"when":"2026-08-18T00:00:00.000Z"}}',
      ),
    ).toEqual({
      first: { when: new Date('2026-08-17T00:00:00.000Z') },
      second: { when: new Date('2026-08-18T00:00:00.000Z') },
    });
    expect(() => create(z3.object({ converted: first, raw: shared }))).toThrow('ZodDate');
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
    { name: 'lazy', schema: () => z3.lazy(() => z3.coerce.bigint()) },
    {
      name: 'intersection',
      schema: () => z3.intersection(z3.coerce.bigint(), z3.coerce.bigint()),
    },
    {
      name: 'shared intersection',
      schema: () => {
        const count = z3.coerce.bigint();
        return z3.intersection(count, count);
      },
    },
    { name: 'nullable', schema: () => z3.coerce.bigint().nullable() },
    { name: 'branded', schema: () => z3.coerce.bigint().brand<'safe-bigint'>() },
    { name: 'readonly', schema: () => z3.coerce.bigint().readonly() },
    {
      name: 'preprocessed',
      schema: () =>
        z3.preprocess((value) => (typeof value === 'number' ? BigInt(value) : value), z3.bigint()),
    },
    {
      name: 'transform pipeline',
      schema: () => z3.number().transform(BigInt).pipe(z3.bigint()),
    },
    {
      name: 'nested wrappers',
      schema: () => z3.coerce.bigint().brand<'safe-bigint'>().readonly().nullable(),
    },
    {
      name: 'nested union',
      schema: () => z3.union([z3.coerce.bigint(), z3.string()]),
    },
  ])('bounds overlapping number alternatives after $name BigInt schemas', ({ schema }) => {
    const result = create(z3.object({ value: z3.union([schema(), z3.number()]) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [
            expect.anything(),
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
      },
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('preserves productive recursive lazy BigInt definitions', () => {
    const recursive: z3.ZodTypeAny = z3.lazy(() =>
      z3.union([z3.coerce.bigint(), z3.object({ next: recursive })]),
    );
    const result = create(z3.object({ value: z3.union([recursive, z3.number()]) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [
            expect.anything(),
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
      },
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(result.$parseRaw('{"value":{"next":7}}')).toEqual({ value: { next: 7n } });
  });

  it('preserves productive recursive lazy number definitions', () => {
    const recursive: z3.ZodTypeAny = z3.lazy(() => z3.union([z3.number(), z3.object({ next: recursive })]));
    const result = create(z3.object({ value: z3.union([z3.coerce.bigint(), recursive]) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [expect.anything(), { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }],
        },
      },
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(result.$parseRaw('{"value":{"next":7}}')).toEqual({ value: { next: 7 } });
  });

  it('bounds shared number references locally without changing other fields', () => {
    const sharedNumber = z3.number();
    const result = create(
      z3.object({
        outside: sharedNumber,
        value: z3.union([z3.coerce.bigint(), sharedNumber]),
      }),
    );
    const schema = getStrictHelperSchema(result) as {
      properties: { outside: Record<string, unknown>; value: { anyOf: Record<string, unknown>[] } };
    };

    expect(schema.properties.outside).toEqual({ type: 'number' });
    expect(schema.properties.value.anyOf[1]).toMatchObject({
      type: 'number',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(result.$parseRaw('{"outside":9007199254740992,"value":7}')).toEqual({
      outside: 9_007_199_254_740_992,
      value: 7n,
    });
  });

  it.each([
    {
      name: 'compact primitive',
      schema: () => z3.union([z3.number(), z3.string()]),
    },
    {
      name: 'nested constrained',
      schema: () => z3.union([z3.number().min(0), z3.string()]),
    },
    {
      name: 'lazy',
      schema: () => z3.lazy(() => z3.number()),
    },
    {
      name: 'intersection',
      schema: () => z3.intersection(z3.number(), z3.number()),
    },
    {
      name: 'shared intersection',
      schema: () => {
        const number = z3.number();
        return z3.intersection(number, number);
      },
    },
    {
      name: 'promise',
      schema: () => z3.promise(z3.number()),
    },
    {
      name: 'numeric native enum',
      schema: () => z3.nativeEnum({ Unsafe: 9_007_199_254_740_992 } as const),
    },
  ])('bounds numeric branches inside $name unions after BigInt alternatives', ({ name, schema }) => {
    const result = create(z3.object({ value: z3.union([z3.coerce.bigint(), schema()]) }));
    const generated = getStrictHelperSchema(result) as {
      properties: {
        value: { anyOf: { minimum?: number; maximum?: number; anyOf?: Record<string, unknown>[] }[] };
      };
    };
    const [, branch] = generated.properties.value.anyOf;

    expect(branch).toMatchObject({
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    if (name === 'nested constrained') {
      expect(branch?.anyOf?.[0]).toMatchObject({ minimum: 0 });
    }
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
  });

  it('tightens existing number bounds that exceed the safe integer range', () => {
    const result = create(
      z3.object({
        value: z3.union([z3.coerce.bigint(), z3.number().min(-1e20).max(1e20)]),
      }),
    );

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [
            expect.anything(),
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
      },
    });
  });

  it.each([
    { name: 'any', schema: () => z3.any() },
    { name: 'unknown', schema: () => z3.unknown() },
  ])('bounds later $name branches while preserving nonnumeric JSON inputs', ({ schema }) => {
    const result = create(z3.object({ value: z3.union([z3.coerce.bigint(), schema()]) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [expect.anything(), { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }],
        },
      },
    });
    expect(result.$parseRaw('{"value":"unchanged"}')).toEqual({ value: 'unchanged' });
  });

  it('bounds trailing number branches when an earlier number cannot always win', () => {
    const result = create(
      z3.object({
        value: z3.union([z3.number().max(10), z3.coerce.bigint(), z3.number()]),
      }),
    );

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [
            { type: 'number', maximum: 10 },
            { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
      },
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7 });
    expect(result.$parseRaw('{"value":12}')).toEqual({ value: 12n });
  });

  it('preserves number alternatives that win before wrapped BigInt branches', () => {
    const result = create(
      z3.object({
        value: z3.union([z3.number(), z3.coerce.bigint().nullable()]),
      }),
    );
    const schema = getStrictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(schema.properties.value.anyOf[0]).toEqual({ type: 'number' });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7 });
  });

  it('preserves and serializes safe nullable BigInt defaults', () => {
    const result = create(z3.object({ value: z3.coerce.bigint().nullable().default(4n) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: {
          anyOf: [
            { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
            { type: 'null' },
          ],
          default: 4,
        },
      },
    });
    expect(result.$parseRaw('{}')).toEqual({ value: 4n });
    expect(result.$parseRaw('{"value":null}')).toEqual({ value: null });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    { name: 'direct', schema: (count: z3.ZodBigInt) => count.default(4n) },
    { name: 'nullable', schema: (count: z3.ZodBigInt) => count.nullable().default(4n) },
    { name: 'lazy', schema: (count: z3.ZodBigInt) => z3.lazy(() => count).default(4n) },
  ])('preserves $name BigInt defaults when the underlying schema is shared', ({ schema }) => {
    const count = z3.coerce.bigint();
    const result = create(
      z3.object({
        first: count,
        second: schema(count),
      }),
    );

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        first: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
        second: { default: 4 },
      },
    });
    expect(result.$parseRaw('{"first":7}')).toEqual({ first: 7n, second: 4n });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('preserves shared preprocessed BigInt-literal defaults', () => {
    const count = z3.preprocess(
      (value) => (typeof value === 'number' ? BigInt(value) : value),
      z3.literal(4n),
    );
    const result = create(
      z3.object({
        first: count,
        second: count.default(4n),
      }),
    );

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: { second: { default: 4 } },
    });
    expect(result.$parseRaw('{"first":4}')).toEqual({ first: 4n, second: 4n });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('normalizes nested object and array BigInt defaults without mutating caller values', () => {
    const objectDefault = { count: 4n, nested: { count: 5n } };
    const arrayDefault = [6n, 7n];
    const result = create(
      z3.object({
        object: z3
          .object({
            count: z3.coerce.bigint(),
            nested: z3.object({ count: z3.coerce.bigint() }),
          })
          .default(objectDefault),
        array: z3.array(z3.coerce.bigint()).default(arrayDefault),
      }),
    );

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        object: { default: { count: 4, nested: { count: 5 } } },
        array: { default: [6, 7] },
      },
    });
    expect(objectDefault).toEqual({ count: 4n, nested: { count: 5n } });
    expect(arrayDefault).toEqual([6n, 7n]);
    expect(result.$parseRaw('{}')).toEqual({ object: objectDefault, array: arrayDefault });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('preserves existing Date and ordinary object defaults by reference', () => {
    const dateDefault = new Date('2026-08-17T00:00:00.000Z');
    const objectDefault = { label: 'unchanged' };
    const result = create(
      z3.object({
        date: z3.coerce.date().default(dateDefault),
        object: z3.object({ label: z3.string() }).default(objectDefault),
      }),
    );
    const schema = getStrictHelperSchema(result) as {
      properties: { date: { default: unknown }; object: { default: unknown } };
    };

    expect(schema.properties.date.default).toBe(dateDefault);
    expect(schema.properties.object.default).toBe(objectDefault);
    expect(result.$parseRaw('{}')).toEqual({ date: dateDefault, object: objectDefault });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    {
      name: 'object property',
      schema: () => z3.object({ count: z3.coerce.bigint() }).default({ count: 9_007_199_254_740_992n }),
      keyword: 'default.count',
    },
    {
      name: 'array item',
      schema: () => z3.array(z3.coerce.bigint()).default([9_007_199_254_740_992n]),
      keyword: 'default[0]',
    },
  ])('rejects unsafe nested BigInt defaults at the $name path', ({ schema, keyword }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow(
      `cannot represent the \`${keyword}\` value as a safe JSON integer`,
    );
  });

  it.each([
    {
      name: 'exclusive maximum safe value',
      schema: () => z3.coerce.bigint().gt(BigInt(Number.MAX_SAFE_INTEGER)),
    },
    {
      name: 'exclusive minimum safe value',
      schema: () => z3.coerce.bigint().lt(BigInt(Number.MIN_SAFE_INTEGER)),
    },
    { name: 'inverted inclusive bounds', schema: () => z3.coerce.bigint().min(5n).max(4n) },
    { name: 'adjacent exclusive bounds', schema: () => z3.coerce.bigint().gt(4n).lt(5n) },
    { name: 'equal exclusive and inclusive bounds', schema: () => z3.coerce.bigint().gt(5n).max(5n) },
  ])('rejects $name when no safe JSON integer satisfies a BigInt schema', ({ schema }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow('no safe JSON integer values');
  });

  it('preserves nonempty exclusive BigInt bounds at the safe integer edge', () => {
    const result = create(z3.object({ value: z3.coerce.bigint().gt(BigInt(Number.MAX_SAFE_INTEGER) - 1n) }));

    expect(getStrictHelperSchema(result)).toMatchObject({
      properties: {
        value: { exclusiveMinimum: Number.MAX_SAFE_INTEGER - 1, maximum: Number.MAX_SAFE_INTEGER },
      },
    });
    expect(result.$parseRaw(`{"value":${Number.MAX_SAFE_INTEGER}}`)).toEqual({
      value: BigInt(Number.MAX_SAFE_INTEGER),
    });
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
  it('bounds shared and wrapped number branches without changing their other uses', () => {
    const number = z3.number();
    const narrower = z3.number().min(-2).max(2);
    const schema = z3.object({
      unrestricted: number,
      reference: z3.union([z3.coerce.bigint(), number]),
      nullable: z3.union([z3.coerce.bigint(), number.nullable()]),
      defaulted: z3.union([z3.coerce.bigint(), number.default(1)]).default(1),
      branded: z3.union([z3.coerce.bigint(), number.brand<'counter'>()]),
      narrower: z3.union([z3.coerce.bigint(), narrower]),
    });
    const format = zodResponseFormat(schema, 'strict');
    const safeInteger = {
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    };

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        unrestricted: { type: 'number' },
        reference: { anyOf: [{ type: 'integer' }, { type: 'number', ...safeInteger }] },
        nullable: {
          anyOf: [{ type: 'integer' }, { type: 'number', nullable: true, ...safeInteger }],
        },
        defaulted: { anyOf: [{ type: 'integer' }, { type: 'number', default: 1, ...safeInteger }] },
        branded: { anyOf: [{ type: 'integer' }, { type: 'number', ...safeInteger }] },
        narrower: { anyOf: [{ type: 'integer' }, { type: 'number', minimum: -2, maximum: 2 }] },
      },
    });
    const { unrestricted } = (format.json_schema.schema as { properties: Record<string, unknown> })
      .properties;
    expect(unrestricted).not.toHaveProperty('minimum');
    expect(unrestricted).not.toHaveProperty('maximum');
    expect(
      format.$parseRaw(
        '{"unrestricted":9007199254740992,"reference":7,"nullable":null,"defaulted":8,"branded":9,"narrower":1}',
      ),
    ).toMatchObject({ unrestricted: 9_007_199_254_740_992, nullable: null });
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

  it('bounds registered shared number definitions only inside later union branches', () => {
    const sharedNumber = z3.number();
    const format = zodResponseFormat(
      z3.object({
        outside: sharedNumber,
        value: z3.union([z3.coerce.bigint(), sharedNumber]),
      }),
      'strict',
      { schemaDefinitions: { SharedNumber: sharedNumber } },
    );

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        outside: { $ref: '#/definitions/SharedNumber' },
        value: {
          anyOf: [
            { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          ],
        },
      },
      definitions: { SharedNumber: { type: 'number' } },
    });
  });

  it('preserves registered shared BigInt definitions while normalizing defaults', () => {
    const count = z3.coerce.bigint();
    const format = zodResponseFormat(
      z3.object({
        first: count,
        second: count.default(4n),
        nullable: count.nullable().default(5n),
      }),
      'strict',
      { schemaDefinitions: { Count: count } },
    );

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        first: { $ref: '#/definitions/Count' },
        second: { $ref: '#/definitions/Count', default: 4 },
        nullable: { anyOf: [{ $ref: '#/definitions/Count' }, { type: 'null' }], default: 5 },
      },
      definitions: {
        Count: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
      },
    });
    expect(format.$parseRaw('{"first":7}')).toEqual({ first: 7n, second: 4n, nullable: 5n });
    expect(() => JSON.stringify(format)).not.toThrow();
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

  it('preserves preprocessing context for registered shared native containers', () => {
    const shared = z3.object({ when: z3.date() });
    const convert = (value: unknown) => {
      if (typeof value !== 'object' || value === null) {
        return value;
      }

      const input = value as { when?: unknown };
      return { ...input, when: preprocessDateValue(input.when) };
    };
    const format = zodResponseFormat(
      z3.object({
        first: z3.preprocess(convert, shared),
        second: z3.preprocess(convert, shared),
      }),
      'strict',
      { schemaDefinitions: { Shared: shared } },
    );

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        first: { $ref: '#/definitions/Shared' },
        second: { $ref: '#/definitions/Shared' },
      },
      definitions: {
        Shared: {
          properties: { when: { type: 'string', format: 'date-time' } },
        },
      },
    });
    expect(
      format.$parseRaw(
        '{"first":{"when":"2026-08-17T00:00:00.000Z"},"second":{"when":"2026-08-18T00:00:00.000Z"}}',
      ),
    ).toEqual({
      first: { when: new Date('2026-08-17T00:00:00.000Z') },
      second: { when: new Date('2026-08-18T00:00:00.000Z') },
    });
  });

  it('rejects registered definitions shared between converted and raw inputs', () => {
    const shared = z3.object({ when: z3.date() });
    const converted = z3.preprocess((value) => {
      if (typeof value !== 'object' || value === null) {
        return value;
      }

      const input = value as { when?: unknown };
      return { ...input, when: preprocessDateValue(input.when) };
    }, shared);

    expect(() =>
      zodResponseFormat(z3.object({ converted, raw: shared }), 'strict', {
        schemaDefinitions: { Shared: shared },
      }),
    ).toThrow('ZodDate');
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
