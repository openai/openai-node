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

type ZodSchemaDefinitions = Record<string, ZodTypeLike>;

type ZodResponseFormatProps = Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'> & {
  /**
   * Schemas to extract into the generated JSON Schema definitions.
   * Use this to reuse large shared schemas instead of inlining them at every occurrence.
   */
  schemaDefinitions?: ZodSchemaDefinitions | undefined;
};

function encodeSchemaDefinitionRefToken(token: string): string {
  return encodeURIComponent(token.replace(/~/g, '~0').replace(/\//g, '~1'));
}

function validateSchemaDefinitions(schemaDefinitions: ZodSchemaDefinitions | undefined): void {
  if (schemaDefinitions && Object.prototype.hasOwnProperty.call(schemaDefinitions, '__proto__')) {
    throw new Error('schemaDefinitions cannot include "__proto__" as a definition name');
  }
}

function escapeSchemaDefinitionRefs(
  schema: Record<string, unknown>,
  schemaDefinitions: ZodSchemaDefinitions | undefined,
): Record<string, unknown> {
  const refReplacements = new Map(
    Object.keys(schemaDefinitions ?? {}).map((name) => [
      `#/definitions/${name}`,
      `#/definitions/${encodeSchemaDefinitionRefToken(name)}`,
    ]),
  );

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    const record = value as Record<string, unknown>;
    const ref = record['$ref'];
    if (typeof ref === 'string') {
      record['$ref'] = refReplacements.get(ref) ?? ref;
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(schema);
  return schema;
}

function getZodV3RootName(name: string, schemaDefinitions: ZodSchemaDefinitions | undefined): string {
  let rootName = name;
  while (schemaDefinitions && Object.prototype.hasOwnProperty.call(schemaDefinitions, rootName)) {
    rootName = `${rootName}_root`;
  }
  return rootName;
}

function zodV3ToJsonSchema(
  schema: z3.ZodType,
  options: { name: string; schemaDefinitions?: ZodSchemaDefinitions | undefined },
): Record<string, unknown> {
  const rootName = getZodV3RootName(options.name, options.schemaDefinitions);
  const jsonSchema = _zodToJsonSchema(schema, {
    openaiStrictMode: true,
    name: rootName,
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    nullableStrategy: 'property',
    ...(options.schemaDefinitions ?
      { definitions: options.schemaDefinitions as unknown as Record<string, z3.ZodType> }
    : undefined),
  });

  return escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);
}

function zodV4ToJsonSchema(
  schema: ZodV4Schema,
  options: { schemaDefinitions?: ZodSchemaDefinitions | undefined } = {},
): Record<string, unknown> {
  const metadata = options.schemaDefinitions ? z4.registry<Record<string, unknown>>() : undefined;
  for (const [name, definition] of Object.entries(options.schemaDefinitions ?? {})) {
    metadata?.add(definition as unknown as z4.ZodType, { id: name });
  }

  const jsonSchema = toStrictJsonSchema(
    z4.toJSONSchema(schema, {
      target: 'draft-7',
      ...(metadata ? { metadata } : undefined),
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

  return escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);
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
  props?: ZodResponseFormatProps,
): AutoParseableResponseFormat<InferZodType<ZodInput>> {
  const zodSchema = zodObject as unknown as ZodSchema;
  const { schemaDefinitions, ...responseFormatProps } = props ?? {};
  validateSchemaDefinitions(schemaDefinitions);

  return makeParseableResponseFormat<InferZodType<ZodInput>>(
    {
      type: 'json_schema',
      json_schema: {
        ...responseFormatProps,
        name,
        strict: true,
        schema:
          isZodV4(zodSchema) ?
            zodV4ToJsonSchema(zodSchema, { schemaDefinitions })
          : zodV3ToJsonSchema(zodSchema, { name, schemaDefinitions }),
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
