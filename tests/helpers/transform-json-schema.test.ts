import { detailedDiff } from 'deep-object-diff';
import { transformJSONSchema } from '../../src/lib/transform-json-schema';

describe('transformJsonSchema', () => {
  it('should not mutate the original schema', () => {
    const input = {
      type: 'object',
      properties: {
        bonus: {
          type: 'integer',
          default: 100000,
          minimum: 100000,
          title: 'Bonus',
          description: 'Annual bonus in USD',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          minItems: 3,
        },
      },
      title: 'Employee',
      additionalProperties: true,
    };

    const inputCopy = JSON.parse(JSON.stringify(input));

    transformJSONSchema(input);

    expect(input).toEqual(inputCopy);
  });

  it('should remove unsupported properties and add them to description', () => {
    const input = {
      type: 'object',
      properties: {
        bonus: {
          type: 'integer',
          default: 100000,
          minimum: 100000,
          title: 'Bonus',
          description: 'Annual bonus in USD',
        },
      },
      title: 'Employee',
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "additionalProperties": false,
  },
  "deleted": {
    "properties": {
      "bonus": {
        "default": undefined,
        "minimum": undefined,
      },
    },
  },
  "updated": {
    "properties": {
      "bonus": {
        "description": "Annual bonus in USD

{default: 100000, minimum: 100000}",
      },
    },
  },
}
`);
  });

  it('should handle objects without existing description', () => {
    const input = {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          maximum: 10,
          minimum: 1,
        },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "additionalProperties": false,
    "properties": {
      "count": {
        "description": "{maximum: 10, minimum: 1}",
      },
    },
  },
  "deleted": {
    "properties": {
      "count": {
        "maximum": undefined,
        "minimum": undefined,
      },
    },
  },
  "updated": {},
}
`);
  });

  it('should preserve supported minItems values (0 and 1)', () => {
    const input = {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {},
  "deleted": {},
  "updated": {},
}
`);
  });

  it('should handle nested objects recursively', () => {
    const input = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            age: {
              type: 'integer',
              minimum: 0,
              maximum: 120,
            },
          },
        },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "additionalProperties": false,
    "properties": {
      "user": {
        "additionalProperties": false,
        "properties": {
          "age": {
            "description": "{minimum: 0, maximum: 120}",
          },
        },
      },
    },
  },
  "deleted": {
    "properties": {
      "user": {
        "properties": {
          "age": {
            "maximum": undefined,
            "minimum": undefined,
          },
        },
      },
    },
  },
  "updated": {},
}
`);
  });

  it('should handle $defs and definitions recursively', () => {
    const input = {
      type: 'object',
      $defs: {
        Person: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              pattern: '^[A-Za-z]+$',
            },
          },
        },
      },
      properties: {
        person: {
          $ref: '#/$defs/Person',
        },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "$defs": {
      "Person": {
        "additionalProperties": false,
        "properties": {
          "name": {
            "description": "{pattern: "^[A-Za-z]+$"}",
          },
        },
      },
    },
    "additionalProperties": false,
  },
  "deleted": {
    "$defs": {
      "Person": {
        "properties": {
          "name": {
            "pattern": undefined,
          },
        },
      },
    },
  },
  "updated": {},
}
`);
  });

  it('should remove additionalProperties: true', () => {
    const input = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      additionalProperties: true,
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {},
  "deleted": {},
  "updated": {
    "additionalProperties": false,
  },
}
`);
  });

  it('should set additionalProperties when missing', () => {
    const input = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
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

  it('should preserve supported string formats', () => {
    const input = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        date: { type: 'string', format: 'date-time' },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
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

  it('should remove unsupported string formats', () => {
    const input = {
      type: 'object',
      properties: {
        password: {
          type: 'string',
          format: 'password',
          description: 'User password',
        },
        customField: {
          type: 'string',
          format: 'custom-format',
        },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "additionalProperties": false,
    "properties": {
      "customField": {
        "description": "{format: "custom-format"}",
      },
    },
  },
  "deleted": {
    "properties": {
      "customField": {
        "format": undefined,
      },
      "password": {
        "format": undefined,
      },
    },
  },
  "updated": {
    "properties": {
      "password": {
        "description": "User password

{format: "password"}",
      },
    },
  },
}
`);
  });

  it('should transform all subschemas in allOf recursively', () => {
    const input = {
      allOf: [
        {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              minimum: 1,
              maximum: 999,
            },
          },
        },
        {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              pattern: '^[A-Z]',
              minLength: 2,
            },
          },
          additionalProperties: true,
        },
      ],
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
{
  "added": {
    "allOf": {
      "0": {
        "additionalProperties": false,
        "properties": {
          "id": {
            "description": "{minimum: 1, maximum: 999}",
          },
        },
      },
      "1": {
        "properties": {
          "name": {
            "description": "{pattern: "^[A-Z]", minLength: 2}",
          },
        },
      },
    },
  },
  "deleted": {
    "allOf": {
      "0": {
        "properties": {
          "id": {
            "maximum": undefined,
            "minimum": undefined,
          },
        },
      },
      "1": {
        "properties": {
          "name": {
            "minLength": undefined,
            "pattern": undefined,
          },
        },
      },
    },
  },
  "updated": {
    "allOf": {
      "1": {
        "additionalProperties": false,
      },
    },
  },
}
`);
  });

  it('should filter out unsupported number properties', () => {
    const input = {
      type: 'object',
      properties: {
        score: {
          type: 'number',
          // Supported properties
          minimum: 0,
          maximum: 100,
          // Unsupported properties
          precision: 2,
          step: 0.5,
          format: 'float',
        },
      },
    };

    const result = transformJSONSchema(input);
    const diff = detailedDiff(input, result);
    expect(diff).toMatchInlineSnapshot(`
   {
     "added": {
       "additionalProperties": false,
       "properties": {
         "score": {
           "description": "{precision: 2, step: 0.5, format: "float"}",
         },
       },
     },
     "deleted": {
       "properties": {
         "score": {
           "format": undefined,
           "precision": undefined,
           "step": undefined,
         },
       },
     },
     "updated": {},
   }
   `);

    expect(result['properties']['score'].minimum).toBe(0);
    expect(result['properties']['score'].maximum).toBe(100);

    expect(result['properties']['score'].precision).toBeUndefined();
    expect(result['properties']['score'].step).toBeUndefined();
    expect(result['properties']['score'].format).toBeUndefined();
    expect(result['properties']['score'].description).toContain('precision: 2');
    expect(result['properties']['score'].description).toContain('step: 0.5');
    expect(result['properties']['score'].description).toContain('format: "float"');
  });
});
