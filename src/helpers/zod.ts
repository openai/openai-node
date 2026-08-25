import type { ResponseFormatJSONSchema } from '../resources/index';
import * as z4 from 'zod/v4/core';
import type { AutoParseableResponseFormat, AutoParseableTextFormat, AutoParseableTool } from '../lib/parser';
import {
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
  parseResponseFormatContent,
} from '../lib/parser';
import type { AutoParseableResponseTool } from '../lib/ResponsesParser';
import { makeParseableResponseTool } from '../lib/ResponsesParser';
import type { ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';
import type { RealtimeFunctionTool } from '../resources/realtime/realtime';
import { forEachJSONSchemaChild, toStrictJsonSchema } from '../lib/transform';
import type { JSONSchema } from '../lib/jsonschema';
import { hasOwn } from '../internal/utils/values';

// The public helpers only need Zod's output type and, when available, parser. Using these small
// structural shapes avoids expanding Zod's full v4 type graphs in Deno.
/** Minimal Zod v4 or v4 Mini schema shape accepted by the public parsing helpers. */
interface ZodTypeLike {
  /** Zod v4 schema metadata that exposes the inferred parsed-output type. */
  _zod: {
    /** Inferred value produced after successful schema validation. */
    output: unknown;
  };

  /** Synchronous schema parser when the validator exposes an instance-level parse method. */
  parse?: (data: unknown) => unknown;
}

/** Extracts the validated output type from a supported Zod schema. */
type InferZodType<T extends ZodTypeLike> = T['_zod']['output'];

/** Named reusable Zod schemas extracted into a generated JSON Schema definitions object. */
type ZodSchemaDefinitions = Record<string, ZodTypeLike>;

/** Optional model-visible metadata and reusable schema definitions for a chat response format. */
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
  if (schemaDefinitions && hasOwn(schemaDefinitions, '__proto__')) {
    throw new Error('schemaDefinitions cannot include "__proto__" as a definition name');
  }
}

function assertZodV4Schema(schema: unknown, label = 'schema'): asserts schema is z4.$ZodType {
  if (typeof schema !== 'object' || schema === null || !('_zod' in schema)) {
    throw new TypeError(
      `${label} must be a Zod v4 or Zod v4 Mini schema; Zod v3 schemas are no longer supported. Import from \`zod/v4\` or \`zod/v4-mini\`.`,
    );
  }
}

function escapeSchemaDefinitionRefs<T extends object>(
  schema: T,
  schemaDefinitions: ZodSchemaDefinitions | undefined,
): T {
  const refReplacements = new Map(
    Object.keys(schemaDefinitions ?? {}).map((name) => [
      `#/definitions/${name}`,
      `#/definitions/${encodeSchemaDefinitionRefToken(name)}`,
    ]),
  );

  if (refReplacements.size === 0) {
    return schema;
  }

  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || visited.has(value)) {
      return;
    }

    visited.add(value);
    const record = value as Record<string, unknown>;
    const ref = record['$ref'];
    if (typeof ref === 'string') {
      const replacement = refReplacements.get(ref);
      if (replacement !== undefined && replacement !== ref) {
        record['$ref'] = replacement;
      }
    }

    forEachJSONSchemaChild(record, [], visit);
  };

  visit(schema);
  return schema;
}

function zodV4ToJsonSchema(
  schema: ZodTypeLike,
  options: { schemaDefinitions?: ZodSchemaDefinitions | undefined } = {},
): Record<string, unknown> {
  assertZodV4Schema(schema);
  const metadata = options.schemaDefinitions ? z4.registry<Record<string, unknown>>() : undefined;
  for (const [name, definition] of Object.entries(options.schemaDefinitions ?? {})) {
    assertZodV4Schema(definition, `schemaDefinitions.${name}`);
    metadata?.add(definition, { id: name });
  }

  const jsonSchema = z4.toJSONSchema(schema, {
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
  }) as JSONSchema;

  const escapedSchema = escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);

  return toStrictJsonSchema(escapedSchema) as Record<string, unknown>;
}

function zodV4ToNonStrictJsonSchema(schema: ZodTypeLike): Record<string, unknown> {
  assertZodV4Schema(schema);
  return z4.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>;
}

function parseZodObject<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  content: string,
): InferZodType<ZodInput> {
  const parsed = parseResponseFormatContent({ type: 'json_schema', $parseRaw: undefined }, content);
  const parser = (zodObject as { parse?: (data: unknown) => unknown }).parse;

  if (typeof parser === 'function') {
    return parser.call(zodObject, parsed) as InferZodType<ZodInput>;
  }

  return z4.parse(zodObject as unknown as z4.$ZodType, parsed) as InferZodType<ZodInput>;
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
 *
 * Supports Zod v4 schemas from `zod/v4`, `zod/v4-mini`, and `zod/v4/mini`.
 *
 * @param zodObject Zod schema used to generate and validate structured model output.
 * @param name Model-visible name of the generated strict JSON Schema.
 * @param props Optional response-format metadata and named reusable schema definitions.
 */
export function zodResponseFormat<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  name: string,
  props?: ZodResponseFormatProps,
): AutoParseableResponseFormat<InferZodType<ZodInput>> {
  const { schemaDefinitions, ...responseFormatProps } = props ?? {};
  validateSchemaDefinitions(schemaDefinitions);

  return makeParseableResponseFormat<InferZodType<ZodInput>>(
    {
      type: 'json_schema',
      json_schema: {
        ...responseFormatProps,
        name,
        strict: true,
        schema: zodV4ToJsonSchema(zodObject, { schemaDefinitions }),
      },
    },
    (content) => parseZodObject(zodObject, content),
  );
}

/**
 * Creates a strict Responses API text format that validates output with a Zod schema.
 *
 * Pass the returned format as `text.format` to `client.responses.parse()` to
 * populate `response.output_parsed` with the schema's inferred output type.
 * Calling `responses.create()` with the same format does not enable automatic
 * parsing. Zod v4 Classic and Mini schemas are supported.
 *
 * ```ts
 * const response = await client.responses.parse({
 *   model: 'gpt-5.5',
 *   input: 'Describe the weather.',
 *   text: { format: zodTextFormat(Weather, 'weather') },
 * });
 * console.log(response.output_parsed);
 * ```
 *
 * @param zodObject Zod schema used to generate and validate structured model output.
 * @param name Model-visible name of the generated strict JSON Schema.
 * @param props Optional model-visible text-format metadata, such as a description.
 */
export function zodTextFormat<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  name: string,
  props?: Omit<ResponseFormatTextJSONSchemaConfig, 'schema' | 'type' | 'strict' | 'name'>,
): AutoParseableTextFormat<InferZodType<ZodInput>> {
  return makeParseableTextFormat<InferZodType<ZodInput>>(
    {
      type: 'json_schema',
      ...props,
      name,
      strict: true,
      schema: zodV4ToJsonSchema(zodObject),
    },
    (content) => parseZodObject(zodObject, content),
  );
}

/**
 * Creates a chat completion `function` tool that can be invoked
 * automatically by the chat completion `.runTools()` method or automatically
 * parsed by `.parse()` / `.stream()`.
 *
 * Arguments are converted to strict JSON Schema and validated with the supplied
 * Zod schema before the optional callback receives them.
 *
 * @param options Model-visible function name, Zod parameter schema, description,
 * and optional callback used by `chat.completions.runTools()`.
 */
export function zodFunction<Parameters extends ZodTypeLike>(options: {
  /** Model-visible function name used to identify matching tool calls. */
  name: string;

  /** Zod schema used to describe and validate the function's JSON arguments. */
  parameters: Parameters;

  /** Optional callback invoked with validated arguments by chat `runTools()`. */
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;

  /** Optional model-visible explanation of when and how the function should be used. */
  description?: string | undefined;
}): AutoParseableTool<{
  /** Inferred argument type produced by the Zod parameter schema. */
  arguments: InferZodType<Parameters>;

  /** Model-visible name used to match generated function calls. */
  name: string;

  /** Callback signature associated with validated function-call arguments. */
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters: zodV4ToJsonSchema(options.parameters),
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

/**
 * Creates a strict Responses API function tool with Zod-validated arguments.
 *
 * Passing this tool to `client.responses.parse()` populates
 * `function_call.parsed_arguments` with the inferred schema output. Parsing a
 * response does not invoke the optional callback or submit tool results; the
 * application remains responsible for its function-execution loop.
 *
 * @param options Model-visible function name, Zod parameter schema, optional
 * description, and optional callback metadata.
 */
export function zodResponsesFunction<Parameters extends ZodTypeLike>(options: {
  /** Model-visible function name used to identify matching tool calls. */
  name: string;

  /** Zod schema used to describe and validate the function's JSON arguments. */
  parameters: Parameters;

  /** Optional callback retained on the tool; `responses.parse()` does not execute it. */
  function?: ((args: InferZodType<Parameters>) => unknown | Promise<unknown>) | undefined;

  /** Optional model-visible explanation of when and how the function should be used. */
  description?: string | undefined;
}): AutoParseableResponseTool<{
  /** Inferred argument type produced by the Zod parameter schema. */
  arguments: InferZodType<Parameters>;

  /** Model-visible name used to match generated function calls. */
  name: string;

  /** Callback signature associated with validated function-call arguments. */
  function: (args: InferZodType<Parameters>) => unknown;
}> {
  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters: zodV4ToJsonSchema(options.parameters),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => parseZodObject(options.parameters, args),
    },
  );
}

/**
 * Creates a Realtime API `function` tool definition from the given Zod schema.
 *
 * Unlike {@link zodResponsesFunction}, this helper does not add `strict`
 * because Realtime function tools do not support that field.
 *
 * This helper only creates the tool definition. Parse function-call arguments
 * from Realtime events with the original Zod schema.
 *
 * @param options Model-visible function name, Zod parameter schema, and description.
 */
export function zodRealtimeFunction<Parameters extends ZodTypeLike>(options: {
  /** Model-visible function name used to identify Realtime function calls. */
  name: string;

  /** Zod schema converted into the Realtime function's non-strict JSON Schema. */
  parameters: Parameters;

  /** Optional model-visible explanation of when and how the function should be used. */
  description?: string | undefined;
}): RealtimeFunctionTool {
  return {
    type: 'function',
    name: options.name,
    parameters: zodV4ToNonStrictJsonSchema(options.parameters),
    ...(options.description ? { description: options.description } : undefined),
  };
}
