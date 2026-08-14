import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema';
import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod/v4';

const nullLiteralSchema = { type: 'null', const: null };
const nullStatus = z3.object({ status: z3.literal(null) });
const validNullStatus = '{"status":null}';
const invalidObjectStatus = '{"status":{}}';

describe('Zod v3 null literals in public helpers', () => {
  it('zodResponseFormat emits a strict null literal and parses null', () => {
    const format = zodResponseFormat(nullStatus, 'null_status');

    expect(format.json_schema).toMatchObject({
      strict: true,
      schema: {
        type: 'object',
        properties: { status: nullLiteralSchema },
        required: ['status'],
      },
    });
    expect(format.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(() => format.$parseRaw(invalidObjectStatus)).toThrow();
  });

  it('zodTextFormat emits a strict null literal and parses null', () => {
    const format = zodTextFormat(nullStatus, 'null_status');

    expect(format).toMatchObject({
      strict: true,
      schema: {
        type: 'object',
        properties: { status: nullLiteralSchema },
        required: ['status'],
      },
    });
    expect(format.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(() => format.$parseRaw(invalidObjectStatus)).toThrow();
  });

  it('zodFunction emits strict null literal parameters and parses null', () => {
    const tool = zodFunction({ name: 'null_status', parameters: nullStatus });

    expect(tool.function).toMatchObject({
      strict: true,
      parameters: {
        type: 'object',
        properties: { status: nullLiteralSchema },
        required: ['status'],
      },
    });
    expect(tool.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(() => tool.$parseRaw(invalidObjectStatus)).toThrow();
  });

  it('zodResponsesFunction emits strict null literal parameters and parses null', () => {
    const tool = zodResponsesFunction({ name: 'null_status', parameters: nullStatus });

    expect(tool).toMatchObject({
      strict: true,
      parameters: {
        type: 'object',
        properties: { status: nullLiteralSchema },
        required: ['status'],
      },
    });
    expect(tool.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(() => tool.$parseRaw(invalidObjectStatus)).toThrow();
  });

  it('zodRealtimeFunction emits non-strict null literal parameters accepted by Zod', () => {
    const tool = zodRealtimeFunction({ name: 'null_status', parameters: nullStatus });

    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { status: nullLiteralSchema },
      required: ['status'],
    });
    expect(tool).not.toHaveProperty('strict');
    expect(nullStatus.parse(JSON.parse(validNullStatus))).toEqual({ status: null });
    expect(() => nullStatus.parse(JSON.parse(invalidObjectStatus))).toThrow();
  });

  it('preserves nested, described, nullable, union, array, defaulted, and plain null fields', () => {
    const schema = z3.object({
      nested: z3.object({ status: z3.literal(null) }),
      described: z3.literal(null).describe('An explicitly empty status'),
      optionalNullable: z3.literal(null).optional().nullable(),
      mixedUnion: z3.union([z3.literal(null), z3.string()]),
      describedLiteralUnion: z3.union([
        z3.literal(null).describe('An explicitly empty choice'),
        z3.literal('ready'),
      ]),
      items: z3.array(z3.literal(null)),
      defaulted: z3.literal(null).default(null),
      plainNull: z3.null(),
      optimizedLiteralUnion: z3.union([z3.literal(null), z3.literal('ready')]),
    });
    const format = zodResponseFormat(schema, 'nested_null_literals');
    const realtime = zodRealtimeFunction({ name: 'nested_null_literals', parameters: schema });
    const expectedProperties = {
      nested: { type: 'object', properties: { status: nullLiteralSchema }, required: ['status'] },
      described: { ...nullLiteralSchema, description: 'An explicitly empty status' },
      optionalNullable: { anyOf: [nullLiteralSchema, { type: 'null' }] },
      mixedUnion: { anyOf: [nullLiteralSchema, { type: 'string' }] },
      describedLiteralUnion: {
        anyOf: [
          { ...nullLiteralSchema, description: 'An explicitly empty choice' },
          { type: 'string', const: 'ready' },
        ],
      },
      items: { type: 'array', items: nullLiteralSchema },
      defaulted: { ...nullLiteralSchema, default: null },
      plainNull: { type: 'null' },
      optimizedLiteralUnion: { type: ['null', 'string'], enum: [null, 'ready'] },
    };
    const valid = {
      nested: { status: null },
      described: null,
      optionalNullable: null,
      mixedUnion: null,
      describedLiteralUnion: null,
      items: [null],
      defaulted: null,
      plainNull: null,
      optimizedLiteralUnion: null,
    };

    expect(format.json_schema).toMatchObject({
      strict: true,
      schema: {
        properties: expectedProperties,
        required: [
          'nested',
          'described',
          'optionalNullable',
          'mixedUnion',
          'describedLiteralUnion',
          'items',
          'defaulted',
          'plainNull',
          'optimizedLiteralUnion',
        ],
      },
    });
    expect(format.$parseRaw(JSON.stringify(valid))).toEqual(valid);
    expect(realtime.parameters).toMatchObject({
      properties: expectedProperties,
      required: [
        'nested',
        'described',
        'mixedUnion',
        'describedLiteralUnion',
        'items',
        'plainNull',
        'optimizedLiteralUnion',
      ],
    });
    expect(realtime).not.toHaveProperty('strict');
    expect(schema.parse(valid)).toEqual(valid);
  });

  it('preserves null literals inside shared schema definitions and references', () => {
    const shared = z3.object({ status: z3.literal(null) });
    const schema = z3.object({ first: shared, second: shared });
    const format = zodResponseFormat(schema, 'shared_null_literals', {
      schemaDefinitions: { nullableStatus: shared },
    });

    expect(format.json_schema.schema).toMatchObject({
      properties: {
        first: { $ref: '#/definitions/nullableStatus' },
        second: { $ref: '#/definitions/nullableStatus' },
      },
      definitions: {
        nullableStatus: {
          type: 'object',
          properties: { status: nullLiteralSchema },
          required: ['status'],
        },
      },
    });
    expect(format.$parseRaw('{"first":{"status":null},"second":{"status":null}}')).toEqual({
      first: { status: null },
      second: { status: null },
    });
  });
});

describe('Zod v4 null literal compatibility', () => {
  it('keeps all five public helpers aligned with their existing null literal schemas', () => {
    const schema = z4.object({ status: z4.literal(null) });
    const response = zodResponseFormat(schema, 'v4_null_status');
    const text = zodTextFormat(schema, 'v4_null_status');
    const chatTool = zodFunction({ name: 'v4_null_status', parameters: schema });
    const responseTool = zodResponsesFunction({ name: 'v4_null_status', parameters: schema });
    const realtimeTool = zodRealtimeFunction({ name: 'v4_null_status', parameters: schema });

    for (const convertedSchema of [
      response.json_schema.schema,
      text.schema,
      chatTool.function.parameters,
      responseTool.parameters,
      realtimeTool.parameters,
    ]) {
      expect(convertedSchema).toMatchObject({
        type: 'object',
        properties: { status: nullLiteralSchema },
        required: ['status'],
      });
    }

    expect(response.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(text.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(chatTool.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(responseTool.$parseRaw(validNullStatus)).toEqual({ status: null });
    expect(realtimeTool).not.toHaveProperty('strict');
    expect(schema.parse(JSON.parse(validNullStatus))).toEqual({ status: null });
  });
});

describe('Zod v3 literal converter compatibility', () => {
  it.each([
    { description: 'string', value: 'ready', expectedType: 'string' },
    { description: 'integer-valued number', value: 7, expectedType: 'number' },
    { description: 'fractional number', value: 1.5, expectedType: 'number' },
    { description: 'boolean', value: true, expectedType: 'boolean' },
  ])('preserves existing $description literals', ({ value, expectedType }) => {
    const schema = z3.object({ status: z3.literal(value) });
    const format = zodResponseFormat(schema, 'existing_literal');

    expect(format.json_schema.schema).toMatchObject({
      properties: { status: { type: expectedType, const: value } },
    });
    expect(format.$parseRaw(JSON.stringify({ status: value }))).toEqual({ status: value });
  });

  it('emits the exact Draft 7 JSON Schema for a root null literal', () => {
    expect(zodToJsonSchema(z3.literal(null))).toEqual({
      type: 'null',
      const: null,
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
  });

  it('emits the exact 2019-09 JSON Schema for a root null literal', () => {
    expect(zodToJsonSchema(z3.literal(null), { target: 'jsonSchema2019-09' })).toEqual({
      type: 'null',
      const: null,
      $schema: 'https://json-schema.org/draft/2019-09/schema#',
    });
  });

  it('preserves plain null without adding a literal constraint', () => {
    expect(zodToJsonSchema(z3.null())).toEqual({
      type: 'null',
      $schema: 'http://json-schema.org/draft-07/schema#',
    });
  });

  it('delegates OpenAPI 3 null literals to the existing plain-null representation', () => {
    const expected = { enum: ['null'], nullable: true };

    expect(zodToJsonSchema(z3.literal(null), { target: 'openApi3' })).toEqual(expected);
    expect(zodToJsonSchema(z3.null(), { target: 'openApi3' })).toEqual(expected);
  });
});
