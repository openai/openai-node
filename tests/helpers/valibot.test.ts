import { valibotResponseFormat } from 'openai/helpers/valibot';
import * as v from 'valibot';

const toJSON = (obj: unknown) => JSON.parse(JSON.stringify(obj));

describe('valibotResponseFormat', () => {
  it('generates a valid json_schema response format', () => {
    const result = valibotResponseFormat(
      v.object({
        city: v.string(),
        temperature: v.number(),
        units: v.picklist(['c', 'f']),
      }),
      'location',
    );

    expect(result.json_schema).toEqual({
      name: 'location',
      strict: true,
      schema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
          temperature: { type: 'number' },
          units: { enum: ['c', 'f'], type: 'string' },
        },
        required: ['city', 'temperature', 'units'],
        type: 'object',
      },
    });
  });

  it('supports nullable optional fields', () => {
    const result = valibotResponseFormat(
      v.object({
        city: v.string(),
        temperature: v.number(),
        units: v.optional(v.nullable(v.picklist(['c', 'f']))),
      }),
      'location',
    );

    expect(result.json_schema).toEqual({
      name: 'location',
      strict: true,
      schema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
          temperature: { type: 'number' },
          units: {
            anyOf: [
              { enum: ['c', 'f'], type: 'string' },
              { type: 'null' },
            ],
          },
        },
        required: ['city', 'temperature', 'units'],
        type: 'object',
      },
    });
  });

  it('allows description field to be passed in', () => {
    expect(
      valibotResponseFormat(
        v.object({
          city: v.string(),
        }),
        'city',
        { description: 'A city' },
      ).json_schema,
    ).toHaveProperty('description', 'A city');
  });

  test('complex nested schema', () => {
    const Table = v.picklist(['orders', 'customers', 'products']);

    const Column = v.picklist([
      'id',
      'status',
      'expected_delivery_date',
      'delivered_at',
      'shipped_at',
      'ordered_at',
      'canceled_at',
    ]);

    const Operator = v.picklist(['=', '>', '<', '<=', '>=', '!=']);

    const OrderBy = v.picklist(['asc', 'desc']);

    const DynamicValue = v.object({
      column_name: v.string(),
    });

    const Condition = v.object({
      column: v.string(),
      operator: Operator,
      value: v.union([v.string(), v.number(), DynamicValue]),
    });

    const Query = v.object({
      table_name: Table,
      columns: v.array(Column),
      conditions: v.array(Condition),
      order_by: OrderBy,
    });

    const result = valibotResponseFormat(Query, 'query');

    expect(result.json_schema).toEqual({
      name: 'query',
      strict: true,
      schema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
          columns: {
            items: {
              enum: [
                'id',
                'status',
                'expected_delivery_date',
                'delivered_at',
                'shipped_at',
                'ordered_at',
                'canceled_at',
              ],
              type: 'string',
            },
            type: 'array',
          },
          conditions: {
            items: {
              additionalProperties: false,
              properties: {
                column: { type: 'string' },
                operator: {
                  enum: ['=', '>', '<', '<=', '>=', '!='],
                  type: 'string',
                },
                value: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    {
                      additionalProperties: false,
                      properties: {
                        column_name: { type: 'string' },
                      },
                      required: ['column_name'],
                      type: 'object',
                    },
                  ],
                },
              },
              required: ['column', 'operator', 'value'],
              type: 'object',
            },
            type: 'array',
          },
          order_by: {
            enum: ['asc', 'desc'],
            type: 'string',
          },
          table_name: {
            enum: ['orders', 'customers', 'products'],
            type: 'string',
          },
        },
        required: ['table_name', 'columns', 'conditions', 'order_by'],
        type: 'object',
      },
    });
  });

  it('throws error on optional fields without nullable', () => {
    expect(() =>
      valibotResponseFormat(
        v.object({
          required: v.string(),
          optional: v.optional(v.string()),
        }),
        'schema',
      ),
    ).toThrow(
      /Zod field at `properties\/optional` uses `\.optional\(\)` without `\.nullable\(\)`/,
    );
  });

  it('throws error on nested optional fields without nullable', () => {
    expect(() =>
      valibotResponseFormat(
        v.object({
          foo: v.object({
            bar: v.array(v.object({ can_be_missing: v.optional(v.boolean()) })),
          }),
        }),
        'schema',
      ),
    ).toThrow(
      /Zod field at `properties\/foo\/properties\/bar\/items\/properties\/can_be_missing` uses `\.optional\(\)` without `\.nullable\(\)`/,
    );
  });

  it('does not throw on nullable optional fields', () => {
    expect(() =>
      valibotResponseFormat(
        v.object({
          union: v.optional(v.nullable(v.string())),
        }),
        'schema',
      ),
    ).not.toThrow();
  });
});
