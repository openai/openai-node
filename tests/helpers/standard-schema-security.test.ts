import {
  standardFunction,
  standardResponseFormat,
  standardResponsesFunction,
  standardTextFormat,
} from 'openai/helpers/standard-schema';
import { hasOwn } from 'openai/internal/utils/values';

const prototypePropertyName = '__proto__';

function strictSchemasForAllHelpers(jsonSchema: Record<string, unknown>) {
  const standardSchema = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => jsonSchema },
    },
  };

  return [
    standardResponseFormat(standardSchema, 'weather').json_schema.schema,
    standardTextFormat(standardSchema, 'weather').schema,
    standardFunction({
      name: 'get_weather',
      parameters: standardSchema,
    }).function.parameters,
    standardResponsesFunction({
      name: 'get_weather',
      parameters: standardSchema,
    }).parameters,
  ];
}

function makePrototypeManipulationSchema(): Record<string, unknown> {
  return JSON.parse(
    '{"type":"object","properties":{"safe":{"type":"string"}},"required":["safe"],' +
      '"__proto__":{"additionalProperties":false,"polluted":"YES"}}',
  ) as Record<string, unknown>;
}

function expectPrototypeSafeClosedSchema(schema: Record<string, unknown>) {
  const serializedSchema = JSON.stringify(schema);

  expect(schema['additionalProperties']).toBe(false);
  expect(hasOwn(schema, 'additionalProperties')).toBe(true);
  expect(Object.getPrototypeOf(schema)).toBe(Object.prototype);
  expect(hasOwn(schema, prototypePropertyName)).toBe(true);
  expect(schema[prototypePropertyName]).toEqual({ additionalProperties: false, polluted: 'YES' });
  expect(schema['polluted']).toBeUndefined();
  expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(JSON.parse(serializedSchema)).toMatchObject({ additionalProperties: false });
}

describe('Standard Schema prototype security', () => {
  it.each(['$ref', 'allOf', 'anyOf'] as const)(
    'keeps promoted root %s schemas prototype-safe and strictly closed across all helper surfaces',
    (keyword) => {
      const branch = makePrototypeManipulationSchema();
      const metadata = { title: 'Ordinary root title', description: 'Ordinary root description' };
      const rootSchemas = {
        $ref: { ...metadata, $ref: '#/$defs/target', $defs: { target: branch } },
        allOf: { ...metadata, allOf: [branch] },
        anyOf: { ...metadata, type: 'object', anyOf: [branch] },
      };

      for (const schema of strictSchemasForAllHelpers(rootSchemas[keyword])) {
        expectPrototypeSafeClosedSchema(schema as Record<string, unknown>);
        expect(schema).toMatchObject({
          ...metadata,
          type: 'object',
          properties: { safe: { type: 'string' } },
          required: ['safe'],
        });
      }
    },
  );

  it('keeps nested singleton allOf schemas prototype-safe across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        nested: {
          description: 'Ordinary nested annotation',
          allOf: [makePrototypeManipulationSchema()],
        },
      },
      required: ['nested'],
    });

    for (const schema of schemas) {
      const properties = (schema as Record<string, unknown>)['properties'] as Record<
        string,
        Record<string, unknown>
      >;
      const nested = properties['nested'] ?? {};
      const serializedSchema = JSON.stringify(schema);

      expectPrototypeSafeClosedSchema(nested);
      expect(nested['description']).toBe('Ordinary nested annotation');
      expect(hasOwn(schema as Record<string, unknown>, 'additionalProperties')).toBe(true);
      expect(JSON.parse(serializedSchema)).toMatchObject({
        additionalProperties: false,
        properties: { nested: { additionalProperties: false } },
      });
    }
  });

  it('preserves legitimate __proto__ property names across all helper surfaces', () => {
    const jsonSchema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"safe":{"type":"number"}},' +
        '"required":["__proto__","safe"]}',
    ) as Record<string, unknown>;

    for (const schema of strictSchemasForAllHelpers(jsonSchema)) {
      const properties = (schema as Record<string, unknown>)['properties'] as Record<string, unknown>;

      expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
      expect(hasOwn(properties, prototypePropertyName)).toBe(true);
      expect(properties[prototypePropertyName]).toEqual({ type: 'string' });
      expect(properties['safe']).toEqual({ type: 'number' });
      expect(hasOwn(schema as Record<string, unknown>, 'additionalProperties')).toBe(true);
    }
  });

  it.each(['$defs', 'definitions'] as const)(
    'preserves own __proto__ entries in promoted root anyOf %s maps across all helper surfaces',
    (keyword) => {
      const branchDefinitions = JSON.parse(
        '{"__proto__":{"type":"string"},"constructor":{"type":"number"},' +
          '"toString":{"type":"boolean"},"BranchOnly":{"type":"integer"}}',
      ) as Record<string, unknown>;
      const schemas = strictSchemasForAllHelpers({
        type: 'object',
        description: 'Ordinary root definition metadata',
        [keyword]: { RootOnly: { type: 'number' } },
        anyOf: [
          {
            type: 'object',
            [keyword]: branchDefinitions,
            properties: {
              ordinary: { $ref: `#/anyOf/0/${keyword}/BranchOnly` },
              constructorValue: { $ref: `#/anyOf/0/${keyword}/constructor` },
              toStringValue: { $ref: `#/anyOf/0/${keyword}/toString` },
              rootValue: { $ref: `#/${keyword}/RootOnly` },
            },
            required: ['ordinary', 'constructorValue', 'toStringValue', 'rootValue'],
          },
        ],
      });

      for (const schema of schemas) {
        const definitions = (schema as Record<string, unknown>)[keyword] as Record<string, unknown>;
        const serializedSchema = JSON.stringify(schema);
        const serialized = JSON.parse(serializedSchema) as Record<string, unknown>;
        const serializedDefinitions = serialized[keyword] as Record<string, unknown>;

        expect(Object.getPrototypeOf(definitions)).toBe(Object.prototype);
        expect(hasOwn(definitions, prototypePropertyName)).toBe(true);
        expect(definitions[prototypePropertyName]).toEqual({ type: 'string' });
        expect(definitions['RootOnly']).toEqual({ type: 'number' });
        expect(definitions['constructor']).toEqual({ type: 'number' });
        expect(definitions['toString']).toEqual({ type: 'boolean' });
        expect(definitions['BranchOnly']).toEqual({ type: 'integer' });
        expect(hasOwn(serializedDefinitions, prototypePropertyName)).toBe(true);
        expect(serialized['additionalProperties']).toBe(false);
        expect(schema).toMatchObject({
          description: 'Ordinary root definition metadata',
          properties: {
            ordinary: { $ref: `#/${keyword}/BranchOnly` },
            constructorValue: { $ref: `#/${keyword}/constructor` },
            toStringValue: { $ref: `#/${keyword}/toString` },
            rootValue: { $ref: `#/${keyword}/RootOnly` },
          },
        });
      }
    },
  );

  it.each(['$defs', 'definitions'] as const)(
    'keeps refs to promoted own __proto__ %s definitions across all helper surfaces',
    (keyword) => {
      const branchDefinitions = JSON.parse('{"__proto__":{"type":"string"}}') as Record<string, unknown>;
      const schemas = strictSchemasForAllHelpers({
        type: 'object',
        [keyword]: { RootOnly: { type: 'number' } },
        anyOf: [
          {
            type: 'object',
            [keyword]: branchDefinitions,
            properties: {
              value: { $ref: `#/anyOf/0/${keyword}/__proto__` },
            },
            required: ['value'],
          },
        ],
      });

      for (const schema of schemas) {
        const definitions = (schema as Record<string, unknown>)[keyword] as Record<string, unknown>;

        expect(Object.getPrototypeOf(definitions)).toBe(Object.prototype);
        expect(hasOwn(definitions, prototypePropertyName)).toBe(true);
        expect(definitions[prototypePropertyName]).toEqual({ type: 'string' });
        expect(schema).toMatchObject({
          properties: { value: { $ref: `#/${keyword}/__proto__` } },
          additionalProperties: false,
        });
      }
    },
  );
});
