import { ResponseFormatJSONSchema } from '../resources/index';
import * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';
import type * as z4Mini from 'zod/v4-mini';
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

type ZodV4Schema = z4.ZodType | z4Mini.ZodMiniType;
type ZodSchema = z3.ZodType | ZodV4Schema;

// The public helpers only need Zod's output type and, when available, parser. Using these small
// structural shapes avoids expanding Zod's full v3/v4 type graphs in Deno.
type ZodTypeLike = (
  | { _output: unknown }
  | {
      _zod: {
        output: unknown;
      };
    }
) & {
  parse?: (data: unknown) => unknown;
};

type InferZodType<T extends ZodTypeLike> =
  T extends { _output: infer Output } ? Output
  : T extends { _zod: { output: infer Output } } ? Output
  : never;

function zodV3ToJsonSchema(schema: z3.ZodType, options: { name: string }): Record<string, unknown> {
  return _zodToJsonSchema(schema, {
    openaiStrictMode: true,
    name: options.name,
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    nullableStrategy: 'property',
  });
}

function zodV4ToJsonSchema(schema: ZodV4Schema): Record<string, unknown> {
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

function isZodV4(zodObject: ZodSchema): zodObject is ZodV4Schema {
  return '_zod' in zodObject;
}

function parseZodObject<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  content: string,
): InferZodType<ZodInput> {
  const parsed = JSON.parse(content);
  const parser = (zodObject as { parse?: (data: unknown) => unknown }).parse;

  if (typeof parser === 'function') {
    return parser.call(zodObject, parsed) as InferZodType<ZodInput>;
  }

  return z4.parse(zodObject as unknown as ZodV4Schema, parsed) as InferZodType<ZodInput>;
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
  const zodSchema = zodObject as unknown as ZodSchema;

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
    (content) => parseZodObject(zodObject, content),
  );
}

export function zodTextFormat<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  name: string,
  props?: Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'>,
): AutoParseableTextFormat<InferZodType<ZodInput>> {
  const zodSchema = zodObject as unknown as ZodSchema;

  return makeParseableTextFormat<InferZodType<ZodInput>>(
    {
      type: 'json_schema',
      ...props,
      name,
      strict: true,
      schema: isZodV4(zodSchema) ? zodV4ToJsonSchema(zodSchema) : zodV3ToJsonSchema(zodSchema, { name }),
    },
    (content) => parseZodObject(zodObject, content),
  );
}

/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 */
export function zodFunction<Parameters extends ZodTypeLike>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableTool<{
  arguments: Parameters;
  name: string;
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  const zodSchema = options.parameters as unknown as ZodSchema;

  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters:
          isZodV4(zodSchema) ?
            zodV4ToJsonSchema(zodSchema)
          : zodV3ToJsonSchema(zodSchema, { name: options.name }),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
      },
    },
    {
      callback: options.function,
      parser: (args) => parseZodObject(options.parameters, args),
    },
  );
}

export function zodResponsesFunction<Parameters extends ZodTypeLike>(options: {
  name: string;
  parameters: Parameters;
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
}): AutoParseableResponseTool<{
  arguments: Parameters;
  name: string;
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  const zodSchema = options.parameters as unknown as ZodSchema;

  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters:
        isZodV4(zodSchema) ?
          zodV4ToJsonSchema(zodSchema)
        : zodV3ToJsonSchema(zodSchema, { name: options.name }),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => parseZodObject(options.parameters, args),
    },
  );
}
