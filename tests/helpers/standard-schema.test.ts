import {
  standardFunction,
  standardResponseFormat,
  standardResponsesFunction,
  standardTextFormat,
} from 'openai/helpers/standard-schema';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { compareType, expectType } from '../utils/typing';

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

  it('normalizes oneOf to anyOf before strictifying schemas', () => {
    const oneOfSchema = {
      type: 'object',
      properties: {
        choice: {
          oneOf: [
            {
              type: 'object',
              properties: { foo: { type: 'string' } },
              required: ['foo'],
            },
            {
              type: 'object',
              properties: { bar: { type: 'number' } },
              required: ['bar'],
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
              properties: { foo: { type: 'string' } },
              required: ['foo'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { bar: { type: 'number' } },
              required: ['bar'],
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

  compareType<ReturnType<typeof chatTool.$parseRaw>, WeatherOutput>(true);
  compareType<ReturnType<typeof responseTool.$parseRaw>, WeatherOutput>(true);
}
