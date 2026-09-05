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
    value.map((item, index) => collectNotPointers(item, `${path}/${index}`, pointers));
    return pointers;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'not') {
      pointers.push(`${path}/not`);
    }
    collectNotPointers(child, `${path}/${key.split('~').join('~0').split('/').join('~1')}`, pointers);
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

/** `definitions[name]`, asserted present so the tests can index it plainly. */
function definitionNamed(schema: unknown, name: string): Record<string, unknown> {
  const { definitions } = schema as { definitions?: Record<string, unknown> };
  expect(definitions).toBeDefined();
  const found = (definitions as Record<string, unknown>)[name];
  expect(found).toBeDefined();
  return found as Record<string, unknown>;
}

const emptySlot = () =>
  zv3
    .preprocess(() => undefined as unknown, zv3.void())
    .transform(() => 0)
    .optional();

const withOverride = (marker: any, node: any) => {
  const shared = zv3.string().nullable().optional();
  return zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
    name: 'p',
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    override: (def, _r, _s, _f) => (def === (marker as any)._def ? node : ignoreOverride),
  }) as any;
};

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

    expect(definitionNamed(schema, 'Optional')).toEqual({ anyOf: [{ not: {} }, { type: 'string' }] });
  });

  it('keeps the standalone encoding for a definition the caller supplied outright', () => {
    const optional = zv3.string().optional();

    const schema = zodToJsonSchema(zv3.object({ other: zv3.number() }), {
      definitions: { Optional: optional },
    }) as { definitions: Record<string, JsonSchema> };

    expect(definitionNamed(schema, 'Optional')).toEqual({ anyOf: [{ not: {} }, { type: 'string' }] });
  });

  // `items` is positional while `minItems`/`maxItems` come from the declared arity, so a
  // slot that parses to nothing has to stay as `{}`. Dropping it shifts every later
  // element and makes the document accept and reject the opposite arrays from the Zod
  // schema. The exported converter is reachable without the strict helpers' `ZodTuple`
  // rejection, so every position is covered here rather than assumed away.
  it('keeps every tuple position when the tuple is a supplied definition', () => {
    const tuple = zv3.tuple([emptySlot(), zv3.string()]);

    const schema = zodToJsonSchema(tuple, { definitions: { Tuple: tuple } }) as {
      definitions: Record<string, { items: JsonSchema[]; minItems: number; maxItems: number }>;
    };

    expect(definitionNamed(schema, 'Tuple')).toEqual({
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

    expect(definitionNamed(schema, 'Tuple')['items']).toEqual([{}, { type: 'string' }]);
  });

  it('keeps the unconstrained branch of a union definition', () => {
    const choice = zv3.union([emptySlot(), zv3.string()]);

    const schema = zodToJsonSchema(zv3.object({ value: choice }), {
      openaiStrictMode: true,
      definitions: { Choice: choice },
    }) as { definitions: Record<string, { anyOf: JsonSchema[] }> };

    // Without the empty branch the document rejects `{ value: 42 }`, which Zod accepts.
    expect(definitionNamed(schema, 'Choice')['anyOf']).toEqual([{}, { type: 'string' }]);
  });

  it('keeps `items` on an array definition whose element parses to nothing', () => {
    const arr = zv3.array(emptySlot());

    const schema = zodToJsonSchema(zv3.object({ value: arr }), {
      openaiStrictMode: true,
      definitions: { Arr: arr },
    }) as { definitions: Record<string, JsonSchema> };

    // `items: undefined` disappears in serialization and strict validation rejects
    // the result, so the key has to carry a real value.
    expect(definitionNamed(schema, 'Arr')).toEqual({ type: 'array', items: {} });
    expect((structuredClone(definitionNamed(schema, 'Arr')) as { items?: unknown }).items).toEqual({});
  });

  it('keeps the description on a definition that falls back to an empty schema', () => {
    const described = zv3
      .preprocess(() => undefined as unknown, zv3.void())
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
    expect(definitionNamed(tool.parameters, 'normalizer_properties_first')).toEqual({
      description: 'Tell the model this field normalizes to zero',
    });
    expect(tool.parameters.properties['second']).toEqual({
      $ref: '#/definitions/normalizer_properties_first',
    });
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

    expect(definitionNamed(tool.parameters, 'f_properties_first_anyOf_0')).toEqual({});
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
      openaiStrictMode: true,
      name: 'p',
      markdownDescription: true,
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
    }) as { definitions: Record<string, JsonSchema> };

    // The inline occurrence gets both from `addMeta`; the definition the second
    // property points at has to match it.
    expect(definitionNamed(schema, 'p_properties_a')).toEqual({
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
        forceResolution && def === shared._def
          ? ({ anyOf: [{ not: {} }, { type: 'string', maxLength: 3 }], maxLength: 5 } as JsonSchema7Type)
          : ignoreOverride,
    }) as { definitions: Record<string, JsonSchema> };

    // Both constraints applied before, so both have to survive. Collapsing here
    // would spread `maxLength: 5` over the branch's `maxLength: 3` and let
    // four-character strings through, so the union is left standing instead.
    expect(JSON.stringify(definitionNamed(schema, 'p_properties_a'))).toContain('"maxLength":3');
    expect(definitionNamed(schema, 'p_properties_a')).toHaveProperty('anyOf');
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

    const properties = definitionNamed(schema, 'optional')['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toHaveLength(2);
    expect(Object.keys(properties)).toContain('__proto__');
    expect(Object.keys(properties)).toContain('ok');
  });

  it('leaves the wrapper standing when a reference points inside it', () => {
    // Collapsing removes an `anyOf/1` segment from every pointer below it, and
    // references were generated against the uncollapsed shape. A redundant
    // `anyOf` still means what it says; a broken `$ref` does not.
    const shared = zv3.string().min(2);
    const maybe = zv3.object({ first: shared, second: shared }).optional();

    const schema = zodToJsonSchema(zv3.object({ value: zv3.number() }), {
      openaiStrictMode: true,
      definitions: { Maybe: maybe },
    }) as Record<string, unknown>;

    const pointer = (
      (
        (schema['definitions'] as Record<string, { anyOf?: { properties?: Record<string, JsonSchema> }[] }>)[
          'Maybe'
        ]?.anyOf?.[1]?.properties?.['second'] as { $ref?: string }
      )?.$ref ?? ''
    ).replace('#/', '');

    expect(pointer).toBeTruthy();
    let resolved: unknown = schema;
    for (const key of pointer.split('/')) {
      resolved = (resolved as Record<string, unknown>)?.[key];
    }
    expect(resolved).toBeDefined();
  });

  it('does not invoke accessors on a schema an override returned', () => {
    // Reading one runs caller code before anything has validated it, and a
    // throwing getter would take the conversion down.
    let reads = 0;
    const definition = zv3.string();
    const custom: Record<string, unknown> = { type: 'object' };
    Object.defineProperty(custom, 'properties', {
      enumerable: true,
      get() {
        reads += 1;
        return { value: { type: 'string' } };
      },
    });

    zodToJsonSchema(zv3.object({ value: zv3.string() }), {
      openaiStrictMode: true,
      definitions: { definition },
      override: (def, _refs, _seen, forceResolution) =>
        forceResolution && def === definition._def ? (custom as unknown as JsonSchema7Type) : ignoreOverride,
    });

    expect(reads).toBe(0);
  });

  it('uses the context a supplied definition is first referenced from', () => {
    // Pre-seeded from `definitions`, so its `Seen` entry carries no context until
    // something references it. Here that is a property, and the extracted
    // definition has to be encoded the way the property spells it.
    const shared = zv3.string().nullable().optional();

    const schema = zodResponseFormat(zv3.object({ a: shared, b: shared }), 'p', {
      schemaDefinitions: { shared },
    }).json_schema.schema as unknown as Record<string, unknown>;

    expect(definitionNamed(schema, 'shared')).toEqual({ type: 'string', nullable: true });
  });

  it('reaches optionality spelled inside a nullable wrapper', () => {
    // `z.string().optional().nullable()` puts the union inside. Inline the inner
    // wrapper is dropped, so the extracted definition has to match.
    const shared = zv3.string().optional().nullable();

    const schema = zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
      openaiStrictMode: true,
      definitions: { shared },
    }) as Record<string, unknown>;

    expect(definitionNamed(schema, 'shared')).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('does not invoke accessors on the branch it collapses into', () => {
    let reads = 0;
    const shared = zv3.string().nullable().optional();
    const surviving: Record<string, unknown> = { type: 'string' };
    Object.defineProperty(surviving, 'nullable', {
      enumerable: true,
      get() {
        reads += 1;
        return true;
      },
    });

    zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
      name: 'p',
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
      override: (def, _refs, _seen, forceResolution) =>
        forceResolution && def === shared._def
          ? ({ anyOf: [{ not: {} }, surviving] } as unknown as JsonSchema7Type)
          : ignoreOverride,
    });

    expect(reads).toBe(0);
  });

  it('checks every wrapper path the collapse would remove, not just the outer one', () => {
    // Stepping through a nullable puts the wrapper a level down, so the pointer
    // aims at `anyOf/0/anyOf/1` and a guard built only from the outer path would
    // miss it.
    const leaf = zv3.string().min(2);
    const maybe = zv3.object({ first: leaf, second: leaf }).optional().nullable();

    const schema = zodToJsonSchema(zv3.object({ v: zv3.number() }), {
      openaiStrictMode: true,
      definitions: { maybe },
    }) as Record<string, unknown>;

    const pointers: string[] = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          collect(item);
        }
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const ref = (node as { $ref?: unknown }).$ref;
      if (typeof ref === 'string') {
        pointers.push(ref);
      }
      for (const key of Object.keys(node)) {
        collect((node as Record<string, unknown>)[key]);
      }
    };
    collect(definitionNamed(schema, 'maybe'));

    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      let resolved: unknown = schema;
      for (const key of pointer.replace('#/', '').split('/')) {
        resolved = (resolved as Record<string, unknown>)?.[key];
      }
      expect(resolved).toBeDefined();
    }
  });

  it('ignores a non-enumerable property the document would not carry', () => {
    // `JSON.stringify` emits own enumerable properties, so a non-enumerable
    // `anyOf` is not in the document being normalized.
    const shared = zv3.string().nullable().optional();
    const custom: Record<string, unknown> = { type: 'string' };
    Object.defineProperty(custom, 'anyOf', {
      enumerable: false,
      value: [{ not: {} }, { type: 'number' }],
    });

    const schema = zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
      name: 'p',
      $refStrategy: 'extract-to-root',
      nameStrategy: 'duplicate-ref',
      override: (def, _refs, _seen, forceResolution) =>
        forceResolution && def === shared._def ? (custom as unknown as JsonSchema7Type) : ignoreOverride,
    }) as Record<string, unknown>;

    expect(definitionNamed(schema, 'p_properties_a')).toEqual({ type: 'string' });
  });

  it('waits for every definition before committing a collapse', () => {
    // A definition materialized later can add a reference into a branch an
    // earlier collapse removed, so the decision cannot be made mid-loop.
    const leaf = zv3.object({ n: zv3.number() });
    const maybe = zv3.object({ value: leaf }).optional().nullable();
    const later = zv3.object({ value: leaf });

    const schema = zodToJsonSchema(zv3.object({ a: maybe, b: later }), {
      openaiStrictMode: true,
      definitions: { maybe, later },
    }) as Record<string, unknown>;

    const pointers: string[] = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          collect(item);
        }
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      const ref = (node as { $ref?: unknown }).$ref;
      if (typeof ref === 'string') {
        pointers.push(ref);
      }
      for (const key of Object.keys(node)) {
        collect((node as Record<string, unknown>)[key]);
      }
    };
    collect(schema);

    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      let resolved: unknown = schema;
      for (const key of pointer.replace('#/', '').split('/')) {
        resolved = (resolved as Record<string, unknown>)?.[key];
      }
      expect(resolved).toBeDefined();
    }
  });

  it('records the first reference context even when it is not a property', () => {
    // `propertyPath` is legitimately undefined for a reference outside a
    // property, so it cannot be the sentinel for "not yet recorded" -- a later
    // property reference would overwrite it and the definition would be
    // collapsed as though it had come from one.
    const shared = zv3.string().nullable().optional();

    const schema = zodToJsonSchema(zv3.union([zv3.array(shared), zv3.object({ value: shared })]), {
      definitions: { shared },
    }) as Record<string, unknown>;

    expect(definitionNamed(schema, 'shared')).toEqual({
      anyOf: [{ not: {} }, { type: ['string', 'null'] }],
    });
  });

  it('still strips the wrapper for a definition extracted from a property', () => {
    const shared = zv3.string().nullable().optional();

    const schema = zodResponseFormat(zv3.object({ a: shared, b: shared }), 'p').json_schema
      .schema as unknown as { definitions: Record<string, JsonSchema> };

    expect(definitionNamed(schema, 'p_properties_a')).toEqual({ type: 'string', nullable: true });
  });

  describe('references the converter must not strand', () => {
    // Each of these is a schema the base revision converts correctly. The
    // collapse must leave them exactly as they were rather than move a node out
    // from under a reference that names it.

    test('a relative reference keeps its wrapper', () => {
      const leaf = zv3.string().min(2);
      const maybe = zv3.object({ value: leaf }).optional();

      const schema = zodToJsonSchema(zv3.object({ first: leaf, second: maybe }), {
        $refStrategy: 'relative',
        definitions: { Maybe: maybe },
      }) as { definitions: Record<string, JsonSchema> };

      // The reference inside `Maybe` counts hops from where it sits, so moving
      // the node it sits under would silently change what it resolves to.
      expect(definitionNamed(schema, 'Maybe')).toHaveProperty('anyOf');
    });

    test('a reference under `dependencies` keeps its target', () => {
      const maybe = zv3.object({ value: zv3.string() }).optional();
      const other = zv3.number();

      const schema = zodToJsonSchema(zv3.object({ first: maybe, second: other }), {
        definitions: { Maybe: maybe },
        // A later Draft-7 shape the converter has to look inside: the reference
        // lives under `dependencies`, which the scan has to reach.
        override: (def, _refs, _seen, _force) =>
          def === (other as any)._def
            ? ({
                type: 'object',
                dependencies: {
                  whenPresent: { $ref: '#/definitions/Maybe/anyOf/1/properties/value' },
                },
              } as any)
            : ignoreOverride,
      }) as { definitions: Record<string, JsonSchema> };

      expect(definitionNamed(schema, 'Maybe')).toHaveProperty('anyOf');
    });

    test('an accessor-backed array entry is left alone', () => {
      const shared = zv3.string().nullable().optional();
      const branches: unknown[] = [{ not: {} }];
      Object.defineProperty(branches, '1', {
        enumerable: true,
        get() {
          throw new Error('boom');
        },
      });

      expect(() =>
        zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
          name: 'p',
          nameStrategy: 'duplicate-ref',
          $refStrategy: 'extract-to-root',
          override: (def, _refs, _seen, forceResolution) =>
            forceResolution && def === (shared as any)._def ? ({ anyOf: branches } as any) : ignoreOverride,
        }),
      ).not.toThrow();
    });
  });

  describe('inspection must not run caller code or rewrite an unreferenced alias', () => {
    test('1. custom Symbol.iterator is not invoked', () => {
      const shared = zv3.string().nullable().optional();
      const branches: unknown[] = [{ not: {} }, { type: ['string', 'null'] }];
      Object.defineProperty(branches, Symbol.iterator, {
        get() {
          throw new Error('iterator ran');
        },
      });
      expect(() =>
        zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
          name: 'p',
          nameStrategy: 'duplicate-ref',
          $refStrategy: 'extract-to-root',
          override: (def, _r, _s, force) =>
            force && def === (shared as any)._def ? ({ anyOf: branches } as any) : ignoreOverride,
        }),
      ).not.toThrow();
    });

    test('2. a nested toJSON that emits a $ref keeps the wrapper', () => {
      const shared = zv3.string().nullable().optional();
      const sneaky = { type: 'object', toJSON: () => ({ $ref: '#/definitions/p_properties_a/anyOf/1' }) };
      const marker = zv3.number();
      const out = zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        override: (def, _r, _s, _f) => (def === (marker as any)._def ? (sneaky as any) : ignoreOverride),
      }) as any;
      // Through the wire, so `toJSON` runs exactly as it would for a request.
      const wire = JSON.stringify(out);
      const serialized = JSON.parse(wire) as any;
      const target = serialized?.definitions?.p_properties_a;
      expect(target).toBeDefined();
      expect(target).toHaveProperty('anyOf');
    });

    test('3. an unreferenced alias keeps its standalone form', () => {
      const shared = zv3.string().nullable().optional();
      const out = zodToJsonSchema(zv3.object({ used: shared }), {
        definitions: { First: shared, Second: shared },
      }) as any;
      // `First` is never referenced from a property; it must keep the standalone spelling.
      expect(out.definitions.First).toHaveProperty('anyOf');
    });
  });

  describe('a reference the scan cannot read is still a reference', () => {
    test('361 accessor-backed $ref', () => {
      const marker = zv3.number();
      const node: any = { type: 'object' };
      Object.defineProperty(node, '$ref', {
        enumerable: true,
        get: () => '#/definitions/p_properties_a/anyOf/1',
      });
      const out = withOverride(marker, node);
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });

    test('377 inherited toJSON', () => {
      const marker = zv3.number();
      const proto = { toJSON: () => ({ $ref: '#/definitions/p_properties_a/anyOf/1' }) };
      const node = Object.create(proto);
      node.type = 'object';
      const out = withOverride(marker, node);
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });

    test('an accessor-backed schema child hides everything under it', () => {
      const marker = zv3.number();
      const node: any = { type: 'object' };
      Object.defineProperty(node, 'properties', {
        enumerable: true,
        get: () => ({ inner: { $ref: '#/definitions/p_properties_a/anyOf/1' } }),
      });
      const out = withOverride(marker, node);
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });

    test('365 URI-encoded reference', () => {
      const marker = zv3.number();
      const node = { type: 'object', $ref: '#%2Fdefinitions%2Fp_properties_a%2FanyOf%2F1' };
      const out = withOverride(marker, node);
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });
  });

  describe('what the collapse removes, and when it may decide', () => {
    test('317 reference into the discarded branch', () => {
      const shared = zv3.string().nullable().optional();
      const marker = zv3.number();
      const out: any = zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        override: (def, _r, _s, _f) =>
          def === (marker as any)._def
            ? ({ type: 'object', properties: { x: { $ref: '#/definitions/p_properties_a/anyOf/0' } } } as any)
            : ignoreOverride,
      });
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });

    test('332 array-level toJSON', () => {
      const shared = zv3.string().nullable().optional();
      const marker = zv3.number();
      const list: any[] = [{ type: 'string' }];
      (list as any).toJSON = () => [{ $ref: '#/definitions/p_properties_a/anyOf/1' }];
      const out: any = zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        override: (def, _r, _s, _f) =>
          def === (marker as any)._def ? ({ type: 'object', allOf: list } as any) : ignoreOverride,
      });
      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
    });

    test('a recursive definition keeps the encoding it had', () => {
      // A schema that refers back to itself materializes a definition whose
      // shape differs from the inline occurrence by more than the wrapper, so
      // whether removing the wrapper preserves meaning cannot be established
      // here. Leaving it is what the converter did before, and that is the
      // right answer for a form this fix cannot prove safe.
      const node: any = zv3
        .lazy(() => zv3.union([zv3.string(), zv3.array(node)]))
        .nullable()
        .optional();

      const out: any = zodToJsonSchema(zv3.object({ a: node, b: node }), {
        openaiStrictMode: true,
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
      });

      expect(out.definitions.p_properties_a).toHaveProperty('anyOf');
      expect(out.definitions.p_properties_a.anyOf[0]).toEqual({ not: {} });
    });

    test('an accessor inside a schema map is treated as a reference', () => {
      // `properties: { get x() { ... } }` puts the accessor on the entry, not
      // on `properties`, so reading the map yields `undefined` and the walk
      // stops there. Whether the getter returns a pointer into a branch this
      // rewrite is about to remove cannot be known without running caller
      // code, and `JSON.stringify` runs it afterwards. Its presence is enough
      // to leave the schema alone.
      const shared = zv3.string().nullable().optional();
      const marker = zv3.number();
      const supplied: any = {
        type: 'object',
        properties: {
          get x() {
            return { $ref: '#/definitions/p_properties_a/anyOf/1' };
          },
        },
      };

      const out: any = zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
        openaiStrictMode: true,
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        override: (def) => (def === (marker as any)._def ? supplied : ignoreOverride),
      });

      const wire = JSON.parse(JSON.stringify(out));
      expect(wire.definitions.p_properties_a).toHaveProperty('anyOf');
      expect(wire.definitions.p_properties_a.anyOf[1]).toBeDefined();
    });

    test('a strict helper is the only path this rewrites', () => {
      // Everything outside the strict helpers keeps the output it had.
      const shared = zv3.string().nullable().optional();
      const out: any = zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
      });
      expect(out.definitions.p_properties_a).toEqual({
        anyOf: [{ not: {} }, { type: ['string', 'null'] }],
      });
    });

    test.each([
      { name: 'undefined', value: undefined },
      { name: 'a function', value: () => 'fromWrapper' },
      { name: 'a symbol', value: Symbol('fromWrapper') },
    ])('a wrapper annotation holding $name does not erase the branch value', ({ value }) => {
      // Serialization drops all three from an object property, so the wrapper
      // never states one. Carrying it onto the branch would delete a
      // description the branch does state.
      const shared = zv3.string().nullable().optional();
      const supplied: any = {
        anyOf: [{ not: {} }, { type: 'string', description: 'inner' }],
        description: value,
      };

      const out: any = zodToJsonSchema(zv3.object({ a: shared, b: shared }), {
        openaiStrictMode: true,
        name: 'p',
        nameStrategy: 'duplicate-ref',
        $refStrategy: 'extract-to-root',
        override: (def, _refs, _seen, forceResolution) =>
          forceResolution && def === (shared as any)._def ? supplied : ignoreOverride,
      });

      expect(JSON.parse(JSON.stringify(out)).definitions.p_properties_a).toEqual({
        type: 'string',
        description: 'inner',
      });
    });

    test('112 branch order changes the result', () => {
      // Referenced from a property in one branch and from an array in the
      // other, so neither encoding is owed to every reference. Which branch
      // came first decided the answer while it was read off the first
      // recorded context.
      const shared = zv3.string().optional();
      const propertyFirst: any = zodToJsonSchema(
        zv3.union([zv3.object({ value: shared }), zv3.array(shared)]),
        { definitions: { shared } },
      );
      const arrayFirst: any = zodToJsonSchema(zv3.union([zv3.array(shared), zv3.object({ value: shared })]), {
        definitions: { shared },
      });
      expect(propertyFirst.definitions.shared).toEqual(arrayFirst.definitions.shared);
      expect(propertyFirst.definitions.shared).toEqual({
        anyOf: [{ not: {} }, { type: 'string' }],
      });
    });

    test('621 a strategy that emits no reference collapses nothing', () => {
      // `'none'` inlines every occurrence, so the definition is reached by the
      // conversion but pointed at by nothing. There is no property that owes
      // it the property encoding.
      const shared = zv3.string().optional();
      const out: any = zodToJsonSchema(zv3.object({ a: shared }), {
        $refStrategy: 'none',
        definitions: { shared },
      });
      expect(out.definitions.shared).toEqual({ anyOf: [{ not: {} }, { type: 'string' }] });
    });

    test('the alias a property points at is the one that collapses', () => {
      // One Zod def under two names. The property references exactly one of
      // them; the other is a standalone definition nothing reached, and
      // rewriting it would change a schema no reference names.
      const shared = zv3.string().nullable().optional();
      const out: any = zodToJsonSchema(zv3.object({ a: shared }), {
        openaiStrictMode: true,
        definitions: { First: shared, Second: shared },
      });
      expect(out.properties.a).toEqual({ $ref: '#/definitions/Second' });
      expect(out.definitions.Second).toEqual({ type: ['string', 'null'] });
      expect(out.definitions.First).toEqual({
        anyOf: [{ not: {} }, { type: ['string', 'null'] }],
      });
    });

    test('553 definition order changes the result', () => {
      const leaf = zv3.string().optional();
      const container = zv3.object({ inner: leaf });
      const first: any = zodToJsonSchema(zv3.object({ z: container }), {
        definitions: { Leaf: leaf, Container: container },
      });
      const second: any = zodToJsonSchema(zv3.object({ z: container }), {
        definitions: { Container: container, Leaf: leaf },
      });
      expect(first.definitions.Leaf).toEqual(second.definitions.Leaf);
    });
  });

  describe('a schema an override supplied can be any depth', () => {
    test('597 deep override schema does not blow the stack', () => {
      let deep: any = { type: 'string' };
      for (let i = 0; i < 20_000; i += 1) {
        deep = { not: deep };
      }
      const marker = zv3.number();
      expect(() =>
        zodToJsonSchema(zv3.object({ c: marker }), {
          definitions: { Deep: marker },
          override: (def, _r, _s, _f) => (def === (marker as any)._def ? deep : ignoreOverride),
        }),
      ).not.toThrow();
    });

    test('597b deep schema alongside a pending collapse', () => {
      let deep: any = { type: 'string' };
      for (let i = 0; i < 20_000; i += 1) {
        deep = { not: deep };
      }
      const shared = zv3.string().nullable().optional();
      const marker = zv3.number();
      expect(() =>
        zodToJsonSchema(zv3.object({ a: shared, b: shared, c: marker }), {
          name: 'p',
          nameStrategy: 'duplicate-ref',
          $refStrategy: 'extract-to-root',
          override: (def, _r, _s, _f) => (def === (marker as any)._def ? deep : ignoreOverride),
        }),
      ).not.toThrow();
    });
  });
});
