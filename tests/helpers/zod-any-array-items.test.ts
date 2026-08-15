import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { toStrictJsonSchema } from 'openai/lib/transform';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

const zodV3AnyArray = zv3.object({ values: zv3.array(zv3.any()) });
const zodV4AnyArray = zv4.object({ values: zv4.array(zv4.any()) });

type AnyArraySchema = typeof zodV3AnyArray | typeof zodV4AnyArray;

describe.each([
  {
    helper: 'zodResponseFormat',
    getSchema: (schema: AnyArraySchema) => zodResponseFormat(schema, 'any_array').json_schema.schema,
  },
  {
    helper: 'zodTextFormat',
    getSchema: (schema: AnyArraySchema) => zodTextFormat(schema, 'any_array').schema,
  },
  {
    helper: 'zodFunction',
    getSchema: (schema: AnyArraySchema) =>
      zodFunction({ name: 'any_array', parameters: schema }).function.parameters,
  },
  {
    helper: 'zodResponsesFunction',
    getSchema: (schema: AnyArraySchema) =>
      zodResponsesFunction({ name: 'any_array', parameters: schema }).parameters,
  },
])('$helper', ({ getSchema }) => {
  it('gives Zod v3 any-array items the same schema as Zod v4', () => {
    const zodV3Schema = getSchema(zodV3AnyArray);
    const zodV4Schema = getSchema(zodV4AnyArray);

    expect(zodV4Schema).toMatchObject({
      properties: {
        values: { type: 'array', items: {} },
      },
    });
    expect(zodV3Schema).toEqual(zodV4Schema);
  });
});

describe('strict Zod v3 any-array schemas', () => {
  it('includes item schemas for nested arrays', () => {
    const zodV3Schema = zodResponseFormat(
      zv3.object({ values: zv3.array(zv3.array(zv3.any())) }),
      'nested_any_arrays',
    ).json_schema.schema;
    const zodV4Schema = zodResponseFormat(
      zv4.object({ values: zv4.array(zv4.array(zv4.any())) }),
      'nested_any_arrays',
    ).json_schema.schema;

    expect(zodV3Schema).toMatchObject({
      properties: {
        values: { type: 'array', items: { type: 'array', items: {} } },
      },
    });
    expect(zodV3Schema).toEqual(zodV4Schema);
  });

  it('preserves defaults on arrays with unconstrained items', () => {
    const zodV3Schema = zodResponseFormat(
      zv3.object({ values: zv3.array(zv3.any()).default([]) }),
      'defaulted_any_array',
    ).json_schema.schema;
    const zodV4Schema = zodResponseFormat(
      zv4.object({ values: zv4.array(zv4.any()).default([]) }),
      'defaulted_any_array',
    ).json_schema.schema;

    expect(zodV3Schema).toMatchObject({
      properties: {
        values: { type: 'array', items: {}, default: [] },
      },
      required: ['values'],
    });
    expect(zodV3Schema).toEqual(zodV4Schema);
  });

  it('retains descriptions attached to unconstrained array items', () => {
    const { schema } = zodResponseFormat(
      zv3.object({ values: zv3.array(zv3.any().describe('An unconstrained item')) }),
      'described_any_array',
    ).json_schema;

    expect(schema).toMatchObject({
      properties: {
        values: {
          type: 'array',
          items: { description: 'An unconstrained item' },
        },
      },
    });
  });

  it('references and resolves a named unconstrained item definition', () => {
    const anyItem = zv3.any().describe('A reusable unconstrained item');
    const { schema } = zodResponseFormat(zv3.object({ values: zv3.array(anyItem) }), 'named_any_array', {
      schemaDefinitions: { anyItem },
    }).json_schema;

    expect(schema).toMatchObject({
      properties: {
        values: {
          type: 'array',
          items: { $ref: '#/definitions/anyItem' },
        },
      },
      definitions: {
        anyItem: { description: 'A reusable unconstrained item' },
      },
    });
  });

  it('does not change typed or unknown array items', () => {
    const { schema } = zodResponseFormat(
      zv3.object({
        typed: zv3.array(zv3.string()),
        unknown: zv3.array(zv3.unknown()),
      }),
      'other_array_items',
    ).json_schema;

    expect(schema).toMatchObject({
      properties: {
        typed: { type: 'array', items: { type: 'string' } },
        unknown: { type: 'array', items: {} },
      },
    });
  });

  it('matches strictification requirements for present array items', () => {
    expect(() =>
      toStrictJsonSchema({
        type: 'object',
        properties: { values: { type: 'array' } },
        required: ['values'],
      }),
    ).toThrow('declares an array without `items`');

    const strictSchema = toStrictJsonSchema({
      type: 'object',
      properties: { values: { type: 'array', items: {} } },
      required: ['values'],
    });

    expect(strictSchema.properties?.['values']).toEqual({ type: 'array', items: {} });
  });
});

describe('non-strict Zod v3 any-array compatibility', () => {
  it('preserves the existing Realtime function schema exactly', () => {
    expect(zodRealtimeFunction({ name: 'any_array', parameters: zodV3AnyArray })).toEqual({
      type: 'function',
      name: 'any_array',
      parameters: {
        type: 'object',
        properties: { values: { type: 'array' } },
        required: ['values'],
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      },
    });
  });

  it.each([
    {
      target: 'jsonSchema7',
      expectedSchema: { type: 'array', $schema: 'http://json-schema.org/draft-07/schema#' },
    },
    {
      target: 'jsonSchema2019-09',
      expectedSchema: { type: 'array', $schema: 'https://json-schema.org/draft/2019-09/schema#' },
    },
    {
      target: 'openApi3',
      expectedSchema: { type: 'array' },
    },
  ] as const)('preserves the existing $target converter output exactly', ({ target, expectedSchema }) => {
    expect(zodToJsonSchema(zv3.array(zv3.any()), { target })).toEqual(expectedSchema);
  });
});
