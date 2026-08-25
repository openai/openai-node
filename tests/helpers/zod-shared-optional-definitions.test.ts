import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { toStrictJsonSchema } from 'openai/lib/transform';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

interface JsonSchema {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  not?: JsonSchema;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
}

interface Helper {
  name: string;
  convert: (schema: zv3.ZodType | zv4.ZodType) => JsonSchema;
}

const strictHelpers: Helper[] = [
  {
    name: 'zodResponseFormat',
    convert: (schema) => zodResponseFormat(schema, 'root').json_schema.schema as JsonSchema,
  },
  {
    name: 'zodTextFormat',
    convert: (schema) => zodTextFormat(schema, 'root').schema as JsonSchema,
  },
  {
    name: 'zodFunction',
    convert: (schema) => zodFunction({ name: 'root', parameters: schema }).function.parameters as JsonSchema,
  },
  {
    name: 'zodResponsesFunction',
    convert: (schema) => zodResponsesFunction({ name: 'root', parameters: schema }).parameters as JsonSchema,
  },
];

/** Collects every JSON Pointer at which the `not` keyword appears. */
function collectNotPointers(value: unknown, path = '#', pointers: string[] = []): string[] {
  if (!value || typeof value !== 'object') {
    return pointers;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNotPointers(item, `${path}/${index}`, pointers));
    return pointers;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'not') {
      pointers.push(`${path}/not`);
    }
    collectNotPointers(child, `${path}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`, pointers);
  }

  return pointers;
}

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

// `.optional()` on its own is rejected with "uses `.optional()` without `.nullable()`", so
// `.nullable().optional()` is the shape these helpers accept. Reusing one field schema across
// several properties is what makes the converter extract it into `definitions`.
const sharedString = zv3.string().nullable().optional();
const sharedObject = zv3.object({ street: zv3.string(), city: zv3.string() }).nullable().optional();

const sharedStringSchema = zv3.object({ primary: sharedString, secondary: sharedString });
const sharedObjectSchema = zv3.object({ home: sharedObject, work: sharedObject });

describe('Zod v3 optional schemas extracted into definitions', () => {
  it.each(strictHelpers)('reuses one encoding for a shared optional string in $name', ({ convert }) => {
    const schema = convert(sharedStringSchema);

    expect(collectNotPointers(schema)).toEqual([]);
    expect(schema.properties?.['primary']).toEqual({ type: 'string', nullable: true });
    expect(definitionFor(schema, schema.properties?.['secondary']?.$ref)).toEqual(
      schema.properties?.['primary'],
    );
  });

  it.each(strictHelpers)('reuses one encoding for a shared optional object in $name', ({ convert }) => {
    const schema = convert(sharedObjectSchema);

    // `extract-to-root` also hoists the nested object into its own definition, so the extracted
    // entry is not literally identical to the inline occurrence. What has to match is the
    // wrapper: inline it is `anyOf: [<object>, null]`, and so is the extracted one.
    expect(collectNotPointers(schema)).toEqual([]);
    expect(definitionFor(schema, schema.properties?.['work']?.$ref)).toEqual({
      anyOf: [{ $ref: '#/definitions/root_properties_home_anyOf_0' }, { type: 'null' }],
    });
  });

  it.each(strictHelpers)('produces a schema strictification accepts in $name', ({ convert }) => {
    // `not` is outside the strict Structured Outputs keyword subset, so the SDK's own transform
    // rejects it. The Zod v4 and Standard Schema paths run this check already; the Zod v3 path
    // does not, which is how the wrapper reached generated request bodies.
    expect(() =>
      toStrictJsonSchema(structuredClone(convert(sharedStringSchema)) as JSONSchema),
    ).not.toThrow();
    expect(() =>
      toStrictJsonSchema(structuredClone(convert(sharedObjectSchema)) as JSONSchema),
    ).not.toThrow();
  });

  it('matches Zod v4, which never emits `not` for the same schema', () => {
    const sharedV4 = zv4.string().nullable().optional();
    const zodV4Schema = zodResponseFormat(zv4.object({ primary: sharedV4, secondary: sharedV4 }), 'root')
      .json_schema.schema;

    expect(collectNotPointers(zodV4Schema)).toEqual([]);
  });

  it('applies to a schemaDefinitions entry, which needs no sharing at all', () => {
    const optional = zv3.string().nullable().optional();
    const schema = zodResponseFormat(zv3.object({ primary: optional }), 'root', {
      schemaDefinitions: { Optional: optional },
    }).json_schema.schema as JsonSchema;

    expect(collectNotPointers(schema)).toEqual([]);
    expect(schema.properties?.['primary']).toEqual({ $ref: '#/definitions/Optional' });
    expect(schema.definitions?.['Optional']).toEqual({ type: 'string', nullable: true });
  });

  it('keeps non-strict Realtime tools consistent too', () => {
    const shared = zv3.string().nullable().optional();
    const parameters = zodRealtimeFunction({
      name: 'root',
      parameters: zv3.object({ primary: shared, secondary: shared }),
    }).parameters as JsonSchema;

    expect(collectNotPointers(parameters)).toEqual([]);
    expect(definitionFor(parameters, parameters.properties?.['secondary']?.$ref)).toEqual(
      parameters.properties?.['primary'],
    );
  });

  it.each([
    {
      description: 'distinct optional schemas that are never extracted',
      build: () =>
        zv3.object({
          primary: zv3.string().nullable().optional(),
          secondary: zv3.string().nullable().optional(),
        }),
    },
    {
      description: 'a single field whose schema is not reused',
      build: () => zv3.object({ primary: zv3.string().nullable().optional() }),
    },
    {
      description: 'a shared schema that is not optional',
      build: () => {
        const shared = zv3.string().nullable();
        return zv3.object({ primary: shared, secondary: shared });
      },
    },
  ])('stays clean for $description', ({ build }) => {
    expect(collectNotPointers(zodResponseFormat(build(), 'root').json_schema.schema)).toEqual([]);
  });
});

describe('Zod v3 standalone optional schemas', () => {
  // `anyOf: [{ not: {} }, ...]` is the correct JSON Schema encoding for a value that may be
  // absent, and it has to survive wherever the optionality is not carried by a containing
  // property. Only extracted definitions, which stand in for a property occurrence, change.
  it('still encodes a root-level optional with `not`', () => {
    expect(zodToJsonSchema(zv3.string().optional())).toEqual({
      anyOf: [{ not: {} }, { type: 'string' }],
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
  });

  it('still encodes a named root-level optional with `not`', () => {
    expect(zodToJsonSchema(zv3.string().optional(), { name: 'maybe_string' })).toEqual({
      $ref: '#/definitions/maybe_string',
      definitions: { maybe_string: { anyOf: [{ not: {} }, { type: 'string' }] } },
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
  });
});
