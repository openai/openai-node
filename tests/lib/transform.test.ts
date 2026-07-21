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

    test('normalizes singleton type arrays at root and nested positions', () => {
      const schema: JSONSchema = {
        type: ['object'],
        properties: {
          user: {
            type: ['object'],
            properties: {
              name: { type: ['string'] },
              nickname: { type: ['string', 'null'] },
            },
            required: ['name', 'nickname'],
          },
        },
        required: ['user'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              nickname: { type: ['string', 'null'] },
            },
            required: ['name', 'nickname'],
            additionalProperties: false,
          },
        },
        required: ['user'],
        additionalProperties: false,
      });
      expect(schema.type).toEqual(['object']);
    });

    test('inlines a root local object ref while retaining definitions', () => {
      const schema: JSONSchema = {
        $ref: '#/$defs/Input',
        $defs: {
          Input: {
            type: 'object',
            properties: {
              name: { $ref: '#/$defs/Name' },
            },
            required: ['name'],
          },
          Name: { type: 'string' },
        },
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          name: { $ref: '#/$defs/Name' },
        },
        required: ['name'],
        additionalProperties: false,
        $defs: {
          Input: {
            type: 'object',
            properties: {
              name: { $ref: '#/$defs/Name' },
            },
            required: ['name'],
            additionalProperties: false,
          },
          Name: { type: 'string' },
        },
      });
      expect(schema).not.toHaveProperty('type');
    });

    test('preserves root dialect and base metadata when inlining a local ref', () => {
      const schema: JSONSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/input.json',
        $ref: '#/$defs/Input',
        $defs: {
          Input: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/input.json',
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {
          Input: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      });
    });

    test('follows a root local ref chain before validating the object type', () => {
      const schema: JSONSchema = {
        $ref: '#/$defs/A',
        $defs: {
          A: { $ref: '#/$defs/B' },
          B: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {
          A: { $ref: '#/$defs/B' },
          B: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      });
    });

    test('preserves root ref-chain annotations with outer precedence', () => {
      const schema: JSONSchema = {
        $ref: '#/$defs/A',
        description: 'root description',
        $defs: {
          A: {
            $ref: '#/$defs/B',
            title: 'alias title',
            description: 'alias description',
          },
          B: {
            $ref: '#/$defs/Input',
            title: 'inner alias title',
            $comment: 'inner alias comment',
          },
          Input: {
            type: 'object',
            title: 'target title',
            description: 'target description',
            $comment: 'target comment',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        title: 'alias title',
        description: 'root description',
        $comment: 'inner alias comment',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {
          A: {
            $ref: '#/$defs/B',
            title: 'alias title',
            description: 'alias description',
          },
          B: {
            $ref: '#/$defs/Input',
            title: 'inner alias title',
            $comment: 'inner alias comment',
          },
          Input: {
            type: 'object',
            title: 'target title',
            description: 'target description',
            $comment: 'target comment',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      });
    });

    test.each(['$defs', 'definitions'] as const)(
      'preserves nested %s maps at their original pointer scope when inlining a root local ref',
      (keyword) => {
        const schema = {
          $ref: '#/' + keyword + '/Input',
          [keyword]: {
            Input: {
              type: 'object',
              [keyword]: { Nested: { type: 'string' } },
              properties: {
                nested: { $ref: '#/' + keyword + '/Input/' + keyword + '/Nested' },
                outer: { $ref: '#/' + keyword + '/Nested' },
              },
              required: ['nested', 'outer'],
            },
            Nested: { type: 'number' },
          },
        } as JSONSchema;

        expect(toStrictJsonSchema(schema)).toEqual({
          type: 'object',
          properties: {
            nested: { $ref: '#/' + keyword + '/Input/' + keyword + '/Nested' },
            outer: { $ref: '#/' + keyword + '/Nested' },
          },
          required: ['nested', 'outer'],
          additionalProperties: false,
          [keyword]: {
            Input: {
              type: 'object',
              [keyword]: { Nested: { type: 'string' } },
              properties: {
                nested: { $ref: '#/' + keyword + '/Input/' + keyword + '/Nested' },
                outer: { $ref: '#/' + keyword + '/Nested' },
              },
              required: ['nested', 'outer'],
              additionalProperties: false,
            },
            Nested: { type: 'number' },
          },
        });
      },
    );

    test('rejects cyclic root local ref chains', () => {
      const schema: JSONSchema = {
        $ref: '#/$defs/A',
        $defs: {
          A: { $ref: '#/$defs/B' },
          B: { $ref: '#/$defs/A' },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('Cyclic local $ref at `<root>`');
    });

    test('inlines root local ref chains exposed by singleton root allOf', () => {
      const schema: JSONSchema = {
        allOf: [{ $ref: '#/$defs/A' }],
        $defs: {
          A: { $ref: '#/$defs/Input' },
          Input: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {
          A: { $ref: '#/$defs/Input' },
          Input: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      });
    });

    test('normalizes root allOf branches exposed by local ref inlining', () => {
      const schema: JSONSchema = {
        allOf: [{ $ref: '#/$defs/A' }],
        $defs: {
          A: {
            allOf: [
              {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            ],
          },
        },
      };

      expect(toStrictJsonSchema(schema)).toMatchObject({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      });
    });

    test('rejects alternating root ref and allOf cycles', () => {
      const schema: JSONSchema = {
        allOf: [{ $ref: '#/$defs/A' }],
        $defs: {
          A: { allOf: [{ $ref: '#/$defs/A' }] },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('Cyclic local $ref');
    });

    test('rejects root local ref cycles exposed by singleton root allOf', () => {
      const schema: JSONSchema = {
        allOf: [{ $ref: '#/$defs/A' }],
        $defs: {
          A: { $ref: '#/$defs/B' },
          B: { $ref: '#/$defs/A' },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('Cyclic local $ref');
    });

    test.each([
      ['missing', '#/$defs/Missing', 'does not resolve to an object or boolean schema'],
      ['external', 'https://example.com/schema.json#/$defs/Input', 'External $ref at `<root>`'],
    ])('rejects %s targets in root local ref chains', (_name, ref, message) => {
      const schema: JSONSchema = {
        $ref: '#/$defs/A',
        $defs: { A: { $ref: ref } },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(message);
    });

    test('reports the root path for invalid root ref values and boolean targets', () => {
      expect(() => toStrictJsonSchema({ $ref: 1 } as unknown as JSONSchema)).toThrow(
        'Received non-string $ref - 1; path=<root>',
      );
      expect(() =>
        toStrictJsonSchema({
          $ref: '#/$defs/False',
          $defs: { False: false },
        }),
      ).toThrow('Expected object schema but got boolean; path=<root>');
    });

    test('normalizes a single root allOf object branch before validating the type', () => {
      const schema: JSONSchema = {
        allOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        ],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      });
    });

    test('merges compatible root allOf object branches before validating the type', () => {
      const schema: JSONSchema = {
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
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name', 'age'],
        additionalProperties: false,
      });
    });

    test('preserves root dialect and base metadata while merging root allOf branches', () => {
      const schema: JSONSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/input.json',
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
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/input.json',
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name', 'age'],
        additionalProperties: false,
      });
    });

    test('still rejects root allOf object branches that cannot be merged exactly', () => {
      const schema: JSONSchema = {
        allOf: [
          {
            type: 'object',
            properties: { shared: { type: 'string' } },
            required: ['shared'],
          },
          {
            type: 'object',
            properties: { shared: { type: 'number' } },
            required: ['shared'],
          },
        ],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'cannot be merged without changing Draft 7 validation',
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

    test('decodes complete URI fragments before splitting pointer tokens', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          'A/properties/B': { type: 'number' },
          A: {
            type: 'object',
            properties: {
              B: { type: ['string', 'null'] },
            },
            required: ['B'],
          },
        },
        properties: {
          value: { $ref: '#/$defs/A%2Fproperties%2FB' },
        },
      };

      const strict = toStrictJsonSchema(schema);

      expect(strict.required).toEqual(['value']);
      expect(strict.properties?.['value']).toEqual({ $ref: '#/$defs/A%2Fproperties%2FB' });
    });

    test('resolves literal slash keys only through JSON Pointer escaping', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          'A/properties/B': { type: 'string' },
          A: {
            type: 'object',
            properties: {
              B: { type: 'number' },
            },
            required: ['B'],
          },
        },
        properties: {
          value: { $ref: '#/$defs/A~1properties~1B' },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema).properties?.['value']).toEqual({
        $ref: '#/$defs/A~1properties~1B',
      });
    });

    test('rejects malformed URI encodings in local refs', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          Text: { type: 'string' },
        },
        properties: {
          value: { $ref: '#/$defs/Text%2' },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Local $ref at `properties/value` does not resolve to an object or boolean schema',
      );
    });

    test('rejects local refs into non-schema literal payloads', () => {
      const schema: JSONSchema = {
        type: 'object',
        default: { type: 'string' },
        properties: {
          value: { $ref: '#/default' },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Local $ref at `properties/value` does not resolve to an object or boolean schema',
      );
    });

    test('rejects boolean schemas reached through local refs', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: { $ref: '#/additionalProperties' },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Expected object schema but got boolean; path=properties/value',
      );
    });

    test('allows local refs into traversed schema array locations', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          source: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
          alias: { $ref: '#/properties/source/anyOf/0' },
        },
        required: ['source', 'alias'],
      };

      expect(toStrictJsonSchema(schema).properties?.['alias']).toEqual({
        $ref: '#/properties/source/anyOf/0',
      });
    });

    test('resolves local refs with $comment and other annotation-only siblings', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          NullableString: { type: ['string', 'null'] },
        },
        properties: {
          nickname: {
            $ref: '#/$defs/NullableString',
            $comment: 'Generated alias',
            title: 'Nickname',
            description: 'A preferred name',
            default: null,
            examples: [null],
          },
        },
      };

      const strict = toStrictJsonSchema(schema);

      expect(strict.required).toEqual(['nickname']);
      expect(strict.properties?.['nickname']).toEqual({
        $ref: '#/$defs/NullableString',
        $comment: 'Generated alias',
        title: 'Nickname',
        description: 'A preferred name',
        examples: [null],
      });
    });

    test.each(['$defs', 'definitions'] as const)(
      'retains nested %s maps beside local refs at their original pointer scope',
      (keyword) => {
        const ref = '#/properties/value/' + keyword + '/Value';
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            value: {
              $ref: ref,
              [keyword]: {
                Value: { type: 'string' },
              },
            },
          },
          required: ['value'],
        };

        const strictValue = toStrictJsonSchema(schema).properties?.['value'] as JSONSchema;

        expect(strictValue.$ref).toBe(ref);
        expect(strictValue[keyword]).toEqual({
          Value: { type: 'string' },
        });
      },
    );

    test('conservatively rejects cyclic refs when checking nullable optional properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          NullableString: { type: ['string', 'null'] },
          Cyclic: { $ref: '#/$defs/Cyclic' },
        },
        properties: {
          nickname: { $ref: '#/$defs/Cyclic' },
        },
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Schema field at `properties/nickname` uses `.optional()` without `.nullable()`',
      );
    });

    test('rejects unresolved local refs before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          nickname: { $ref: '#/$defs/Missing' },
        },
        required: ['nickname'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Local $ref at `properties/nickname` does not resolve to an object or boolean schema',
      );
    });

    test('rejects external refs before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          nickname: { $ref: 'https://example.com/schema.json#/$defs/NullableString' },
        },
        required: ['nickname'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'External $ref at `properties/nickname` is not supported in strict Structured Outputs',
      );
    });

    test.each([false, true])('rejects Draft 7 validation siblings on %s $ref properties', (isRequired) => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          Text: { type: 'string' },
        },
        properties: {
          value: { $ref: '#/$defs/Text', type: 'number' },
        },
        ...(isRequired ? { required: ['value'] } : {}),
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('has non-annotation siblings that Draft 7 ignores');
    });

    test('rejects required properties missing from properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name', 'age'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'requires property `age` but does not declare it in `properties`',
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

    test('rejects array schemas without items before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
          },
        },
        required: ['tags'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('declares an array without `items`');
    });

    test('rejects union-typed array schemas without items before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tags: {
            type: ['array', 'null'],
          },
        },
        required: ['tags'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('declares an array without `items`');
    });

    test('does not require items for schemas that do not declare arrays', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          label: {
            type: ['string', 'null'],
          },
        },
        required: ['label'],
      };

      expect(toStrictJsonSchema(schema).properties?.['label']).toEqual({
        type: ['string', 'null'],
      });
    });

    test('rejects tuple-form items before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tuple: {
            type: 'array',
            items: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: ['tuple'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('uses tuple-form `items`');
    });

    test('rejects additionalItems before returning a strict schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tuple: {
            type: 'array',
            items: { type: 'string' },
            additionalItems: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
        required: ['tuple'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword `additionalItems`');
    });

    test('rejects patternProperties schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            patternProperties: {
              '^x-': {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
              },
            },
            additionalProperties: false,
          },
        },
        required: ['metadata'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword `patternProperties`');
    });

    test('rejects uniqueItems schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        required: ['tags'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword `uniqueItems`');
    });

    test.each([
      ['contentEncoding', 'base64'],
      ['contentMediaType', 'application/json'],
    ] as const)('rejects unsupported %s schemas', (keyword, value) => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          payload: {
            type: 'string',
            [keyword]: value,
          },
        },
        required: ['payload'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(`uses unsupported keyword \`${keyword}\``);
    });

    test.each(['minProperties', 'maxProperties'] as const)('rejects %s schemas', (keyword) => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            [keyword]: 1,
          },
        },
        required: ['metadata'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(`uses unsupported keyword \`${keyword}\``);
    });

    test.each(['minContains', 'maxContains'] as const)(
      'rejects unsupported %s without contains',
      (keyword) => {
        const schema = {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              [keyword]: 1,
            },
          },
          required: ['values'],
        } as JSONSchema;

        expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword');
      },
    );

    test.each([
      [
        'contains',
        {
          type: 'array',
          contains: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      ],
      [
        'propertyNames',
        {
          type: 'object',
          properties: {},
          propertyNames: { type: 'string' },
          additionalProperties: false,
        },
      ],
      [
        'if/then/else',
        {
          type: 'object',
          properties: {},
          if: { type: 'object' },
          then: { type: 'object' },
          else: { type: 'object' },
          additionalProperties: false,
        },
      ],
      [
        'schema-valued dependencies',
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          dependencies: {
            value: {
              type: 'object',
              properties: { dependent: { type: 'string' } },
              required: ['dependent'],
            },
          },
          additionalProperties: false,
        },
      ],
      [
        'dependentSchemas',
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          dependentSchemas: {
            value: {
              type: 'object',
              properties: { dependent: { type: 'string' } },
              required: ['dependent'],
            },
          },
          additionalProperties: false,
        },
      ],
      [
        'dependentRequired',
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          dependentRequired: {
            value: ['dependent'],
          },
          additionalProperties: false,
        },
      ],
    ])('rejects unsupported nested %s schemas', (_name, propertySchema) => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: propertySchema as JSONSchema,
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword');
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

    test('removes a redundant array type from an anyOf wrapper', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'array',
            anyOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'array', items: { type: 'number' } },
            ],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema).properties?.['value']).toEqual({
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'array', items: { type: 'number' } },
        ],
      });
    });

    test('removes a redundant object type from an anyOf wrapper before closing branches', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'object',
            anyOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
                required: ['kind', 'foo'],
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
                required: ['kind', 'bar'],
              },
            ],
          },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);
      expect(strict.properties?.['value']).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
            required: ['kind', 'foo'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
            required: ['kind', 'bar'],
            additionalProperties: false,
          },
        ],
      });
    });

    test('removes empty object keywords from an untyped anyOf wrapper', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            properties: {},
            required: [],
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema).properties?.['value']).toEqual({
        anyOf: [{ type: 'string' }, { type: 'number' }],
      });
    });

    test('rejects non-empty object constraints on untyped anyOf wrappers', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            properties: { kind: { type: 'string' } },
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('Object anyOf schema');
    });

    test('rejects object anyOf wrappers whose own constraints cannot be preserved', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'object',
            properties: { kind: { type: 'string' } },
            required: ['kind'],
            anyOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'foo' }, foo: { type: 'string' } },
                required: ['kind', 'foo'],
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'bar' }, bar: { type: 'number' } },
                required: ['kind', 'bar'],
              },
            ],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'Object anyOf schema at `properties/value` cannot be represented',
      );
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

    test('removes a true singleton allOf branch without dropping annotations', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            description: 'Any value',
            allOf: [true],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          value: {
            description: 'Any value',
          },
        },
        required: ['value'],
        additionalProperties: false,
      });
    });

    test('rejects a false singleton allOf branch', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [false],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'uses `allOf: [false]`, which cannot be represented in strict Structured Outputs',
      );
    });

    test('uses array items introduced by a singleton allOf branch', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          values: {
            allOf: [{ type: 'array', items: { type: 'string' } }],
          },
        },
        required: ['values'],
      };

      expect(toStrictJsonSchema(schema).properties?.['values']).toEqual({
        type: 'array',
        items: { type: 'string' },
      });
    });

    test('preserves refs into allOf branches before flattening', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [{ type: 'string' }],
          },
          alias: { $ref: '#/properties/value/allOf/0' },
        },
        required: ['value', 'alias'],
      };

      const strict = toStrictJsonSchema(schema);

      expect(strict).toMatchObject({
        $defs: {
          __openai_strict_allOf_ref_0: { type: 'string' },
        },
        properties: {
          value: { type: 'string' },
          alias: { $ref: '#/$defs/__openai_strict_allOf_ref_0' },
        },
      });
      expect(JSON.stringify(strict)).not.toContain('"allOf"');
    });

    test('rejects refs to missing allOf branches', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [{ type: 'string' }],
          },
          alias: { $ref: '#/properties/value/allOf/1' },
        },
        required: ['value', 'alias'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow('does not resolve to an object or boolean schema');
    });

    test('rejects a single allOf variant with sibling constraints', () => {
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

      expect(() => toStrictJsonSchema(schema)).toThrow('uses unsupported keyword `allOf`');
    });

    test('merges compatible object allOf variants before closing them', () => {
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

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          value: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'number' } },
            required: ['name', 'age'],
            additionalProperties: false,
          },
        },
        required: ['value'],
        additionalProperties: false,
      });
    });

    test('merges compatible object allOf variants through local ref chains', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          Name: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          NameAlias: {
            $ref: '#/$defs/Name',
            description: 'Name fields',
          },
          Age: {
            type: 'object',
            properties: { age: { type: 'number' } },
            required: ['age'],
          },
        },
        properties: {
          value: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/NameAlias', $comment: 'Generated alias' }, { $ref: '#/$defs/Age' }],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema).properties?.['value']).toEqual({
        type: 'object',
        $comment: 'Generated alias',
        description: 'Name fields',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name', 'age'],
        additionalProperties: false,
      });
    });

    test('fails closed on cyclic local ref chains in object allOf variants', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          A: { $ref: '#/$defs/B' },
          B: { $ref: '#/$defs/A' },
          Age: {
            type: 'object',
            properties: { age: { type: 'number' } },
            required: ['age'],
          },
        },
        properties: {
          value: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/A' }, { $ref: '#/$defs/Age' }],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'cannot be merged without changing Draft 7 validation',
      );
    });

    test('merges object allOf properties that match Object prototype names', () => {
      const specialProperties = Object.fromEntries([
        ['constructor', { type: 'string' }],
        ['toString', { type: 'string' }],
        ['__proto__', { type: 'string' }],
      ]);
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: specialProperties,
                required: ['constructor', 'toString', '__proto__'],
              },
              {
                type: 'object',
                properties: { other: { type: 'number' } },
                required: ['other'],
              },
            ],
          },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);
      const properties = (strict.properties?.['value'] as JSONSchema).properties;

      expect(properties).toEqual(
        Object.fromEntries([
          ['constructor', { type: 'string' }],
          ['toString', { type: 'string' }],
          ['__proto__', { type: 'string' }],
          ['other', { type: 'number' }],
        ]),
      );
      expect(Object.prototype.hasOwnProperty.call(properties, '__proto__')).toBe(true);
    });

    test('merges matching object allOf properties with reordered schema keys', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: {
                  shared: {
                    type: 'object',
                    description: 'shared object',
                    properties: { name: { type: 'string', description: 'display name' } },
                    required: ['name'],
                  },
                },
                required: ['shared'],
              },
              {
                required: ['shared'],
                properties: {
                  shared: {
                    required: ['name'],
                    properties: { name: { description: 'display name', type: 'string' } },
                    description: 'shared object',
                    type: 'object',
                  },
                },
                type: 'object',
              },
            ],
          },
        },
        required: ['value'],
      };

      expect(toStrictJsonSchema(schema)).toEqual({
        type: 'object',
        properties: {
          value: {
            type: 'object',
            properties: {
              shared: {
                type: 'object',
                description: 'shared object',
                properties: { name: { type: 'string', description: 'display name' } },
                required: ['name'],
                additionalProperties: false,
              },
            },
            required: ['shared'],
            additionalProperties: false,
          },
        },
        required: ['value'],
        additionalProperties: false,
      });
    });

    test('rejects matching object allOf properties with reordered array values', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: { shared: { type: 'string', enum: ['first', 'second'] } },
                required: ['shared'],
              },
              {
                type: 'object',
                properties: { shared: { enum: ['second', 'first'], type: 'string' } },
                required: ['shared'],
              },
            ],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'cannot be merged without changing Draft 7 validation',
      );
    });

    test('rejects object allOf variants that cannot be merged exactly', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            allOf: [
              {
                type: 'object',
                properties: { shared: { type: 'string' } },
                required: ['shared'],
              },
              {
                type: 'object',
                properties: { shared: { type: 'number' } },
                required: ['shared'],
              },
            ],
          },
        },
        required: ['value'],
      };

      expect(() => toStrictJsonSchema(schema)).toThrow(
        'cannot be merged without changing Draft 7 validation',
      );
    });
  });

  describe('$ref Resolution', () => {
    test('resolves percent-encoded JSON Pointer tokens before pointer unescaping', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          'A B': { type: 'string' },
          'A/B': { type: 'number' },
        },
        properties: {
          spaced: { $ref: '#/$defs/A%20B' },
          slash: { $ref: '#/$defs/A%7E1B' },
        },
        required: ['spaced', 'slash'],
      };

      expect(toStrictJsonSchema(schema)).toMatchObject({
        properties: {
          spaced: { $ref: '#/$defs/A%20B' },
          slash: { $ref: '#/$defs/A%7E1B' },
        },
      });
    });

    test('rejects malformed URI and JSON Pointer escapes in local refs', () => {
      for (const ref of ['#/$defs/A%2', '#/$defs/A%ZZ', '#/$defs/A~2B']) {
        const schema: JSONSchema = {
          type: 'object',
          $defs: { 'A B': { type: 'string' } },
          properties: { value: { $ref: ref } },
          required: ['value'],
        };

        expect(() => toStrictJsonSchema(schema)).toThrow('does not resolve to an object or boolean schema');
      }
    });

    test('allows a root $id and undefined nested $id values but rejects defined nested resource scopes', () => {
      const rootIdSchema: JSONSchema = {
        $id: 'https://example.com/root.json',
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      };
      expect(toStrictJsonSchema(rootIdSchema)).toMatchObject({
        $id: 'https://example.com/root.json',
      });

      const undefinedNestedIdSchema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            $id: undefined,
            type: 'string',
          },
        },
        required: ['value'],
      };
      expect(() => toStrictJsonSchema(undefinedNestedIdSchema)).not.toThrow();

      const nestedIdSchema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            $id: 'nested.json',
            type: 'string',
          },
        },
        required: ['value'],
      };
      expect(() => toStrictJsonSchema(nestedIdSchema)).toThrow(
        'establishes a separate JSON Schema resource scope',
      );
    });

    test('retains annotation-only recursive refs without expanding them', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          Node: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              next: {
                anyOf: [{ $ref: '#/$defs/Node', description: 'The next node' }, { type: 'null' }],
              },
            },
            required: ['value', 'next'],
          },
        },
        properties: {
          root: { $ref: '#/$defs/Node', description: 'The root node' },
        },
        required: ['root'],
      };

      expect(toStrictJsonSchema(schema)).toMatchObject({
        $defs: {
          Node: {
            additionalProperties: false,
            properties: {
              next: {
                anyOf: [{ $ref: '#/$defs/Node', description: 'The next node' }, { type: 'null' }],
              },
            },
          },
        },
        properties: {
          root: { $ref: '#/$defs/Node', description: 'The root node' },
        },
      });
    });

    test('retains validation through annotated local reference chains', () => {
      const schema: JSONSchema = {
        type: 'object',
        $defs: {
          Text: { type: 'string' },
          Alias: { $ref: '#/$defs/Text' },
        },
        properties: {
          value: { $ref: '#/$defs/Alias', description: 'A text value' },
        },
        required: ['value'],
      };

      const strict = toStrictJsonSchema(schema);

      expect(strict.$defs?.['Alias']).toEqual({ $ref: '#/$defs/Text' });
      expect(strict.properties?.['value']).toEqual({
        $ref: '#/$defs/Alias',
        description: 'A text value',
      });
    });

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
