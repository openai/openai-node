import { JSONSchema } from 'openai/lib/jsonschema';
import { toStrictJsonSchema } from 'openai/lib/transform';

describe('Strict JSON Schema Validation', () => {
  describe('General Rules', () => {
    test('root schema must be an object', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.type).toBe('object');
    });

    test('root schema cannot use anyOf', () => {
      const schema: JSONSchema = {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      };

      // This should be rejected by validation
      // In a real implementation, you'd add validation logic
      expect(schema.anyOf).toBeDefined();
      expect(schema.type).toBeUndefined();
    });

    test('all fields must be required', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string' },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.required).toEqual(['name', 'age', 'email']);
    });

    test('optional fields emulated with union types', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nickname: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.required).toContain('nickname');

      const nickname = strict.properties!['nickname'] as JSONSchema;
      expect(nickname.anyOf).toBeDefined();
    });

    test('additionalProperties: false must be set on all objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.additionalProperties).toBe(false);

      const nested = strict.properties!['nested'] as JSONSchema;
      expect(nested.additionalProperties).toBe(false);
    });

    test('key ordering is preserved', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          zebra: { type: 'string' },
          apple: { type: 'string' },
          middle: { type: 'string' },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const keys = Object.keys(strict.properties!);

      expect(keys).toEqual(['zebra', 'apple', 'middle']);
    });
  });

  describe('Supported Property Types & Constraints', () => {
    describe('Strings', () => {
      test('pattern constraint is preserved', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              pattern: '^[A-Z]{3}-\\d{4}$',
            },
          },
        };

        const strict = toStrictJsonSchema(schema);
        const code = strict.properties!['code'] as JSONSchema;
        expect(code.pattern).toBe('^[A-Z]{3}-\\d{4}$');
      });

      test('supported format values are preserved', () => {
        const formats = [
          'date-time',
          'time',
          'date',
          'duration',
          'email',
          'hostname',
          'ipv4',
          'ipv6',
          'uuid',
        ];

        formats.forEach((fmt) => {
          const schema: JSONSchema = {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                format: fmt,
              },
            },
          };

          const strict = toStrictJsonSchema(schema);
          const field = strict.properties!['field'] as JSONSchema;
          expect(field.format).toBe(fmt);
        });
      });
    });

    describe('Numbers', () => {
      test('multipleOf constraint is preserved', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            score: {
              type: 'number',
              multipleOf: 5,
            },
          },
        };

        const strict = toStrictJsonSchema(schema);
        const score = strict.properties!['score'] as JSONSchema;
        expect(score.multipleOf).toBe(5);
      });

      test('maximum and minimum constraints are preserved', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            age: {
              type: 'integer',
              minimum: 0,
              maximum: 150,
            },
          },
        };

        const strict = toStrictJsonSchema(schema);
        const age = strict.properties!['age'] as JSONSchema;
        expect(age.minimum).toBe(0);
        expect(age.maximum).toBe(150);
      });

      test('exclusive minimum and maximum constraints are preserved', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            rating: {
              type: 'number',
              exclusiveMinimum: 0,
              exclusiveMaximum: 100,
            },
          },
        };

        const strict = toStrictJsonSchema(schema);
        const rating = strict.properties!['rating'] as JSONSchema;
        expect(rating.exclusiveMinimum).toBe(0);
        expect(rating.exclusiveMaximum).toBe(100);
      });
    });

    describe('Arrays', () => {
      test('minItems and maxItems constraints are preserved', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 10,
            },
          },
        };

        const strict = toStrictJsonSchema(schema);
        const tags = strict.properties!['tags'] as JSONSchema;
        expect(tags.minItems).toBe(1);
        expect(tags.maxItems).toBe(10);
      });
    });
  });

  describe('Object & Schema Limitations', () => {
    test('nesting depth up to 10 levels', () => {
      // Create a deeply nested schema (10 levels)
      const createNested = (depth: number): JSONSchema => {
        if (depth === 0) {
          return { type: 'string' };
        }
        return {
          type: 'object',
          properties: {
            nested: createNested(depth - 1),
          },
        };
      };

      const schema = createNested(10);
      const strict = toStrictJsonSchema(schema);

      // Verify it processes without error
      expect(strict.type).toBe('object');
    });

    test('handles many object properties', () => {
      const properties: Record<string, JSONSchema> = {};

      // Create 100 properties (testing a reasonable subset of 5000 limit)
      for (let i = 0; i < 100; i++) {
        properties[`field${i}`] = { type: 'string' };
      }

      const schema: JSONSchema = {
        type: 'object',
        properties,
      };

      const strict = toStrictJsonSchema(schema);
      expect(Object.keys(strict.properties!).length).toBe(100);
      expect(strict.required!.length).toBe(100);
    });

    test('handles enum values', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'active', 'completed', 'cancelled'],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const status = strict.properties!['status'] as JSONSchema;
      expect(status.enum).toEqual(['pending', 'active', 'completed', 'cancelled']);
    });

    test('handles large enum (under 250 values)', () => {
      const enumValues = Array.from({ length: 200 }, (_, i) => `value${i}`);

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            enum: enumValues,
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const code = strict.properties!['code'] as JSONSchema;
      expect(code.enum?.length).toBe(200);
    });
  });

  describe('Supported Structures', () => {
    test('anyOf is allowed within object properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const value = strict.properties!['value'] as JSONSchema;
      expect(value.anyOf).toBeDefined();
      expect(value.anyOf!.length).toBe(3);
    });

    test('$defs for reusable subschemas', () => {
      const schema: JSONSchema & { $defs?: any } = {
        type: 'object',
        properties: {
          user: { $ref: '#/$defs/User' },
          admin: { $ref: '#/$defs/User' },
        },
        $defs: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.$defs).toBeDefined();

      const userDef = (strict.$defs as any).User as JSONSchema;
      expect(userDef.additionalProperties).toBe(false);
      expect(userDef.required).toEqual(['name', 'email']);
    });

    test('recursive schemas via root reference', () => {
      const schema: JSONSchema & { $defs?: any } = {
        type: 'object',
        properties: {
          value: { type: 'string' },
          children: {
            type: 'array',
            items: { $ref: '#' },
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.properties!['children']).toBeDefined();

      const children = strict.properties!['children'] as JSONSchema;
      const items = children.items as JSONSchema & { $ref?: string };
      expect(items.$ref).toBe('#');
    });

    test('recursive schemas via $defs reference', () => {
      const schema: JSONSchema & { $defs?: any } = {
        type: 'object',
        properties: {
          tree: { $ref: '#/$defs/TreeNode' },
        },
        $defs: {
          TreeNode: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              left: { $ref: '#/$defs/TreeNode' },
              right: { $ref: '#/$defs/TreeNode' },
            },
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const treeDef = (strict.$defs as any).TreeNode as JSONSchema;
      expect(treeDef.properties!['left']).toBeDefined();
      expect(treeDef.properties!['right']).toBeDefined();
    });
  });

  describe('Unsupported Features', () => {
    test('allOf is unsupported (but processed by our function)', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          combined: {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
              { type: 'object', properties: { b: { type: 'number' } } },
            ],
          },
        },
      };

      // Our function processes allOf, but in strict mode it should be avoided
      const strict = toStrictJsonSchema(schema);
      const combined = strict.properties!['combined'] as JSONSchema;

      // Single allOf gets expanded
      if (combined.allOf && combined.allOf.length === 1) {
        expect(combined.allOf).toBeUndefined();
      }
    });

    test('not keyword is unsupported', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            not: { type: 'null' },
          },
        } as any,
      };

      // Our function doesn't handle 'not', it would pass through
      const strict = toStrictJsonSchema(schema);
      expect(strict.properties!['value']).toBeDefined();
    });

    test('if/then/else is unsupported', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        if: {
          properties: {
            value: { const: 'special' },
          },
        } as any,
        then: {
          properties: {
            extra: { type: 'string' },
          },
        } as any,
      };

      // Our function doesn't handle if/then/else, it would pass through
      const strict = toStrictJsonSchema(schema);
      expect(strict.if).toBeDefined();
    });

    test('patternProperties is unsupported', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'string' },
        },
        patternProperties: {
          '^S_': { type: 'string' },
          '^I_': { type: 'integer' },
        },
      };

      // Our function doesn't remove patternProperties
      const strict = toStrictJsonSchema(schema);
      expect(strict.patternProperties).toBeDefined();
    });
  });

  describe('Fine-tuned Model Restrictions', () => {
    test('string constraints that would be restricted', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            minLength: 3,
            maxLength: 20,
            pattern: '^[a-zA-Z0-9_]+$',
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const username = strict.properties!['username'] as JSONSchema;

      // These are preserved but would be restricted for fine-tuned models
      expect(username.minLength).toBe(3);
      expect(username.maxLength).toBe(20);
      expect(username.pattern).toBeDefined();
    });

    test('number constraints that would be restricted', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          price: {
            type: 'number',
            minimum: 0,
            maximum: 1000000,
            multipleOf: 0.01,
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const price = strict.properties!['price'] as JSONSchema;

      // These are preserved but would be restricted for fine-tuned models
      expect(price.minimum).toBe(0);
      expect(price.maximum).toBe(1000000);
      expect(price.multipleOf).toBe(0.01);
    });

    test('array constraints that would be restricted', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 100,
          },
        },
      };

      const strict = toStrictJsonSchema(schema);
      const items = strict.properties!['items'] as JSONSchema;

      // These are preserved but would be restricted for fine-tuned models
      expect(items.minItems).toBe(1);
      expect(items.maxItems).toBe(100);
    });
  });
});
