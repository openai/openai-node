import { ResponseFormatJSONSchema } from '../resources/index';
import * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';
import {
  AutoParseableResponseFormat,
  AutoParseableTextFormat,
  AutoParseableTool,
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
} from '../lib/parser';
import { zodToJsonSchema as _zodToJsonSchema } from '../_vendor/zod-to-json-schema';
import { AutoParseableResponseTool, makeParseableResponseTool } from '../lib/ResponsesParser';
import { type ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';
import { toStrictJsonSchema } from '../lib/transform';
import { JSONSchema } from '../lib/jsonschema';

// The public helpers only need Zod's output type and parser. Using this small
// structural type avoids expanding Zod's full v3/v4 type graphs in Deno.
type ZodTypeLike = {
  _output: unknown;
  parse: (data: unknown) => unknown;
};

type InferZodType<T extends ZodTypeLike> = T['_output'];

function zodV3ToJsonSchema(schema: z3.ZodType, options: { name: string }): Record<string, unknown> {
  return _zodToJsonSchema(schema, {
    openaiStrictMode: true,
    name: options.name,
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    nullableStrategy: 'property',
  });
}

function zodV4ToJsonSchema(schema: z4.ZodType): Record<string, unknown> {
  return toStrictJsonSchema(
    z4.toJSONSchema(schema, {
      target: 'draft-7',
      override: ({ zodSchema, jsonSchema }) => {
        const def = zodSchema._zod.def;

        if (def.type === 'union' && 'discriminator' in def && Array.isArray(jsonSchema.oneOf)) {
          if (jsonSchema.anyOf !== undefined) {
            throw new Error(
              'Zod discriminated union generated both `anyOf` and `oneOf`, which cannot be represented in an OpenAI strict schema',
            );
          }

          // Discriminator values are mutually exclusive, so anyOf preserves the
          // union while staying inside the API's supported JSON Schema subset.
          jsonSchema.anyOf = jsonSchema.oneOf;
          delete jsonSchema.oneOf;
        }
      },
    }) as JSONSchema,
  ) as Record<string, unknown>;
}

function isZodV4(zodObject: z3.ZodType | z4.ZodType): zodObject is z4.ZodType {
  return '_zod' in zodObject;
}

/**
 * Creates a chat completion `JSONSchema` response format object from
 * the given Zod schema.
 *
 * If this is passed to the `.parse()`, `.stream()` or `.runTools()`
 * chat completion methods then the response message will contain a
 * `.parsed` property that is the result of parsing the content with
 * the given Zod object.
 *
 * ```ts
 * const completion = await client.chat.completions.parse({
 *    model: 'gpt-4o-2024-08-06',
 *    messages: [
 *      { role: 'system', content: 'You are a helpful math tutor.' },
 *      { role: 'user', content: 'solve 8x + 31 = 2' },
 *    ],
 *    response_format: zodResponseFormat(
 *      z.object({
 *        steps: z.array(z.object({
 *          explanation: z.string(),
 *          answer: z.string(),
 *        })),
 *        final_answer: z.string(),
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
export function zodResponseFormat<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  name: string,
  props?: Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'>,
): AutoParseableResponseFormat<InferZodType<ZodInput>> {
  const zodSchema = zodObject as unknown as z3.ZodType | z4.ZodType;

  return makeParseableResponseFormat<InferZodType<ZodInput>>(
    {
      type: 'json_schema',
      json_schema: {
        ...props,
        name,
        strict: true,
        schema: isZodV4(zodSchema) ? zodV4ToJsonSchema(zodSchema) : zodV3ToJsonSchema(zodSchema, { name }),
      },
    },
    (content) => zodObject.parse(JSON.parse(content)) as InferZodType<ZodInput>,
  );
}

export function zodTextFormat<ZodInput extends z3.ZodType | z4.ZodType>(
  zodObject: ZodInput,
  name: string,
  props?: Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'>,
): AutoParseableTextFormat<InferZodType<ZodInput>> {
  return makeParseableTextFormat(
    {
      type: 'json_schema',
      ...props,
      name,
      strict: true,
      schema: isZodV4(zodObject) ? zodV4ToJsonSchema(zodObject) : zodV3ToJsonSchema(zodObject, { name }),
    },
    (content) => zodObject.parse(JSON.parse(content)),
  );
}

/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 */
export function zodFunction<Parameters extends z3.ZodType | z4.ZodType>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableTool<{
  arguments: Parameters;
  name: string;
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters:
          isZodV4(options.parameters) ?
            zodV4ToJsonSchema(options.parameters)
          : zodV3ToJsonSchema(options.parameters, { name: options.name }),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
      },
    },
    {
      callback: options.function,
      parser: (args) => options.parameters.parse(JSON.parse(args)),
    },
  );
}

export function zodResponsesFunction<Parameters extends z3.ZodType | z4.ZodType>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableResponseTool<{
  arguments: Parameters;
  name: string;
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters:
        isZodV4(options.parameters) ?
          zodV4ToJsonSchema(options.parameters)
        : zodV3ToJsonSchema(options.parameters, { name: options.name }),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => options.parameters.parse(JSON.parse(args)),
    },
  );
}
