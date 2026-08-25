import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z4 } from 'zod/v4';
import { z as z4Mini } from 'zod/v4-mini';

interface JsonSchema {
  $ref?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
}

type SupportedSchema = z4.ZodType | z4Mini.ZodMiniType;

interface HelperResult {
  schema: JsonSchema;
  parseRaw?: (content: string) => unknown;
}

interface Helper {
  name: string;
  convert: (schema: SupportedSchema) => HelperResult;
}

const helpers: Helper[] = [
  {
    name: 'zodResponseFormat',
    convert: (schema) => {
      const format = zodResponseFormat(schema, 'root');
      return { schema: format.json_schema.schema as JsonSchema, parseRaw: format.$parseRaw };
    },
  },
  {
    name: 'zodTextFormat',
    convert: (schema) => {
      const format = zodTextFormat(schema, 'root');
      return { schema: format.schema as JsonSchema, parseRaw: format.$parseRaw };
    },
  },
  {
    name: 'zodFunction',
    convert: (schema) => {
      const tool = zodFunction({ name: 'root', parameters: schema });
      return { schema: tool.function.parameters as JsonSchema, parseRaw: tool.$parseRaw };
    },
  },
  {
    name: 'zodResponsesFunction',
    convert: (schema) => {
      const tool = zodResponsesFunction({ name: 'root', parameters: schema });
      return { schema: tool.parameters as JsonSchema, parseRaw: tool.$parseRaw };
    },
  },
  {
    name: 'zodRealtimeFunction',
    convert: (schema) => ({
      schema: zodRealtimeFunction({ name: 'root', parameters: schema }).parameters as JsonSchema,
    }),
  },
];

const schemaVariants = [
  {
    version: 'Classic',
    create() {
      const sharedString = z4.string();
      const sharedNumber = z4.number();
      return z4.object({
        a: z4.object({ b: sharedString, again: sharedString }),
        a_properties_b: sharedNumber,
        anotherNumber: sharedNumber,
      });
    },
  },
  {
    version: 'Mini',
    create() {
      const sharedString = z4Mini.string();
      const sharedNumber = z4Mini.number();
      return z4Mini.object({
        a: z4Mini.object({ b: sharedString, again: sharedString }),
        a_properties_b: sharedNumber,
        anotherNumber: sharedNumber,
      });
    },
  },
];

describe.each(helpers)('$name Zod v4 definitions', ({ convert }) => {
  it.each(schemaVariants)('preserves colliding Zod v4 $version property paths', ({ create }) => {
    const result = convert(create());

    expect(result.schema.properties?.['a']?.properties?.['again']?.type).toBe('string');
    expect(result.schema.properties?.['anotherNumber']?.type).toBe('number');

    const value = { a: { b: 'first', again: 'second' }, a_properties_b: 1, anotherNumber: 2 };
    if (result.parseRaw) {
      expect(result.parseRaw(JSON.stringify(value))).toEqual(value);
    }
  });
});

it('accepts frozen caller definitions without mutation', () => {
  const shared = z4.object({ value: z4.string() });
  const definitions = Object.freeze({ provided: shared });
  const root = z4.object({ first: shared, again: shared });
  const schema = zodResponseFormat(root, 'root', {
    schemaDefinitions: definitions,
  }).json_schema.schema as JsonSchema;

  expect(schema.properties?.['first']?.$ref).toBe('#/definitions/provided');
  expect(schema.definitions?.['provided']?.type).toBe('object');
  expect(Object.keys(definitions)).toEqual(['provided']);
  expect(definitions.provided).toBe(shared);
});
