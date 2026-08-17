import { vi } from 'vitest';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z3 } from 'zod/v3';

const formatFor = (value: z3.ZodTypeAny) => zodResponseFormat(z3.object({ value }), 'strict');

const nestedSchemaAt = (schema: unknown, path: readonly (string | number)[]): unknown => {
  let current = schema;
  for (const key of path) {
    current = (current as Record<string, unknown>)[String(key)];
  }
  return current;
};

const convertLeafDate = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const input = value as { when: string };
  return { when: new Date(input.when) };
};

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

const strictHelperSchema = (helper: ReturnType<(typeof strictHelpers)[number]['create']>) => {
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

class DefaultCounter {
  count = 4n;
}

interface RecursiveDateNode {
  when: Date;
  next: RecursiveDateNode | null;
}

const convertRegisteredDates = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const input = value as { middle: { leaf: { when: string } } };
  return { middle: { leaf: { when: new Date(input.middle.leaf.when) } } };
};

const convertRecursiveDates = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const input = value as { when: string; next: unknown };
  return { when: new Date(input.when), next: input.next === null ? null : convertRecursiveDates(input.next) };
};

describe('Zod v3 strict schema capability analysis', () => {
  it.each([
    {
      name: 'union',
      schema: () =>
        z3
          .union([
            z3.string().transform((value) => new Date(value)),
            z3.number().transform((value) => new Date(value)),
          ])
          .pipe(z3.date()),
    },
    {
      name: 'lazy',
      schema: () => z3.lazy(() => z3.string().transform((value) => new Date(value))).pipe(z3.date()),
    },
    {
      name: 'intersection',
      schema: () =>
        z3
          .intersection(
            z3.string().transform((value) => new Date(value)),
            z3.string().transform((value) => new Date(value)),
          )
          .pipe(z3.date()),
    },
  ])('recognizes native conversions inside $name pipeline inputs', ({ schema }) => {
    expect(formatFor(schema()).$parseRaw('{"value":"2026-08-17T00:00:00.000Z"}')).toEqual({
      value: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it.each([
    {
      name: 'union',
      input: () => z3.union([z3.string().transform((value) => new Date(value)), z3.number()]),
    },
    {
      name: 'intersection',
      input: () =>
        z3.intersection(
          z3.string().transform((value) => new Date(value)),
          z3.string(),
        ),
    },
    {
      name: 'nested intersection',
      input: () =>
        z3.intersection(
          z3.lazy(() => z3.string().transform((value) => new Date(value))),
          z3.string(),
        ),
    },
  ])('rejects compound pipelines when one $name input does not convert', ({ input }) => {
    expect(() => formatFor(input().pipe(z3.date()))).toThrow('ZodDate');
  });

  it.each([
    {
      name: 'direct',
      output: () => z3.intersection(z3.string(), z3.date()),
    },
    {
      name: 'lazy',
      output: () =>
        z3.intersection(
          z3.string(),
          z3.lazy(() => z3.date()),
        ),
    },
  ])('rejects incompatible $name arms in a coercing pipeline output intersection', ({ output }) => {
    expect(() => formatFor(z3.coerce.string().pipe(output()))).toThrow('ZodDate');
  });

  it('preserves compatible intersections and existential unions in coercing pipeline outputs', () => {
    expect(formatFor(z3.coerce.string().pipe(z3.intersection(z3.string(), z3.string())))).toBeDefined();
    expect(formatFor(z3.coerce.string().pipe(z3.union([z3.string(), z3.date()])))).toBeDefined();
  });

  it.each([
    { name: 'any value', schema: () => z3.any().default({ count: 4n }) },
    { name: 'unknown value', schema: () => z3.unknown().default({ count: 4n }) },
    { name: 'any property', schema: () => z3.object({ count: z3.any() }).default({ count: 4n }) },
    { name: 'unknown array item', schema: () => z3.array(z3.unknown()).default([4n]) },
    { name: 'any record value', schema: () => z3.record(z3.any()).default({ count: 4n }) },
  ])('rejects nested BigInt defaults without a typed $name schema', ({ schema }) => {
    expect(() => formatFor(schema())).toThrow('ZodBigInt');
  });

  it('preserves nested BigInt defaults in supported typed arrays and objects', () => {
    const format = zodResponseFormat(
      z3.object({
        values: z3.array(z3.coerce.bigint()).default([4n]),
        detail: z3.object({ count: z3.coerce.bigint() }).default({ count: 5n }),
      }),
      'strict',
    );

    expect(format.json_schema.schema).toMatchObject({
      properties: { values: { default: [4] }, detail: { default: { count: 5 } } },
    });
    expect(format.$parseRaw('{}')).toEqual({ values: [4n], detail: { count: 5n } });
  });

  it.each([
    {
      name: 'direct',
      schema: () => z3.object({ count: z3.coerce.bigint() }).default(new DefaultCounter()),
      normalized: { count: 4 },
      parsed: { count: 4n },
    },
    {
      name: 'nested',
      schema: () =>
        z3.object({ detail: z3.object({ count: z3.coerce.bigint() }) }).default({
          detail: new DefaultCounter(),
        }),
      normalized: { detail: { count: 4 } },
      parsed: { detail: { count: 4n } },
    },
  ])(
    'normalizes safe $name class-instance default data without invoking user code',
    ({ schema, normalized, parsed }) => {
      const format = formatFor(schema());
      expect(format.json_schema.schema).toHaveProperty('properties.value.default', normalized);
      expect(format.$parseRaw('{}')).toEqual({ value: parsed });
      expect(() => JSON.stringify(format)).not.toThrow();
    },
  );

  it.each([
    {
      name: 'plain serializer',
      create: (hook: () => unknown) => ({ count: 4, toJSON: hook }),
      message: 'toJSON',
    },
    {
      name: 'inherited serializer',
      create: (hook: () => unknown) => Object.assign(Object.create({ toJSON: hook }), { count: 4 }),
      message: 'toJSON',
    },
    {
      name: 'accessor',
      create: (hook: () => unknown) => Object.defineProperty({}, 'count', { enumerable: true, get: hook }),
      message: 'accessor',
    },
  ])('rejects a default $name hook without executing it', ({ create, message }) => {
    const hook = vi.fn(() => {
      throw new Error('must never run');
    });
    expect(() => formatFor(z3.any().default(create(hook)))).toThrow(message);
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'function', value: () => () => 4 },
    { name: 'symbol', value: () => Symbol('default') },
    { name: 'undefined', value: () => Object.getOwnPropertyDescriptor({}, 'missing') },
  ])('rejects non-JSON $name values inside safe class data', ({ value }) => {
    const instance = Object.assign(Object.create({ label: 'class' }), { count: value() });
    expect(() => formatFor(z3.any().default(instance))).toThrow('non-JSON');
  });

  it.each([
    { name: 'invalid timestamp', value: () => new Date(Number.NaN) },
    {
      name: 'subclass',
      value: () => Object.setPrototypeOf(new Date('2026-08-17T00:00:00.000Z'), Object.create(Date.prototype)),
    },
    {
      name: 'own serializer',
      value: () =>
        Object.defineProperty(new Date('2026-08-17T00:00:00.000Z'), 'toJSON', {
          value: () => ({ value: 'unsafe' }),
        }),
    },
  ])('rejects a noncanonical $name Date default', ({ value }) => {
    expect(() => formatFor(z3.coerce.date().default(value()))).toThrow('invalid or customized');
  });

  it.each([
    { name: 'string', first: () => z3.string() },
    { name: 'any value', first: () => z3.any() },
    { name: 'wrapped string', first: () => z3.string().readonly() },
  ])('rejects a Date default intercepted by an earlier $name union option', ({ first }) => {
    const value = z3.union([first(), z3.coerce.date()]).default(new Date('2026-08-17T00:00:00.000Z'));
    expect(() => formatFor(value)).toThrow('ZodDate');
  });

  it('preserves Date defaults selected by direct, ordered, and discriminated native branches', () => {
    const date = new Date('2026-08-17T00:00:00.000Z');
    const format = zodResponseFormat(
      z3.object({
        direct: z3.coerce.date().default(date),
        ordered: z3.union([z3.coerce.date(), z3.string()]).default(date),
        tagged: z3
          .union([
            z3.object({ kind: z3.literal('string'), when: z3.string() }),
            z3.object({ kind: z3.literal('date'), when: z3.coerce.date() }),
          ])
          .default({ kind: 'date', when: date }),
      }),
      'strict',
    );
    expect(format.$parseRaw('{}')).toEqual({
      direct: date,
      ordered: date,
      tagged: { kind: 'date', when: date },
    });
    expect(() => JSON.stringify(format)).not.toThrow();
  });

  it.each([Infinity, -Infinity, Number.NaN])('rejects a non-finite numeric default %s', (value) => {
    expect(() => formatFor(z3.number().default(value))).toThrow('non-finite');
    expect(() => formatFor(z3.any().default({ nested: [value] }))).toThrow('non-finite');
  });

  it('rejects cyclic defaults while preserving completed shared default values', () => {
    const cyclic: { nested?: unknown } = {};
    cyclic.nested = cyclic;
    expect(() => formatFor(z3.any().default(cyclic))).toThrow('cyclic');

    const array: unknown[] = [];
    array.push(array);
    expect(() => formatFor(z3.any().default(array))).toThrow('cyclic');

    const shared = { count: 4 };
    const format = formatFor(z3.any().default({ first: shared, second: shared }));
    expect(format.$parseRaw('{}')).toEqual({ value: { first: shared, second: shared } });
    expect(() => JSON.stringify(format)).not.toThrow();
  });

  it('revalidates shared native default objects against every schema use site', () => {
    const shared = { count: 4n };
    const incompatible = z3
      .object({
        typed: z3.object({ count: z3.coerce.bigint() }),
        raw: z3.any(),
      })
      .default({ typed: shared, raw: shared });
    expect(() => formatFor(incompatible)).toThrow('ZodBigInt');

    const compatible = z3
      .object({
        first: z3.object({ count: z3.coerce.bigint() }),
        second: z3.object({ count: z3.coerce.bigint() }),
      })
      .default({ first: shared, second: shared });
    const format = formatFor(compatible);
    const value = (
      format.json_schema.schema as {
        properties: { value: { default: { first: object; second: object } } };
      }
    ).properties.value.default;
    expect(value.first).toEqual({ count: 4 });
    expect(value.first).toBe(value.second);
    expect(format.$parseRaw('{}')).toEqual({ value: { first: { count: 4n }, second: { count: 4n } } });
  });

  it.each([
    {
      name: 'self-referencing',
      create: () => {
        const proxy: object = new Proxy({}, { getPrototypeOf: () => proxy });
        return proxy;
      },
    },
    {
      name: 'unbounded',
      create: () => {
        const handler: ProxyHandler<object> = {
          getPrototypeOf: () => new Proxy({}, handler),
        };
        return new Proxy({}, handler);
      },
    },
  ])('rejects a hostile $name Proxy prototype chain without hanging', ({ create }) => {
    expect(() => formatFor(z3.any().default(create()))).toThrow('prototype chain');
  });

  it.each([
    { name: 'tuple', schema: () => z3.tuple([z3.number()]), message: 'tuple-form' },
    { name: 'record', schema: () => z3.record(z3.number()), message: 'additionalProperties: false' },
    {
      name: 'array and tuple union',
      schema: () => z3.union([z3.array(z3.coerce.bigint()), z3.tuple([z3.number()])]),
      message: 'tuple-form',
    },
    {
      name: 'preprocessed Map',
      schema: () =>
        z3.preprocess((value) => new Map(value as [string, number][]), z3.map(z3.string(), z3.number())),
      message: 'tuple-form',
    },
  ])('rejects unsupported $name representations at the canonical strict boundary', ({ schema, message }) => {
    expect(() => formatFor(schema())).toThrow(message);
  });

  it.each([
    {
      name: 'direct union',
      schema: () => z3.union([z3.coerce.bigint(), z3.string()]).default(4n),
      output: 4n,
      normalized: 4,
    },
    {
      name: 'string-prefixed union',
      schema: () => z3.union([z3.string(), z3.coerce.bigint()]).default(4n),
      output: 4n,
      normalized: 4,
    },
    {
      name: 'unmatched numeric literal',
      schema: () => z3.union([z3.literal(5), z3.coerce.bigint()]).default(4n),
      output: 4n,
      normalized: 4,
    },
    {
      name: 'unmatched native enum',
      schema: () => z3.union([z3.nativeEnum({ Five: 5 } as const), z3.coerce.bigint()]).default(4n),
      output: 4n,
      normalized: 4,
    },
    {
      name: 'disjoint numeric minimum',
      schema: () => z3.union([z3.number().min(5), z3.coerce.bigint()]).default(4n),
      output: 4n,
      normalized: 4,
    },
    {
      name: 'nested object union',
      schema: () =>
        z3.union([z3.object({ count: z3.coerce.bigint() }), z3.object({ count: z3.string() })]).default({
          count: 4n,
        }),
      output: { count: 4n },
      normalized: { count: 4 },
    },
    {
      name: 'discriminated object union',
      schema: () =>
        z3
          .union([
            z3.object({ kind: z3.literal('number'), count: z3.number() }),
            z3.object({ kind: z3.literal('bigint'), count: z3.coerce.bigint() }),
          ])
          .default({ kind: 'bigint', count: 4n }),
      output: { kind: 'bigint', count: 4n },
      normalized: { kind: 'bigint', count: 4 },
    },
  ])(
    'normalizes a safe BigInt default through a compatible $name branch',
    ({ schema, output, normalized }) => {
      const format = formatFor(schema());
      expect(format.json_schema.schema).toHaveProperty('properties.value.default', normalized);
      expect(format.$parseRaw('{}')).toEqual({ value: output });
    },
  );

  it.each([
    { name: 'branded', wrap: (schema: z3.ZodTypeAny) => schema.brand<'number-branch'>() },
    { name: 'readonly', wrap: (schema: z3.ZodTypeAny) => schema.readonly() },
    { name: 'refinement', wrap: (schema: z3.ZodTypeAny) => schema.refine(() => true) },
    { name: 'defaulted', wrap: (schema: z3.ZodTypeAny) => schema.default({ kind: 'number', count: 0 }) },
    { name: 'lazy', wrap: (schema: z3.ZodTypeAny) => z3.lazy(() => schema) },
  ])('matches discriminators through a transparent $name union option', ({ wrap }) => {
    const number = z3.object({ kind: z3.literal('number'), count: z3.number() });
    const bigint = z3.object({ kind: z3.literal('bigint'), count: z3.coerce.bigint() });
    const value = z3.union([wrap(number), bigint]).default({ kind: 'bigint', count: 4n });
    const format = formatFor(value);

    expect(format.json_schema.schema).toHaveProperty('properties.value.default', {
      kind: 'bigint',
      count: 4,
    });
    expect(format.$parseRaw('{}')).toEqual({ value: { kind: 'bigint', count: 4n } });
  });

  it.each([
    { name: 'number', schema: () => z3.union([z3.number(), z3.coerce.bigint()]).default(4n) },
    { name: 'any', schema: () => z3.union([z3.any(), z3.coerce.bigint()]).default(4n) },
    {
      name: 'matching literal',
      schema: () => z3.union([z3.literal(4), z3.coerce.bigint()]).default(4n),
    },
    {
      name: 'matching native enum',
      schema: () => z3.union([z3.nativeEnum({ Four: 4 } as const), z3.coerce.bigint()]).default(4n),
    },
    {
      name: 'nested number',
      schema: () =>
        z3
          .union([z3.object({ count: z3.number() }), z3.object({ count: z3.coerce.bigint() })])
          .default({ count: 4n }),
    },
  ])('rejects BigInt defaults intercepted by an earlier $name union option', ({ schema }) => {
    expect(() => formatFor(schema())).toThrow('ZodBigInt');
  });

  it.each([
    {
      name: 'Set',
      type: 'ZodSet',
      schema: () =>
        z3
          .preprocess(
            (value) => (value instanceof Set ? value : new Set(value as string[])),
            z3.set(z3.string()),
          )
          .default(new Set(['x'])),
    },
    {
      name: 'Map',
      type: 'ZodMap',
      schema: () =>
        z3
          .preprocess(
            (value) => (value instanceof Map ? value : new Map(value as [string, number][])),
            z3.map(z3.string(), z3.number()),
          )
          .default(new Map([['x', 1]])),
    },
    {
      name: 'nested Set',
      type: 'ZodSet',
      schema: () =>
        z3
          .object({
            values: z3.preprocess((value) => new Set(value as string[]), z3.set(z3.string())),
          })
          .default({ values: new Set(['x']) }),
    },
  ])('rejects native $name defaults before JSON serialization', ({ schema, type }) => {
    expect(() => formatFor(schema())).toThrow(type);
  });

  it('bounds fallible numeric branches before BigInt coercion', () => {
    const value = z3.union([z3.number().refine((input) => input < 100), z3.coerce.bigint()]);
    const format = formatFor(value);

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        value: {
          anyOf: [
            { type: 'number', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
            { type: 'integer' },
          ],
        },
      },
    });
    expect(format.$parseRaw('{"value":101}')).toEqual({ value: 101n });
  });

  it.each([
    {
      name: 'whole-object refinement',
      earlier: () => z3.object({ count: z3.number() }).refine((value) => value.count < 100),
      later: () => z3.object({ count: z3.coerce.bigint() }),
      input: { count: 101 },
      output: { count: 101n },
    },
    {
      name: 'sibling refinement',
      earlier: () =>
        z3.object({ count: z3.number(), kind: z3.string().refine((value) => value === 'number') }),
      later: () => z3.object({ count: z3.coerce.bigint(), kind: z3.string() }),
      input: { count: 101, kind: 'bigint' },
      output: { count: 101n, kind: 'bigint' },
    },
  ])('bounds numeric leaves when an earlier $name can fall through', ({ earlier, later, input, output }) => {
    const format = formatFor(z3.union([earlier(), later()]));
    expect(format.json_schema.schema).toHaveProperty('properties.value.anyOf.0.properties.count', {
      type: 'number',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(format.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: output });
  });

  it.each([
    {
      name: 'disjoint positive values',
      bigint: () => z3.coerce.bigint().max(10n),
      number: () => z3.number().min(1e20),
      branch: { type: 'number', minimum: 1e20 },
      input: 1e20,
    },
    {
      name: 'only negative unsafe overlap',
      bigint: () => z3.coerce.bigint().max(10n),
      number: () => z3.number(),
      branch: { type: 'number', minimum: Number.MIN_SAFE_INTEGER },
      input: 1e20,
    },
    {
      name: 'only positive unsafe overlap',
      bigint: () => z3.coerce.bigint().min(-10n),
      number: () => z3.number(),
      branch: { type: 'number', maximum: Number.MAX_SAFE_INTEGER },
      input: -1e20,
    },
    {
      name: 'fully bounded BigInt values',
      bigint: () => z3.coerce.bigint().min(-10n).max(10n),
      number: () => z3.number(),
      branch: { type: 'number' },
      input: 1e20,
    },
    {
      name: 'disjoint constrained intersection',
      bigint: () => z3.intersection(z3.coerce.bigint().max(10n), z3.coerce.bigint()),
      number: () => z3.number().min(1e20),
      branch: { type: 'number', minimum: 1e20 },
      input: 1e20,
    },
  ])('preserves $name in later number alternatives', ({ bigint, number, branch, input }) => {
    const format = formatFor(z3.union([bigint(), number()]));
    const schema = format.json_schema.schema as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(schema.properties.value.anyOf[1]).toEqual(branch);
    expect(format.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: input });
  });

  it('does not treat Promise-wrapped BigInt as a synchronous union producer', () => {
    const value = z3.union([z3.promise(z3.coerce.bigint()), z3.number()]);
    const format = formatFor(value);

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        value: {
          anyOf: [{ type: 'number' }],
        },
      },
    });
    expect(format.$parseRaw('{"value":7}')).toEqual({ value: 7 });
  });

  it.each([
    { name: 'Date', schema: () => z3.date().catch(new Date(0)), input: 'fallback', output: new Date(0) },
    { name: 'BigInt', schema: () => z3.bigint().catch(1n), input: 1, output: 1n },
    {
      name: 'Set',
      schema: () => z3.set(z3.string()).catch(new Set(['fallback'])),
      input: [],
      output: new Set(['fallback']),
    },
  ])('treats typed $name catch fallbacks as native conversions', ({ schema, input, output }) => {
    const format = formatFor(schema());
    expect(format.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: output });
    expect(() => JSON.stringify(format)).not.toThrow();
  });

  it('propagates preprocessing through reverse-ordered nested registered definitions', () => {
    const leaf = z3.object({ when: z3.date() });
    const middle = z3.object({ leaf });
    const outer = z3.object({ middle });
    const format = zodResponseFormat(
      z3.object({ value: z3.preprocess(convertRegisteredDates, outer) }),
      'strict',
      {
        schemaDefinitions: { Leaf: leaf, Middle: middle, Outer: outer },
      },
    );

    expect(format.$parseRaw('{"value":{"middle":{"leaf":{"when":"2026-08-17T00:00:00.000Z"}}}}')).toEqual({
      value: { middle: { leaf: { when: new Date('2026-08-17T00:00:00.000Z') } } },
    });
    expect(format.json_schema.schema).toHaveProperty('definitions.Leaf.properties.when.format', 'date-time');
    expect(() =>
      zodResponseFormat(
        z3.object({ converted: z3.preprocess(convertRegisteredDates, outer), raw: leaf }),
        'strict',
        {
          schemaDefinitions: { Leaf: leaf, Middle: middle, Outer: outer },
        },
      ),
    ).toThrow('ZodDate');
  });

  it('rejects recursive BigInt and number alternatives whose shared references cannot be bounded', () => {
    const bigintNode: z3.ZodTypeAny = z3.lazy(() =>
      z3.object({ value: z3.coerce.bigint(), next: bigintNode.nullable() }),
    );
    const numberNode: z3.ZodTypeAny = z3.lazy(() =>
      z3.object({ value: z3.number(), next: numberNode.nullable() }),
    );

    expect(() => formatFor(z3.union([bigintNode, numberNode]))).toThrow(
      'Recursive BigInt and number union alternatives cannot safely preserve integer precision',
    );
  });

  it('bounds a finite numeric overlap beside an unrelated recursive string subtree', () => {
    const metadata: z3.ZodTypeAny = z3.lazy(() =>
      z3.object({ label: z3.string(), next: metadata.nullable() }),
    );
    const producer = z3.object({ count: z3.coerce.bigint(), meta: metadata });
    const consumer = z3.object({ count: z3.number(), meta: metadata });
    const format = formatFor(z3.union([producer, consumer]));

    expect(format.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.count', {
      type: 'number',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(
      format.$parseRaw('{"value":{"count":7,"meta":{"label":"outer","next":{"label":"inner","next":null}}}}'),
    ).toEqual({ value: { count: 7n, meta: { label: 'outer', next: { label: 'inner', next: null } } } });
  });

  it('preserves independently recursive and discriminator-separated numeric alternatives', () => {
    const bigintNode: z3.ZodTypeAny = z3.lazy(() =>
      z3.object({ kind: z3.literal('bigint'), value: z3.coerce.bigint(), next: bigintNode.nullable() }),
    );
    const numberNode: z3.ZodTypeAny = z3.lazy(() =>
      z3.object({ kind: z3.literal('number'), value: z3.number(), next: numberNode.nullable() }),
    );
    const input = { kind: 'number', value: 1e20, next: null };

    expect(formatFor(numberNode).$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: input });
    expect(formatFor(z3.union([bigintNode, numberNode])).$parseRaw(JSON.stringify({ value: input }))).toEqual(
      { value: input },
    );
  });

  it.each([
    { name: 'minimum', schema: () => z3.set(z3.string()).min(2) },
    { name: 'exact size', schema: () => z3.set(z3.string()).size(2) },
  ])('rejects a preprocessed Set with an unrepresentable $name cardinality constraint', ({ schema }) => {
    const value = z3.preprocess((input) => new Set(input as string[]), schema());
    expect(() => formatFor(value)).toThrow(/ZodSet.*uniqueItems/u);
  });

  it.each([
    { name: 'unconstrained', schema: () => z3.set(z3.string()) },
    { name: 'maximum-only', schema: () => z3.set(z3.string()).max(2) },
    { name: 'zero minimum', schema: () => z3.set(z3.string()).min(0) },
  ])('preserves duplicate-deduplicating $name Sets', ({ schema }) => {
    const value = z3.preprocess((input) => new Set(input as string[]), schema());
    expect(formatFor(value).$parseRaw('{"value":["x","x"]}')).toEqual({ value: new Set(['x']) });
  });

  it('preserves non-strict constrained Set schemas', () => {
    const realtime = zodRealtimeFunction({
      name: 'realtime',
      parameters: z3.object({
        value: z3.preprocess((input) => new Set(input as string[]), z3.set(z3.string()).min(2)),
      }),
    });
    expect(realtime.parameters).toHaveProperty('properties.value', {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string' },
      minItems: 2,
    });
  });

  it('preserves preprocessing context in extracted recursive lazy definitions', () => {
    const node: z3.ZodType<RecursiveDateNode> = z3.lazy(() =>
      z3.object({ when: z3.date(), next: node.nullable() }),
    );
    const format = formatFor(z3.preprocess(convertRecursiveDates, node));

    expect(
      format.$parseRaw(
        '{"value":{"when":"2026-08-17T00:00:00.000Z","next":{"when":"2026-08-18T00:00:00.000Z","next":null}}}',
      ),
    ).toEqual({
      value: {
        when: new Date('2026-08-17T00:00:00.000Z'),
        next: { when: new Date('2026-08-18T00:00:00.000Z'), next: null },
      },
    });
    expect(() =>
      zodResponseFormat(
        z3.object({ converted: z3.preprocess(convertRecursiveDates, node), raw: node }),
        'strict',
      ),
    ).toThrow('ZodDate');
  });

  it.each([
    {
      name: 'object properties',
      producer: () => z3.object({ count: z3.coerce.bigint() }),
      consumer: () => z3.object({ count: z3.number() }),
      input: { count: 7 },
      output: { count: 7n },
      path: ['properties', 'count'],
    },
    {
      name: 'exact BigInt object transform',
      producer: () => z3.object({ count: z3.number().transform(BigInt) }),
      consumer: () => z3.object({ count: z3.number() }),
      input: { count: 7 },
      output: { count: 7n },
      path: ['properties', 'count'],
    },
    {
      name: 'exact BigInt array transform',
      producer: () => z3.array(z3.number().transform(BigInt)),
      consumer: () => z3.array(z3.number()),
      input: [7],
      output: [7n],
      path: ['items'],
    },
    {
      name: 'array items',
      producer: () => z3.array(z3.coerce.bigint()),
      consumer: () => z3.array(z3.number()),
      input: [7],
      output: [7n],
      path: ['items'],
    },
    {
      name: 'nested object-array paths',
      producer: () => z3.object({ values: z3.array(z3.object({ count: z3.coerce.bigint() })) }),
      consumer: () => z3.object({ values: z3.array(z3.object({ count: z3.number() })) }),
      input: { values: [{ count: 7 }] },
      output: { values: [{ count: 7n }] },
      path: ['properties', 'values', 'items', 'properties', 'count'],
    },
    {
      name: 'nullable nested object',
      producer: () => z3.object({ nested: z3.object({ count: z3.coerce.bigint() }).nullable() }),
      consumer: () => z3.object({ nested: z3.object({ count: z3.number() }).nullable() }),
      input: { nested: { count: 7 } },
      output: { nested: { count: 7n } },
      path: ['properties', 'nested', 'anyOf', 0, 'properties', 'count'],
    },
    {
      name: 'nullable nested array',
      producer: () => z3.object({ values: z3.array(z3.object({ count: z3.coerce.bigint() })).nullable() }),
      consumer: () => z3.object({ values: z3.array(z3.object({ count: z3.number() })).nullable() }),
      input: { values: [{ count: 7 }] },
      output: { values: [{ count: 7n }] },
      path: ['properties', 'values', 'anyOf', 0, 'items', 'properties', 'count'],
    },
  ])(
    'bounds unsafe overlap at matching $name in union alternatives',
    ({ producer, consumer, input, output, path }) => {
      const format = formatFor(z3.union([producer(), consumer()]));
      const schema = format.json_schema.schema as {
        properties: { value: { anyOf: Record<string, unknown>[] } };
      };

      expect(nestedSchemaAt(schema.properties.value.anyOf[1], path)).toMatchObject({
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      expect(format.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: output });
    },
  );

  it('preserves distinct object properties and disjoint literal branches', () => {
    const differentPaths = formatFor(
      z3.union([z3.object({ bigint: z3.coerce.bigint() }), z3.object({ number: z3.number() })]),
    );
    const tagged = formatFor(
      z3.union([
        z3.object({ kind: z3.literal('bigint'), count: z3.coerce.bigint() }),
        z3.object({ kind: z3.literal('number'), count: z3.number() }),
      ]),
    );

    expect(differentPaths.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.number', {
      type: 'number',
    });
    expect(tagged.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.count', {
      type: 'number',
    });
  });

  it.each([
    {
      name: 'nested literal',
      bigint: () => z3.object({ kind: z3.object({ name: z3.literal('bigint') }), count: z3.coerce.bigint() }),
      number: () =>
        z3.object({ kind: z3.object({ name: z3.literal('number') }), count: z3.number().min(1e20) }),
      input: { kind: { name: 'number' }, count: 1e20 },
    },
    {
      name: 'wrapped literal',
      bigint: () => z3.object({ kind: z3.literal('bigint').readonly(), count: z3.coerce.bigint() }),
      number: () =>
        z3.object({ kind: z3.literal('number').brand<'number-kind'>(), count: z3.number().min(1e20) }),
      input: { kind: 'number', count: 1e20 },
    },
    {
      name: 'enum',
      bigint: () => z3.object({ kind: z3.enum(['bigint']), count: z3.coerce.bigint() }),
      number: () => z3.object({ kind: z3.enum(['number']), count: z3.number().min(1e20) }),
      input: { kind: 'number', count: 1e20 },
    },
    {
      name: 'primitive number versus string',
      bigint: () => z3.object({ kind: z3.number(), count: z3.coerce.bigint() }),
      number: () => z3.object({ kind: z3.string(), count: z3.number().min(1e20) }),
      input: { kind: 'number', count: 1e20 },
    },
    {
      name: 'wrapped primitive boolean versus string',
      bigint: () => z3.object({ kind: z3.boolean().readonly(), count: z3.coerce.bigint() }),
      number: () => z3.object({ kind: z3.string().brand<'string-kind'>(), count: z3.number().min(1e20) }),
      input: { kind: 'number', count: 1e20 },
    },
    {
      name: 'nested primitive number versus string',
      bigint: () => z3.object({ kind: z3.object({ type: z3.number() }), count: z3.coerce.bigint() }),
      number: () => z3.object({ kind: z3.object({ type: z3.string() }), count: z3.number().min(1e20) }),
      input: { kind: { type: 'number' }, count: 1e20 },
    },
    {
      name: 'numeric native enum reverse mapping',
      bigint: () =>
        z3.object({ kind: z3.nativeEnum({ 0: 'numeric', numeric: 0 } as const), count: z3.coerce.bigint() }),
      number: () => z3.object({ kind: z3.literal('numeric'), count: z3.number().min(1e20) }),
      input: { kind: 'numeric', count: 1e20 },
    },
  ])(
    'preserves unsafe-range number branches separated by a $name discriminator',
    ({ bigint, number, input }) => {
      const format = formatFor(z3.union([bigint(), number()]));
      expect(format.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.count', {
        type: 'number',
        minimum: 1e20,
      });
      expect(format.$parseRaw(JSON.stringify({ value: input }))).toEqual({ value: input });
    },
  );

  it('keeps overlap bounds when a coercing discriminator accepts multiple JSON primitive types', () => {
    const format = formatFor(
      z3.union([
        z3.object({ kind: z3.coerce.number(), count: z3.coerce.bigint() }),
        z3.object({ kind: z3.string(), count: z3.number() }),
      ]),
    );
    expect(format.json_schema.schema).toHaveProperty(
      'properties.value.anyOf.1.properties.count.maximum',
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('preserves disjoint and one-sided nested numeric interception intervals', () => {
    const disjoint = formatFor(
      z3.union([
        z3.object({ count: z3.coerce.bigint().max(10n) }),
        z3.object({ count: z3.number().min(1e20) }),
      ]),
    );
    const oneSided = formatFor(
      z3.union([z3.object({ count: z3.coerce.bigint().max(10n) }), z3.object({ count: z3.number() })]),
    );

    expect(disjoint.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.count', {
      type: 'number',
      minimum: 1e20,
    });
    expect(oneSided.json_schema.schema).toHaveProperty('properties.value.anyOf.1.properties.count', {
      type: 'number',
      minimum: Number.MIN_SAFE_INTEGER,
    });
  });

  it('bounds shared nested numeric references without changing their other uses', () => {
    const number = z3.number();
    const container = z3.object({ count: z3.number() });
    const format = zodResponseFormat(
      z3.object({
        outsideNumber: number,
        outsideContainer: container,
        direct: z3.union([z3.object({ count: z3.coerce.bigint() }), z3.object({ count: number })]),
        nested: z3.union([
          z3.object({ child: z3.object({ count: z3.coerce.bigint() }) }),
          z3.object({ child: container }),
        ]),
      }),
      'strict',
    );

    const bounds = { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
    expect(format.json_schema.schema).toHaveProperty('properties.outsideNumber', { type: 'number' });
    expect(format.json_schema.schema).toHaveProperty('properties.outsideContainer.properties.count', {
      type: 'number',
    });
    expect(format.json_schema.schema).toHaveProperty('properties.direct.anyOf.1.properties.count', {
      type: 'number',
      ...bounds,
    });
    expect(format.json_schema.schema).toHaveProperty(
      'properties.nested.anyOf.1.properties.child.properties.count',
      {
        type: 'number',
        ...bounds,
      },
    );
    expect(JSON.stringify(format.json_schema.schema)).not.toContain('"allOf"');
  });

  it.each(['leaf-first', 'holder-first'] as const)(
    'revalidates a registered definition after a late raw edge in %s order',
    (order) => {
      const leaf = z3.object({ when: z3.date() });
      const holder = z3.object({ leaf });
      const definitions =
        order === 'leaf-first' ? { Leaf: leaf, Holder: holder } : { Holder: holder, Leaf: leaf };

      expect(() =>
        zodResponseFormat(
          z3.object({ converted: z3.preprocess(convertLeafDate, leaf), raw: holder }),
          'strict',
          { schemaDefinitions: definitions },
        ),
      ).toThrow('ZodDate');
    },
  );
});

describe.each(strictHelpers)('$name strict numeric input capability analysis', ({ create }) => {
  it.each([0n, -2n])('rejects an invalid BigInt multiple %s before emitting JSON Schema', (multiple) => {
    expect(() => create(z3.object({ value: z3.coerce.bigint().multipleOf(multiple) }))).toThrow(
      'strictly positive',
    );
  });

  it.each([
    { name: 'direct BigInt', schema: () => z3.number().int().transform(BigInt) },
    { name: 'unrestricted BigInt', schema: () => z3.number().transform(BigInt) },
    {
      name: 'wrapped BigInt',
      schema: () => z3.number().int().transform(BigInt).nullable(),
    },
  ])('conservatively bounds numeric $name transforms', ({ schema }) => {
    const result = create(z3.object({ value: schema() }));
    const generated = strictHelperSchema(result) as {
      properties: { value: Record<string, unknown> };
    };
    const property = generated.properties.value;
    const value = Array.isArray(property['anyOf'])
      ? (property['anyOf'][0] as Record<string, unknown>)
      : property;

    expect(value).toMatchObject({
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
  });

  it.each([
    { name: 'direct', producer: () => z3.number().transform(BigInt) },
    { name: 'readonly', producer: () => z3.number().transform(BigInt).readonly() },
    { name: 'lazy', producer: () => z3.lazy(() => z3.number().transform(BigInt)) },
  ])('bounds later numbers after an exact $name BigInt transform producer', ({ producer }) => {
    const result = create(z3.object({ value: z3.union([producer(), z3.number()]) }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value.anyOf.1', {
      type: 'number',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
  });

  it('preserves numeric intervals disjoint from an exact bounded BigInt transform', () => {
    const value = z3.union([z3.number().max(10).transform(BigInt), z3.number().min(1e20)]);
    const result = create(z3.object({ value }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value.anyOf.1', {
      type: 'number',
      minimum: 1e20,
    });
  });

  it('rejects compound inputs that the built-in BigInt transform cannot safely represent', () => {
    const value = z3.union([z3.number(), z3.string()]).transform(BigInt);
    expect(() => create(z3.object({ value }))).toThrow('directly representable numeric JSON input');
  });

  it.each([
    { name: 'string', schema: () => z3.number().transform(String), expected: String(1e20) },
    { name: 'boolean', schema: () => z3.number().transform(Boolean), expected: true },
    { name: 'number', schema: () => z3.number().transform(Number), expected: 1e20 },
  ])('preserves unsafe-range numeric inputs for inspectable $name transforms', ({ schema, expected }) => {
    const result = create(z3.object({ value: schema() }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value', { type: 'number' });
    expect(result.$parseRaw('{"value":100000000000000000000}')).toEqual({ value: expected });
  });

  it.each([
    { name: 'BigInt', schema: () => z3.number().transform((value) => BigInt(Math.trunc(value))), output: 7n },
    {
      name: 'string',
      schema: () => z3.number().transform((value) => `number: ${value}`),
      output: 'number: 7',
    },
    { name: 'object', schema: () => z3.number().transform((value) => ({ value })), output: { value: 7 } },
  ])('preserves standalone opaque numeric $name transform input compatibility', ({ schema, output }) => {
    const result = create(z3.object({ value: schema() }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value', { type: 'number' });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: output });
  });

  it('rejects a synchronously recoverable Promise catch rather than silently omitting its union branch', () => {
    const fallback = z3.promise(z3.number()).catch(7 as unknown as Promise<number>);
    expect(() => create(z3.object({ value: z3.union([fallback, z3.number()]) }))).toThrow('ZodPromise');
  });

  it.each([
    { name: 'direct', schema: () => z3.promise(z3.string()) },
    { name: 'lazy', schema: () => z3.lazy(() => z3.promise(z3.string())) },
    { name: 'pipeline output', schema: () => z3.string().pipe(z3.promise(z3.string())) },
  ])('rejects a synchronously unparseable $name Promise field', ({ schema }) => {
    expect(() => create(z3.object({ value: schema() }))).toThrow('ZodPromise');
  });

  it.each([
    {
      name: 'numeric Promise',
      value: () => z3.union([z3.promise(z3.number()), z3.string()]),
      schema: { type: 'string' },
      raw: '{"value":"valid"}',
    },
    {
      name: 'string Promise',
      value: () => z3.union([z3.promise(z3.string()), z3.number()]),
      schema: { type: 'number' },
      raw: '{"value":7}',
    },
  ])('omits an uncovered $name union branch from its synchronous input schema', ({ value, schema, raw }) => {
    const result = create(z3.object({ value: value() }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value.anyOf', [schema]);
    expect(() => result.$parseRaw(raw)).not.toThrow();
  });

  it.each([
    {
      name: 'object',
      asynchronous: () => z3.object({ kind: z3.literal('async'), value: z3.promise(z3.number()) }),
      synchronous: () => z3.object({ kind: z3.literal('sync'), value: z3.number() }),
      value: { kind: 'sync', value: 7 },
    },
    {
      name: 'nested object',
      asynchronous: () =>
        z3.object({
          kind: z3.literal('async'),
          detail: z3.object({ value: z3.promise(z3.number()) }),
        }),
      synchronous: () =>
        z3.object({
          kind: z3.literal('sync'),
          detail: z3.object({ value: z3.number() }),
        }),
      value: { kind: 'sync', detail: { value: 7 } },
    },
    {
      name: 'nonempty array',
      asynchronous: () => z3.array(z3.promise(z3.number())).min(1),
      synchronous: () => z3.array(z3.number()),
      value: [7],
    },
  ])('omits a synchronously unreachable $name union container', ({ asynchronous, synchronous, value }) => {
    const result = create(z3.object({ value: z3.union([asynchronous(), synchronous()]) }));
    const branches = (
      strictHelperSchema(result) as {
        properties: { value: { anyOf: unknown[] } };
      }
    ).properties.value.anyOf;

    expect(branches).toHaveLength(1);
    expect(result.$parseRaw(JSON.stringify({ value }))).toEqual({ value });
  });

  it('preserves empty arrays and nulls that synchronously avoid Promise elements', () => {
    const emptyArray = create(
      z3.object({ value: z3.union([z3.array(z3.promise(z3.number())), z3.string()]) }),
    );
    const nullable = create(
      z3.object({ value: z3.union([z3.promise(z3.number()).nullable(), z3.string()]) }),
    );

    expect(strictHelperSchema(emptyArray)).toHaveProperty('properties.value.anyOf.0', {
      type: 'array',
      items: {},
      maxItems: 0,
    });
    expect(emptyArray.$parseRaw('{"value":[]}')).toEqual({ value: [] });
    expect(nullable.$parseRaw('{"value":null}')).toEqual({ value: null });
    expect(nullable.$parseRaw('{"value":"sync"}')).toEqual({ value: 'sync' });
  });

  it('rejects a union whose options all require asynchronous Promise inputs', () => {
    const value = z3.union([z3.promise(z3.string()), z3.lazy(() => z3.promise(z3.number()))]);
    expect(() => create(z3.object({ value }))).toThrow('ZodPromise');
  });

  it.each([
    {
      name: 'output refinement',
      schema: () => z3.number().pipe(z3.number().refine((value) => Math.abs(value) < 10)),
    },
    {
      name: 'output super refinement',
      schema: () =>
        z3.number().pipe(
          z3.number().superRefine((value, context) => {
            if (Math.abs(value) >= 10) {
              context.addIssue({ code: z3.ZodIssueCode.custom, message: 'outside range' });
            }
          }),
        ),
    },
    {
      name: 'output preprocessor',
      schema: () =>
        z3
          .number()
          .pipe(
            z3.preprocess(
              (value) => (typeof value === 'number' && Math.abs(value) >= 10 ? 'rejected' : value),
              z3.number(),
            ),
          ),
    },
    {
      name: 'nested output pipeline',
      schema: () => z3.number().pipe(z3.number().pipe(z3.number().refine((value) => Math.abs(value) < 10))),
    },
    {
      name: 'lazy output pipeline',
      schema: () => z3.lazy(() => z3.number().pipe(z3.number().refine((value) => Math.abs(value) < 10))),
    },
    {
      name: 'intersection output pipeline',
      schema: () =>
        z3.intersection(z3.number().pipe(z3.number().refine((value) => Math.abs(value) < 10)), z3.number()),
    },
  ])('bounds fallible $name branches before BigInt coercion', ({ schema }) => {
    const result = create(z3.object({ value: z3.union([schema(), z3.coerce.bigint()]) }));
    const generated = strictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(generated.properties.value.anyOf[0]).toMatchObject({
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7 });
    expect(result.$parseRaw('{"value":9007199254740993}')).toEqual({ value: 9_007_199_254_740_992n });
    expect(result.$parseRaw('{"value":-9007199254740993}')).toEqual({ value: -9_007_199_254_740_992n });
  });

  it.each([
    {
      name: 'positive refinement',
      number: () => z3.number().max(9),
      fallback: () => z3.number().refine((value) => Math.abs(value) < 10),
      raw: '9007199254740993',
      rounded: 9_007_199_254_740_992n,
    },
    {
      name: 'negative refinement',
      number: () => z3.number().min(-9),
      fallback: () => z3.number().refine((value) => Math.abs(value) < 10),
      raw: '-9007199254740993',
      rounded: -9_007_199_254_740_992n,
    },
    {
      name: 'positive Promise',
      number: () => z3.number().max(9),
      fallback: () => z3.promise(z3.number()),
      raw: '9007199254740993',
      rounded: 9_007_199_254_740_992n,
    },
  ])(
    'bounds nested constrained numeric unions with $name fallthrough',
    ({ number, fallback, raw, rounded }) => {
      const result = create(
        z3.object({ value: z3.union([z3.union([number(), fallback()]), z3.coerce.bigint()]) }),
      );
      const generated = strictHelperSchema(result) as {
        properties: { value: { anyOf: Record<string, unknown>[] } };
      };

      expect(generated.properties.value.anyOf[0]).toMatchObject({
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      expect(result.$parseRaw(`{"value":${raw}}`)).toEqual({ value: rounded });
    },
  );

  it.each([
    { name: 'direct', schema: () => z3.promise(z3.number()) },
    { name: 'lazy', schema: () => z3.lazy(() => z3.promise(z3.number())) },
    {
      name: 'intersection',
      schema: () => z3.intersection(z3.promise(z3.number()), z3.number()),
    },
    {
      name: 'pipeline output',
      schema: () => z3.number().pipe(z3.promise(z3.number())),
    },
  ])('bounds $name Promise numeric branches that synchronously fall through', ({ schema }) => {
    const result = create(z3.object({ value: z3.union([schema(), z3.coerce.bigint()]) }));
    const generated = strictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(generated.properties.value.anyOf[0]).toMatchObject({
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(result.$parseRaw('{"value":9007199254740993}')).toEqual({ value: 9_007_199_254_740_992n });
    expect(result.$parseRaw('{"value":-9007199254740993}')).toEqual({ value: -9_007_199_254_740_992n });
  });

  it.each([
    { name: 'plain', schema: () => z3.number(), expected: { type: 'number' } },
    { name: 'coerced', schema: () => z3.coerce.number(), expected: { type: 'number' } },
    { name: 'finite', schema: () => z3.number().finite(), expected: { type: 'number' } },
    { name: 'integer', schema: () => z3.number().int(), expected: { type: 'integer' } },
    {
      name: 'maximum',
      schema: () => z3.number().max(9),
      expected: { type: 'number', maximum: 9 },
    },
    {
      name: 'minimum',
      schema: () => z3.number().min(-9),
      expected: { type: 'number', minimum: -9 },
    },
    {
      name: 'multiple',
      schema: () => z3.number().multipleOf(2),
      expected: { type: 'number', multipleOf: 2 },
    },
  ])('preserves represented $name numeric branches before BigInt coercion', ({ schema, expected }) => {
    const result = create(z3.object({ value: z3.union([schema(), z3.coerce.bigint()]) }));
    const generated = strictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(generated.properties.value.anyOf[0]).toEqual(expected);
  });

  it('preserves nested total numeric branches ahead of opaque alternatives', () => {
    const result = create(
      z3.object({
        value: z3.union([
          z3.union([z3.number(), z3.number().refine((value) => Math.abs(value) < 10)]),
          z3.coerce.bigint(),
        ]),
      }),
    );
    const generated = strictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(generated.properties.value.anyOf[0]).not.toHaveProperty('minimum');
    expect(generated.properties.value.anyOf[0]).not.toHaveProperty('maximum');
    expect(result.$parseRaw('{"value":9007199254740993}')).toEqual({ value: 9_007_199_254_740_992 });
  });

  it.each([
    {
      name: 'object property minimum',
      input: () => z3.object({ count: z3.number() }),
      output: () => z3.object({ count: z3.number().min(1) }),
      path: 'properties.value.properties.count.minimum',
      expected: 1,
    },
    {
      name: 'nested object maximum',
      input: () => z3.object({ inner: z3.object({ count: z3.number() }) }),
      output: () => z3.object({ inner: z3.object({ count: z3.number().max(9) }) }),
      path: 'properties.value.properties.inner.properties.count.maximum',
      expected: 9,
    },
    {
      name: 'array item minimum',
      input: () => z3.array(z3.number()),
      output: () => z3.array(z3.number().min(1)),
      path: 'properties.value.items.minimum',
      expected: 1,
    },
    {
      name: 'array length bounds',
      input: () => z3.array(z3.number()).max(5),
      output: () => z3.array(z3.number()).min(2),
      path: 'properties.value.minItems',
      expected: 2,
    },
  ])(
    'preserves representable structural pipeline output $name constraints',
    ({ input, output, path, expected }) => {
      const result = create(z3.object({ value: input().pipe(output()) }));
      expect(strictHelperSchema(result)).toHaveProperty(path, expected);
      expect(JSON.stringify(strictHelperSchema(result))).not.toContain('"allOf"');
    },
  );

  it.each([
    {
      name: 'array',
      schema: () => {
        const shared = z3.array(z3.number().min(1));
        return shared.pipe(shared);
      },
      path: 'properties.value.items.minimum',
      expected: 1,
    },
    {
      name: 'object',
      schema: () => {
        const shared = z3.object({ count: z3.number().max(9) });
        return shared.pipe(shared);
      },
      path: 'properties.value.properties.count.maximum',
      expected: 9,
    },
  ])('merges a shared $name pipeline input and output reference', ({ schema, path, expected }) => {
    const result = create(z3.object({ value: schema() }));
    expect(strictHelperSchema(result)).toHaveProperty(path, expected);
    expect(JSON.stringify(strictHelperSchema(result))).not.toContain('"allOf"');
  });

  it.each([
    { name: 'identical', input: ['a'] as const, output: ['a'] as const, expected: ['a'] },
    {
      name: 'reordered',
      input: ['a', 'b'] as const,
      output: ['b', 'a'] as const,
      expected: ['a', 'b'],
    },
    {
      name: 'overlapping',
      input: ['a', 'b'] as const,
      output: ['b', 'c'] as const,
      expected: ['b'],
    },
  ])('intersects value-equivalent $name pipeline enum arrays', ({ input, output, expected }) => {
    const result = create(z3.object({ value: z3.enum(input).pipe(z3.enum(output)) }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value.enum', expected);
    expect(() => result.$parseRaw(JSON.stringify({ value: expected[0] }))).not.toThrow();
  });

  it('rejects pipelines with disjoint enums or incompatible enum and literal constraints', () => {
    expect(() => create(z3.object({ value: z3.enum(['a']).pipe(z3.enum(['b'])) }))).toThrow(
      'ZodPipeline output constraints',
    );
    expect(() => create(z3.object({ value: z3.enum(['a']).pipe(z3.literal('b')) }))).toThrow(
      'ZodPipeline output constraints',
    );
  });

  it.each([
    {
      name: 'BigInt maximum',
      output: () => z3.bigint().max(9n),
      keyword: 'maximum',
      expected: 9,
    },
    {
      name: 'BigInt literal',
      output: () => z3.literal(4n),
      keyword: 'const',
      expected: 4,
    },
  ])(
    'projects a converting pipeline output $name constraint onto numeric input',
    ({ output, keyword, expected }) => {
      const result = create(z3.object({ value: z3.number().transform(BigInt).pipe(output()) }));
      expect(strictHelperSchema(result)).toHaveProperty(`properties.value.${keyword}`, expected);
    },
  );

  it('projects every constrained BigInt pipeline output alternative onto numeric input', () => {
    const value = z3
      .number()
      .transform(BigInt)
      .pipe(z3.union([z3.bigint().max(10n), z3.bigint().min(100n)]));
    const result = create(z3.object({ value }));
    expect(strictHelperSchema(result)).toHaveProperty('properties.value.anyOf', [
      expect.objectContaining({ type: 'integer', maximum: 10 }),
      expect.objectContaining({ type: 'integer', minimum: 100 }),
    ]);
    expect(result.$parseRaw('{"value":7}')).toEqual({ value: 7n });
    expect(result.$parseRaw('{"value":101}')).toEqual({ value: 101n });
    expect(() => result.$parseRaw('{"value":50}')).toThrow();
  });

  it.each([
    {
      name: 'value-changing transform',
      input: () => z3.number().transform((value) => -value),
    },
    {
      name: 'value-changing preprocessor',
      input: () => z3.preprocess((value) => (typeof value === 'number' ? -value : value), z3.number()),
    },
  ])('rejects constrained outputs after an opaque $name', ({ input }) => {
    expect(() => create(z3.object({ value: input().pipe(z3.number().min(0)) }))).toThrow(
      'cannot be safely projected across an opaque transform',
    );
    const unconstrained = create(z3.object({ value: input().pipe(z3.number()) }));
    expect(unconstrained.$parseRaw('{"value":-1}')).toEqual({ value: 1 });
  });

  it('rejects compound pipeline outputs that cannot be projected without losing constraints', () => {
    const value = z3.number().transform(BigInt).pipe(z3.bigint().max(10n).nullable());
    expect(() => create(z3.object({ value }))).toThrow('ZodPipeline output constraints');
  });

  it('rejects converting output constraints that cannot be projected onto their input', () => {
    const value = z3.string().transform(BigInt).pipe(z3.bigint().max(9n));
    expect(() => create(z3.object({ value }))).toThrow('ZodPipeline output constraints');
  });

  it('rejects pipeline output constraints that cannot be structurally represented', () => {
    const input = z3.object({ value: z3.number() });
    const output = z3.object({ different: z3.number() });
    expect(() => create(z3.object({ value: input.pipe(output) }))).toThrow('ZodPipeline output constraints');
  });

  it('preserves represented restrictions in pipeline outputs', () => {
    const result = create(
      z3.object({ value: z3.union([z3.number().pipe(z3.number().max(9)), z3.coerce.bigint()]) }),
    );
    const generated = strictHelperSchema(result) as {
      properties: { value: { anyOf: Record<string, unknown>[] } };
    };

    expect(generated.properties.value.anyOf[0]).toEqual({ type: 'number', maximum: 9 });
  });
});
