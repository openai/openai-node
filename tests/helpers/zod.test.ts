import { zodResponseFormat } from 'openai/helpers/zod';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (!value || typeof value !== 'object') return refs;

  const maybeRef = (value as { $ref?: unknown }).$ref;
  if (typeof maybeRef === 'string') refs.push(maybeRef);

  for (const child of Object.values(value)) {
    collectRefs(child, refs);
  }

  return refs;
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

  it('does not emit whitespace in extracted definition refs', () => {
    const Thing = z.object({ id: z.string() });
    const Root = z.object({
      group: z.object({
        'Thing With Spaces': Thing,
        AnotherUsage: Thing,
      }),
    });

    const schema = zodResponseFormat(Root, 'example-scope').json_schema.schema as Record<string, unknown>;
    const definitions = (schema.definitions ?? schema.$defs ?? {}) as Record<string, unknown>;
    const refs = collectRefs(schema);

    expect(refs).not.toContainEqual(expect.stringMatching(/\s/));
    expect(Object.keys(definitions)).not.toContainEqual(expect.stringMatching(/\s/));

    for (const ref of refs) {
      const definitionName = ref.split('/').at(-1);
      expect(definitionName).toBeDefined();
      expect(definitions).toHaveProperty(definitionName as string);
    }
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
});
