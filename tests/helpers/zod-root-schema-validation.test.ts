import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z4 } from 'zod/v4';
import { z as z4Mini } from 'zod/v4-mini';

type SupportedSchema = z4.ZodType | z4Mini.ZodMiniType;

const strictHelpers = [
  { name: 'zodResponseFormat', create: (schema: SupportedSchema) => zodResponseFormat(schema, 'root') },
  { name: 'zodTextFormat', create: (schema: SupportedSchema) => zodTextFormat(schema, 'root') },
  {
    name: 'zodFunction',
    create: (schema: SupportedSchema) => zodFunction({ name: 'root', parameters: schema }),
  },
  {
    name: 'zodResponsesFunction',
    create: (schema: SupportedSchema) => zodResponsesFunction({ name: 'root', parameters: schema }),
  },
];

const expectedRootError = (type?: string) =>
  `Root schema must have type: 'object' but got type: ${type ? `'${type}'` : 'undefined'}`;

interface RecursiveObject {
  value: string;
  children: RecursiveObject[];
}

const recursiveObject: z4.ZodType<RecursiveObject> = z4.lazy(() =>
  z4.object({ value: z4.string(), children: z4.array(recursiveObject) }),
);

const invalidRootSchemas = [
  { name: 'a Classic string', type: 'string', schema: z4.string() },
  { name: 'a Mini string', type: 'string', schema: z4Mini.string() },
  { name: 'a Classic array', type: 'array', schema: z4.array(z4.string()) },
  { name: 'a Mini array', type: 'array', schema: z4Mini.array(z4Mini.string()) },
  {
    name: 'a union of objects',
    schema: z4.union([z4.object({ first: z4.string() }), z4.object({ second: z4.number() })]),
  },
  {
    name: 'a discriminated union of objects',
    schema: z4.discriminatedUnion('kind', [
      z4.object({ kind: z4.literal('first'), first: z4.string() }),
      z4.object({ kind: z4.literal('second'), second: z4.number() }),
    ]),
  },
  { name: 'a nullable object', schema: z4.object({ value: z4.string() }).nullable() },
  { name: 'an unrestricted schema', schema: z4.any() },
];

describe.each(strictHelpers)('$name root schema validation', ({ create }) => {
  it.each(invalidRootSchemas)('rejects $name', ({ type, schema }) => {
    expect(() => create(schema)).toThrow(expectedRootError(type));
  });

  it.each([
    { name: 'a Classic object', schema: z4.object({ value: z4.string() }) },
    { name: 'a Mini object', schema: z4Mini.object({ value: z4Mini.string() }) },
    { name: 'a lazy object', schema: z4.lazy(() => z4.object({ value: z4.string() })) },
    { name: 'a recursive lazy object', schema: recursiveObject },
    {
      name: 'an object containing nested unions',
      schema: z4.object({ values: z4.array(z4.union([z4.string(), z4.number()])) }),
    },
    { name: 'an optional object', schema: z4.object({ value: z4.string() }).optional() },
  ])('accepts $name', ({ schema }) => {
    expect(() => create(schema)).not.toThrow();
  });
});

describe.each(['direct', 'lazy'] as const)('%s registered response-format roots', (kind) => {
  it('preserves frozen definitions and concrete root behavior', () => {
    const root = z4.object({ value: z4.string() });
    const definitions = Object.freeze({ Root: root });
    const wrapped = kind === 'lazy' ? z4.lazy(() => root) : root;
    const { schema } = zodResponseFormat(wrapped, 'response', { schemaDefinitions: definitions }).json_schema;

    expect(schema).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
    expect(schema).not.toHaveProperty('$ref');
    expect(definitions.Root).toBe(root);
  });
});

it('preserves escaped registered definition names', () => {
  const shared = z4.object({ value: z4.string() });
  const named = zodResponseFormat(z4.object({ shared }), 'named-root', {
    schemaDefinitions: { 'shared/name~value%25': shared },
  }).json_schema;

  expect(named.name).toBe('named-root');
  expect(named.schema).toMatchObject({
    properties: { shared: { $ref: '#/definitions/shared~1name~0value%2525' } },
    definitions: { 'shared/name~value%25': { type: 'object' } },
  });
});

it.each([
  { name: 'string', parameters: z4.string(), expected: { type: 'string' } },
  { name: 'array', parameters: z4.array(z4.string()), expected: { type: 'array' } },
  {
    name: 'union',
    parameters: z4.union([z4.object({ first: z4.string() }), z4.object({ second: z4.number() })]),
    expected: { anyOf: expect.any(Array) },
  },
])('keeps realtime $name roots non-strict', ({ name, parameters, expected }) => {
  const tool = zodRealtimeFunction({ name, parameters });

  expect(tool.parameters).toMatchObject(expected);
  expect(tool).not.toHaveProperty('strict');
});
