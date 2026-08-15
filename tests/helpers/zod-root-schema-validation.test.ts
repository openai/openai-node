import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import { vi } from 'vitest';
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
  { name: 'zodResponseFormat', create: (schema: any) => zodResponseFormat(schema, 'root') },
  { name: 'zodTextFormat', create: (schema: any) => zodTextFormat(schema, 'root') },
  { name: 'zodFunction', create: (schema: any) => zodFunction({ name: 'root', parameters: schema }) },
  {
    name: 'zodResponsesFunction',
    create: (schema: any) => zodResponsesFunction({ name: 'root', parameters: schema }),
  },
];

const invalidRootSchemas = [
  { name: 'a string', type: 'string', v3: z3.string(), v4: z4.string() },
  { name: 'an array', type: 'array', v3: z3.array(z3.string()), v4: z4.array(z4.string()) },
  {
    name: 'a union of objects',
    v3: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    v4: z4.union([z4.object({ first: z4.string() }), z4.object({ second: z4.number() })]),
  },
  {
    name: 'a discriminated union of objects',
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
    v3: z3.object({ value: z3.string() }).nullable(),
    v4: z4.object({ value: z4.string() }).nullable(),
  },
  { name: 'an unrestricted schema', v3: z3.any(), v4: z4.any() },
];

const expectedRootError = (type?: string) =>
  `Root schema must have type: 'object' but got type: ${type ? `'${type}'` : 'undefined'}`;

interface RecursiveObject {
  value: string;
  children: RecursiveObject[];
}

const recursiveObject: z3.ZodType<RecursiveObject> = z3.lazy(() =>
  z3.object({ value: z3.string(), children: z3.array(recursiveObject) }),
);

const validObjectRoots = [
  { name: 'a plain object', schema: z3.object({ value: z3.string() }) },
  { name: 'a lazy object', schema: z3.lazy(() => z3.object({ value: z3.string() })) },
  { name: 'a recursive lazy object', schema: recursiveObject },
  {
    name: 'a refined object',
    schema: z3.object({ value: z3.string() }).refine(({ value }) => value.length > 0),
  },
  {
    name: 'a transformed object',
    schema: z3.object({ value: z3.string() }).transform(({ value }) => ({ value })),
  },
  { name: 'a defaulted object', schema: z3.object({ value: z3.string() }).default({ value: 'fallback' }) },
  {
    name: 'an object containing nested unions and arrays',
    schema: z3.object({
      values: z3.array(z3.union([z3.string(), z3.number()])),
      choice: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    }),
  },
];

describe.each(strictHelpers)('$name root schema validation', ({ create }) => {
  it.each(invalidRootSchemas)('rejects $name equally for Zod v3 and v4', ({ type, v3, v4 }) => {
    expect(() => create(v3)).toThrow(expectedRootError(type));
    expect(() => create(v4)).toThrow(expectedRootError(type));
  });

  it('rejects unsupported Zod v3 object intersections', () => {
    expect(() =>
      create(z3.intersection(z3.object({ first: z3.string() }), z3.object({ second: z3.number() }))),
    ).toThrow(expectedRootError());
  });

  it('rejects optional Zod v3 objects that produce a root union', () => {
    expect(() => create(z3.object({ value: z3.string() }).optional())).toThrow(expectedRootError());
    expect(() => create(z4.object({ value: z4.string() }).optional())).not.toThrow();
  });

  it('reports every type in a Zod v3 primitive union', () => {
    expect(() => create(z3.union([z3.string(), z3.number()]))).toThrow(expectedRootError('string,number'));
  });

  it.each(validObjectRoots)('continues accepting $name', ({ schema }) => {
    expect(() => create(schema)).not.toThrow();
  });
});

describe.each([
  { name: 'direct', wrapV3: (root: z3.ZodType) => root, wrapV4: (root: z4.ZodType) => root },
  {
    name: 'lazy',
    wrapV3: (root: z3.ZodType) => z3.lazy(() => root),
    wrapV4: (root: z4.ZodType) => z4.lazy(() => root),
  },
])('$name registered response-format roots', ({ wrapV3, wrapV4 }) => {
  it('preserves frozen definitions and matches Zod v4 concrete-root behavior', () => {
    const root = z3.object({ value: z3.string() });
    const other = z3.object({ other: z3.number() });
    const schemaDefinitions = Object.freeze({ Root: root, Other: other });
    const { schema } = zodResponseFormat(wrapV3(root), 'response', { schemaDefinitions }).json_schema;

    expect(schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      additionalProperties: false,
      definitions: { Root: { type: 'object' }, Other: { type: 'object' } },
    });
    expect(schema).not.toHaveProperty('$ref');
    expect(schemaDefinitions).toEqual({ Root: root, Other: other });

    const v4Root = z4.object({ value: z4.string() });
    const v4Definitions = Object.freeze({ Root: v4Root });
    const v4Schema = zodResponseFormat(wrapV4(v4Root), 'response', {
      schemaDefinitions: v4Definitions,
    }).json_schema.schema;

    expect(v4Schema).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
    expect(v4Schema).not.toHaveProperty('$ref');
    expect(v4Definitions.Root).toBe(v4Root);
  });
});

it('preserves recursive child references for frozen registered lazy roots', () => {
  const schemaDefinitions = Object.freeze({ Root: recursiveObject });
  const { schema } = zodResponseFormat(recursiveObject, 'response', { schemaDefinitions }).json_schema;

  expect(schema).toMatchObject({
    type: 'object',
    properties: { children: { type: 'array', items: { $ref: '#/definitions/response' } } },
    definitions: { Root: { type: 'object' }, response: { type: 'object' } },
  });
  expect(schema).not.toHaveProperty('$ref');
  expect(schemaDefinitions.Root).toBe(recursiveObject);
});

it.each([
  { name: 'a string', schema: z3.string(), type: 'string' },
  { name: 'an array', schema: z3.array(z3.string()), type: 'array' },
  { name: 'a nullable object', schema: z3.object({ value: z3.string() }).nullable(), type: undefined },
])('rejects registered $name roots', ({ schema, type }) => {
  expect(() => zodResponseFormat(schema, 'response', { schemaDefinitions: { Root: schema } })).toThrow(
    expectedRootError(type),
  );
});

it('preserves named object roots and escaped references to supplied definitions', () => {
  const shared = z3.object({ value: z3.string() });
  const format = zodResponseFormat(z3.object({ shared }), 'named-root', {
    schemaDefinitions: { 'shared/name~value%25': shared },
  });

  expect(format.json_schema.name).toBe('named-root');
  expect(format.json_schema.schema).toMatchObject({
    type: 'object',
    properties: { shared: { $ref: '#/definitions/shared~1name~0value%2525' } },
    definitions: { 'shared/name~value%25': { type: 'object' } },
  });
});

describe('strict vendor converter root schemas', () => {
  it.each([
    { name: 'an array', root: [], serialized: '[]' },
    { name: 'a boxed string', root: Reflect.construct(String, ['value']) as object, serialized: '"value"' },
    { name: 'a boxed number', root: Reflect.construct(Number, [42]) as object, serialized: '42' },
    { name: 'a boxed boolean', root: Reflect.construct(Boolean, [true]) as object, serialized: 'true' },
  ])('rejects $name roots that falsely claim to be objects', ({ root, serialized }) => {
    const overriddenRoot = Object.assign(root, { type: 'object' as const });

    expect(JSON.stringify(overriddenRoot)).toBe(serialized);
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        target: 'openApi3',
        openaiStrictMode: true,
        override: () => overriddenRoot as { type: 'object' },
      }),
    ).toThrow('Root schema must serialize to a JSON object');
  });

  it('rejects boxed BigInt roots before JSON serialization fails', () => {
    const boxedBigInt = Reflect.construct(Object, [Reflect.apply(BigInt, undefined, [1])]) as object;
    const overriddenRoot = Object.assign(boxedBigInt, {
      type: 'object' as const,
    });

    expect(() => JSON.stringify(overriddenRoot)).toThrow(TypeError);
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        target: 'openApi3',
        openaiStrictMode: true,
        override: () => overriddenRoot,
      }),
    ).toThrow('Root schema must serialize to a JSON object');
  });

  it('preserves strict object roots without a prototype', () => {
    const overriddenRoot = Object.assign(Object.create(null) as object, { type: 'object' as const });
    const schema = zodToJsonSchema(z3.object({ value: z3.string() }), {
      target: 'openApi3',
      openaiStrictMode: true,
      override: () => overriddenRoot,
    });

    expect(JSON.stringify(schema)).toBe('{"type":"object"}');
  });

  it.each([
    { keyword: 'type', value: 'object', visibility: 'inherited' },
    { keyword: 'type', value: 'object', visibility: 'non-enumerable' },
    { keyword: '$ref', value: '#/definitions/Root', visibility: 'inherited' },
    { keyword: '$ref', value: '#/definitions/Root', visibility: 'non-enumerable' },
    { keyword: 'nullable', value: true, visibility: 'inherited' },
    { keyword: 'nullable', value: true, visibility: 'non-enumerable' },
  ])('validates the serialized root when $keyword is $visibility', ({ keyword, value, visibility }) => {
    const overriddenRoot = Object.create(
      visibility === 'inherited' ? { [keyword]: value } : Object.prototype,
    );

    if (visibility === 'non-enumerable') {
      Object.defineProperty(overriddenRoot, keyword, { value, enumerable: false });
    }
    if (keyword !== 'type') {
      overriddenRoot.type = 'object';
    }

    const emittedRoot = JSON.stringify(overriddenRoot);
    const convert = () =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        target: 'openApi3',
        openaiStrictMode: true,
        override: () => overriddenRoot,
      });

    if (keyword === 'type') {
      expect(emittedRoot).toBe('{}');
      expect(convert).toThrow(expectedRootError());
    } else {
      expect(JSON.stringify(convert())).toBe(emittedRoot);
      expect(JSON.parse(emittedRoot)).toEqual({ type: 'object' });
    }
  });

  it.each([
    { keyword: 'type', value: 'object' },
    { keyword: '$ref', value: '#/definitions/Root' },
    { keyword: 'nullable', value: true },
  ])('rejects an enumerable $keyword accessor without invoking it', ({ keyword, value }) => {
    const overriddenRoot = { type: 'object' as const };
    const getter = vi.fn(() => value);

    Object.defineProperty(overriddenRoot, keyword, { enumerable: true, get: getter });

    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        openaiStrictMode: true,
        override: () => overriddenRoot,
      }),
    ).toThrow(`Root schema validation keyword '${keyword}' must be a data property`);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['own', 'inherited'])('rejects %s toJSON hooks that serialize a non-object root', (location) => {
    const toJSON = vi.fn().mockReturnValue({ type: 'string' });
    const overriddenRoot =
      location === 'own'
        ? { type: 'object' as const, toJSON }
        : Object.assign(Object.create({ toJSON }), { type: 'object' as const });

    expect(JSON.stringify(overriddenRoot)).toBe('{"type":"string"}');
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        openaiStrictMode: true,
        override: () => overriddenRoot,
      }),
    ).toThrow("Root schema cannot contain a callable or accessor-backed 'toJSON' property");
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it.each(['own', 'inherited'])('rejects %s toJSON accessors without invoking them', (location) => {
    const prototype = {};
    const overriddenRoot = Object.assign(Object.create(prototype), { type: 'object' as const });
    const getter = vi.fn(() => () => ({ type: 'string' }));

    Object.defineProperty(location === 'own' ? overriddenRoot : prototype, 'toJSON', { get: getter });

    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        openaiStrictMode: true,
        override: () => overriddenRoot,
      }),
    ).toThrow("Root schema cannot contain a callable or accessor-backed 'toJSON' property");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'undefined', value: undefined },
    { name: 'a function', value: () => '#/definitions/Root' },
    { name: 'a symbol', value: Symbol('reference') },
  ])('ignores an enumerable root reference containing $name because JSON omits it', ({ value }) => {
    const overriddenRoot = { type: 'object' as const, $ref: value };

    expect(JSON.stringify(overriddenRoot)).toBe('{"type":"object"}');
    const schema = zodToJsonSchema(z3.object({ value: z3.string() }), {
      target: 'openApi3',
      openaiStrictMode: true,
      override: () => overriddenRoot as { type: 'object' },
    });
    expect(JSON.stringify(schema)).toBe('{"type":"object"}');
  });

  it.each([
    { name: 'conflicting properties', sibling: { properties: { injected: { type: 'number' } } } },
    { name: 'additionalProperties: true', sibling: { additionalProperties: true } },
  ])('does not activate root reference siblings containing $name', ({ sibling }) => {
    const root = z3.object({ value: z3.string() });
    const schema = zodToJsonSchema(root, {
      openaiStrictMode: true,
      definitions: { Root: root },
      override: (_definition, _refs, _seen, forceResolution) =>
        forceResolution
          ? { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false }
          : { $ref: '#/definitions/Root', type: 'object', ...sibling },
    });

    expect(schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty('properties.injected');
  });

  it('rejects root references returned by forced overrides before activating assertion siblings', () => {
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), {
        openaiStrictMode: true,
        override: () => ({ $ref: '#/definitions/Root', type: 'object', additionalProperties: true }),
      }),
    ).toThrow("Root schema must be a concrete object and cannot contain '$ref'");
  });

  it('rejects named object roots that resolve to a root reference', () => {
    expect(() =>
      zodToJsonSchema(z3.object({ value: z3.string() }), { name: 'named-object', openaiStrictMode: true }),
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
    const root = z3.object({ value: z3.string() }).nullable();

    expect(() => zodToJsonSchema(root, { target: 'openApi3', openaiStrictMode: true })).toThrow(
      expectedRootError('object,null'),
    );
  });
});

describe.each(['jsonSchema7', 'jsonSchema2019-09', 'openApi3'] as const)(
  'non-strict %s targets',
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
        definitions: { 'named-string': { type: 'string' } },
      });
    });

    it('continues accepting non-object roots with explicit non-strict mode', () => {
      expect(zodToJsonSchema(z3.string(), { target, openaiStrictMode: false })).toMatchObject({
        type: 'string',
      });
    });
  },
);

it('preserves non-strict registered roots without cloning or changing caller definitions', () => {
  const root = z3.object({ value: z3.string() });
  const definitions = { Root: root };

  expect(zodToJsonSchema(root, { definitions })).toMatchObject({
    $ref: '#/definitions/Root',
    definitions: { Root: { type: 'object' } },
  });
  expect(definitions.Root).toBe(root);
});

it('preserves non-strict OpenAPI3 nullable object roots', () => {
  const root = z3.object({ value: z3.string() }).nullable();

  expect(zodToJsonSchema(root, { target: 'openApi3' })).toMatchObject({ type: 'object', nullable: true });
});

describe('zodRealtimeFunction non-strict root schemas', () => {
  it('continues accepting a primitive Zod v3 root', () => {
    const tool = zodRealtimeFunction({ name: 'realtime-string', parameters: z3.string() });

    expect(tool.parameters).toMatchObject({ type: 'string' });
    expect(tool).not.toHaveProperty('strict');
  });

  it('continues accepting a Zod v3 array root', () => {
    const tool = zodRealtimeFunction({ name: 'realtime-array', parameters: z3.array(z3.string()) });

    expect(tool.parameters).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('continues accepting a Zod v3 union root', () => {
    const parameters = z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]);

    expect(zodRealtimeFunction({ name: 'realtime-union', parameters }).parameters).toHaveProperty('anyOf');
  });
});
