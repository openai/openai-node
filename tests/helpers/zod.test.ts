import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

describe('zodResponseFormat', () => {
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
          units: z.enum(['c', 'f']).optional(),
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
});
