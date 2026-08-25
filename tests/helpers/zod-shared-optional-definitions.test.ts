import type { JsonSchema7Type } from 'openai/_vendor/zod-to-json-schema';
import { ignoreOverride, zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
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

describe('a definition keeps the context it was referenced from', () => {
  // Only some definitions come from a property. Marking every materialized definition as
  // one changes how the wrapper parsers encode it, in two ways that have nothing to do
  // with the redundant `anyOf` this file is about.

  it('keeps the standalone encoding for a definition referenced from an array item', () => {
    const optional = zv3.string().optional();

    const schema = zodToJsonSchema(zv3.array(optional), {
      definitions: { Optional: optional },
    }) as { definitions: Record<string, JsonSchema> };

    expect(schema.definitions!['Optional']).toEqual({ anyOf: [{ not: {} }, { type: 'string' }] });
  });

  it('keeps the standalone encoding for a definition the caller supplied outright', () => {
    const optional = zv3.string().optional();

    const schema = zodToJsonSchema(zv3.object({ other: zv3.number() }), {
      definitions: { Optional: optional },
    }) as { definitions: Record<string, JsonSchema> };

    expect(schema.definitions!['Optional']).toEqual({ anyOf: [{ not: {} }, { type: 'string' }] });
  });

  // `items` is positional while `minItems`/`maxItems` come from the declared arity, so a
  // slot that parses to nothing has to stay as `{}`. Dropping it shifts every later
  // element and makes the document accept and reject the opposite arrays from the Zod
  // schema. The exported converter is reachable without the strict helpers' `ZodTuple`
  // rejection, so every position is covered here rather than assumed away.
  const emptySlot = () =>
    zv3
      .preprocess(() => undefined, zv3.void())
      .transform(() => 0)
      .optional();

  it('keeps every tuple position when the tuple is a supplied definition', () => {
    const tuple = zv3.tuple([emptySlot(), zv3.string()]);

    const schema = zodToJsonSchema(tuple, { definitions: { Tuple: tuple } }) as {
      definitions: Record<string, { items: JsonSchema[]; minItems: number; maxItems: number }>;
    };

    expect(schema.definitions['Tuple']).toEqual({
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: [{}, { type: 'string' }],
    });

    // Zod coerces element 0 and requires element 1 to be a string; the schema has to agree.
    expect(tuple.safeParse([123, 'valid']).success).toBe(true);
    expect(tuple.safeParse(['valid', 123]).success).toBe(false);
  });

  it('keeps every tuple position under `openaiStrictMode` on the exported converter', () => {
    const tuple = zv3.tuple([emptySlot(), zv3.string()]);

    const schema = zodToJsonSchema(zv3.object({ value: tuple }), {
      openaiStrictMode: true,
      definitions: { Tuple: tuple },
    }) as { definitions: Record<string, { items: JsonSchema[] }> };

    expect(schema.definitions['Tuple']!.items).toEqual([{}, { type: 'string' }]);
  });

  it('keeps every tuple position under an object property', () => {
    const schema = zodToJsonSchema(
      zv3.object({ pair: zv3.tuple([emptySlot(), zv3.string()]) }),
    ) as { properties: Record<string, { items: JsonSchema[] }> };

    expect(schema.properties!['pair']!.items).toEqual([{}, { type: 'string' }]);
  });

  it('keeps every tuple position when the tuple has a rest element', () => {
    const schema = zodToJsonSchema(zv3.tuple([emptySlot(), zv3.string()]).rest(zv3.number())) as {
      items: JsonSchema[];
      minItems: number;
      additionalItems: JsonSchema;
    };

    expect(schema.items).toEqual([{}, { type: 'string' }]);
    expect(schema.minItems).toBe(2);
    expect(schema.additionalItems).toEqual({ type: 'number' });
  });

  it('keeps the unconstrained branch of a union definition', () => {
    const choice = zv3.union([emptySlot(), zv3.string()]);

    const schema = zodToJsonSchema(zv3.object({ value: choice }), {
      openaiStrictMode: true,
      definitions: { Choice: choice },
    }) as { definitions: Record<string, { anyOf: JsonSchema[] }> };

    // Without the empty branch the document rejects `{ value: 42 }`, which Zod accepts.
    expect(schema.definitions['Choice']!.anyOf).toEqual([{}, { type: 'string' }]);
  });

  it('keeps `items` on an array definition whose element parses to nothing', () => {
    const arr = zv3.array(emptySlot());

    const schema = zodToJsonSchema(zv3.object({ value: arr }), {
      openaiStrictMode: true,
      definitions: { Arr: arr },
    }) as { definitions: Record<string, JsonSchema> };

    // `items: undefined` disappears in serialization and strict validation rejects
    // the result, so the key has to carry a real value.
    expect(schema.definitions['Arr']).toEqual({ type: 'array', items: {} });
    expect(JSON.parse(JSON.stringify(schema.definitions['Arr'])).items).toEqual({});
  });

  it('keeps the description on a definition that falls back to an empty schema', () => {
    const described = zv3
      .preprocess(() => undefined, zv3.void())
      .transform(() => 0)
      .optional()
      .describe('Tell the model this field normalizes to zero');

    const tool = zodRealtimeFunction({
      name: 'normalizer',
      parameters: zv3.object({ first: described, second: described }),
    }) as unknown as {
      parameters: { definitions: Record<string, JsonSchema>; properties: Record<string, JsonSchema> };
    };

    // The second property is a `$ref` to this definition, so losing the text here
    // takes the model-visible guidance for both fields with it.
    expect(tool.parameters.definitions['normalizer_properties_first']).toEqual({
      description: 'Tell the model this field normalizes to zero',
    });
    expect(tool.parameters.properties['second']).toEqual({
      $ref: '#/definitions/normalizer_properties_first',
    });
  });

  it('strips the never branch even when the definition carries a description', () => {
    const described = zv3.string().nullable().optional().describe('field guidance');

    const schema = zodResponseFormat(zv3.object({ a: zv3.string() }), 'p', {
      schemaDefinitions: { described },
    }).json_schema.schema as unknown as { definitions: Record<string, JsonSchema> };

    // `parseDef` puts `description` beside the generated `anyOf`, so a reducer that
    // only accepts a lone `anyOf` would leave `not` in strict output.
    expect(schema.definitions!['described']).toEqual({
      type: 'string',
      nullable: true,
      description: 'field guidance',
    });
  });

  it('strips a never branch nested inside a supplied container', () => {
    const arr = zv3.array(zv3.string().nullable().optional());

    const schema = zodResponseFormat(zv3.object({ a: zv3.string() }), 'p', {
      schemaDefinitions: { arr },
    }).json_schema.schema as unknown as { definitions: Record<string, JsonSchema> };

    // The container has no property origin, so its element keeps the standalone
    // spelling; strict mode still cannot carry the `not` down there.
    expect(schema.definitions!['arr']).toEqual({
      type: 'array',
      items: { type: 'string', nullable: true },
    });
    expect(JSON.stringify(schema.definitions!['arr'])).not.toContain('not');
  });

  it('leaves the branches of a definition that only wraps them', () => {
    // The property treatment is the outer optional wrapper and nothing below it.
    // Applied to every descendant, this union would lose its unconstrained branch
    // and the two properties sharing it would stop accepting the same values.
    const shared = zv3.union([emptySlot(), zv3.string()]);

    const tool = zodRealtimeFunction({
      name: 'f',
      parameters: zv3.object({ first: shared, second: shared }),
    }) as unknown as { parameters: { definitions: Record<string, JsonSchema> } };

    expect(tool.parameters.definitions['f_properties_first_anyOf_0']).toEqual({});
  });

  it('leaves literal JSON alone while reducing schema positions', () => {
    // A `default` is a value the caller declared, not a schema. Walking into it
    // would rewrite the value the helpers serialize.
    const literal = { anyOf: [{ not: {} }, { value: 'kept' }] };
    const withDefault = zv3
      .object({ v: zv3.string() })
      .default(literal as never)
      .nullable()
      .optional();

    const schema = zodToJsonSchema(zv3.object({ a: zv3.string() }), {
      openaiStrictMode: true,
      definitions: { withDefault },
    }) as { definitions: Record<string, JsonSchema> };

    expect(JSON.stringify(schema.definitions!['withDefault'])).toContain(
      JSON.stringify({ default: literal }).slice(1, -1),
    );
    // The schema-level never branch is still gone.
    expect((schema.definitions!['withDefault'] as { anyOf?: unknown }).anyOf).not.toEqual([
      { not: {} },
      expect.anything(),
    ]);
  });

  it('still runs `override` for the definition it materializes', () => {
    const seen: string[] = [];
    const optional = zv3.string().nullable().optional();

    zodToJsonSchema(zv3.object({ a: zv3.string() }), {
      definitions: { optional },
      override: (def) => {
        seen.push(String((def as { typeName?: unknown }).typeName));
        return ignoreOverride;
      },
    });

    // Parsing the inner type directly instead of the wrapper would hide the
    // `ZodOptional` from the public override hook.
    expect(seen).toContain('ZodOptional');
  });

  it('carries `markdownDescription` onto the definition as well', () => {
    const described = zv3.string().nullable().optional().describe('guidance');

    const schema = zodToJsonSchema(zv3.object({ a: described, b: described }), {
      name: 'p',
      markdownDescription: true,
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
    }) as { definitions: Record<string, JsonSchema> };

    // The inline occurrence gets both from `addMeta`; the definition the second
    // property points at has to match it.
    expect(schema.definitions!['p_properties_a']).toEqual({
      type: ['string', 'null'],
      description: 'guidance',
      markdownDescription: 'guidance',
    });
  });

  it('does not let a sibling constraint override the branch it collapses into', () => {
    // An `override` may return a union with a validation keyword beside it. Both
    // apply, so spreading the outer one over the branch would widen the schema.
    const shared = zv3.string().nullable().optional();

    const schema = zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
      name: 'p',
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
      override: (def, _refs, _seen, forceResolution) =>
        forceResolution && def === shared._def ?
          ({ anyOf: [{ not: {} }, { type: 'string', maxLength: 3 }], maxLength: 5 } as JsonSchema7Type)
        : ignoreOverride,
    }) as { definitions: Record<string, JsonSchema> };

    // Both constraints applied before, so both have to survive. Collapsing here
    // would spread `maxLength: 5` over the branch's `maxLength: 3` and let
    // four-character strings through, so the union is left standing instead.
    expect(JSON.stringify(schema.definitions!['p_properties_a'])).toContain('"maxLength":3');
    expect(schema.definitions!['p_properties_a']).toHaveProperty('anyOf');
  });

  it('keeps a `__proto__` entry in a schema map', () => {
    // The deep walk rebuilds schema maps. Plain assignment of a `__proto__` key
    // reaches the inherited setter, which drops the entry and installs it as the
    // object's prototype instead.
    const optional = zv3.string().nullable().optional();
    const withProto = {
      type: 'object',
      properties: JSON.parse('{"__proto__": {"type": "string"}, "ok": {"type": "number"}}'),
    };

    const schema = zodToJsonSchema(zv3.object({ a: zv3.string() }), {
      openaiStrictMode: true,
      definitions: { optional },
      override: (def, _refs, _seen, forceResolution) =>
        forceResolution && def === optional._def ? (withProto as JsonSchema7Type) : ignoreOverride,
    }) as { definitions: Record<string, { properties: Record<string, unknown> }> };

    expect(Object.keys(schema.definitions!['optional']!.properties).sort()).toEqual([
      '__proto__',
      'ok',
    ]);
  });

  it('still strips the wrapper for a definition extracted from a property', () => {
    const shared = zv3.string().nullable().optional();

    const schema = zodResponseFormat(zv3.object({ a: shared, b: shared }), 'p').json_schema
      .schema as unknown as { definitions: Record<string, JsonSchema> };

    expect(schema.definitions!['p_properties_a']).toEqual({ type: 'string', nullable: true });
  });
});
