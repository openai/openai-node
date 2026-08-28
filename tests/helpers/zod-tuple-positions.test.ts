import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import { z as zv3 } from 'zod/v3';
import { z as zv4 } from 'zod/v4';

describe('Zod v3 tuple positions', () => {
  it('keeps a position whose element parses to no schema', () => {
    // `minItems`/`maxItems` come from the declared element count, so dropping an
    // entry leaves the array claiming an arity it no longer describes and moves
    // every later element onto the wrong index.
    const schema = zodToJsonSchema(zv3.tuple([zv3.void(), zv3.string()])) as {
      items: unknown[];
      minItems: number;
      maxItems: number;
    };

    expect(schema.items).toEqual([{}, { type: 'string' }]);
    expect(schema.minItems).toBe(2);
    expect(schema.maxItems).toBe(2);
  });

  it('keeps those positions alongside a rest element', () => {
    const schema = zodToJsonSchema(zv3.tuple([zv3.void(), zv3.string()]).rest(zv3.number())) as {
      items: unknown[];
      minItems: number;
      additionalItems: unknown;
    };

    expect(schema.items).toEqual([{}, { type: 'string' }]);
    expect(schema.minItems).toBe(2);
    expect(schema.additionalItems).toEqual({ type: 'number' });
  });

  it('agrees with Zod v4 on the number of described positions', () => {
    const v3 = zodToJsonSchema(zv3.tuple([zv3.void(), zv3.string()])) as { items: unknown[] };
    const v4 = zv4.toJSONSchema(zv4.tuple([zv4.void(), zv4.string()]), {
      io: 'input',
      unrepresentable: 'any',
    }) as { prefixItems?: unknown[] };

    expect(v3.items).toHaveLength(v4.prefixItems?.length ?? 0);
  });

  it('does not change tuples whose elements all produce schemas', () => {
    expect(zodToJsonSchema(zv3.tuple([zv3.string(), zv3.number()]))).toEqual({
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      maxItems: 2,
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
  });
});
