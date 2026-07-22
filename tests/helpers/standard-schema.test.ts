import {
  standardFunction,
  standardResponseFormat,
  standardResponsesFunction,
  standardTextFormat,
} from 'openai/helpers/standard-schema';
import type OpenAI from 'openai';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { compareType, expectType } from '../utils/typing';
import { z as zv4 } from 'zod/v4';

declare const runTools: OpenAI['chat']['completions']['runTools'];

type WeatherInput = {
  city: string;
  unit: 'c' | 'f';
};

type WeatherOutput = WeatherInput & {
  normalized: true;
};

const weatherJSONSchema: JSONSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    unit: { type: 'string', enum: ['c', 'f'] },
  },
  required: ['city', 'unit'],
};

const strictWeatherJSONSchema: JSONSchema = {
  ...weatherJSONSchema,
  additionalProperties: false,
};

function validateWeather(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'city' in value &&
    typeof value.city === 'string' &&
    'unit' in value &&
    (value.unit === 'c' || value.unit === 'f')
  ) {
    return {
      value: {
        city: value.city,
        unit: value.unit,
        normalized: true as const,
      },
    };
  }

  return {
    issues: [{ message: 'expected weather input', path: ['city'] }],
  };
}

function makeStandardSchema(
  jsonSchema: Record<string, unknown> = weatherJSONSchema as unknown as Record<string, unknown>,
) {
  const input = jest.fn(() => jsonSchema);
  const output = jest.fn(() => ({ type: 'string' }));

  return {
    input,
    output,
    standardSchema: {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        types: undefined as unknown as {
          input: WeatherInput;
          output: WeatherOutput;
        },
        validate: validateWeather,
        jsonSchema: { input, output },
      },
    },
  };
}

function makeStrictSchemaFactories(jsonSchema: Record<string, unknown>) {
  const { standardSchema } = makeStandardSchema(jsonSchema);

  return [
    () => standardResponseFormat(standardSchema, 'weather').json_schema.schema,
    () => standardTextFormat(standardSchema, 'weather').schema,
    () =>
      standardFunction({
        name: 'get_weather',
        parameters: standardSchema,
      }).function.parameters,
    () =>
      standardResponsesFunction({
        name: 'get_weather',
        parameters: standardSchema,
      }).parameters,
  ];
}

function strictSchemasForAllHelpers(jsonSchema: Record<string, unknown>) {
  return makeStrictSchemaFactories(jsonSchema).map((makeSchema) => makeSchema());
}

function makeValidationOnlySchema() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      types: undefined as unknown as {
        input: WeatherInput;
        output: WeatherOutput;
      },
      validate: validateWeather,
    },
  };
}

describe('Standard Schema helpers', () => {
  it('uses the input JSON Schema for parseable response formats', () => {
    const { standardSchema, input, output } = makeStandardSchema();

    const responseFormat = standardResponseFormat(standardSchema, 'weather');
    const textFormat = standardTextFormat(standardSchema, 'weather');

    expect(responseFormat.json_schema.schema).toEqual(strictWeatherJSONSchema);
    expect(textFormat.schema).toEqual(strictWeatherJSONSchema);
    expect(responseFormat.$parseRaw('{"city":"Paris","unit":"c"}')).toEqual({
      city: 'Paris',
      unit: 'c',
      normalized: true,
    });
    expect(textFormat.$parseRaw('{"city":"Paris","unit":"c"}')).toEqual({
      city: 'Paris',
      unit: 'c',
      normalized: true,
    });
    expect(input).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledWith({ target: 'draft-07' });
    expect(output).not.toHaveBeenCalled();
  });

  it('builds parseable function tools', () => {
    const { standardSchema } = makeStandardSchema();

    const chatTool = standardFunction({
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: standardSchema,
    });
    const responseTool = standardResponsesFunction({
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: standardSchema,
    });

    expect(chatTool.function).toEqual({
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: strictWeatherJSONSchema,
      strict: true,
    });
    expect(responseTool).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: strictWeatherJSONSchema,
      strict: true,
    });
    expect(chatTool.$parseRaw('{"city":"Paris","unit":"c"}')).toEqual({
      city: 'Paris',
      unit: 'c',
      normalized: true,
    });
    expect(responseTool.$parseRaw('{"city":"Paris","unit":"c"}')).toEqual({
      city: 'Paris',
      unit: 'c',
      normalized: true,
    });
  });

  it('accepts a caller-supplied JSON Schema when no converter is available', () => {
    const standardSchema = makeValidationOnlySchema();

    const format = standardResponseFormat(standardSchema, 'weather', {
      schema: weatherJSONSchema,
    });

    expect(format.json_schema.schema).toEqual(strictWeatherJSONSchema);
  });

  it('normalizes provably exclusive oneOf branches before strictifying schemas', () => {
    const oneOfSchema = {
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    };
    const { standardSchema } = makeStandardSchema(oneOfSchema);

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toEqual({
      type: 'object',
      properties: {
        choice: {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['choice'],
      additionalProperties: false,
    });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    expect(oneOfSchema.properties.choice).toHaveProperty('oneOf');
  });

  it('rewrites a shared oneOf schema only once', () => {
    const sharedChoice = {
      oneOf: [{ type: 'string', const: 'foo' }, { type: 'number' }],
    };
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: { first: sharedChoice, second: sharedChoice },
      required: ['first', 'second'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toMatchObject({
      properties: {
        first: { anyOf: [{ type: 'string', const: 'foo' }, { type: 'number' }] },
        second: { anyOf: [{ type: 'string', const: 'foo' }, { type: 'number' }] },
      },
    });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  });

  it('does not close redundant object oneOf wrappers as empty objects', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;
    expect(schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
              additionalProperties: false,
            },
          ],
        },
      },
    });
    const properties = (schema as Record<string, unknown>)['properties'] as Record<string, unknown>;
    const choice = properties['choice'] as Record<string, unknown>;
    expect(choice).not.toHaveProperty('type');
    expect(choice).not.toHaveProperty('additionalProperties');
  });

  it('normalizes redundant nullable object oneOf wrappers across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          type: ['object', 'null'],
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      const choice = (schema as JSONSchema).properties?.['choice'] as JSONSchema;
      expect(choice).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
            required: ['kind', 'foo'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
            required: ['kind', 'bar'],
            additionalProperties: false,
          },
        ],
      });
    }
  });

  it('normalizes redundant nullable array anyOf wrappers across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          type: ['array', 'null'],
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'array', items: { type: 'number' } },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'array', items: { type: 'number' } },
        ],
      });
    }
  });

  it('normalizes singleton allOf wrappers inside object unions across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          type: 'object',
          anyOf: [
            {
              allOf: [
                {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                  required: ['name'],
                },
              ],
            },
            {
              type: 'object',
              properties: { age: { type: 'number' } },
              required: ['age'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { age: { type: 'number' } },
            required: ['age'],
            additionalProperties: false,
          },
        ],
      });
    }
  });

  it('normalizes singleton allOf wrappers inside array unions across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          type: 'array',
          anyOf: [
            { allOf: [{ type: 'array', items: { type: 'string' } }] },
            { type: 'array', items: { type: 'number' } },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'array', items: { type: 'number' } },
        ],
      });
    }
  });

  it('deduplicates identical non-object allOf branches across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        scalar: {
          allOf: [{ type: 'string' }, { type: 'string' }],
        },
        array: {
          allOf: [
            { type: 'array', items: { type: 'string' } },
            { items: { type: 'string' }, type: 'array' },
          ],
        },
      },
      required: ['scalar', 'array'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties).toEqual({
        scalar: { type: 'string' },
        array: { type: 'array', items: { type: 'string' } },
      });
    }
  });

  it('removes false anyOf alternatives across all helper surfaces but keeps boolean unions fail closed', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          anyOf: [false, { type: 'string' }],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [{ type: 'string' }],
      });
    }

    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        choice: {
          anyOf: [false, false],
        },
      },
      required: ['choice'],
    })) {
      expect(makeSchema).toThrow('Expected object schema but got boolean');
    }
  });

  it('removes false oneOf alternatives across all helper surfaces but keeps boolean unions fail closed', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          oneOf: [false, { type: 'string' }],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [{ type: 'string' }],
      });
    }

    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        choice: {
          oneOf: [false, false],
        },
      },
      required: ['choice'],
    })) {
      expect(makeSchema).toThrow('Expected object schema but got boolean');
    }
  });

  it('rewrites nested refs into shifted false anyOf alternatives across all helper surfaces', () => {
    const definitionName = 'union/name~% value';
    const definitionRef = '#/$defs/union~1name~0%25%20value';
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      $defs: {
        [definitionName]: {
          anyOf: [
            false,
            {
              type: 'object',
              properties: {
                nested: {
                  anyOf: [false, { type: 'string' }],
                },
              },
              required: ['nested'],
            },
          ],
        },
      },
      properties: {
        value: { $ref: `${definitionRef}/anyOf/1` },
        nested: { $ref: `${definitionRef}/anyOf/1/properties/nested/anyOf/1` },
      },
      required: ['value', 'nested'],
    });

    for (const schema of schemas) {
      expect(schema).toMatchObject({
        $defs: {
          [definitionName]: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  nested: {
                    anyOf: [{ type: 'string' }],
                  },
                },
              },
            ],
          },
        },
        properties: {
          value: { $ref: `${definitionRef}/anyOf/0` },
          nested: { $ref: `${definitionRef}/anyOf/0/properties/nested/anyOf/0` },
        },
      });
    }
  });

  it('keeps refs into removed false anyOf alternatives fail closed across all helper surfaces', () => {
    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        choice: {
          anyOf: [false, { type: 'string' }],
        },
        alias: { $ref: '#/properties/choice/anyOf/0' },
      },
      required: ['choice', 'alias'],
    })) {
      expect(makeSchema).toThrow('Expected object schema but got boolean');
    }
  });

  it('updates refs into oneOf branches after moving them to anyOf', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          oneOf: [{ type: 'string', const: 'foo' }, { type: 'number' }],
        },
        alias: { $ref: '#/properties/choice/oneOf/0' },
      },
      required: ['choice', 'alias'],
    });

    expect(standardResponseFormat(standardSchema, 'choice').json_schema.schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [{ type: 'string', const: 'foo' }, { type: 'number' }],
        },
        alias: { $ref: '#/properties/choice/anyOf/0' },
      },
    });
  });

  it('infers literal types when proving oneOf exclusivity across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          oneOf: [{ const: 'foo' }, { type: 'number' }],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [{ const: 'foo' }, { type: 'number' }],
      });
    }
  });

  it('re-encodes rewritten local refs after moving oneOf branches', () => {
    const definitionName = 'folder/name~% value';
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      $defs: {
        [definitionName]: {
          oneOf: [{ type: 'string', const: 'foo' }, { type: 'number' }],
        },
      },
      properties: {
        // The encoded slashes are URI-fragment separators. The definition
        // token itself exercises JSON Pointer escapes plus URI encoding.
        alias: { $ref: '#/%24defs%2Ffolder~1name~0%25%20value%2FoneOf%2F0' },
      },
      required: ['alias'],
    });

    expect(standardResponseFormat(standardSchema, 'choice').json_schema.schema).toMatchObject({
      $defs: {
        [definitionName]: {
          anyOf: [{ type: 'string', const: 'foo' }, { type: 'number' }],
        },
      },
      properties: {
        alias: { $ref: '#/$defs/folder~1name~0%25%20value/anyOf/0' },
      },
    });
  });

  it('rejects oneOf branches that may overlap', () => {
    const overlappingOneOfSchema = {
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            { type: 'string', enum: ['left', 'shared'] },
            { type: 'string', enum: ['shared', 'right'] },
          ],
        },
      },
      required: ['choice'],
    };
    const { standardSchema } = makeStandardSchema(overlappingOneOfSchema);

    expect(() => standardResponseFormat(standardSchema, 'choice')).toThrow(
      'Standard JSON Schema generated a `oneOf` whose branches are not provably mutually exclusive',
    );
  });

  it('proves disjoint closed object property sets across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              type: 'object',
              properties: { a: { type: 'string' } },
              required: ['a'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { b: { type: 'number' } },
              required: ['b'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: { a: { type: 'string' } },
            required: ['a'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { b: { type: 'number' } },
            required: ['b'],
            additionalProperties: false,
          },
        ],
      });
    }
  });

  it('keeps overlapping closed object property sets fail closed across all helper surfaces', () => {
    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              type: 'object',
              properties: { shared: { type: 'string' } },
              required: ['shared'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { shared: { type: 'string' }, optional: { type: 'number' } },
              required: ['shared'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['choice'],
    })) {
      expect(makeSchema).toThrow('whose branches are not provably mutually exclusive');
    }
  });

  it('normalizes provably exclusive oneOf branches behind local refs', () => {
    const referencedOneOfSchema = {
      type: 'object',
      $defs: {
        foo: {
          type: 'object',
          properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
          required: ['kind', 'foo'],
        },
        bar: {
          type: 'object',
          properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
          required: ['kind', 'bar'],
        },
      },
      properties: {
        choice: {
          oneOf: [{ $ref: '#/$defs/foo' }, { $ref: '#/$defs/bar' }],
        },
      },
      required: ['choice'],
    };
    const { standardSchema } = makeStandardSchema(referencedOneOfSchema);

    expect(standardResponseFormat(standardSchema, 'choice').json_schema.schema).toEqual({
      type: 'object',
      $defs: {
        foo: {
          type: 'object',
          properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
          required: ['kind', 'foo'],
          additionalProperties: false,
        },
        bar: {
          type: 'object',
          properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
          required: ['kind', 'bar'],
          additionalProperties: false,
        },
      },
      properties: {
        choice: {
          anyOf: [{ $ref: '#/$defs/foo' }, { $ref: '#/$defs/bar' }],
        },
      },
      required: ['choice'],
      additionalProperties: false,
    });
  });

  it('resolves discriminator property ref chains when proving oneOf exclusivity', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      $defs: {
        fooKind: { $ref: '#/$defs/fooLiteral', description: 'Foo discriminator' },
        fooLiteral: { type: 'string', const: 'foo' },
        barKind: { $ref: '#/$defs/barLiteral', description: 'Bar discriminator' },
        barLiteral: { type: 'string', const: 'bar' },
      },
      properties: {
        choice: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { $ref: '#/$defs/fooKind', $comment: 'Generated foo discriminator' },
                foo: { type: 'string' },
              },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: {
                kind: { $ref: '#/$defs/barKind', title: 'Bar discriminator' },
                bar: { type: 'number' },
              },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [
            { properties: { kind: { $ref: '#/$defs/fooKind' } } },
            { properties: { kind: { $ref: '#/$defs/barKind' } } },
          ],
        },
      },
    });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  });

  it('inspects mergeable allOf branches when proving oneOf exclusivity', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              allOf: [
                {
                  type: 'object',
                  properties: { foo: { type: 'string' } },
                  required: ['foo'],
                },
                {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'foo' } },
                  required: ['kind'],
                },
              ],
            },
            {
              allOf: [
                {
                  type: 'object',
                  properties: { bar: { type: 'number' } },
                  required: ['bar'],
                },
                {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'bar' } },
                  required: ['kind'],
                },
              ],
            },
          ],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
            },
          ],
        },
      },
    });
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  });

  it('normalizes oneOf allOf branches to a fixed point before proving exclusivity', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              allOf: [
                true,
                {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
                  required: ['kind', 'foo'],
                },
              ],
            },
            {
              allOf: [
                true,
                {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
                  required: ['kind', 'bar'],
                },
              ],
            },
          ],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
            },
          ],
        },
      },
    });
    expect(JSON.stringify(schema)).not.toContain('"allOf"');
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  });

  it('resolves local refs exposed by oneOf allOf normalization across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      $defs: {
        'foo branch': {
          type: 'object',
          properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
          required: ['kind', 'foo'],
        },
        'bar branch': {
          type: 'object',
          properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
          required: ['kind', 'bar'],
        },
      },
      properties: {
        choice: {
          oneOf: [
            { allOf: [{ $ref: '#/$defs/foo%20branch' }] },
            { allOf: [{ $ref: '#/$defs/bar%20branch' }] },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        anyOf: [{ $ref: '#/$defs/foo%20branch' }, { $ref: '#/$defs/bar%20branch' }],
      });
      expect(JSON.stringify(schema)).not.toContain('"allOf"');
      expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    }
  });

  it('normalizes ref-resolved allOf targets before earlier consumers across all helper surfaces', () => {
    const makeSchema = (consumerFirst: boolean) => {
      const consumer = {
        type: 'object',
        allOf: [
          { $ref: '#/properties/target' },
          {
            type: 'object',
            properties: { active: { type: 'boolean' } },
            required: ['active'],
          },
        ],
      };
      const target = {
        allOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          {
            type: 'object',
            properties: { age: { type: 'number' } },
            required: ['age'],
          },
        ],
      };
      return {
        type: 'object',
        properties: consumerFirst ? { consumer, target } : { target, consumer },
        required: ['consumer', 'target'],
      };
    };

    for (const consumerFirst of [true, false]) {
      for (const schema of strictSchemasForAllHelpers(makeSchema(consumerFirst))) {
        expect((schema as JSONSchema).properties?.['consumer']).toEqual({
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            active: { type: 'boolean' },
          },
          required: ['name', 'age', 'active'],
          additionalProperties: false,
        });
        expect(JSON.stringify(schema)).not.toContain('"allOf"');
      }
    }
  });

  it('intersects closed allOf property sets across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        value: {
          allOf: [
            {
              type: 'object',
              properties: { x: { type: 'string' } },
              required: ['x'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { x: { type: 'string' }, y: { type: 'number' } },
              required: ['x'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['value'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['value']).toEqual({
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
        additionalProperties: false,
      });
    }
  });

  it('preserves refs to optional allOf properties discarded by closed branches', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        wrapper: {
          type: 'object',
          properties: { x: { type: 'string' } },
          allOf: [
            {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          ],
        },
        alias: { $ref: '#/properties/wrapper/properties/x' },
      },
      required: ['wrapper', 'alias'],
    });

    for (const schema of schemas) {
      expect(schema).toMatchObject({
        $defs: {
          __openai_strict_allOf_property_ref_0: { type: 'string' },
        },
        properties: {
          wrapper: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          alias: { $ref: '#/$defs/__openai_strict_allOf_property_ref_0' },
        },
      });
    }
  });

  it('rejects closed allOf property sets that exclude required properties across all helper surfaces', () => {
    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        value: {
          allOf: [
            {
              type: 'object',
              properties: { x: { type: 'string' } },
              required: ['x'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { x: { type: 'string' }, y: { type: 'number' } },
              required: ['x', 'y'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['value'],
    })) {
      expect(makeSchema).toThrow('cannot be merged without changing Draft 7 validation');
    }
  });

  it.each(['$defs', 'definitions'] as const)(
    'discards neutral %s-only allOf branches across all helper surfaces',
    (keyword) => {
      const schemas = strictSchemasForAllHelpers({
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                [keyword]: {
                  Name: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  name: { $ref: `#/properties/value/allOf/0/${keyword}/Name` },
                },
                required: ['name'],
              },
            ],
          },
        },
        required: ['value'],
      });

      for (const schema of schemas) {
        expect(schema).toMatchObject({
          $defs: {
            __openai_strict_allOf_ref_0: { type: 'string' },
          },
          properties: {
            value: {
              type: 'object',
              properties: {
                name: { $ref: '#/$defs/__openai_strict_allOf_ref_0' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
        });
        expect(JSON.stringify(schema)).not.toContain('"allOf"');
      }
    },
  );

  it('drops validation-neutral empty object keywords when normalizing oneOf wrappers', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          type: 'object',
          properties: {},
          required: [],
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;
    expect((schema as JSONSchema).properties?.['choice']).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
          required: ['kind', 'foo'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
          required: ['kind', 'bar'],
          additionalProperties: false,
        },
      ],
    });
  });

  it('drops empty object keywords from untyped oneOf wrappers', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          properties: {},
          required: [],
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
      required: ['choice'],
    });

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;
    expect((schema as JSONSchema).properties?.['choice']).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('still rejects non-empty object constraints on untyped oneOf wrappers', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          properties: { kind: { type: 'string' } },
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
      required: ['choice'],
    });

    expect(() => standardResponseFormat(standardSchema, 'choice')).toThrow('Object anyOf schema');
  });

  it('still rejects non-empty object constraints on normalized oneOf wrappers', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        choice: {
          type: 'object',
          properties: { kind: { type: 'string' } },
          required: ['kind'],
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
              required: ['kind', 'foo'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
              required: ['kind', 'bar'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    expect(() => standardResponseFormat(standardSchema, 'choice')).toThrow('Object anyOf schema');
  });

  it('normalizes annotated oneOf ref branches but rejects validation siblings', () => {
    const definitions = {
      foo: {
        type: 'object',
        properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
        required: ['kind', 'foo'],
      },
      bar: {
        type: 'object',
        properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
        required: ['kind', 'bar'],
      },
    };
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      $defs: definitions,
      properties: {
        choice: {
          oneOf: [
            { $ref: '#/$defs/foo', $comment: 'Generated foo alias', description: 'Foo choice' },
            { $ref: '#/$defs/bar', title: 'Bar choice' },
          ],
        },
      },
      required: ['choice'],
    });

    expect(standardResponseFormat(standardSchema, 'choice').json_schema.schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [
            { $ref: '#/$defs/foo', $comment: 'Generated foo alias', description: 'Foo choice' },
            { $ref: '#/$defs/bar', title: 'Bar choice' },
          ],
        },
      },
    });

    const { standardSchema: constrainedRefSchema } = makeStandardSchema({
      type: 'object',
      $defs: definitions,
      properties: {
        choice: {
          oneOf: [{ $ref: '#/$defs/foo', minProperties: 1 }, { $ref: '#/$defs/bar' }],
        },
      },
      required: ['choice'],
    });
    expect(() => standardResponseFormat(constrainedRefSchema, 'choice')).toThrow(
      'whose branches are not provably mutually exclusive',
    );
  });

  it('resolves URI-escaped oneOf refs and rejects malformed encodings', () => {
    const definitions = {
      'foo branch': {
        type: 'object',
        properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
        required: ['kind', 'foo'],
      },
      'bar branch': {
        type: 'object',
        properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
        required: ['kind', 'bar'],
      },
    };
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      $defs: definitions,
      properties: {
        choice: {
          oneOf: [{ $ref: '#/$defs/foo%20branch' }, { $ref: '#/$defs/bar%20branch' }],
        },
      },
      required: ['choice'],
    });

    expect(standardResponseFormat(standardSchema, 'choice').json_schema.schema).toMatchObject({
      properties: {
        choice: {
          anyOf: [{ $ref: '#/$defs/foo%20branch' }, { $ref: '#/$defs/bar%20branch' }],
        },
      },
    });

    const { standardSchema: malformedRefSchema } = makeStandardSchema({
      type: 'object',
      $defs: definitions,
      properties: {
        choice: {
          oneOf: [{ $ref: '#/$defs/foo%2' }, { $ref: '#/$defs/bar%20branch' }],
        },
      },
      required: ['choice'],
    });
    expect(() => standardResponseFormat(malformedRefSchema, 'choice')).toThrow(
      'whose branches are not provably mutually exclusive',
    );
  });

  it('allows root $id scopes but rejects nested $id before oneOf normalization', () => {
    const rootScopedSchema = {
      $id: 'https://example.com/root.json',
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    };
    const { standardSchema: rootScopedStandardSchema } = makeStandardSchema(rootScopedSchema);
    expect(standardResponseFormat(rootScopedStandardSchema, 'value').json_schema.schema).toMatchObject({
      $id: 'https://example.com/root.json',
    });

    const { standardSchema: nestedScopedStandardSchema } = makeStandardSchema({
      type: 'object',
      $defs: {
        outer: {
          type: 'object',
          properties: { kind: { type: 'string', const: 'outer' } },
          required: ['kind'],
        },
      },
      properties: {
        nested: {
          $id: 'nested.json',
          type: 'object',
          $defs: {
            outer: {
              type: 'object',
              properties: { kind: { type: 'string', const: 'nested' } },
              required: ['kind'],
            },
          },
          properties: {
            choice: {
              oneOf: [{ $ref: '#/$defs/outer' }, { type: 'string' }],
            },
          },
          required: ['choice'],
        },
      },
      required: ['nested'],
    });
    expect(() => standardResponseFormat(nestedScopedStandardSchema, 'nested')).toThrow(
      'establishes a separate JSON Schema resource scope',
    );
  });

  it('rejects oneOf refs that cannot be resolved locally', () => {
    for (const branches of [
      [{ $ref: '#/$defs/missing' }, { type: 'string' }],
      [{ $ref: 'https://example.com/schema.json#/$defs/foo' }, { type: 'string' }],
    ]) {
      const { standardSchema } = makeStandardSchema({
        type: 'object',
        properties: { choice: { oneOf: branches } },
        required: ['choice'],
      });

      expect(() => standardResponseFormat(standardSchema, 'choice')).toThrow(
        'Standard JSON Schema generated a `oneOf` whose branches are not provably mutually exclusive',
      );
    }
  });

  it.each([
    ['missing', { allOf: [{ $ref: '#/$defs/missing' }] }, {}],
    ['external', { allOf: [{ $ref: 'https://example.com/schema.json#/$defs/foo' }] }, {}],
    ['cyclic', { allOf: [{ $ref: '#/$defs/cycle' }] }, { cycle: { allOf: [{ $ref: '#/$defs/cycle' }] } }],
  ])('keeps %s refs exposed by oneOf allOf normalization fail closed', (_name, branch, defs) => {
    const factories = makeStrictSchemaFactories({
      type: 'object',
      $defs: defs,
      properties: {
        choice: {
          oneOf: [branch, { type: 'string' }],
        },
      },
      required: ['choice'],
    });

    for (const makeSchema of factories) {
      expect(makeSchema).toThrow(
        'Standard JSON Schema generated a `oneOf` whose branches are not provably mutually exclusive',
      );
    }
  });

  it('does not normalize oneOf keys inside literal schema values', () => {
    const schemaWithLiterals = {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: [{ oneOf: ['literal enum value'] }],
          const: { oneOf: ['literal const value'] },
          default: { oneOf: ['literal default value'] },
        },
      },
      required: ['choice'],
    };
    const { standardSchema } = makeStandardSchema(schemaWithLiterals);

    const schema = standardResponseFormat(standardSchema, 'choice').json_schema.schema;

    expect(schema).toMatchObject({
      properties: {
        choice: {
          enum: [{ oneOf: ['literal enum value'] }],
          const: { oneOf: ['literal const value'] },
          default: { oneOf: ['literal default value'] },
        },
      },
    });
  });

  it('accepts nullable type arrays for optional properties', () => {
    const nullableTypeArraySchema = {
      type: 'object',
      properties: {
        city: { type: ['string', 'null'] },
      },
    };
    const { standardSchema } = makeStandardSchema(nullableTypeArraySchema);

    expect(standardResponseFormat(standardSchema, 'weather').json_schema.schema).toEqual({
      type: 'object',
      properties: {
        city: { type: ['string', 'null'] },
      },
      required: ['city'],
      additionalProperties: false,
    });
  });

  it('normalizes singleton type arrays while preserving multi-type arrays', () => {
    const { standardSchema } = makeStandardSchema({
      type: ['object'],
      properties: {
        weather: {
          type: ['object'],
          properties: {
            city: { type: ['string'] },
            unit: { type: ['string', 'null'] },
          },
          required: ['city', 'unit'],
        },
      },
      required: ['weather'],
    });

    expect(standardResponseFormat(standardSchema, 'weather').json_schema.schema).toEqual({
      type: 'object',
      properties: {
        weather: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            unit: { type: ['string', 'null'] },
          },
          required: ['city', 'unit'],
          additionalProperties: false,
        },
      },
      required: ['weather'],
      additionalProperties: false,
    });
  });

  it('preserves the first conflicting allOf annotation across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          allOf: [
            {
              type: 'object',
              description: 'first description',
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
            {
              type: 'object',
              description: 'second description',
              title: 'second title',
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({
        type: 'object',
        description: 'first description',
        title: 'second title',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      });
    }
  });

  it('collapses contradictory nullable object allOf branches to null across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      properties: {
        choice: {
          allOf: [
            {
              type: ['object', 'null'],
              properties: {},
              additionalProperties: false,
            },
            {
              type: ['object', 'null'],
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          ],
        },
      },
      required: ['choice'],
    });

    for (const schema of schemas) {
      expect((schema as JSONSchema).properties?.['choice']).toEqual({ type: 'null' });
    }
  });

  it('rejects patternProperties before returning a strict schema', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        metadata: {
          type: 'object',
          patternProperties: {
            '^x-': {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          },
          additionalProperties: false,
        },
      },
      required: ['metadata'],
    });

    expect(() => standardResponseFormat(standardSchema, 'metadata')).toThrow(
      'uses unsupported keyword `patternProperties`',
    );
  });

  it.each([
    ['$dynamicRef', '#node'],
    ['$dynamicAnchor', 'node'],
  ] as const)('rejects unsupported %s before returning a strict schema', (keyword, value) => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        value: {
          type: 'string',
          [keyword]: value,
        },
      },
      required: ['value'],
    });

    expect(() => standardResponseFormat(standardSchema, 'value')).toThrow(
      `uses unsupported keyword \`${keyword}\``,
    );
  });

  it.each([
    ['$anchor', 'node'],
    ['$recursiveRef', '#'],
    ['$recursiveAnchor', true],
  ] as const)('rejects unsupported %s across all helper surfaces', (keyword, value) => {
    for (const makeSchema of makeStrictSchemaFactories({
      type: 'object',
      properties: {
        value: {
          type: 'string',
          [keyword]: value,
        },
      },
      required: ['value'],
    })) {
      expect(makeSchema).toThrow('uses unsupported keyword');
    }
  });

  it.each(['minProperties', 'maxProperties'] as const)(
    'rejects %s before returning a strict schema',
    (keyword) => {
      const { standardSchema } = makeStandardSchema({
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            [keyword]: 1,
          },
        },
        required: ['metadata'],
      });

      expect(() => standardResponseFormat(standardSchema, 'metadata')).toThrow(
        `uses unsupported keyword \`${keyword}\``,
      );
    },
  );

  it.each(['minContains', 'maxContains'] as const)(
    'rejects unsupported %s without contains before returning a strict schema',
    (keyword) => {
      const { standardSchema } = makeStandardSchema({
        type: 'object',
        properties: {
          values: {
            type: 'array',
            [keyword]: 1,
          },
        },
        required: ['values'],
      });

      expect(() => standardResponseFormat(standardSchema, 'values')).toThrow('uses unsupported keyword');
    },
  );

  it('rejects root anyOf schemas', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        kind: { type: 'string' },
      },
      required: ['kind'],
      anyOf: [
        { type: 'object', properties: { kind: { type: 'string', const: 'foo' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { type: 'string', const: 'bar' } }, required: ['kind'] },
      ],
    });

    expect(() => standardResponseFormat(standardSchema, 'choice')).toThrow(
      'Root schema must not use `anyOf`',
    );
  });

  it('flattens singleton root anyOf object wrappers across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      description: 'root description',
      anyOf: [
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      ],
    });

    for (const schema of schemas) {
      expect(schema).toEqual({
        type: 'object',
        description: 'root description',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      });
    }
  });

  it('rewrites refs into flattened singleton root anyOf branches across all helper surfaces', () => {
    const schemas = strictSchemasForAllHelpers({
      type: 'object',
      anyOf: [
        {
          type: 'object',
          $defs: {
            Value: { type: 'string' },
          },
          properties: {
            value: { $ref: '#/anyOf/0/$defs/Value' },
          },
          required: ['value'],
        },
      ],
    });

    for (const schema of schemas) {
      expect(schema).toMatchObject({
        $defs: {
          Value: { type: 'string' },
        },
        properties: {
          value: { $ref: '#/$defs/Value' },
        },
      });
    }
  });

  it.each(['anyOf', 'oneOf'] as const)(
    'filters false root %s alternatives before singleton promotion across all helper surfaces',
    (keyword) => {
      const schemas = strictSchemasForAllHelpers({
        type: 'object',
        [keyword]: [
          false,
          {
            type: 'object',
            $defs: {
              Value: { type: 'string' },
            },
            properties: {
              value: { $ref: `#/${keyword}/1/$defs/Value` },
            },
            required: ['value'],
          },
        ],
      });

      for (const schema of schemas) {
        expect(schema).toEqual({
          type: 'object',
          $defs: {
            Value: { type: 'string' },
          },
          properties: {
            value: { $ref: '#/$defs/Value' },
          },
          required: ['value'],
          additionalProperties: false,
        });
      }
    },
  );

  it.each(['anyOf', 'oneOf'] as const)(
    'keeps refs into removed false root %s alternatives fail closed across all helper surfaces',
    (keyword) => {
      for (const makeSchema of makeStrictSchemaFactories({
        type: 'object',
        [keyword]: [
          false,
          {
            type: 'object',
            properties: {
              value: { $ref: `#/${keyword}/0` },
            },
            required: ['value'],
          },
        ],
      })) {
        expect(makeSchema).toThrow('does not resolve to an object or boolean schema');
      }
    },
  );

  it.each(['$defs', 'definitions'] as const)(
    'preserves colliding root and promoted branch %s maps across all helper surfaces',
    (keyword) => {
      const schemas = strictSchemasForAllHelpers({
        type: 'object',
        [keyword]: {
          Value: { type: 'number' },
          RootOnly: { type: 'boolean' },
        },
        anyOf: [
          {
            type: 'object',
            [keyword]: {
              Value: { type: 'string' },
              BranchOnly: { type: 'integer' },
            },
            properties: {
              branchValue: { $ref: `#/anyOf/0/${keyword}/Value` },
              branchOnly: { $ref: `#/anyOf/0/${keyword}/BranchOnly` },
              rootValue: { $ref: `#/${keyword}/Value` },
              rootOnly: { $ref: `#/${keyword}/RootOnly` },
            },
            required: ['branchValue', 'branchOnly', 'rootValue', 'rootOnly'],
          },
        ],
      });

      for (const schema of schemas) {
        expect(schema).toMatchObject({
          [keyword]: {
            Value: { type: 'number' },
            RootOnly: { type: 'boolean' },
            __openai_strict_anyOf_definition_0: { type: 'string' },
            BranchOnly: { type: 'integer' },
          },
          properties: {
            branchValue: { $ref: `#/${keyword}/__openai_strict_anyOf_definition_0` },
            branchOnly: { $ref: `#/${keyword}/BranchOnly` },
            rootValue: { $ref: `#/${keyword}/Value` },
            rootOnly: { $ref: `#/${keyword}/RootOnly` },
          },
        });
      }
    },
  );

  it('rejects unsupported nested schema keywords before returning a strict schema', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        values: {
          type: 'array',
          contains: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
      required: ['values'],
    });

    expect(() => standardResponseFormat(standardSchema, 'values')).toThrow(
      'uses unsupported keyword `contains`',
    );
  });

  it.each([
    ['true', true],
    ['schema-valued', { type: 'string' }],
  ])('rejects %s additionalProperties before returning a strict schema', (_name, additionalProperties) => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
      additionalProperties,
    });

    expect(() => standardResponseFormat(standardSchema, 'weather')).toThrow(
      'must set `additionalProperties: false` to be compatible with strict Structured Outputs',
    );
  });

  it('rejects boolean schemas reached through local refs before returning a strict schema', () => {
    const { standardSchema } = makeStandardSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { $ref: '#/additionalProperties' },
      },
      required: ['value'],
    });

    expect(() => standardResponseFormat(standardSchema, 'value')).toThrow(
      'Expected object schema but got boolean; path=properties/value',
    );
  });

  it('throws an actionable error when no JSON Schema is available', () => {
    const standardSchema = makeValidationOnlySchema();

    expect(() => standardResponseFormat(standardSchema, 'weather')).toThrow(
      'Standard Schema helpers require a JSON Schema',
    );
  });

  it('surfaces validation issues', () => {
    const { standardSchema } = makeStandardSchema();
    const format = standardResponseFormat(standardSchema, 'weather');

    expect(() => format.$parseRaw('{"city":123,"unit":"c"}')).toThrow(
      'Standard Schema validation failed: city: expected weather input',
    );
  });

  it('rejects asynchronous validators', () => {
    const { standardSchema } = makeStandardSchema();
    const asyncSchema = {
      ...standardSchema,
      '~standard': {
        ...standardSchema['~standard'],
        validate: async (value: unknown) => validateWeather(value),
      },
    };
    const format = standardResponseFormat(asyncSchema, 'weather');

    expect(() => format.$parseRaw('{"city":"Paris","unit":"c"}')).toThrow(
      'Standard Schema helpers only support synchronous validation',
    );
  });

  it('observes rejected asynchronous validators', async () => {
    const { standardSchema } = makeStandardSchema();
    const unhandledRejection = jest.fn();
    const rejectingAsyncSchema = {
      ...standardSchema,
      '~standard': {
        ...standardSchema['~standard'],
        validate: () => Promise.reject(new Error('validation rejected')),
      },
    };
    const format = standardResponseFormat(rejectingAsyncSchema, 'weather');
    process.once('unhandledRejection', unhandledRejection);

    try {
      expect(() => format.$parseRaw('{"city":"Paris","unit":"c"}')).toThrow(
        'Standard Schema helpers only support synchronous validation',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandledRejection);
    }
  });
});

function _typeTests() {
  const { standardSchema } = makeStandardSchema();
  const vendorStandardSchema = zv4.object({ city: zv4.string() });

  const responseFormat = standardResponseFormat(standardSchema, 'weather');
  const textFormat = standardTextFormat(standardSchema, 'weather');
  expectType<WeatherOutput>(responseFormat.__output);
  expectType<WeatherOutput>(textFormat.__output);
  compareType<typeof responseFormat.__output, WeatherOutput>(true);
  compareType<typeof textFormat.__output, WeatherOutput>(true);

  const chatTool = standardFunction({
    name: 'get_weather',
    parameters: standardSchema,
    function: (args) => expectType<WeatherOutput>(args),
  });
  const responseTool = standardResponsesFunction({
    name: 'get_weather',
    parameters: standardSchema,
    function: (args) => expectType<WeatherOutput>(args),
  });
  const callbacklessChatTool = standardFunction({
    name: 'get_weather',
    parameters: standardSchema,
  });
  const standardTargetSchema = {
    ...standardSchema,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        input: (_options: { readonly target: 'draft-07' | 'draft-2020-12' }) =>
          weatherJSONSchema as unknown as Record<string, unknown>,
      },
    },
  };
  const typelessStandardSchema = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: validateWeather,
      jsonSchema: {
        input: () => weatherJSONSchema as unknown as Record<string, unknown>,
      },
    },
  };
  const typelessResponseFormat = standardResponseFormat(typelessStandardSchema, 'weather');
  const typelessTextFormat = standardTextFormat(typelessStandardSchema, 'weather');
  const typelessChatTool = standardFunction({
    name: 'get_weather',
    parameters: typelessStandardSchema,
    function: (args) => compareType<typeof args, unknown>(true),
  });
  const typelessResponseTool = standardResponsesFunction({
    name: 'get_weather',
    parameters: typelessStandardSchema,
    function: (args) => compareType<typeof args, unknown>(true),
  });
  const vendorResponseFormat = standardResponseFormat(vendorStandardSchema, 'weather');
  const vendorChatTool = standardFunction({
    name: 'get_weather',
    parameters: vendorStandardSchema,
    function: (args) => expectType<{ city: string }>(args),
  });

  compareType<ReturnType<typeof chatTool.$parseRaw>, WeatherOutput>(true);
  compareType<ReturnType<typeof responseTool.$parseRaw>, WeatherOutput>(true);
  compareType<typeof typelessResponseFormat.__output, unknown>(true);
  compareType<typeof typelessTextFormat.__output, unknown>(true);
  compareType<ReturnType<typeof typelessChatTool.$parseRaw>, unknown>(true);
  compareType<ReturnType<typeof typelessResponseTool.$parseRaw>, unknown>(true);
  compareType<typeof vendorResponseFormat.__output, { city: string }>(true);
  compareType<ReturnType<typeof vendorChatTool.$parseRaw>, { city: string }>(true);
  expectType<true>(chatTool.__hasFunction);
  expectType<false>(callbacklessChatTool.__hasFunction);
  // @ts-expect-error callback-less tools cannot be passed to runTools
  runTools({ model: 'gpt-4o', messages: [], tools: [callbacklessChatTool] });
  standardResponseFormat(standardTargetSchema, 'weather');
}
