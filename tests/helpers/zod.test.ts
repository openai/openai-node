import { zodResponseFormat, zodTextFormat } from 'openai/helpers/zod';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

function expectDefinitionRefsToResolve(schema: Record<string, unknown>) {
  const definitions = (schema['definitions'] ?? {}) as Record<string, unknown>;

  const visit = (value: unknown, resolving: Set<string>) => {
    if (!value || typeof value !== 'object') return;

    const ref = (value as Record<string, unknown>)['$ref'];
    if (typeof ref === 'string') {
      const prefix = '#/definitions/';
      expect(ref.startsWith(prefix)).toBe(true);

      const name = ref.slice(prefix.length);
      const definition = definitions[name];
      expect(definition).toBeDefined();
      expect(resolving.has(name)).toBe(false);

      visit(definition, new Set(resolving).add(name));
      return;
    }

    for (const child of Object.values(value)) {
      visit(child, resolving);
    }
  };

  visit(schema, new Set());
}

describe.each([
  { version: 'v3', z: zv3 },
  { version: 'v4', z: zv4 as any as typeof zv3 },
])('zodResponseFormat (Zod $version)', ({ version, z }) => {
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
    if (version === 'v3') {
      expect(() =>
        zodResponseFormat(
          z.object({
            required: z.string(),
            optional: z.string().optional(),
            optional_and_nullable: z.string().optional().nullable(),
          }),
          'schema',
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        `"Zod field at \`#/definitions/schema/properties/optional\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required"`,
      );
    } else {
      expect(() =>
        zodResponseFormat(
          z.object({
            required: z.string(),
            optional: z.string().optional(),
            optional_and_nullable: z.string().optional().nullable(),
          }),
          'schema',
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        `"Zod field at \`properties/optional\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required"`,
      );
    }
  });

  it('throws error on nested optional fields', () => {
    if (version === 'v3') {
      expect(() =>
        zodResponseFormat(
          z.object({
            foo: z.object({ bar: z.array(z.object({ can_be_missing: z.boolean().optional() })) }),
          }),
          'schema',
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        `"Zod field at \`#/definitions/schema/properties/foo/properties/bar/items/properties/can_be_missing\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required"`,
      );
    } else {
      expect(() =>
        zodResponseFormat(
          z.object({
            foo: z.object({ bar: z.array(z.object({ can_be_missing: z.boolean().optional() })) }),
          }),
          'schema',
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        `"Zod field at \`properties/foo/properties/bar/items/properties/can_be_missing\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required"`,
      );
    }
  });

  it('does not warn on union nullable fields', () => {
    const consoleSpy = jest.spyOn(console, 'warn');
    consoleSpy.mockClear();

    zodResponseFormat(
      z.object({
        union: z.union([z.string(), z.null()]).optional(),
      }),
      'schema',
    );

    expect(consoleSpy).toHaveBeenCalledTimes(0);
  });

  if (version === 'v3') {
    it('fully resolves reused wrapper types', () => {
      const branded = z.string().brand<'BlockId'>();
      const caught = z.string().catch('fallback');
      const defaulted = z.string().default('fallback');
      const promised = z.promise(z.string());
      const readonly = z.string().readonly();
      const optionalNullable = z.string().nullable().optional();
      const lazy = z.lazy(() => z.string());
      const nullable = z.object({ value: z.string() }).nullable();
      const pipeline = z.string().pipe(z.string());

      const schema = zodTextFormat(
        z.object({
          brandedFirst: branded,
          brandedSecond: branded,
          caughtFirst: caught,
          caughtSecond: caught,
          defaultedFirst: defaulted,
          defaultedSecond: defaulted,
          promisedFirst: promised,
          promisedSecond: promised,
          readonlyFirst: readonly,
          readonlySecond: readonly,
          optionalNullableFirst: optionalNullable,
          optionalNullableSecond: optionalNullable,
          lazyFirst: lazy,
          lazySecond: lazy,
          nullableFirst: nullable,
          nullableSecond: nullable,
          pipelineFirst: pipeline,
          pipelineSecond: pipeline,
        }),
        'wrappers',
      ).schema as Record<string, unknown>;

      expectDefinitionRefsToResolve(schema);

      const properties = schema['properties'] as Record<string, { $ref?: string }>;
      const brandedRef = properties['brandedSecond']?.$ref;
      expect(brandedRef).toBeDefined();

      const definitions = schema['definitions'] as Record<string, unknown>;
      expect(definitions[brandedRef!.replace('#/definitions/', '')]).toMatchObject({ type: 'string' });
    });

    it('does not rebind shared inner types to wrapper definitions', () => {
      const base = z.string();
      const early = z.object({ value: base });
      const defaulted = base.default('fallback');
      const late = z.object({ value: base });

      const schema = zodTextFormat(
        z.object({
          earlyFirst: early,
          earlySecond: early,
          defaultedFirst: defaulted,
          defaultedSecond: defaulted,
          lateFirst: late,
          lateSecond: late,
        }),
        'wrapperState',
      ).schema as Record<string, any>;
      const definitions = schema['definitions'] as Record<string, any>;

      const lateRef = schema['properties']['lateSecond']['$ref'] as string;
      const lateDefinition = definitions[lateRef.replace('#/definitions/', '')];
      const valueRef = lateDefinition['properties']['value']['$ref'] as string;
      const valueDefinition = definitions[valueRef.replace('#/definitions/', '')];

      expect(valueDefinition).toEqual({ type: 'string' });
    });

    it('preserves intentional recursion through lazy types', () => {
      let recursive: zv3.ZodTypeAny;
      recursive = z.lazy(() =>
        z.object({
          value: z.string(),
          children: z.array(recursive),
        }),
      );

      const schema = zodTextFormat(
        z.object({
          first: recursive,
          second: recursive,
        }),
        'recursive',
      ).schema as Record<string, any>;
      const definitions = schema['definitions'] as Record<string, any>;

      const recursiveRef = schema['properties']['second']['$ref'] as string;
      const recursiveDefinition = definitions[recursiveRef.replace('#/definitions/', '')];

      expect(recursiveDefinition).toMatchObject({
        type: 'object',
        properties: {
          children: {
            type: 'array',
            items: { $ref: recursiveRef },
          },
        },
      });
    });
  }
});
