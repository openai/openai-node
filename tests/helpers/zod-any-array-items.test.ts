import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { toStrictJsonSchema } from 'openai/lib/transform';
import { z as z4 } from 'zod/v4';
import { z as z4Mini } from 'zod/v4-mini';

type SupportedSchema = z4.ZodType | z4Mini.ZodMiniType;

const strictHelpers = [
  {
    name: 'zodResponseFormat',
    convert: (schema: SupportedSchema) => zodResponseFormat(schema, 'any_array').json_schema.schema,
  },
  {
    name: 'zodTextFormat',
    convert: (schema: SupportedSchema) => zodTextFormat(schema, 'any_array').schema,
  },
  {
    name: 'zodFunction',
    convert: (schema: SupportedSchema) =>
      zodFunction({ name: 'any_array', parameters: schema }).function.parameters,
  },
  {
    name: 'zodResponsesFunction',
    convert: (schema: SupportedSchema) =>
      zodResponsesFunction({ name: 'any_array', parameters: schema }).parameters,
  },
];

const schemaVariants = [
  { version: 'Classic', schema: z4.object({ values: z4.array(z4.any()) }) },
  { version: 'Mini', schema: z4Mini.object({ values: z4Mini.array(z4Mini.any()) }) },
];

describe.each(strictHelpers)('$name unconstrained arrays', ({ convert }) => {
  it.each(schemaVariants)('includes the Zod v4 $version array item schema', ({ schema }) => {
    expect(convert(schema)).toMatchObject({
      properties: { values: { type: 'array', items: {} } },
      required: ['values'],
    });
  });
});

it('retains nested and described unconstrained Zod v4 array items', () => {
  const { schema } = zodResponseFormat(
    z4.object({ values: z4.array(z4.array(z4.any().describe('An unconstrained item'))) }),
    'nested_any_arrays',
  ).json_schema;

  expect(schema).toMatchObject({
    properties: {
      values: { type: 'array', items: { type: 'array', items: { description: 'An unconstrained item' } } },
    },
  });
});

it.each([
  { version: 'Classic', schema: z4.object({ values: z4.array(z4.any()).default([]) }) },
  {
    version: 'Mini',
    schema: z4Mini.object({ values: z4Mini._default(z4Mini.array(z4Mini.any()), []) }),
  },
])('retains defaulted Zod v4 $version unconstrained array items', ({ schema }) => {
  expect(zodResponseFormat(schema, 'defaulted_any_array').json_schema.schema).toMatchObject({
    properties: { values: { type: 'array', items: {}, default: [] } },
    required: ['values'],
  });
});

it.each(schemaVariants)('preserves non-strict Zod v4 $version Realtime array items', ({ schema }) => {
  const tool = zodRealtimeFunction({ name: 'any_array', parameters: schema });

  expect(tool.parameters).toMatchObject({ properties: { values: { type: 'array', items: {} } } });
  expect(tool).not.toHaveProperty('strict');
});

it('requires present array item schemas during strictification', () => {
  expect(() =>
    toStrictJsonSchema({
      type: 'object',
      properties: { values: { type: 'array' } },
      required: ['values'],
    }),
  ).toThrow('declares an array without `items`');

  expect(
    toStrictJsonSchema({
      type: 'object',
      properties: { values: { type: 'array', items: {} } },
      required: ['values'],
    }).properties?.['values'],
  ).toEqual({ type: 'array', items: {} });
});
