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

    test('preserves existing additionalProperties value', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: true,
      };

      const strict = toStrictJsonSchema(schema);
      const diff = detailedDiff(schema, strict);

      expect(diff).toMatchInlineSnapshot(`
        {
          "added": {},
          "deleted": {},
          "updated": {},
        }
      `);
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

    test('throws error for optional properties without nullable', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Zod field at `properties/name` uses `.optional()` without `.nullable()` which is not supported by the API',
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
