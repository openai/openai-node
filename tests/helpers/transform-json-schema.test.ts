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

  it('should turn a discriminated union oneOf into an anyOf', () => {
    const input = {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            bonus: {
              type: 'integer',
            },
          },
        },
        {
          type: 'object',
          properties: {
            salary: {
              type: 'integer',
            },
          },
        },
      ],
    };

    const expected = {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: {
            bonus: {
              type: 'integer',
            },
          },
        },
        {
          type: 'object',
          properties: {
            salary: {
              type: 'integer',
            },
          },
        },
      ],
    };

    const transformedSchema = transformJSONSchema(input);

    expect(transformedSchema).toEqual(expected);
  });

  it('should turn oneOf into anyOf in recursive object in list', () => {
    const input = {
      type: 'object',
      properties: {
        employees: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                properties: {
                  bonus: {
                    type: 'integer',
                  },
                },
              },
              {
                type: 'object',
                properties: {
                  salary: {
                    type: 'integer',
                  },
                },
              },
            ],
          },
        },
      },
    };

    const expected = {
      type: 'object',
      properties: {
        employees: {
          type: 'array',
          items: {
            type: 'object',
            anyOf: [
              {
                type: 'object',
                properties: {
                  bonus: {
                    type: 'integer',
                  },
                },
              },
              {
                type: 'object',
                properties: {
                  salary: {
                    type: 'integer',
                  },
                },
              },
            ],
          },
        },
      },
    };

    const transformedSchema = transformJSONSchema(input);

    expect(transformedSchema).toEqual(expected);
  });
});
