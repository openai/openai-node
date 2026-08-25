import { vi } from 'vitest';
import { hasOwn } from 'openai/internal/utils/values';

import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { compareType, expectType } from '../utils/typing';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';
import { z as zv4Mini } from 'zod/v4-mini';

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (!value || typeof value !== 'object') {
    return refs;
  }

  const maybeRef = (value as { $ref?: unknown }).$ref;
  if (typeof maybeRef === 'string') {
    refs.push(maybeRef);
  }

  for (const child of Object.values(value)) {
    collectRefs(child, refs);
  }

  return refs;
}

function countEnumValues(value: unknown): number {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const child of value) {
      total += countEnumValues(child);
    }
    return total;
  }

  const record = value as Record<string, unknown>;
  const enumValues = Array.isArray(record['enum']) ? record['enum'].length : 0;
  let nestedEnumValues = 0;
  for (const child of Object.values(record)) {
    nestedEnumValues += countEnumValues(child);
  }
  return enumValues + nestedEnumValues;
}

function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  expect(pointer.startsWith('#/')).toBe(true);

  const tokens = decodeURIComponent(pointer.slice(2))
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));

  let value: unknown = root;
  for (const token of tokens) {
    expect(value).not.toBeNull();
    expect(typeof value).toBe('object');
    expect(hasOwn(value as object, token)).toBe(true);
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}

function expectDefinitionRefsToResolve(schema: Record<string, unknown>) {
  const visit = (value: unknown, resolving: Set<string>) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    const ref = (value as Record<string, unknown>)['$ref'];
    if (typeof ref === 'string') {
      const definition = resolveJsonPointer(schema, ref);
      expect(definition).toBeDefined();
      expect(resolving.has(ref)).toBe(false);

      visit(definition, new Set(resolving).add(ref));
      return;
    }

    for (const child of Object.values(value)) {
      visit(child, resolving);
    }
  };

  visit(schema, new Set());
}

it('converts Zod v4 discriminated unions to anyOf for strict schemas', () => {
  const ResponseSchema = zv4.object({
    data: zv4.discriminatedUnion('type', [
      zv4.object({ type: zv4.literal('a') }),
      zv4.object({ type: zv4.literal('b') }),
    ]),
  });

  const schema = zodResponseFormat(ResponseSchema, 'choice').json_schema.schema as any;

  expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  expect(schema.properties.data.anyOf).toHaveLength(2);
});

describe('Zod v4 mini', () => {
  const MiniSchema = zv4Mini.object({ hello: zv4Mini.literal('world') });
  const expectedSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      hello: {
        type: 'string',
        const: 'world',
      },
    },
    required: ['hello'],
    additionalProperties: false,
  };

  it('supports response formats', () => {
    const format = zodResponseFormat(MiniSchema, 'response');

    expect(format.json_schema.schema).toEqual(expectedSchema);
    expect(format.$parseRaw('{"hello":"world"}')).toEqual({ hello: 'world' });
    expect(() => format.$parseRaw('{"hello":"there"}')).toThrow();
  });

  it('supports text formats', () => {
    const format = zodTextFormat(MiniSchema, 'response');

    expect(format.schema).toEqual(expectedSchema);
    expect(format.$parseRaw('{"hello":"world"}')).toEqual({ hello: 'world' });
    expect(() => format.$parseRaw('{"hello":"there"}')).toThrow();
  });

  it('supports tool argument parsing', () => {
    const chatTool = zodFunction({ name: 'mini_tool', parameters: MiniSchema });
    const responseTool = zodResponsesFunction({ name: 'mini_tool', parameters: MiniSchema });
    const realtimeTool = zodRealtimeFunction({ name: 'mini_tool', parameters: MiniSchema });

    expect(chatTool.function.parameters).toEqual(expectedSchema);
    expect(chatTool.$parseRaw('{"hello":"world"}')).toEqual({ hello: 'world' });
    expect(() => chatTool.$parseRaw('{"hello":"there"}')).toThrow();

    expect(responseTool.parameters).toEqual(expectedSchema);
    expect(responseTool.$parseRaw('{"hello":"world"}')).toEqual({ hello: 'world' });
    expect(() => responseTool.$parseRaw('{"hello":"there"}')).toThrow();

    expect(realtimeTool).toMatchObject({
      type: 'function',
      name: 'mini_tool',
      parameters: {
        type: 'object',
        properties: expectedSchema.properties,
        required: ['hello'],
      },
    });
  });
});

describe('legacy Zod schema rejection', () => {
  const unsupportedSchema = zv3.object({ value: zv3.string() });
  // @ts-expect-error Zod v3 schemas are intentionally invalid public helper inputs.
  const legacySchema: zv4.ZodType = unsupportedSchema;

  it.each([
    {
      name: 'zodResponseFormat',
      create: () => zodResponseFormat(legacySchema, 'legacy'),
    },
    {
      name: 'zodTextFormat',
      create: () => zodTextFormat(legacySchema, 'legacy'),
    },
    {
      name: 'zodFunction',
      create: () => zodFunction({ name: 'legacy', parameters: legacySchema }),
    },
    {
      name: 'zodResponsesFunction',
      create: () => zodResponsesFunction({ name: 'legacy', parameters: legacySchema }),
    },
    {
      name: 'zodRealtimeFunction',
      create: () => zodRealtimeFunction({ name: 'legacy', parameters: legacySchema }),
    },
  ])('rejects Zod v3 schemas in $name', ({ create }) => {
    expect(create).toThrow(TypeError);
    expect(create).toThrow(/Zod v3 schemas are no longer supported/);
  });

  it('rejects Zod v3 schemas inside otherwise valid schema definitions', () => {
    const root = zv4.object({ value: zv4.string() });

    expect(() =>
      zodResponseFormat(root, 'mixed', {
        schemaDefinitions: { valid: root, legacy: legacySchema },
      }),
    ).toThrow(/schemaDefinitions\.legacy.*Zod v3 schemas are no longer supported/);
  });
});

describe('Zod v4 Classic validation errors', () => {
  const schema = zv4.object({ value: zv4.string() });

  it.each([
    { name: 'zodResponseFormat', parse: zodResponseFormat(schema, 'classic').$parseRaw },
    { name: 'zodTextFormat', parse: zodTextFormat(schema, 'classic').$parseRaw },
    { name: 'zodFunction', parse: zodFunction({ name: 'classic', parameters: schema }).$parseRaw },
    {
      name: 'zodResponsesFunction',
      parse: zodResponsesFunction({ name: 'classic', parameters: schema }).$parseRaw,
    },
  ])('preserves ZodError instances in $name', ({ parse }) => {
    expect(() => parse('{"value":42}')).toThrow(zv4.ZodError);
  });
});

describe('zodRealtimeFunction (Zod v4)', () => {
  const z = zv4;
  it('builds a Realtime function tool without strict', () => {
    const tool = zodRealtimeFunction({
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: z.object({
        location: z.string(),
        unit: z.enum(['c', 'f']),
      }),
    });

    expect(tool).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get the current weather',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          unit: { type: 'string', enum: ['c', 'f'] },
        },
        required: ['location', 'unit'],
      },
    });
    expect(tool).not.toHaveProperty('strict');
  });

  it('preserves optional and defaulted parameters in the non-strict schema', () => {
    const tool = zodRealtimeFunction({
      name: 'example',
      parameters: z.object({
        required: z.string(),
        optional: z.number().optional(),
        nullable: z.string().nullable(),
        defaulted: z.boolean().default(true),
      }),
    });

    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        required: { type: 'string' },
        optional: { type: 'number' },
        defaulted: { type: 'boolean', default: true },
      },
      required: ['required', 'nullable'],
    });
  });

  it('uses pipeline input schemas', () => {
    const tool = zodRealtimeFunction({
      name: 'example',
      parameters: z.object({
        value: z.string().transform(Number).pipe(z.number()),
      }),
    });

    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    });
    expect(tool.parameters).not.toHaveProperty('properties.value.allOf');
  });
});

it('preserves inferred output types', () => {
  const format = zodResponseFormat(zv4.object({ value: zv4.string() }), 'example');
  const parsed: { value: string } = format.$parseRaw('{"value":"ok"}');

  expect(parsed.value).toBe('ok');
});

describe('zodResponseFormat (Zod v4)', () => {
  const z = zv4;
  it('does the thing', () => {
    expect(
      zodResponseFormat(
        z.object({
          city: z.string(),
          temperature: z.number(),
          units: z.enum(['c', 'f']),
        }),
        'location',
      ).json_schema,
    ).toMatchInlineSnapshot(`
      {
        "name": "location",
        "schema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "properties": {
            "city": {
              "type": "string",
            },
            "temperature": {
              "type": "number",
            },
            "units": {
              "enum": [
                "c",
                "f",
              ],
              "type": "string",
            },
          },
          "required": [
            "city",
            "temperature",
            "units",
          ],
          "type": "object",
        },
        "strict": true,
      }
    `);
  });

  it('does not emit whitespace in extracted definition refs', () => {
    const ThingWithSpaces = z.object({ spaced: z.string() });
    const ThingWithUnderscores = z.object({ underscored: z.string() });
    const Root = z.object({
      group: z.object({
        'Thing With Spaces': ThingWithSpaces,
        Thing_With_Spaces: ThingWithUnderscores,
        anotherSpacedUsage: ThingWithSpaces,
        anotherUnderscoredUsage: ThingWithUnderscores,
      }),
    });

    const schema = zodResponseFormat(Root, 'example-scope').json_schema.schema as Record<string, unknown>;
    const definitions = (schema['definitions'] ?? schema['$defs'] ?? {}) as Record<string, unknown>;
    const refs = collectRefs(schema);
    const definitionNames = Object.keys(definitions);

    expect(refs).not.toContainEqual(expect.stringMatching(/\s/));
    expect(definitionNames).not.toContainEqual(expect.stringMatching(/\s/));

    for (const ref of refs) {
      const definitionName = ref.split('/').pop();
      expect(definitionName).toBeDefined();
      expect(definitions).toHaveProperty(definitionName as string);
    }
  });

  it('uses supplied schema definitions', () => {
    const fooValues = Array.from({ length: 200 }, (_, index) => 'foo_' + index) as [string, ...string[]];
    const barValues = Array.from({ length: 200 }, (_, index) => 'bar_' + index) as [string, ...string[]];
    const Foo = z.enum(fooValues);
    const Bar = z.enum(barValues);
    const schema = zodResponseFormat(
      z.object({
        foo: Foo,
        foos: z.array(Foo),
        bar: Bar,
        bars: z.array(Bar),
      }),
      'shared',
      { schemaDefinitions: { foo: Foo, bar: Bar } },
    ).json_schema.schema as Record<string, unknown>;

    expect(countEnumValues(schema)).toBe(fooValues.length + barValues.length);
    expect(collectRefs(schema)).not.toHaveLength(0);
    expectDefinitionRefsToResolve(schema);
  });

  it('keeps the response name separate from supplied schema definitions', () => {
    const Shared = z.object({ value: z.string() });
    const schema = zodResponseFormat(z.object({ first: Shared, second: Shared }), 'root', {
      schemaDefinitions: { root: Shared },
    }).json_schema.schema as Record<string, unknown>;

    expect(collectRefs(schema)).toContain('#/definitions/root');
    expectDefinitionRefsToResolve(schema);
  });

  it('escapes JSON Pointer tokens in supplied schema definition refs', () => {
    const Shared = z.object({ value: z.string() });
    const schema = zodResponseFormat(z.object({ first: Shared, second: Shared }), 'response', {
      schemaDefinitions: { 'foo/bar~baz': Shared },
    }).json_schema.schema as Record<string, unknown>;

    expect(collectRefs(schema)).toContain('#/definitions/foo~1bar~0baz');
    expectDefinitionRefsToResolve(schema);
  });

  it('URI-encodes supplied schema definition refs', () => {
    const Shared = z.object({ value: z.string() });
    const schema = zodResponseFormat(z.object({ first: Shared, second: Shared }), 'response', {
      schemaDefinitions: { 'foo%2Fbar': Shared },
    }).json_schema.schema as Record<string, unknown>;

    expect(collectRefs(schema)).toContain('#/definitions/foo%252Fbar');
    expectDefinitionRefsToResolve(schema);
  });

  it('rejects __proto__ as a supplied schema definition name', () => {
    const Shared = z.object({ value: z.string() });

    expect(() =>
      zodResponseFormat(z.object({ first: Shared, second: Shared }), 'response', {
        schemaDefinitions: { ['__proto__']: Shared },
      }),
    ).toThrow('schemaDefinitions cannot include "__proto__" as a definition name');
  });

  it('automatically adds optional properties to `required`', () => {
    expect(
      zodResponseFormat(
        z.object({
          city: z.string(),
          temperature: z.number(),
          units: z.enum(['c', 'f']).optional().nullable(),
        }),
        'location',
      ).json_schema,
    ).toMatchInlineSnapshot(`
      {
        "name": "location",
        "schema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "properties": {
            "city": {
              "type": "string",
            },
            "temperature": {
              "type": "number",
            },
            "units": {
              "anyOf": [
                {
                  "enum": [
                    "c",
                    "f",
                  ],
                  "type": "string",
                },
                {
                  "type": "null",
                },
              ],
            },
          },
          "required": [
            "city",
            "temperature",
            "units",
          ],
          "type": "object",
        },
        "strict": true,
      }
    `);
  });

  it('automatically adds properties with defaults to `required`', () => {
    expect(
      zodResponseFormat(
        z.object({
          city: z.string(),
          temperature: z.number(),
          units: z.enum(['c', 'f']).default('c'),
        }),
        'location',
      ).json_schema,
    ).toMatchInlineSnapshot(`
      {
        "name": "location",
        "schema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "properties": {
            "city": {
              "type": "string",
            },
            "temperature": {
              "type": "number",
            },
            "units": {
              "default": "c",
              "enum": [
                "c",
                "f",
              ],
              "type": "string",
            },
          },
          "required": [
            "city",
            "temperature",
            "units",
          ],
          "type": "object",
        },
        "strict": true,
      }
    `);
  });

  it('allows description field to be passed in', () => {
    expect(
      zodResponseFormat(
        z.object({
          city: z.string(),
        }),
        'city',
        { description: 'A city' },
      ).json_schema,
    ).toHaveProperty('description', 'A city');
  });

  test('kitchen sink types', () => {
    const Table = z.enum(['orders', 'customers', 'products']);

    const Column = z.enum([
      'id',
      'status',
      'expected_delivery_date',
      'delivered_at',
      'shipped_at',
      'ordered_at',
      'canceled_at',
    ]);

    const Operator = z.enum(['=', '>', '<', '<=', '>=', '!=']);

    const OrderBy = z.enum(['asc', 'desc']);

    const DynamicValue = z.object({
      column_name: z.string(),
    });

    const Condition = z.object({
      column: z.string(),
      operator: Operator,
      value: z.union([z.string(), z.number(), DynamicValue]),
    });

    const Query = z.object({
      table_name: Table,
      columns: z.array(Column),
      conditions: z.array(Condition),
      order_by: OrderBy,
    });

    expect(zodResponseFormat(Query, 'query').json_schema).toMatchInlineSnapshot(`
      {
        "name": "query",
        "schema": {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "properties": {
            "columns": {
              "items": {
                "enum": [
                  "id",
                  "status",
                  "expected_delivery_date",
                  "delivered_at",
                  "shipped_at",
                  "ordered_at",
                  "canceled_at",
                ],
                "type": "string",
              },
              "type": "array",
            },
            "conditions": {
              "items": {
                "additionalProperties": false,
                "properties": {
                  "column": {
                    "type": "string",
                  },
                  "operator": {
                    "enum": [
                      "=",
                      ">",
                      "<",
                      "<=",
                      ">=",
                      "!=",
                    ],
                    "type": "string",
                  },
                  "value": {
                    "anyOf": [
                      {
                        "type": "string",
                      },
                      {
                        "type": "number",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "column_name": {
                            "type": "string",
                          },
                        },
                        "required": [
                          "column_name",
                        ],
                        "type": "object",
                      },
                    ],
                  },
                },
                "required": [
                  "column",
                  "operator",
                  "value",
                ],
                "type": "object",
              },
              "type": "array",
            },
            "order_by": {
              "enum": [
                "asc",
                "desc",
              ],
              "type": "string",
            },
            "table_name": {
              "enum": [
                "orders",
                "customers",
                "products",
              ],
              "type": "string",
            },
          },
          "required": [
            "table_name",
            "columns",
            "conditions",
            "order_by",
          ],
          "type": "object",
        },
        "strict": true,
      }
    `);
  });

  it('throws error on optional fields', () => {
    expect(() =>
      zodResponseFormat(
        z.object({
          required: z.string(),
          optional: z.string().optional(),
          optional_and_nullable: z.string().optional().nullable(),
        }),
        'schema',
      ),
    ).toThrow(
      'Schema field at `properties/optional` uses `.optional()` without `.nullable()` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required',
    );
  });

  it('throws error on nested optional fields', () => {
    expect(() =>
      zodResponseFormat(
        z.object({
          foo: z.object({ bar: z.array(z.object({ can_be_missing: z.boolean().optional() })) }),
        }),
        'schema',
      ),
    ).toThrow(
      'Schema field at `properties/foo/properties/bar/items/properties/can_be_missing` uses `.optional()` without `.nullable()` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required',
    );
  });

  it('does not warn on union nullable fields', () => {
    const consoleSpy = vi.spyOn(console, 'warn');
    consoleSpy.mockClear();

    zodResponseFormat(
      z.object({
        union: z.union([z.string(), z.null()]).optional(),
      }),
      'schema',
    );

    expect(consoleSpy).toHaveBeenCalledTimes(0);
  });
});

function _typeTests() {
  const MiniSchema = zv4Mini.object({ hello: zv4Mini.literal('world') });
  type ParsedArguments = { hello: 'world' };

  expectType<ParsedArguments>(zodResponseFormat(MiniSchema, 'response').__output);
  expectType<ParsedArguments>(zodTextFormat(MiniSchema, 'response').__output);
  const chatTool = zodFunction({
    name: 'mini_tool',
    parameters: MiniSchema,
    function: (args) => expectType<ParsedArguments>(args),
  });
  const responseTool = zodResponsesFunction({
    name: 'mini_tool',
    parameters: MiniSchema,
    function: (args) => expectType<ParsedArguments>(args),
  });

  compareType<Parameters<NonNullable<typeof chatTool.$callback>>[0], ParsedArguments>(true);
  compareType<ReturnType<typeof chatTool.$parseRaw>, ParsedArguments>(true);
  compareType<typeof chatTool.__arguments, ParsedArguments>(true);
  compareType<Parameters<NonNullable<typeof responseTool.$callback>>[0], ParsedArguments>(true);
  compareType<ReturnType<typeof responseTool.$parseRaw>, ParsedArguments>(true);
  compareType<typeof responseTool.__arguments, ParsedArguments>(true);
}
