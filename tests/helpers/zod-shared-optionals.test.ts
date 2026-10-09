import { ignoreOverride, zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { toStrictJsonSchema } from 'openai/lib/transform';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { z } from 'zod/v3';

const helpers = [
  {
    name: 'response format',
    convert: (schema: z.ZodType) => zodResponseFormat(schema, 'p').json_schema.schema,
  },
  { name: 'text format', convert: (schema: z.ZodType) => zodTextFormat(schema, 'p').schema },
  {
    name: 'chat function',
    convert: (schema: z.ZodType) => zodFunction({ name: 'p', parameters: schema }).function.parameters,
  },
  {
    name: 'Responses function',
    convert: (schema: z.ZodType) => zodResponsesFunction({ name: 'p', parameters: schema }).parameters,
  },
];

function expectValidSchema(value: unknown): void {
  // SAFETY: Traversal first establishes an object or an existing reference segment; this view reads schema fields without trusting their values before the following checks.
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- verify the actual serialized request schema
  const schema = JSON.parse(JSON.stringify(value)) as JSONSchema;
  expect(JSON.stringify(schema)).not.toContain('"not":');
  expect(() => toStrictJsonSchema(schema)).not.toThrow();

  const visit = (child: unknown): void => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    // SAFETY: Traversal first establishes an object or an existing reference segment; this view reads schema fields without trusting their values before the following checks.
    const reference = (child as Record<string, unknown>)['$ref'];
    if (typeof reference === 'string') {
      expect(reference.startsWith('#/')).toBe(true);
      let target: unknown = schema;
      for (const token of decodeURIComponent(reference.slice(2)).split('/')) {
        // oxlint-disable-next-line unicorn/prefer-string-replace-all -- the test tsconfig uses the ES2020 library
        const key = token.replace(/~[01]/gu, (escape) => (escape === '~1' ? '/' : '~'));
        expect(target).toHaveProperty([key]);
        // SAFETY: Traversal first establishes an object or an existing reference segment; this view reads schema fields without trusting their values before the following checks.
        target = (target as Record<string, unknown>)[key];
      }
    }
    for (const entry of Object.values(child)) {
      visit(entry);
    }
  };
  visit(schema);
}

describe.each(helpers)('shared Zod v3 optionals in $name', ({ convert }) => {
  it.each(['nullable first', 'optional first'] as const)('omits the never branch with %s', (order) => {
    const inner = z.string();
    const shared = order === 'nullable first' ? inner.nullable().optional() : inner.optional().nullable();
    const schema = convert(z.object({ a: shared, b: shared }));
    expect(schema).toMatchObject({ required: ['a', 'b'] });
    expectValidSchema(schema);
  });

  it('keeps nested, reused, and recursive references valid', () => {
    interface Node {
      next?: Node | null | undefined;
    }
    const node: z.ZodType<Node> = z.lazy(() => z.object({ next: node.nullable().optional() }));
    const shared = z
      .object({ node, nodes: z.array(node) })
      .nullable()
      .optional();
    expectValidSchema(convert(z.object({ a: shared, b: shared, group: z.object({ c: shared }) })));
  });
});

it('retains the wrapper and its description in supplied definitions', () => {
  const shared = z.string().nullable().optional().describe('An optional name');
  const { schema } = zodResponseFormat(z.object({ name: shared }), 'p', {
    schemaDefinitions: { 'shared/name~': shared },
  }).json_schema;
  expect(schema).toMatchObject({
    definitions: {
      'shared/name~': {
        anyOf: [{ type: 'string', nullable: true }],
        description: 'An optional name',
      },
    },
  });
  expectValidSchema(schema);
});

it.each([z.enum(['a', 'b']), z.array(z.string()), z.object({ value: z.string() })])(
  'supports shared optional enum, array, and object values',
  (inner) => {
    const shared = inner.nullable().optional();
    expectValidSchema(zodResponseFormat(z.object({ a: shared, b: shared }), 'p').json_schema.schema);
  },
);

it('preserves non-strict and caller-override output', () => {
  const shared = z.string().nullable().optional();
  const schema = z.object({ a: shared, b: shared });
  const options = {
    name: 'p',
    nameStrategy: 'duplicate-ref' as const,
    $refStrategy: 'extract-to-root' as const,
    nullableStrategy: 'property' as const,
  };
  for (const converted of [
    zodToJsonSchema(schema, options),
    zodToJsonSchema(schema, { ...options, openaiStrictMode: true, override: () => ignoreOverride }),
  ]) {
    expect(converted).toMatchObject({
      definitions: { p_properties_a: { anyOf: [{ not: {} }, { type: 'string', nullable: true }] } },
    });
  }
  expect(zodRealtimeFunction({ name: 'p', parameters: schema }).parameters).toEqual(
    zodToJsonSchema(schema, { ...options, nullableStrategy: 'from-target', pipeStrategy: 'input' }),
  );
});
