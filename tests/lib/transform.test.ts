import { toStrictJsonSchema } from 'openai/lib/transform';
import { detailedDiff } from 'deep-object-diff';
import { JSONSchema } from 'openai/lib/jsonschema';

describe('toStrictJsonSchema', () => {
  describe('Root Schema Validation', () => {
    test('throws error if root schema is not an object', () => {
      const schema: any = { type: 'string' };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        "Root schema must have type: 'object' but got type: 'string'",
      );
    });

    test('throws error if root schema has no type', () => {
      const schema: any = { properties: {} };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        "Root schema must have type: 'object' but got type: undefined",
      );
    });
  });

  describe('Additional Properties', () => {
    test('adds additionalProperties: false to object schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });

    test('rejects additionalProperties: true', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: true,
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'must set `additionalProperties: false` to be compatible with strict Structured Outputs',
      );
    });

    test('rejects schema-valued additionalProperties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: { type: 'string' },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'must set `additionalProperties: false` to be compatible with strict Structured Outputs',
      );
    });

    test('adds additionalProperties: false to nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
        required: ['user'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "user": {
                "additionalProperties": false,
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });

    test('adds additionalProperties: false to nullable object type arrays', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: ['object', 'null'],
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
        required: ['user'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          user: {
            type: ['object', 'null'],
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        required: ['user'],
        additionalProperties: false,
      });
    });

    test('adds additionalProperties: false to implicit object schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
        required: ['user'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          user: {
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        required: ['user'],
        additionalProperties: false,
      });
    });

    test.each([
      ['true', true],
      ['schema-valued', { type: 'string' }],
    ])('rejects %s additionalProperties on implicit object schemas', (_name, additionalProperties) => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties,
          },
        },
        required: ['user'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'must set `additionalProperties: false` to be compatible with strict Structured Outputs',
      );
    });
  });

  describe('Required Properties', () => {
    test('makes all properties required when nullable', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          age: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "required": [
              "name",
              "age",
            ],
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });

    test('makes properties with null-valued literals required', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          constNull: { const: null },
          enumNull: { enum: [null] },
          nestedConstNull: { anyOf: [{ type: 'string' }, { const: null }] },
          nestedEnumNull: { anyOf: [{ type: 'string' }, { enum: [null] }] },
        },
      };

      expect(toStrictJsonSchema(schema).required).toEqual([
        'constNull',
        'enumNull',
        'nestedConstNull',
        'nestedEnumNull',
      ]);
    });

    test('only makes literal-constrained properties required when null satisfies the whole schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          validConstNull: { type: ['string', 'null'], const: null },
          validEnumNull: { type: ['string', 'null'], enum: ['ready', null] },
          invalidConstNull: { type: 'string', const: null },
          invalidEnumNull: { type: 'string', enum: ['ready', null] },
        },
        required: ['invalidConstNull', 'invalidEnumNull'],
      };

      expect(toStrictJsonSchema(schema).required).toEqual([
        'validConstNull',
        'validEnumNull',
        'invalidConstNull',
        'invalidEnumNull',
      ]);
    });

    test('rejects optional literal-constrained properties when another keyword excludes null', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ready', null] },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Schema field at `properties/status` uses `.optional()` without `.nullable()`',
      );
    });

    test('resolves pure local refs when checking nullable optional properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          NullableString: { type: ['string', 'null'] },
          Alias: { $ref: '#/$defs/NullableString' },
        },
        properties: {
          nickname: { $ref: '#/$defs/Alias' },
        },
      };

      expect(toStrictJsonSchema(schema).required).toEqual(['nickname']);
    });

    test('resolves local refs with annotation-only siblings when checking nullable optional properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          NullableString: { type: ['string', 'null'] },
        },
        properties: {
          nickname: {
            $ref: '#/$defs/NullableString',
            title: 'Nickname',
            description: 'A preferred name',
            default: null,
            examples: [null],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);

      expect(strict.required).toEqual(['nickname']);
      expect(strict.properties?.['nickname']).toMatchObject({
        type: ['string', 'null'],
        title: 'Nickname',
        description: 'A preferred name',
        examples: [null],
      });
    });

    test.each([
      ['missing', { $ref: '#/$defs/Missing' }],
      ['external', { $ref: 'https://example.com/schema.json#/$defs/NullableString' }],
      ['cyclic', { $ref: '#/$defs/Cyclic' }],
      ['sibling-constrained', { $ref: '#/$defs/NullableString', type: 'string' }],
    ])('conservatively rejects %s refs when checking nullable optional properties', (_name, property) => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          NullableString: { type: ['string', 'null'] },
          Cyclic: { $ref: '#/$defs/Cyclic' },
        },
        properties: {
          nickname: property as JSONSchema,
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Schema field at `properties/nickname` uses `.optional()` without `.nullable()`',
      );
    });

    test('throws error for optional properties without nullable', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Schema field at `properties/name` uses `.optional()` without `.nullable()` which is not supported by the API',
      );
    });
  });

  describe('Nested Schemas', () => {
    test('processes nested object properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
            required: ['street'],
          },
        },
        required: ['address'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "address": {
                "additionalProperties": false,
                "required": {
                  "1": "city",
                },
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });

    test('processes array items', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['tags'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "tags": {
                "items": {
                  "additionalProperties": false,
                },
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });

    test('processes tuple item schemas recursively', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tuple: {
            type: 'array',
            items: [
              { type: 'string' },
              {
                type: 'array',
                items: [
                  {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                  },
                ],
              },
            ],
          },
        },
        required: ['tuple'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          tuple: {
            type: 'array',
            items: [
              { type: 'string' },
              {
                type: 'array',
                items: [
                  {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                    additionalProperties: false,
                  },
                ],
              },
            ],
          },
        },
        required: ['tuple'],
        additionalProperties: false,
      });
    });
  });

  describe('anyOf Handling', () => {
    test('processes anyOf variants', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [
              {
                type: 'object',
                properties: { num: { type: 'number' } },
                required: ['num'],
              },
              {
                type: 'object',
                properties: { str: { type: 'string' } },
                required: ['str'],
              },
            ],
          },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "value": {
                "anyOf": {
                  "0": {
                    "additionalProperties": false,
                  },
                  "1": {
                    "additionalProperties": false,
                  },
                },
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });
  });

  describe('allOf Handling', () => {
    test('inlines single allOf variant', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            ],
          },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "value": {
                "additionalProperties": false,
                "properties": {
                  "name": {
                    "type": "string",
                  },
                },
                "required": [
                  "name",
                ],
                "type": "object",
              },
            },
          },
          "deleted": {
            "properties": {
              "value": {
                "allOf": undefined,
              },
            },
          },
          "updated": {},
        }
      `);
    });

    test('inlines a single allOf variant with annotation siblings', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            description: 'A string value',
            allOf: [{ type: 'string' }],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          value: {
            type: 'string',
            description: 'A string value',
          },
        },
        required: ['value'],
        additionalProperties: false,
      });
    });

    test('does not flatten a single allOf variant across sibling constraints', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            allOf: [{ type: 'number' }],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          value: {
            type: 'string',
            allOf: [{ type: 'number' }],
          },
        },
        required: ['value'],
        additionalProperties: false,
      });
    });

    test('processes multiple allOf variants', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
              {
                type: 'object',
                properties: { age: { type: 'number' } },
                required: ['age'],
              },
            ],
          },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "value": {
                "allOf": {
                  "0": {
                    "additionalProperties": false,
                  },
                  "1": {
                    "additionalProperties": false,
                  },
                },
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });
  });

  describe('$ref Resolution', () => {
    test('processes definitions', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: { $ref: '#/definitions/User' },
        },
        required: ['user'],
        definitions: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "definitions": {
              "User": {
                "additionalProperties": false,
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });
  });

  describe('$defs and definitions', () => {
    test('processes $defs schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: { $ref: '#/$defs/User' },
        },
        required: ['user'],
        $defs: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "$defs": {
      "User": {
        "additionalProperties": false,
      },
    },
    "additionalProperties": false,
  },
  "deleted": {},
  "updated": {},
}
`);
    });

    test('processes definitions schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {},
        definitions: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "definitions": {
              "User": {
                "additionalProperties": false,
              },
            },
            "required": [],
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });
  });

  describe('Complex Scenarios', () => {
    test('handles deeply nested schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
            required: ['level2'],
          },
        },
        required: ['level1'],
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {
            "additionalProperties": false,
            "properties": {
              "level1": {
                "additionalProperties": false,
                "properties": {
                  "level2": {
                    "additionalProperties": false,
                  },
                },
              },
            },
          },
          "deleted": {},
          "updated": {},
        }
      `);
    });
  });
});
