import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod/v4';

const strictHelpers = [
  {
    name: 'zodResponseFormat',
    create: (schema: any) => zodResponseFormat(schema, 'root'),
    getSchema: (result: any) => result.json_schema.schema,
  },
  {
    name: 'zodTextFormat',
    create: (schema: any) => zodTextFormat(schema, 'root'),
    getSchema: (result: any) => result.schema,
  },
  {
    name: 'zodFunction',
    create: (schema: any) => zodFunction({ name: 'root', parameters: schema }),
    getSchema: (result: any) => result.function.parameters,
  },
  {
    name: 'zodResponsesFunction',
    create: (schema: any) => zodResponsesFunction({ name: 'root', parameters: schema }),
    getSchema: (result: any) => result.parameters,
  },
];

const invalidRootSchemas = [
  {
    name: 'a string',
    type: 'string',
    v3: z3.string(),
    v4: z4.string(),
  },
  {
    name: 'an array',
    type: 'array',
    v3: z3.array(z3.string()),
    v4: z4.array(z4.string()),
  },
  {
    name: 'a union of objects',
    type: undefined,
    v3: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    v4: z4.union([z4.object({ first: z4.string() }), z4.object({ second: z4.number() })]),
  },
  {
    name: 'a discriminated union of objects',
    type: undefined,
    v3: z3.discriminatedUnion('kind', [
      z3.object({ kind: z3.literal('first'), first: z3.string() }),
      z3.object({ kind: z3.literal('second'), second: z3.number() }),
    ]),
    v4: z4.discriminatedUnion('kind', [
      z4.object({ kind: z4.literal('first'), first: z4.string() }),
      z4.object({ kind: z4.literal('second'), second: z4.number() }),
    ]),
  },
  {
    name: 'a nullable object',
    type: undefined,
    v3: z3.object({ value: z3.string() }).nullable(),
    v4: z4.object({ value: z4.string() }).nullable(),
  },
  {
    name: 'an unrestricted schema',
    type: undefined,
    v3: z3.any(),
    v4: z4.any(),
  },
];

const expectedRootError = (type?: string) =>
  `Root schema must have type: 'object' but got type: ${type ? `'${type}'` : 'undefined'}`;

interface RecursiveObject {
  value: string;
  children: RecursiveObject[];
}

const recursiveObject: z3.ZodType<RecursiveObject> = z3.lazy(() =>
  z3.object({
    value: z3.string(),
    children: z3.array(recursiveObject),
  }),
);

const validObjectRoots = [
  {
    name: 'a plain object',
    schema: z3.object({ value: z3.string() }),
  },
  {
    name: 'a lazy object',
    schema: z3.lazy(() => z3.object({ value: z3.string() })),
  },
  {
    name: 'a recursive lazy object',
    schema: recursiveObject,
  },
  {
    name: 'a refined object',
    schema: z3.object({ value: z3.string() }).refine(({ value }) => value.length > 0),
  },
  {
    name: 'a transformed object',
    schema: z3.object({ value: z3.string() }).transform(({ value }) => ({ value })),
  },
  {
    name: 'a defaulted object',
    schema: z3.object({ value: z3.string() }).default({ value: 'fallback' }),
  },
  {
    name: 'an object containing nested unions and arrays',
    schema: z3.object({
      values: z3.array(z3.union([z3.string(), z3.number()])),
      choice: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    }),
  },
];

const registeredRootCases = [
  {
    name: 'a directly registered object',
    wrapV3: (root: z3.ZodType) => root,
    wrapV4: (root: z4.ZodType) => root,
  },
  {
    name: 'a lazy registered object',
    wrapV3: (root: z3.ZodType) => z3.lazy(() => root),
    wrapV4: (root: z4.ZodType) => z4.lazy(() => root),
  },
];

describe.each(strictHelpers)('$name root schema validation', ({ create, getSchema }) => {
  it.each(invalidRootSchemas)('rejects $name equally for Zod v3 and v4', ({ type, v3, v4 }) => {
    const expectedError = expectedRootError(type);

    expect(() => create(v3)).toThrow(expectedError);
    expect(() => create(v4)).toThrow(expectedError);
  });

  it('rejects unsupported Zod v3 object intersections', () => {
    const intersection = z3.intersection(
      z3.object({ first: z3.string() }),
      z3.object({ second: z3.number() }),
    );

    expect(() => create(intersection)).toThrow(expectedRootError());
  });

  it('rejects optional Zod v3 objects that produce a root union', () => {
    expect(() => create(z3.object({ value: z3.string() }).optional())).toThrow(expectedRootError());
    expect(() => create(z4.object({ value: z4.string() }).optional())).not.toThrow();
  });

  it('reports every type in a Zod v3 primitive union', () => {
    expect(() => create(z3.union([z3.string(), z3.number()]))).toThrow(expectedRootError('string,number'));
  });

  it.each(validObjectRoots)('continues accepting $name', ({ schema }) => {
    const generatedSchema = getSchema(create(schema));

    expect(generatedSchema).toHaveProperty('type', 'object');
    expect(generatedSchema).not.toHaveProperty('$ref');
    expect(generatedSchema).not.toHaveProperty('nullable', true);
  });
});

describe.each(registeredRootCases)('strict response formats with $name', ({ wrapV3, wrapV4 }) => {
  it('materializes the registered root without mutating caller definitions', () => {
    const root = z3.object({ value: z3.string() });
    const other = z3.object({ other: z3.number() });
    const schemaDefinitions = { Root: root, Other: other };

    const { schema } = zodResponseFormat(wrapV3(root), 'response', { schemaDefinitions }).json_schema;

    expect(schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      definitions: {
        Root: { type: 'object', properties: { value: { type: 'string' } } },
        Other: { type: 'object', properties: { other: { type: 'number' } } },
      },
    });
    expect(schema).not.toHaveProperty('$ref');
    expect(schema).not.toHaveProperty('nullable', true);
    expect(schemaDefinitions).toEqual({ Root: root, Other: other });
    expect(schemaDefinitions.Root).toBe(root);
    expect(schemaDefinitions.Other).toBe(other);
  });

  it('accepts frozen caller definitions while preserving every schema identity', () => {
    const root = z3.object({ value: z3.string() });
    const other = z3.object({ other: z3.number() });
    const schemaDefinitions = Object.freeze({ Root: root, Other: other });

    const { schema } = zodResponseFormat(wrapV3(root), 'response', { schemaDefinitions }).json_schema;

    expect(schema).toMatchObject({ type: 'object', definitions: { Root: { type: 'object' } } });
    expect(schema).not.toHaveProperty('$ref');
    expect(schemaDefinitions.Root).toBe(root);
    expect(schemaDefinitions.Other).toBe(other);
    expect(Object.keys(schemaDefinitions)).toEqual(['Root', 'Other']);
  });

  it.each(['Root/part~value%25', 'Root%2Fpart', 'constructor', 'toString', 'response'])(
    'resolves the literal registered definition name %s',
    (definitionName) => {
      const root = z3.object({ value: z3.string() });
      const schemaDefinitions = Object.freeze({ [definitionName]: root });

      const { schema } = zodResponseFormat(wrapV3(root), 'response', { schemaDefinitions }).json_schema;
      const materializedDefinitions = (schema?.['definitions'] ?? {}) as Record<string, unknown>;

      expect(schema).toHaveProperty('type', 'object');
      expect(schema).not.toHaveProperty('$ref');
      expect(Object.getOwnPropertyDescriptor(materializedDefinitions, definitionName)?.value).toHaveProperty(
        'type',
        'object',
      );
      expect(schemaDefinitions[definitionName]).toBe(root);
    },
  );

  it('matches Zod v4 concrete-root and caller-identity behavior', () => {
    const root = z4.object({ value: z4.string() });
    const schemaDefinitions = Object.freeze({ Root: root });

    const { schema } = zodResponseFormat(wrapV4(root), 'response', { schemaDefinitions }).json_schema;

    expect(schema).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
    expect(schema).not.toHaveProperty('$ref');
    expect(schemaDefinitions.Root).toBe(root);
  });
});

it('preserves recursive references while materializing a registered lazy object root', () => {
  const schemaDefinitions = Object.freeze({ Root: recursiveObject });

  const { schema } = zodResponseFormat(recursiveObject, 'response', { schemaDefinitions }).json_schema;

  expect(schema).toMatchObject({
    type: 'object',
    properties: {
      value: { type: 'string' },
      children: { type: 'array', items: { $ref: '#/definitions/Root' } },
    },
    definitions: { Root: { type: 'object' } },
  });
  expect(schema).not.toHaveProperty('$ref');
  expect(schemaDefinitions.Root).toBe(recursiveObject);
});

it.each([
  { name: 'a registered string', schema: z3.string(), type: 'string' },
  { name: 'a registered array', schema: z3.array(z3.string()), type: 'array' },
  { name: 'a registered nullable object', schema: z3.object({ value: z3.string() }).nullable() },
])('rejects $name after resolving its definition', ({ schema, type }) => {
  expect(() => zodResponseFormat(schema, 'response', { schemaDefinitions: { Root: schema } })).toThrow(
    expectedRootError(type),
  );
});

it('preserves named object roots and escaped references to supplied definitions', () => {
  const shared = z3.object({ value: z3.string() });
  const format = zodResponseFormat(
    z3.object({ shared, values: z3.array(z3.union([z3.string(), z3.number()])) }),
    'named-root',
    {
      schemaDefinitions: {
        'shared/name~value%25': shared,
      },
    },
  );

  expect(format.json_schema.name).toBe('named-root');
  expect(format.json_schema.schema).toMatchObject({
    type: 'object',
    properties: {
      shared: { $ref: '#/definitions/shared~1name~0value%2525' },
      values: { type: 'array' },
    },
    definitions: {
      'shared/name~value%25': { type: 'object' },
    },
  });
});

describe('strict vendor converter root schemas', () => {
  it('materializes a root alias chain while retaining its definition map and root metadata', () => {
    const root = z3.object({ value: z3.string() });
    const alias = z3.object({ alias: z3.string() });
    const definitions = Object.freeze({ Root: root, Alias: alias });

    const schema = zodToJsonSchema(root, {
      name: 'response',
      nameStrategy: 'duplicate-ref',
      openaiStrictMode: true,
      definitions,
      override: (definition, _refs, _seen, forceResolution) => {
        if (!forceResolution) {
          return { $ref: '#/definitions/Root', title: 'root title' };
        }

        return definition === root._def
          ? { $ref: '#/definitions/Alias' }
          : { type: 'object', properties: { alias: { type: 'string' } }, additionalProperties: false };
      },
    });

    expect(schema).toMatchObject({
      type: 'object',
      title: 'root title',
      properties: { alias: { type: 'string' } },
      definitions: {
        Root: { $ref: '#/definitions/Alias' },
        Alias: { type: 'object' },
      },
    });
    expect(schema).not.toHaveProperty('$ref');
    expect(definitions.Root).toBe(root);
    expect(definitions.Alias).toBe(alias);
  });

  it.each([
    'https://example.com/schema.json#/definitions/Root',
    '#/different/Root',
    '#/definitions/Missing',
    '#/definitions/toString',
    '#/definitions/__proto__',
  ])('rejects unsafe or unresolved root references: %s', (reference) => {
    const root = z3.object({ value: z3.string() });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: (_definition, _refs, _seen, forceResolution) =>
          forceResolution ? { type: 'object', additionalProperties: false } : { $ref: reference },
      }),
    ).toThrow(expectedRootError());
  });

  it('rejects external root references even when they have an object-typed sibling', () => {
    const root = z3.object({ value: z3.string() });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: (_definition, _refs, _seen, forceResolution) =>
          forceResolution
            ? { type: 'object', additionalProperties: false }
            : { $ref: 'https://example.com/schema.json', type: 'object' },
      }),
    ).toThrow("Root schema must be a concrete object and cannot contain '$ref'");
  });

  it('rejects unresolved alias references even when they have an object-typed sibling', () => {
    const root = z3.object({ value: z3.string() });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: (_definition, _refs, _seen, forceResolution) =>
          forceResolution
            ? { $ref: '#/definitions/Missing', type: 'object' }
            : { $ref: '#/definitions/Root' },
      }),
    ).toThrow("Root schema must be a concrete object and cannot contain '$ref'");
  });

  it('rejects cyclic local root references without recursing indefinitely', () => {
    const root = z3.object({ value: z3.string() });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: () => ({ $ref: '#/definitions/Root' }),
      }),
    ).toThrow(/cyclic.*root|root.*cyclic/iu);
  });

  it('rejects accessor-backed reference targets without invoking their getters', () => {
    const root = z3.object({ value: z3.string() });
    let getterInvoked = false;
    const target = Object.defineProperty({ type: 'object' as const }, '$ref', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return '#/definitions/Root';
      },
    });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: (_definition, _refs, _seen, forceResolution) =>
          forceResolution ? target : { $ref: '#/definitions/Root' },
      }),
    ).toThrow(/accessor.*root|root.*accessor/iu);
    expect(getterInvoked).toBe(false);
  });

  it.each(['type', 'nullable'] as const)(
    'rejects accessor-backed %s validation keywords without invoking their getters',
    (keyword) => {
      const root = z3.object({ value: z3.string() });
      let getterInvoked = false;
      const target = Object.defineProperty({ type: 'object' as const }, keyword, {
        enumerable: true,
        get: () => {
          getterInvoked = true;
          return keyword === 'type' ? 'object' : true;
        },
      });

      expect(() =>
        zodToJsonSchema(root, {
          openaiStrictMode: true,
          definitions: { Root: root },
          override: (_definition, _refs, _seen, forceResolution) =>
            forceResolution ? target : { $ref: '#/definitions/Root' },
        }),
      ).toThrow('Accessor-backed root schema properties are not supported');
      expect(getterInvoked).toBe(false);
    },
  );

  it.each([
    { name: 'string', key: 'title' },
    { name: 'symbol', key: Symbol('unsafe root metadata') },
  ])('rejects accessor-backed $name root metadata without invoking its getter', ({ key }) => {
    const root = z3.object({ value: z3.string() });
    let getterInvoked = false;
    const reference = Object.defineProperty({ $ref: '#/definitions/Root' }, key, {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 'unsafe metadata';
      },
    });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        definitions: { Root: root },
        override: (_definition, _refs, _seen, forceResolution) =>
          forceResolution ? { type: 'object', additionalProperties: false } : reference,
      }),
    ).toThrow('Accessor-backed root schema properties are not supported');
    expect(getterInvoked).toBe(false);
  });

  it('rejects accessor-backed root references even without supplied definitions', () => {
    const root = z3.object({ value: z3.string() });
    let getterInvoked = false;
    const reference = Object.defineProperty({ type: 'object' as const }, '$ref', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return '#/definitions/Root';
      },
    });

    expect(() =>
      zodToJsonSchema(root, {
        openaiStrictMode: true,
        override: () => reference,
      }),
    ).toThrow("Root schema must be a concrete object and cannot contain '$ref'");
    expect(getterInvoked).toBe(false);
  });

  it('continues rejecting registered nullable OpenAPI3 object roots', () => {
    const root = z3.object({ value: z3.string() }).nullable();

    expect(() =>
      zodToJsonSchema(root, {
        target: 'openApi3',
        openaiStrictMode: true,
        definitions: { Root: root },
      }),
    ).toThrow(expectedRootError('object,null'));
  });

  it('keeps non-strict registered roots as references without changing legacy behavior', () => {
    const root = z3.object({ value: z3.string() });
    const definitions = { Root: root };

    expect(zodToJsonSchema(root, { definitions })).toMatchObject({
      $ref: '#/definitions/Root',
      definitions: { Root: { type: 'object' } },
    });
    expect(definitions.Root).toBe(root);
  });

  it('rejects named object roots that resolve to a root reference', () => {
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        name: 'named-object',
        openaiStrictMode: true,
      }),
    ).toThrow(expectedRootError());
  });

  it('continues accepting named object roots with duplicated references', () => {
    expect(
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        name: 'named-object',
        nameStrategy: 'duplicate-ref',
        openaiStrictMode: true,
      }),
    ).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
  });

  it('rejects nullable OpenAPI3 object roots', () => {
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }).nullable(), {
        target: 'openApi3',
        openaiStrictMode: true,
      }),
    ).toThrow(expectedRootError('object,null'));
  });
});

describe.each(['jsonSchema7', 'jsonSchema2019-09', 'openApi3'] as const)(
  'non-strict %s converter targets',
  (target) => {
    it('continues accepting unnamed non-object roots', () => {
      expect(zodToJsonSchema(z3.array(z3.string()), { target })).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
    });

    it('preserves named root references', () => {
      expect(zodToJsonSchema(z3.string(), { target, name: 'named-string' })).toMatchObject({
        $ref: '#/definitions/named-string',
        definitions: {
          'named-string': { type: 'string' },
        },
      });
    });

    it('continues accepting non-object roots with explicit non-strict mode', () => {
      expect(zodToJsonSchema(z3.string(), { target, openaiStrictMode: false })).toMatchObject({
        type: 'string',
      });
    });
  },
);

it('preserves non-strict OpenAPI3 nullable object roots', () => {
  expect(zodToJsonSchema(z3.object({ value: z3.string() }).nullable(), { target: 'openApi3' })).toMatchObject(
    {
      type: 'object',
      nullable: true,
    },
  );
});

describe('zodRealtimeFunction non-strict root schemas', () => {
  it('continues accepting a primitive Zod v3 root', () => {
    const tool = zodRealtimeFunction({ name: 'realtime-string', parameters: z3.string() });

    expect(tool.parameters).toMatchObject({ type: 'string' });
    expect(tool).not.toHaveProperty('strict');
  });

  it('continues accepting a Zod v3 array root', () => {
    const tool = zodRealtimeFunction({ name: 'realtime-array', parameters: z3.array(z3.string()) });

    expect(tool.parameters).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('continues accepting a Zod v3 union root', () => {
    const tool = zodRealtimeFunction({
      name: 'realtime-union',
      parameters: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    });

    expect(tool.parameters).toHaveProperty('anyOf');
  });
});
