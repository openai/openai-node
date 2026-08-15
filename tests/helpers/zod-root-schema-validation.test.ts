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
  },
  {
    name: 'zodTextFormat',
    create: (schema: any) => zodTextFormat(schema, 'root'),
  },
  {
    name: 'zodFunction',
    create: (schema: any) => zodFunction({ name: 'root', parameters: schema }),
  },
  {
    name: 'zodResponsesFunction',
    create: (schema: any) => zodResponsesFunction({ name: 'root', parameters: schema }),
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

describe.each(strictHelpers)('$name root schema validation', ({ create }) => {
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
    expect(() => create(schema)).not.toThrow();
  });
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
