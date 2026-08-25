import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { hasOwn } from 'openai/internal/utils/values';
import { z as z4 } from 'zod/v4';
import { z as z4Mini } from 'zod/v4-mini';

type SupportedSchema = z4.ZodType | z4Mini.ZodMiniType;

const schemaName = 'object_property_security';

const strictHelpers = [
  {
    name: 'zodResponseFormat',
    getSchema: (schema: SupportedSchema) => zodResponseFormat(schema, schemaName).json_schema.schema,
  },
  {
    name: 'zodTextFormat',
    getSchema: (schema: SupportedSchema) => zodTextFormat(schema, schemaName).schema,
  },
  {
    name: 'zodFunction',
    getSchema: (schema: SupportedSchema) =>
      zodFunction({ name: schemaName, parameters: schema }).function.parameters,
  },
  {
    name: 'zodResponsesFunction',
    getSchema: (schema: SupportedSchema) =>
      zodResponsesFunction({ name: schemaName, parameters: schema }).parameters,
  },
];

const schemaVariants = [
  {
    version: 'Classic',
    create: (fieldNames: string[]) =>
      z4.object(Object.fromEntries(fieldNames.map((name) => [name, z4.string()]))),
  },
  {
    version: 'Mini',
    create: (fieldNames: string[]) =>
      z4Mini.object(Object.fromEntries(fieldNames.map((name) => [name, z4Mini.string()]))),
  },
];

describe.each(strictHelpers)('$name object property security', ({ getSchema }) => {
  it.each(schemaVariants)('rejects a Zod v4 $version __proto__ property without mutation', ({ create }) => {
    const originalPrototype = Object.getOwnPropertyDescriptors(Object.prototype);

    expect(() => getSchema(create(['__proto__', 'safe']))).toThrow(
      'Object schema at `<root>` requires property `__proto__` but does not declare it in `properties`.',
    );
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(originalPrototype);
  });

  it.each(schemaVariants)('preserves safe Zod v4 $version Object.prototype-like names', ({ create }) => {
    const fieldNames = ['safe', 'constructor', 'toString', 'prototype', 'hasOwnProperty'];
    const jsonSchema = getSchema(create(fieldNames)) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const serializedSchema = JSON.stringify(jsonSchema);
    const wireSchema = JSON.parse(serializedSchema) as typeof jsonSchema;

    expect(Object.keys(jsonSchema.properties)).toEqual(fieldNames);
    expect(Object.keys(wireSchema.properties)).toEqual(fieldNames);
    expect(wireSchema.required).toEqual(fieldNames);
    for (const name of fieldNames) {
      expect(hasOwn(jsonSchema.properties, name)).toBe(true);
      expect(wireSchema.properties[name]).toEqual({ type: 'string' });
    }
  });
});

it('preserves safe prototype-like names in non-strict Realtime schemas', () => {
  const fieldNames = ['safe', 'constructor', 'toString', 'prototype', 'hasOwnProperty'];
  const schema = z4.object(Object.fromEntries(fieldNames.map((name) => [name, z4.string()])));
  const tool = zodRealtimeFunction({ name: schemaName, parameters: schema });

  expect(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)).toEqual(
    fieldNames,
  );
  expect(tool).not.toHaveProperty('strict');
});
