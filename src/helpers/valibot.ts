import { ResponseFormatJSONSchema } from '../resources/index';
import * as v from 'valibot';
import {
  AutoParseableResponseFormat,
  AutoParseableTextFormat,
  AutoParseableTool,
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
} from '../lib/parser';
import { toJsonSchema } from '@valibot/to-json-schema';
import { AutoParseableResponseTool, makeParseableResponseTool } from '../lib/ResponsesParser';
import { type ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';
import { toStrictJsonSchema } from '../lib/transform';
import { JSONSchema } from '../lib/jsonschema';

type ValibotSchema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;

function valibotToJsonSchema(schema: ValibotSchema): Record<string, unknown> {
  return toStrictJsonSchema(
    toJsonSchema(schema, { target: 'draft-07' }) as JSONSchema,
  ) as Record<string, unknown>;
}

/**
 * Creates a chat completion `JSONSchema` response format object from
 * the given Valibot schema.
 *
 * If this is passed to the `.parse()`, `.stream()` or `.runTools()`
 * chat completion methods then the response message will contain a
 * `.parsed` property that is the result of parsing the content with
 * the given Valibot schema.
 *
 * ```ts
 * const completion = await client.chat.completions.parse({
 *    model: 'gpt-4o-2024-08-06',
 *    messages: [
 *      { role: 'system', content: 'You are a helpful math tutor.' },
 *      { role: 'user', content: 'solve 8x + 31 = 2' },
 *    ],
 *    response_format: valibotResponseFormat(
 *      v.object({
 *        steps: v.array(v.object({
 *          explanation: v.string(),
 *          answer: v.string(),
 *        })),
 *        final_answer: v.string(),
 *      }),
 *      'math_answer',
 *    ),
 *  });
 *  const message = completion.choices[0]?.message;
 *  if (message?.parsed) {
 *    console.log(message.parsed);
 *    console.log(message.parsed.final_answer);
 * }
 * ```
 *
 * This can be passed directly to the `.create()` method but will not
 * result in any automatic parsing, you'll have to parse the response yourself.
 */
export function valibotResponseFormat<Schema extends ValibotSchema>(
  schema: Schema,
  name: string,
  props?: Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'>,
): AutoParseableResponseFormat<v.InferOutput<Schema>> {
  return makeParseableResponseFormat(
    {
      type: 'json_schema',
      json_schema: {
        ...props,
        name,
        strict: true,
        schema: valibotToJsonSchema(schema),
      },
    },
    (content) => v.parse(schema, JSON.parse(content)),
  );
}

export function valibotTextFormat<Schema extends ValibotSchema>(
  schema: Schema,
  name: string,
  props?: Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'>,
): AutoParseableTextFormat<v.InferOutput<Schema>> {
  return makeParseableTextFormat(
    {
      type: 'json_schema',
      ...props,
      name,
      strict: true,
      schema: valibotToJsonSchema(schema),
    },
    (content) => v.parse(schema, JSON.parse(content)),
  );
}

/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 */
export function valibotFunction<Parameters extends ValibotSchema>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: v.InferOutput<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableTool<{
  arguments: Parameters;
  name: string;
  function: (args: v.InferOutput<Parameters>) => unknown;
}> {
  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters: valibotToJsonSchema(options.parameters),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
      },
    },
    {
      callback: options.function,
      parser: (args) => v.parse(options.parameters, JSON.parse(args)),
    },
  );
}

export function valibotResponsesFunction<Parameters extends ValibotSchema>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: v.InferOutput<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableResponseTool<{
  arguments: Parameters;
  name: string;
  function: (args: v.InferOutput<Parameters>) => unknown;
}> {
  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters: valibotToJsonSchema(options.parameters),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => v.parse(options.parameters, JSON.parse(args)),
    },
  );
}
