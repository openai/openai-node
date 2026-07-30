import type { JSONSchema } from 'openai/lib/jsonschema';
import {
  assertNoNestedSchemaIds,
  forEachJSONSchemaChild,
  hasOnlyRefAndAnnotations,
  normalizeObjectAllOfForExclusivity,
  resolveLocalRef,
  rewriteLocalRefsIntoMovedOneOfBranches,
  toStrictJsonSchema,
} from 'openai/lib/transform';

describe('JSON Schema child traversal', () => {
  test('visits schema-valued keywords without descending into literal payloads', () => {
    const visited: Array<{ path: string; keyword: string; value: unknown }> = [];
    const schema = {
      type: 'object',
      additionalProperties: false,
      items: { type: 'string' },
      anyOf: [{ type: 'number' }, true],
      $defs: { named: { type: 'boolean' } },
      dependencies: { schema: { type: 'object' }, property: ['name'] },
      default: { anyOf: [{ type: 'ignored' }] },
      enum: [{ type: 'ignored' }],
    };

    forEachJSONSchemaChild(schema, ['root'], (value, path, keyword) => {
      visited.push({ path: path.join('/'), keyword, value });
    });

    expect(visited).toEqual([
      { path: 'root/additionalProperties', keyword: 'additionalProperties', value: false },
      { path: 'root/anyOf/0', keyword: 'anyOf', value: { type: 'number' } },
      { path: 'root/anyOf/1', keyword: 'anyOf', value: true },
      { path: 'root/items', keyword: 'items', value: { type: 'string' } },
      { path: 'root/$defs/named', keyword: '$defs', value: { type: 'boolean' } },
      { path: 'root/dependencies/schema', keyword: 'dependencies', value: { type: 'object' } },
    ]);
  });

  test('visits explicitly present undefined single-schema placeholders', () => {
    const paths: string[] = [];

    forEachJSONSchemaChild({ contains: undefined }, [], (_schema, path) => paths.push(path.join('/')));

    expect(paths).toEqual(['contains']);
  });
});

describe('local JSON Schema reference resolution', () => {
  const root = {
    type: 'object',
    $defs: {
      'slash/key': { type: 'string' },
      'tilde~key': { type: 'number' },
      'percent%key': { type: 'boolean' },
    },
    properties: {
      union: { anyOf: [{ type: 'string' }, false] },
      nested: { type: 'object', properties: { value: { type: 'number' } } },
    },
    dependencies: { schema: { type: 'object' }, property: ['name'] },
    default: { nested: { type: 'string' } },
    enum: [{ type: 'string' }],
  } as JSONSchema;

  test('resolves the document root and escaped or encoded property names', () => {
    expect(resolveLocalRef(root, '#')).toBe(root);
    expect(resolveLocalRef(root, '#/$defs/slash~1key')).toEqual({ type: 'string' });
    expect(resolveLocalRef(root, '#/$defs/tilde~0key')).toEqual({ type: 'number' });
    expect(resolveLocalRef(root, '#/$defs/percent%25key')).toEqual({ type: 'boolean' });
    expect(resolveLocalRef(root, '#/properties%2Funion%2FanyOf%2F0')).toEqual({ type: 'string' });
  });

  test('resolves boolean and object definitions in schema arrays and dependency maps', () => {
    expect(resolveLocalRef(root, '#/properties/union/anyOf/0')).toEqual({ type: 'string' });
    expect(resolveLocalRef(root, '#/properties/union/anyOf/1')).toBe(false);
    expect(resolveLocalRef(root, '#/dependencies/schema')).toEqual({ type: 'object' });
    expect(resolveLocalRef(root, '#/dependencies/property')).toBeUndefined();
  });

  test.each([
    'https://example.com/schema.json',
    '#not-a-pointer',
    '#/%E0%A4%A',
    '#/$defs/slash~2key',
    '#/$defs/tilde~',
    '#/$defs/missing',
    '#/properties/union/anyOf',
    '#/properties/union/anyOf/01',
    '#/properties/union/anyOf/-1',
    '#/properties/union/anyOf/5',
    '#/properties/nested/properties/missing',
    '#/default/nested',
    '#/enum/0',
  ])('rejects invalid or non-schema reference %s', (ref) => {
    expect(resolveLocalRef(root, ref)).toBeUndefined();
  });
});

describe('reference annotations and resource identity', () => {
  test('allows annotation siblings and local definition maps on reference schemas', () => {
    expect(
      hasOnlyRefAndAnnotations({
        $ref: '#/$defs/Value',
        title: 'Value',
        description: 'Annotation',
        $comment: 'Comment',
        $defs: { Value: { type: 'string' } },
        definitions: {},
      }),
    ).toBe(true);
    expect(hasOnlyRefAndAnnotations({ $ref: '#/$defs/Value', type: 'string' })).toBe(false);
  });

  test('allows root resource IDs but rejects nested schema resource IDs', () => {
    expect(() =>
      assertNoNestedSchemaIds({ $id: 'https://example.com/root', properties: { value: { $id: undefined } } }),
    ).not.toThrow();

    expect(() =>
      assertNoNestedSchemaIds({
        type: 'object',
        properties: { value: { type: 'string', $id: 'https://example.com/nested' } },
      }),
    ).toThrow('separate JSON Schema resource scope');
  });
});

describe('oneOf reference rewrites', () => {
  test('rewrites pointers that traverse an actual moved oneOf schema branch', () => {
    const root = {
      type: 'object',
      properties: {
        variant: {
          oneOf: [{ type: 'object', properties: { 'slash/key': { type: 'string' } } }],
        },
        alias: { $ref: '#/properties/variant/oneOf/0/properties/slash~1key' },
      },
    } as JSONSchema;

    rewriteLocalRefsIntoMovedOneOfBranches(root);

    expect(root.properties?.['alias']).toEqual({
      $ref: '#/properties/variant/anyOf/0/properties/slash~1key',
    });
  });

  test.each(['#', '#/%ZZ', '#/properties/missing/oneOf/0', 'https://example.com/schema.json'])(
    'preserves unresolved or external reference %s',
    (ref) => {
      const root: JSONSchema = { type: 'object', properties: { alias: { $ref: ref } } };

      rewriteLocalRefsIntoMovedOneOfBranches(root);

      expect(root.properties?.['alias']).toEqual({ $ref: ref });
    },
  );
});

describe('object intersection normalization for exclusivity', () => {
  test('returns undefined when no intersection needs to be normalized', () => {
    const schema: JSONSchema = { type: 'object', properties: { value: { type: 'string' } } };

    expect(normalizeObjectAllOfForExclusivity(schema, schema)).toBeUndefined();
  });

  test('merges compatible object branches without mutating the original schema', () => {
    const schema: JSONSchema = {
      allOf: [
        { type: 'object', properties: { first: { type: 'string' } }, required: ['first'] },
        { type: 'object', properties: { second: { type: 'number' } }, required: ['second'] },
      ],
    };
    const original = structuredClone(schema);

    expect(normalizeObjectAllOfForExclusivity(schema, schema)).toMatchObject({
      type: 'object',
      properties: { first: { type: 'string' }, second: { type: 'number' } },
      required: ['first', 'second'],
    });
    expect(schema).toEqual(original);
  });

  test.each([
    { allOf: [false] },
    { allOf: [{ type: 'object', properties: { value: { type: 'string' } } }, { type: 'string' }] },
    { allOf: [{ type: 'object', required: [1] }, { type: 'object' }] },
  ] as unknown as JSONSchema[])('fails closed for unsupported intersection shapes', (schema) => {
    expect(normalizeObjectAllOfForExclusivity(schema, schema)).toBeUndefined();
  });
});

describe('strict schema edge cases', () => {
  test('rejects validation siblings on a root local reference and its aliases', () => {
    expect(() =>
      toStrictJsonSchema({
        $ref: '#/$defs/Target',
        properties: {},
        $defs: { Target: { type: 'object', properties: {} } },
      }),
    ).toThrow('non-metadata siblings');

    expect(() =>
      toStrictJsonSchema({
        $ref: '#/$defs/Alias',
        $defs: {
          Alias: { $ref: '#/$defs/Target', type: 'object' },
          Target: { type: 'object', properties: {} },
        },
      }),
    ).toThrow('non-annotation siblings');
  });

  test.each([1, ['value', 1]])('rejects malformed required property declarations', (required) => {
    expect(() =>
      toStrictJsonSchema({
        type: 'object',
        properties: { value: { type: 'string' } },
        required,
      } as JSONSchema),
    ).toThrow('Expected `required` to be an array of strings');
  });

  test.each([
    { enum: ['non-null'] },
    { enum: 'invalid' },
    { oneOf: [{ type: 'null' }, { type: 'null' }] },
    { type: ['string', 'null'], not: { type: 'null' } },
  ] as unknown as JSONSchema[])(
    'does not silently accept optional properties when null is not proven valid',
    (property) => {
      expect(() =>
        toStrictJsonSchema({
          type: 'object',
          properties: { optional: property },
        }),
      ).toThrow();
    },
  );

  test.each([{ anyOf: [false, false] }, { anyOf: [true] }, { anyOf: [false, true] }] as const)(
    'rejects root unions that cannot be reduced to a single object branch',
    ({ anyOf }) => {
      expect(() => toStrictJsonSchema({ type: 'object', anyOf: [...anyOf] } as JSONSchema)).toThrow(
        'Root schema must not use `anyOf`',
      );
    },
  );
});
