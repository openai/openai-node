import {
  standardFunction,
  standardResponseFormat,
  standardResponsesFunction,
  standardTextFormat,
} from 'openai/helpers/standard-schema';
import type OpenAI from 'openai';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { compareType, expectType } from '../utils/typing';

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

  expectType<WeatherOutput>(standardResponseFormat(standardSchema, 'weather').__output);
  expectType<WeatherOutput>(standardTextFormat(standardSchema, 'weather').__output);

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

  compareType<ReturnType<typeof chatTool.$parseRaw>, WeatherOutput>(true);
  compareType<ReturnType<typeof responseTool.$parseRaw>, WeatherOutput>(true);
  expectType<true>(chatTool.__hasFunction);
  expectType<false>(callbacklessChatTool.__hasFunction);
  // @ts-expect-error callback-less tools cannot be passed to runTools
  runTools({ model: 'gpt-4o', messages: [], tools: [callbacklessChatTool] });
  standardResponseFormat(standardTargetSchema, 'weather');
}
