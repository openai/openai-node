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

const expectedRootError = (type?: string) =>
  `Root schema must have type: 'object' but got type: ${type ? `'${type}'` : 'undefined'}`;

interface RecursiveObject {
  value: string;
  children: RecursiveObject[];
}

const recursiveObject: z3.ZodType<RecursiveObject> = z3.lazy(() =>
  z3.object({ value: z3.string(), children: z3.array(recursiveObject) }),
);

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

describe.each(strictHelpers)('$name root schema validation', ({ create }) => {
  it.each(invalidRootSchemas)('rejects $name equally for Zod v3 and v4', ({ type, v3, v4 }) => {
    expect(() => create(v3)).toThrow(expectedRootError(type));
    expect(() => create(v4)).toThrow(expectedRootError(type));
  });

  it.each([
    { name: 'a plain object', schema: z3.object({ value: z3.string() }) },
    { name: 'a lazy object', schema: z3.lazy(() => z3.object({ value: z3.string() })) },
    { name: 'a recursive lazy object', schema: recursiveObject },
    {
      name: 'a transformed object',
      schema: z3.object({ value: z3.string() }).transform(({ value }) => ({ value })),
    },
    {
      name: 'an object containing nested unions',
      schema: z3.object({ values: z3.array(z3.union([z3.string(), z3.number()])) }),
    },
  ])('continues accepting $name', ({ schema }) => {
    expect(() => create(schema)).not.toThrow();
  });

  it('retains intersection, optional, and primitive-union diagnostics', () => {
    expect(() =>
      create(z3.intersection(z3.object({ first: z3.string() }), z3.object({ second: z3.number() }))),
    ).toThrow(expectedRootError());
    expect(() => create(z3.object({ value: z3.string() }).optional())).toThrow(expectedRootError());
    expect(() => create(z4.object({ value: z4.string() }).optional())).not.toThrow();
    expect(() => create(z3.union([z3.string(), z3.number()]))).toThrow(expectedRootError('string,number'));
  });
});

describe.each(['direct', 'lazy'] as const)('%s registered response-format roots', (kind) => {
  it('preserves frozen definitions and matches Zod v4 concrete-root behavior', () => {
    const root = z3.object({ value: z3.string() });
    const other = z3.object({ other: z3.number() });
    const schemaDefinitions = Object.freeze({ Root: root, Other: other });
    const wrapped = kind === 'lazy' ? z3.lazy(() => root) : root;
    const { schema } = zodResponseFormat(wrapped, 'response', { schemaDefinitions }).json_schema;

    expect(schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      definitions: { Root: { type: 'object' }, Other: { type: 'object' } },
    });
    expect(schema).not.toHaveProperty('$ref');
    expect(schemaDefinitions).toEqual({ Root: root, Other: other });

    const v4Root = z4.object({ value: z4.string() });
    const v4Definitions = Object.freeze({ Root: v4Root });
    const wrappedV4 = kind === 'lazy' ? z4.lazy(() => v4Root) : v4Root;
    const v4Schema = zodResponseFormat(wrappedV4, 'response', {
      schemaDefinitions: v4Definitions,
    }).json_schema.schema;
    expect(v4Schema).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
    expect(v4Definitions.Root).toBe(v4Root);
  });
});

it('preserves recursive registered roots and escaped definition names', () => {
  const schemaDefinitions = Object.freeze({ Root: recursiveObject });
  const recursive = zodResponseFormat(recursiveObject, 'response', { schemaDefinitions }).json_schema.schema;
  expect(recursive).toMatchObject({
    type: 'object',
    properties: { children: { type: 'array', items: { $ref: '#/definitions/response' } } },
    definitions: { Root: { type: 'object' }, response: { type: 'object' } },
  });
  expect(schemaDefinitions.Root).toBe(recursiveObject);

  const shared = z3.object({ value: z3.string() });
  const named = zodResponseFormat(z3.object({ shared }), 'named-root', {
    schemaDefinitions: { 'shared/name~value%25': shared },
  }).json_schema;
  expect(named.name).toBe('named-root');
  expect(named.schema).toMatchObject({
    properties: { shared: { $ref: '#/definitions/shared~1name~0value%2525' } },
    definitions: { 'shared/name~value%25': { type: 'object' } },
  });
});

it('rejects registered non-object roots without changing definitions', () => {
  const root = z3.string();
  const schemaDefinitions = Object.freeze({ Root: root });
  expect(() => zodResponseFormat(root, 'response', { schemaDefinitions })).toThrow(
    expectedRootError('string'),
  );
  expect(schemaDefinitions.Root).toBe(root);
});

const convertStrictRoot = (root: unknown) =>
  zodToJsonSchema(z3.object({ value: z3.string() }), {
    target: 'openApi3',
    openaiStrictMode: true,
    override: () => root as { type: 'object' },
  });

describe('canonical strict vendor-converter roots', () => {
  it.each([
    { name: 'an array', value: [] },
    { name: 'a callable', value: () => null },
    { name: 'a boxed string', value: Reflect.construct(String, ['value']) },
    { name: 'a boxed number', value: Reflect.construct(Number, [42]) },
    { name: 'a boxed boolean', value: Reflect.construct(Boolean, [true]) },
    { name: 'a boxed BigInt', value: Reflect.construct(Object, [Reflect.apply(BigInt, undefined, [1])]) },
    { name: 'a custom prototype', value: Object.create({ inherited: true }) as object },
  ])('rejects $name carriers through the same plain-record boundary', ({ value }) => {
    expect(() => convertStrictRoot(Object.assign(value, { type: 'object' as const }))).toThrow(
      'Root schema must be a plain JSON-schema record',
    );
  });

  it.each(['cyclic', 'fresh'] as const)('rejects a %s Proxy prototype after one inspection', (kind) => {
    let inspections = 0;
    const root: object = new Proxy(
      { type: 'object' as const },
      {
        getPrototypeOf() {
          inspections += 1;
          return kind === 'cyclic' ? root : new Proxy({}, {});
        },
      },
    );

    expect(() => convertStrictRoot(root)).toThrow('Root schema must be a plain JSON-schema record');
    expect(inspections).toBe(1);
  });

  it.each(['plain', 'null prototype'] as const)('owns and returns a stable %s root snapshot', (kind) => {
    const source: Record<string, unknown> =
      kind === 'plain'
        ? { type: 'object' }
        : Object.assign(Object.create(null) as object, { type: 'object' });
    const owned = convertStrictRoot(source);
    source['type'] = 'string';

    expect(owned).not.toBe(source);
    expect(JSON.stringify(owned)).toBe('{"type":"object"}');
  });

  it('neutralizes synthesized Proxy hooks and keyword reads by owning descriptor values', () => {
    const target: Record<string, unknown> = { type: 'object', nullable: false, $ref: undefined };
    const get = vi.fn((_subject: object, key: PropertyKey) =>
      key === 'toJSON' ? () => ({ type: 'string' }) : 'string',
    );
    const owned = convertStrictRoot(new Proxy(target, { get }));
    target['type'] = 'string';

    expect(get).not.toHaveBeenCalled();
    expect(JSON.stringify(owned)).toBe('{"type":"object","nullable":false}');
  });

  it.each(['type', 'nullable', '$ref', 'properties', 'toJSON'] as const)(
    'rejects an enumerable %s accessor without invoking it',
    (key) => {
      const root = { type: 'object' as const };
      const getter = vi.fn(() => (key === 'type' ? 'object' : true));
      Object.defineProperty(root, key, { enumerable: true, get: getter });

      expect(() => convertStrictRoot(root)).toThrow(`Root schema property '${key}' must be a data property`);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('rejects callable own serialization hooks without invoking them', () => {
    const toJSON = vi.fn(() => ({ type: 'string' }));
    expect(() => convertStrictRoot({ type: 'object', toJSON })).toThrow("callable 'toJSON'");
    expect(toJSON).not.toHaveBeenCalled();
  });

  it.each([Reflect.construct(Boolean, [true]), Reflect.construct(Boolean, [false]), null])(
    'rejects non-primitive nullable keyword %s',
    (nullable) => {
      expect(() => convertStrictRoot({ type: 'object', nullable })).toThrow("'nullable' must be a boolean");
    },
  );

  it.each([undefined, () => 'reference', Symbol('reference')])(
    'omits non-serializable root reference values',
    ($ref) => {
      const owned = convertStrictRoot({ type: 'object', $ref });
      expect(owned).not.toHaveProperty('$ref');
      expect(JSON.stringify(owned)).toBe('{"type":"object"}');
    },
  );

  it('rejects forced root references without activating assertion siblings', () => {
    expect(() =>
      convertStrictRoot({ type: 'object', $ref: '#/definitions/Root', additionalProperties: true }),
    ).toThrow("Root schema must be a concrete object and cannot contain '$ref'");
  });

  it('forces canonical resolution before supplied root-reference siblings', () => {
    const root = z3.object({ value: z3.string() });
    const schema = zodToJsonSchema(root, {
      openaiStrictMode: true,
      definitions: Object.freeze({ Root: root }),
      override: (_definition, _refs, _seen, forceResolution) =>
        forceResolution
          ? { type: 'object', properties: { value: { type: 'string' } } }
          : { $ref: '#/definitions/Root', type: 'object', additionalProperties: true },
    });

    expect(schema).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
    expect(schema).not.toHaveProperty('$ref');
  });

  it('rejects named root references while preserving duplicate-ref object roots', () => {
    const root = z3.object({ value: z3.string() });
    expect(() => zodToJsonSchema(root, { name: 'named', openaiStrictMode: true })).toThrow(
      expectedRootError(),
    );
    expect(
      zodToJsonSchema(root, { name: 'named', nameStrategy: 'duplicate-ref', openaiStrictMode: true }),
    ).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
  });

  it('rejects nullable OpenAPI3 roots', () => {
    const root = z3.object({ value: z3.string() }).nullable();
    expect(() => zodToJsonSchema(root, { target: 'openApi3', openaiStrictMode: true })).toThrow(
      expectedRootError('object,null'),
    );
  });
});

describe.each(['jsonSchema7', 'jsonSchema2019-09', 'openApi3'] as const)(
  'non-strict %s targets',
  (target) => {
    it('preserves unnamed, named, and explicitly non-strict non-object roots', () => {
      expect(zodToJsonSchema(z3.array(z3.string()), { target })).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
      expect(zodToJsonSchema(z3.string(), { target, name: 'named-string' })).toMatchObject({
        $ref: '#/definitions/named-string',
        definitions: { 'named-string': { type: 'string' } },
      });
      expect(zodToJsonSchema(z3.string(), { target, openaiStrictMode: false })).toMatchObject({
        type: 'string',
      });
    });
  },
);

it('preserves non-strict registered and nullable roots', () => {
  const root = z3.object({ value: z3.string() });
  const definitions = { Root: root };
  expect(zodToJsonSchema(root, { definitions })).toMatchObject({
    $ref: '#/definitions/Root',
    definitions: { Root: { type: 'object' } },
  });
  expect(definitions.Root).toBe(root);
  expect(zodToJsonSchema(root.nullable(), { target: 'openApi3' })).toMatchObject({
    type: 'object',
    nullable: true,
  });
});

it.each([
  { name: 'string', parameters: z3.string(), expected: { type: 'string' } },
  { name: 'array', parameters: z3.array(z3.string()), expected: { type: 'array' } },
  {
    name: 'union',
    parameters: z3.union([z3.object({ first: z3.string() }), z3.object({ second: z3.number() })]),
    expected: { anyOf: expect.any(Array) },
  },
])('keeps realtime $name roots non-strict', ({ name, parameters, expected }) => {
  const tool = zodRealtimeFunction({ name, parameters });
  expect(tool.parameters).toMatchObject(expected);
  expect(tool).not.toHaveProperty('strict');
});
