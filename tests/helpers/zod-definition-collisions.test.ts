import { getDefaultOptions, zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

interface JsonSchema {
  $ref?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

interface HelperResult {
  schema: JsonSchema;
  parseRaw?: (content: string) => unknown;
}

interface Helper {
  name: string;
  convert: (schema: zv3.ZodType | zv4.ZodType) => HelperResult;
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

function definitionFor(schema: JsonSchema, ref: string | undefined): JsonSchema {
  if (!ref?.startsWith('#/definitions/')) {
    throw new Error(`Expected a generated definition reference, received ${ref}`);
  }

  const definition = schema.definitions?.[ref.replace('#/definitions/', '')];
  if (!definition) {
    throw new Error(`Definition reference ${ref} does not resolve`);
  }
  return definition;
}

describe('Zod v3 generated definition names', () => {
  it.each(helpers)('keeps colliding paths separate in $name', ({ convert }) => {
    const sharedString = zv3.string();
    const sharedNumber = zv3.number();
    const root = zv3.object({
      a: zv3.object({ b: sharedString, again: sharedString }),
      a_properties_b: sharedNumber,
      anotherNumber: sharedNumber,
    });
    const result = convert(root);
    const nestedString = result.schema.properties?.['a']?.properties?.['again'];
    const repeatedNumber = result.schema.properties?.['anotherNumber'];

    expect(nestedString?.$ref).toBe('#/definitions/root_properties_a_properties_b');
    expect(repeatedNumber?.$ref).toBe('#/definitions/root_properties_a_properties_b_1');
    expect(definitionFor(result.schema, nestedString?.$ref).type).toBe('string');
    expect(definitionFor(result.schema, repeatedNumber?.$ref).type).toBe('number');

    const value = { a: { b: 'first', again: 'second' }, a_properties_b: 1, anotherNumber: 2 };
    expect(root.parse(value)).toEqual(value);
    if (result.parseRaw) {
      expect(result.parseRaw(JSON.stringify(value))).toEqual(value);
    }
  });

  it('does not overwrite a caller-provided definition with a generated collision', () => {
    const providedNumber = zv3.number();
    const definitions = { root_properties_first: providedNumber };
    const sharedString = zv3.string();
    const root = zv3.object({ first: sharedString, again: sharedString });
    const schema = zodResponseFormat(root, 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(definitions).toEqual({ root_properties_first: providedNumber });
    expect(schema.definitions?.['root_properties_first']?.type).toBe('number');
    expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_properties_first_1');
    expect(definitionFor(schema, schema.properties?.['again']?.$ref).type).toBe('string');
  });

  it('keeps the original readable name when no other definition occupies it', () => {
    const shared = zv3.string();
    const schema = zodResponseFormat(zv3.object({ first: shared, again: shared }), 'root').json_schema
      .schema as JsonSchema;

    expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_properties_first');
    expect(schema.definitions?.['root_properties_first']?.type).toBe('string');
  });

  it('assigns deterministic suffixes to three distinct nested paths with the same flattened name', () => {
    const sharedString = zv3.string();
    const sharedNumber = zv3.number();
    const sharedBoolean = zv3.boolean();
    const root = zv3.object({
      a: zv3.object({
        b: zv3.object({ c: sharedString, again: sharedString }),
        b_properties_c: sharedNumber,
        repeatedNumber: sharedNumber,
      }),
      a_properties_b: zv3.object({ c: sharedBoolean, again: sharedBoolean }),
    });
    const schema = zodResponseFormat(root, 'root').json_schema.schema as JsonSchema;
    const nested = schema.properties?.['a']?.properties;
    const stringRef = nested?.['b']?.properties?.['again']?.$ref;
    const numberRef = nested?.['repeatedNumber']?.$ref;
    const booleanRef = schema.properties?.['a_properties_b']?.properties?.['again']?.$ref;

    expect(stringRef).toBe('#/definitions/root_properties_a_properties_b_properties_c');
    expect(numberRef).toBe('#/definitions/root_properties_a_properties_b_properties_c_1');
    expect(booleanRef).toBe('#/definitions/root_properties_a_properties_b_properties_c_2');
    expect(definitionFor(schema, stringRef).type).toBe('string');
    expect(definitionFor(schema, numberRef).type).toBe('number');
    expect(definitionFor(schema, booleanRef).type).toBe('boolean');
  });

  it('skips multiple occupied suffixes and safely handles a shadowed hasOwnProperty key', () => {
    const providedNumber = zv3.number();
    const providedBoolean = zv3.boolean();
    const providedNull = zv3.null();
    const shadowedProperty = zv3.string();
    const definitions = {
      root_properties_first: providedNumber,
      root_properties_first_1: providedBoolean,
      root_properties_first_2: providedNull,
      hasOwnProperty: shadowedProperty,
    };
    const shared = zv3.string();
    const schema = zodResponseFormat(zv3.object({ first: shared, again: shared }), 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;
    const generatedRef = schema.properties?.['again']?.$ref;

    expect(generatedRef).toBe('#/definitions/root_properties_first_3');
    expect(definitionFor(schema, generatedRef).type).toBe('string');
    expect(schema.definitions?.['root_properties_first']?.type).toBe('number');
    expect(schema.definitions?.['root_properties_first_1']?.type).toBe('boolean');
    expect(schema.definitions?.['root_properties_first_2']?.type).toBe('null');
    expect(schema.definitions?.['hasOwnProperty']?.type).toBe('string');
    expect(Object.keys(definitions)).toEqual([
      'root_properties_first',
      'root_properties_first_1',
      'root_properties_first_2',
      'hasOwnProperty',
    ]);
    expect(definitions.root_properties_first).toBe(providedNumber);
  });

  it('supports frozen caller definitions without adding generated names to the caller map', () => {
    const providedNumber = zv3.number();
    const definitions = Object.freeze({ existing: providedNumber });
    const sharedString = zv3.string();
    const root = zv3.object({ first: sharedString, again: sharedString });
    const schema = zodResponseFormat(root, 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(Object.keys(definitions)).toEqual(['existing']);
    expect(definitions.existing).toBe(providedNumber);
    expect(schema.definitions?.['existing']?.type).toBe('number');
    expect(definitionFor(schema, schema.properties?.['again']?.$ref).type).toBe('string');
  });

  it('ignores inherited definition names when checking for generated-name collisions', () => {
    const inherited = { root_properties_first: zv3.number() };
    const definitions = Object.create(inherited) as Record<string, zv3.ZodType>;
    definitions['existing'] = zv3.boolean();
    const shared = zv3.string();
    const schema = zodResponseFormat(zv3.object({ first: shared, again: shared }), 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_properties_first');
    expect(schema.definitions?.['root_properties_first']?.type).toBe('string');
    expect(Object.keys(definitions)).toEqual(['existing']);
  });

  it('accepts null-prototype caller definitions without mutating them', () => {
    const definitions = Object.create(null) as Record<string, zv3.ZodType>;
    definitions['root_properties_first'] = zv3.number();
    const shared = zv3.string();
    const schema = zodResponseFormat(zv3.object({ first: shared, again: shared }), 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_properties_first_1');
    expect(schema.definitions?.['root_properties_first']?.type).toBe('number');
    expect(Object.keys(definitions)).toEqual(['root_properties_first']);
  });

  it.each(['schema', 'raw definition', 'schema alias'] as const)(
    'reuses an identical caller-provided Zod %s without adding a suffix',
    (representation) => {
      const shared = zv3.string();
      const definition = {
        schema: shared,
        'raw definition': shared._def,
        'schema alias': new zv3.ZodString(shared._def),
      }[representation];
      const definitions = { root_properties_first: definition };
      const schema = zodToJsonSchema(zv3.object({ first: shared, again: shared, third: shared }), {
        name: 'root',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        definitions,
      }) as JsonSchema;

      expect(schema.properties?.['first']?.$ref).toBe('#/definitions/root_properties_first');
      expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_properties_first');
      expect(schema.properties?.['third']?.$ref).toBe('#/definitions/root_properties_first');
      expect(schema.definitions?.['root_properties_first']?.type).toBe('string');
      expect(definitions.root_properties_first).toBe(definition);
      expect(Object.keys(definitions)).toEqual(['root_properties_first']);
    },
  );

  it('keeps the response root separate from caller-provided root-name definitions', () => {
    const providedRoot = zv3.number();
    const providedRenamedRoot = zv3.boolean();
    const definitions = { root: providedRoot, root_root: providedRenamedRoot };
    const shared = zv3.string();
    const schema = zodResponseFormat(zv3.object({ first: shared, again: shared }), 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(schema.properties?.['again']?.$ref).toBe('#/definitions/root_root_root_properties_first');
    expect(schema.definitions?.['root']?.type).toBe('number');
    expect(schema.definitions?.['root_root']?.type).toBe('boolean');
    expect(schema.definitions?.['root_root_root']?.type).toBe('object');
    expect(Object.keys(definitions)).toEqual(['root', 'root_root']);
  });

  it('reserves the root definition name while materializing supplied nested definitions', () => {
    const sharedString = zv3.string();
    const provided = zv3.object({ bar: sharedString, again: sharedString });
    const occupiedSuffix = zv3.number();
    const root: zv3.ZodTypeAny = zv3.lazy(() =>
      zv3.object({ first: provided, second: provided, children: zv3.array(root) }),
    );
    const schema = zodResponseFormat(root, 'foo_properties_bar', {
      schemaDefinitions: { foo: provided, foo_properties_bar_1: occupiedSuffix },
    }).json_schema.schema as JsonSchema;
    const nestedString = schema.definitions?.['foo']?.properties?.['again'];

    expect(nestedString?.$ref).toBe('#/definitions/foo_properties_bar_2');
    expect(definitionFor(schema, nestedString?.$ref).type).toBe('string');
    expect(schema.definitions?.['foo_properties_bar']?.type).toBe('object');
    expect(schema.definitions?.['foo_properties_bar_1']?.type).toBe('number');
    expect(schema.properties?.['children']?.items?.$ref).toBe('#/definitions/foo_properties_bar');
  });

  it('preserves the caller definitions identity for converter strategies that cannot mutate it', () => {
    const definitions = { shared: zv3.string() };

    for (const $refStrategy of ['root', 'relative', 'none', 'seen'] as const) {
      expect(
        getDefaultOptions({ definitions, $refStrategy, nameStrategy: 'duplicate-ref' }).definitions,
      ).toBe(definitions);
    }

    expect(
      getDefaultOptions({ definitions, $refStrategy: 'extract-to-root', nameStrategy: 'ref' }).definitions,
    ).toBe(definitions);

    const extracted = getDefaultOptions({
      definitions,
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
    }).definitions;
    expect(extracted).not.toBe(definitions);
    expect(extracted).toEqual(definitions);
  });
});

describe('Zod v4 definition compatibility', () => {
  it.each(helpers)('keeps ordinary Zod v4 conversion unchanged in $name', ({ convert }) => {
    const sharedString = zv4.string();
    const sharedNumber = zv4.number();
    const root = zv4.object({
      a: zv4.object({ b: sharedString, again: sharedString }),
      a_properties_b: sharedNumber,
      anotherNumber: sharedNumber,
    });
    const result = convert(root);

    expect(result.schema.properties?.['a']?.properties?.['again']?.type).toBe('string');
    expect(result.schema.properties?.['anotherNumber']?.type).toBe('number');

    const value = { a: { b: 'first', again: 'second' }, a_properties_b: 1, anotherNumber: 2 };
    expect(root.parse(value)).toEqual(value);
    if (result.parseRaw) {
      expect(result.parseRaw(JSON.stringify(value))).toEqual(value);
    }
  });

  it('continues to accept frozen Zod v4 caller definitions without mutation', () => {
    const shared = zv4.object({ value: zv4.string() });
    const definitions = Object.freeze({ provided: shared });
    const root = zv4.object({ first: shared, again: shared });
    const schema = zodResponseFormat(root, 'root', {
      schemaDefinitions: definitions,
    }).json_schema.schema as JsonSchema;

    expect(schema.properties?.['first']?.$ref).toBe('#/definitions/provided');
    expect(definitionFor(schema, schema.properties?.['first']?.$ref).type).toBe('object');
    expect(Object.keys(definitions)).toEqual(['provided']);
    expect(definitions.provided).toBe(shared);
  });
});
