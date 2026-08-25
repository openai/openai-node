import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as z4 } from 'zod/v4';
import { z as z4Mini } from 'zod/v4-mini';

const nullLiteralSchema = { type: 'null', const: null };
const validNullStatus = '{"status":null}';
const invalidObjectStatus = '{"status":{}}';

describe.each([
  { version: 'Classic', schema: z4.object({ status: z4.literal(null) }) },
  { version: 'Mini', schema: z4Mini.object({ status: z4Mini.literal(null) }) },
])('Zod v4 $version null literals', ({ schema }) => {
  it('keeps all five public helpers aligned and validates parsed output', () => {
    const response = zodResponseFormat(schema, 'null_status');
    const text = zodTextFormat(schema, 'null_status');
    const chatTool = zodFunction({ name: 'null_status', parameters: schema });
    const responseTool = zodResponsesFunction({ name: 'null_status', parameters: schema });
    const realtimeTool = zodRealtimeFunction({ name: 'null_status', parameters: schema });

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

    for (const parse of [response.$parseRaw, text.$parseRaw, chatTool.$parseRaw, responseTool.$parseRaw]) {
      expect(parse(validNullStatus)).toEqual({ status: null });
      expect(() => parse(invalidObjectStatus)).toThrow();
    }

    expect(realtimeTool).not.toHaveProperty('strict');
  });
});

it('preserves null literals inside shared schema definitions and references', () => {
  const shared = z4.object({ status: z4.literal(null) });
  const schema = z4.object({ first: shared, second: shared });
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
