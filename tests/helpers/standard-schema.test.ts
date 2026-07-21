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

  it('strictifies object schemas nested under patternProperties', () => {
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

    expect(standardResponseFormat(standardSchema, 'metadata').json_schema.schema).toMatchObject({
      properties: {
        metadata: {
          patternProperties: {
            '^x-': {
              additionalProperties: false,
            },
          },
        },
      },
    });
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
