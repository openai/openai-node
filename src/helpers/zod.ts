import type { ResponseFormatJSONSchema } from '../resources/index';
import type * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';
import type * as z4Mini from 'zod/v4-mini';
import type { AutoParseableResponseFormat, AutoParseableTextFormat, AutoParseableTool } from '../lib/parser';
import {
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
  parseResponseFormatContent,
} from '../lib/parser';
import { zodToJsonSchema as _zodToJsonSchema } from '../_vendor/zod-to-json-schema';
import type { AutoParseableResponseTool } from '../lib/ResponsesParser';
import { makeParseableResponseTool } from '../lib/ResponsesParser';
import type { ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';
import type { RealtimeFunctionTool } from '../resources/realtime/realtime';
import { forEachJSONSchemaChild, toStrictJsonSchema } from '../lib/transform';
import type { JSONSchema } from '../lib/jsonschema';
import { hasOwn } from '../internal/utils/values';
import { assertJSONSerializableSchema, assertSupportedZodV3Schema } from './zod-v3-strict-schema';

type ZodV4Schema = z4.ZodType | z4Mini.ZodMiniType;
type ZodSchema = z3.ZodType | ZodV4Schema;

// The public helpers only need Zod's output type and, when available, parser. Using these small
// structural shapes avoids expanding Zod's full v3/v4 type graphs in Deno.
/** Minimal Zod v3, v4, or v4 Mini schema shape accepted by the public parsing helpers. */
type ZodTypeLike = (
  | {
      /** Inferred parsed-output type exposed by Zod v3 and compatible Zod schemas. */
      _output: unknown;
    }
  | {
      /** Zod v4 schema metadata that exposes the inferred parsed-output type. */
      _zod: {
        /** Inferred value produced after successful schema validation. */
        output: unknown;
      };
    }
) & {
  /** Synchronous schema parser when the validator exposes an instance-level parse method. */
  parse?: (data: unknown) => unknown;
};

/** Extracts the validated output type from a supported Zod schema. */
type InferZodType<T extends ZodTypeLike> = T extends {
  /** Parsed output type exposed directly by Zod v3 and compatible schemas. */
  _output: infer Output;
}
  ? Output
  : T extends {
        /** Zod v4 schema metadata containing its inferred parsed-output type. */
        _zod: {
          /** Parsed value type inferred from the Zod v4 schema. */
          output: infer Output;
        };
      }
    ? Output
    : never;

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

function getZodV3RootName(name: string, schemaDefinitions: ZodSchemaDefinitions | undefined): string {
  if (!schemaDefinitions) {
    return name;
  }

  let rootName = name;
  while (hasOwn(schemaDefinitions, rootName)) {
    rootName = `${rootName}_root`;
  }
  return rootName;
}

function zodV3ToJsonSchema(
  schema: z3.ZodType,
  options: { name: string; schemaDefinitions?: ZodSchemaDefinitions | undefined },
): Record<string, unknown> {
  assertSupportedZodV3Schema(schema, options.schemaDefinitions as Record<string, z3.ZodType> | undefined);
  const rootName = getZodV3RootName(options.name, options.schemaDefinitions);
  const jsonSchema = _zodToJsonSchema(schema, {
    openaiStrictMode: true,
    name: rootName,
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    nullableStrategy: 'property',
    ...(options.schemaDefinitions
      ? { definitions: options.schemaDefinitions as unknown as Record<string, z3.ZodType> }
      : undefined),
  });

  const escapedSchema = escapeSchemaDefinitionRefs(jsonSchema, options.schemaDefinitions);
  assertJSONSerializableSchema(escapedSchema);
  return escapedSchema;
}

function zodV4ToJsonSchema(
  schema: ZodV4Schema,
  options: { schemaDefinitions?: ZodSchemaDefinitions | undefined } = {},
): Record<string, unknown> {
  const metadata = options.schemaDefinitions ? z4.registry<Record<string, unknown>>() : undefined;
  for (const [name, definition] of Object.entries(options.schemaDefinitions ?? {})) {
    metadata?.add(definition as unknown as z4.ZodType, { id: name });
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

function zodV3ToNonStrictJsonSchema(schema: z3.ZodType, options: { name: string }): Record<string, unknown> {
  return _zodToJsonSchema(schema, {
    name: options.name,
    nameStrategy: 'duplicate-ref',
    $refStrategy: 'extract-to-root',
    pipeStrategy: 'input',
  });
}

function zodV4ToNonStrictJsonSchema(schema: ZodV4Schema): Record<string, unknown> {
  return z4.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
  }) as Record<string, unknown>;
}

function isZodV4(zodObject: ZodSchema): zodObject is ZodV4Schema {
  return '_zod' in zodObject;
}

function parseZodObject<ZodInput extends ZodTypeLike>(
  zodObject: ZodInput,
  content: string,
): InferZodType<ZodInput> {
  const parsed = parseResponseFormatContent({ type: 'json_schema', $parseRaw: undefined }, content);
  const parser = (zodObject as { parse?: (data: unknown) => unknown }).parse;

  if (typeof parser === 'function') {
    const result = parser.call(zodObject, parsed) as InferZodType<ZodInput>;
    if (!isZodV4(zodObject as unknown as ZodSchema)) {
      assertJSONSerializableSchema(result);
    }
    return result;
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
 *
 * Supports schemas from `zod/v3`, `zod/v4`, and `zod/v4-mini`.
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
        schema: isZodV4(zodSchema)
          ? zodV4ToJsonSchema(zodSchema, { schemaDefinitions })
          : zodV3ToJsonSchema(zodSchema, { name, schemaDefinitions }),
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
 * parsing. Schemas from `zod/v3`, `zod/v4`, and `zod/v4-mini` are supported.
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
  const zodSchema = options.parameters as unknown as ZodSchema;

  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters: isZodV4(zodSchema)
          ? zodV4ToJsonSchema(zodSchema)
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
  const zodSchema = options.parameters as unknown as ZodSchema;

  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters: isZodV4(zodSchema)
        ? zodV4ToJsonSchema(zodSchema)
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
  const zodSchema = options.parameters as unknown as ZodSchema;

  return {
    type: 'function',
    name: options.name,
    parameters: isZodV4(zodSchema)
      ? zodV4ToNonStrictJsonSchema(zodSchema)
      : zodV3ToNonStrictJsonSchema(zodSchema, { name: options.name }),
    ...(options.description ? { description: options.description } : undefined),
  };
}
