import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { hasOwn } from 'openai/internal/utils/values';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

type SupportedZodSchema = zv3.ZodTypeAny | zv4.ZodType;

const schemaName = 'object_property_security';
const rootPropertyPath = `#/definitions/${schemaName}/properties/__proto__`;

const schemaHelpers = [
  {
    name: 'zodResponseFormat',
    strict: true,
    getSchema: (schema: SupportedZodSchema) => zodResponseFormat(schema, schemaName).json_schema.schema,
  },
  {
    name: 'zodTextFormat',
    strict: true,
    getSchema: (schema: SupportedZodSchema) => zodTextFormat(schema, schemaName).schema,
  },
  {
    name: 'zodFunction',
    strict: true,
    getSchema: (schema: SupportedZodSchema) =>
      zodFunction({ name: schemaName, parameters: schema }).function.parameters,
  },
  {
    name: 'zodResponsesFunction',
    strict: true,
    getSchema: (schema: SupportedZodSchema) =>
      zodResponsesFunction({ name: schemaName, parameters: schema }).parameters,
  },
  {
    name: 'zodRealtimeFunction',
    strict: false,
    getSchema: (schema: SupportedZodSchema) =>
      zodRealtimeFunction({ name: schemaName, parameters: schema }).parameters,
  },
];

function unsupportedPropertyError(path: string): string {
  return `Zod field at \`${path}\` uses unsupported property name \`__proto__\`, which Zod omits from parsed output.`;
}

function makeDangerousObject(property: zv3.ZodTypeAny = zv3.string()) {
  return zv3.object(
    Object.fromEntries([
      ['__proto__', property],
      ['safe', zv3.number()],
    ]),
  );
}

describe.each(schemaHelpers)('$name object property security', ({ getSchema }) => {
  it('rejects a root __proto__ property without changing Object.prototype', () => {
    const originalPrototype = Object.getOwnPropertyDescriptors(Object.prototype);

    expect(() => getSchema(makeDangerousObject())).toThrow(unsupportedPropertyError(rootPropertyPath));

    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(originalPrototype);
  });

  it('rejects a nested __proto__ property with its complete schema path', () => {
    const schema = zv3.object({
      nested: makeDangerousObject(),
      neighbor: zv3.boolean(),
    });

    expect(() => getSchema(schema)).toThrow(
      unsupportedPropertyError(`#/definitions/${schemaName}/properties/nested/properties/__proto__`),
    );
  });

  it('rejects an optional __proto__ property before strictness-specific validation', () => {
    expect(() => getSchema(makeDangerousObject(zv3.string().optional()))).toThrow(
      unsupportedPropertyError(rootPropertyPath),
    );
  });

  it('rejects __proto__ properties from frozen, composed object shapes', () => {
    const frozenShape = Object.freeze(
      Object.fromEntries([
        ['__proto__', zv3.string()],
        ['safe', zv3.number()],
      ]),
    );
    const schema = zv3
      .object(frozenShape)
      .merge(zv3.object({ neighbor: zv3.boolean() }))
      .readonly();

    expect(() => getSchema(schema)).toThrow(unsupportedPropertyError(rootPropertyPath));
  });

  it('preserves safe properties and valid Object.prototype-like property names', () => {
    const fieldNames = ['safe', 'constructor', 'toString', 'prototype', 'hasOwnProperty'];
    const shape = Object.fromEntries(fieldNames.map((name) => [name, zv3.string()]));
    const jsonSchema = getSchema(zv3.object(shape)) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const serializedSchema = JSON.stringify(jsonSchema);
    const wireSchema = JSON.parse(serializedSchema) as typeof jsonSchema;

    expect(Object.getPrototypeOf(jsonSchema.properties)).toBe(Object.prototype);
    expect(Object.keys(jsonSchema.properties)).toEqual(fieldNames);
    expect(Object.keys(wireSchema.properties)).toEqual(fieldNames);
    expect(wireSchema.required).toEqual(fieldNames);

    for (const name of fieldNames) {
      expect(hasOwn(jsonSchema.properties, name)).toBe(true);
      expect(wireSchema.properties[name]).toEqual({ type: 'string' });
    }
  });
});

it('rejects __proto__ before parsing the dangerous property definition', () => {
  const property = zv3.string();
  Object.defineProperty(property._def, 'description', {
    get() {
      throw new Error('the dangerous property definition must not be parsed');
    },
  });

  expect(() => zodResponseFormat(makeDangerousObject(property), schemaName)).toThrow(
    unsupportedPropertyError(rootPropertyPath),
  );
});

it('fails closed because Zod v3 silently omits __proto__ from parsed objects', () => {
  const schema = makeDangerousObject();
  const parsed = schema.parse(JSON.parse('{"__proto__":"hidden","safe":1}'));

  expect(parsed).toEqual({ safe: 1 });
  expect(hasOwn(parsed, '__proto__')).toBe(false);
  expect(() => zodResponseFormat(schema, schemaName)).toThrow(unsupportedPropertyError(rootPropertyPath));
});

describe.each(schemaHelpers.filter(({ strict }) => strict))('$name Zod v4 compatibility', ({ getSchema }) => {
  it('preserves the existing strict __proto__ property rejection', () => {
    const schema = zv4.object(
      Object.fromEntries([
        ['__proto__', zv4.string()],
        ['safe', zv4.number()],
      ]),
    );

    expect(() => getSchema(schema)).toThrow(
      'Object schema at `<root>` requires property `__proto__` but does not declare it in `properties`.',
    );
  });
});
