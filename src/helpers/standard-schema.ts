import { OpenAIError } from '../error';
import {
  AutoParseableResponseFormat,
  AutoParseableTextFormat,
  AutoParseableTool,
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
} from '../lib/parser';
import { AutoParseableResponseTool, makeParseableResponseTool } from '../lib/ResponsesParser';
import { type JSONSchema } from '../lib/jsonschema';
import { toStrictJsonSchema } from '../lib/transform';
import { ResponseFormatJSONSchema } from '../resources/index';
import { type ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';

type StandardSchemaIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
};

type StandardSchemaResult<Output> =
  | {
      readonly value: Output;
      readonly issues?: undefined;
    }
  | {
      readonly issues: ReadonlyArray<StandardSchemaIssue>;
    };

type StandardJSONSchemaOptions = {
  readonly target: string;
  readonly libraryOptions?: Record<string, unknown> | undefined;
};

type StandardSchemaLike<Input = unknown, Output = Input> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly types?:
      | {
          readonly input: Input;
          readonly output: Output;
        }
      | undefined;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly jsonSchema?:
      | {
          readonly input: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
          readonly output?: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
        }
      | undefined;
  };
};

type InferStandardOutput<Schema extends StandardSchemaLike> = NonNullable<
  Schema['~standard']['types']
>['output'];

type StandardSchemaJSONSchemaProps = {
  /**
   * A JSON Schema override for Standard Schema implementations that do not
   * expose `~standard.jsonSchema.input()`.
   */
  schema?: JSONSchema | Record<string, unknown> | undefined;
};

type StandardResponseFormatProps = Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'> &
  StandardSchemaJSONSchemaProps;

type StandardTextFormatProps = Omit<
  ResponseFormatTextJSONSchemaConfig,
  'schema' | 'type' | 'strict' | 'name'
> &
  StandardSchemaJSONSchemaProps;

type StandardToolOptions<Parameters extends StandardSchemaLike> = {
  name: string;
  parameters: Parameters;
  /**
   * A JSON Schema override for Standard Schema implementations that do not
   * expose `~standard.jsonSchema.input()`.
   */
  schema?: JSONSchema | Record<string, unknown> | undefined;
  function?: ((args: InferStandardOutput<Parameters>) => unknown | Promise<unknown>) | undefined;
  description?: string | undefined;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

function formatStandardSchemaIssues(issues: ReadonlyArray<StandardSchemaIssue>): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) =>
          typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment,
        )
        .map(String)
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function normalizeStructuredOutputSchema(schema: JSONSchema): JSONSchema {
  const normalizedSchema = structuredClone(schema);

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    const record = value as Record<string, unknown>;
    if (Array.isArray(record['oneOf'])) {
      if (record['anyOf'] !== undefined) {
        throw new OpenAIError(
          'Standard JSON Schema generated both `anyOf` and `oneOf`, which cannot be represented in an OpenAI strict schema',
        );
      }

      record['anyOf'] = record['oneOf'];
      delete record['oneOf'];
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(normalizedSchema);
  return normalizedSchema;
}

function parseStandardSchema<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  content: string,
): InferStandardOutput<Schema> {
  const result = standardSchema['~standard'].validate(JSON.parse(content));

  if (isPromiseLike(result)) {
    throw new OpenAIError(
      'Standard Schema helpers only support synchronous validation. Use a schema with a synchronous `~standard.validate()` implementation.',
    );
  }

  if (result.issues) {
    throw new OpenAIError(`Standard Schema validation failed: ${formatStandardSchemaIssues(result.issues)}`);
  }

  return result.value as InferStandardOutput<Schema>;
}

function resolveStandardJSONSchema(
  standardSchema: StandardSchemaLike,
  schemaOverride?: JSONSchema | Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schema = (schemaOverride ?? standardSchema['~standard'].jsonSchema?.input({ target: 'draft-07' })) as
    | JSONSchema
    | undefined;

  if (!schema) {
    throw new OpenAIError(
      'Standard Schema helpers require a JSON Schema. Pass `schema` or use a schema that implements `~standard.jsonSchema.input()`.',
    );
  }

  return toStrictJsonSchema(normalizeStructuredOutputSchema(schema)) as unknown as Record<string, unknown>;
}

/**
 * Creates a chat completion `JSONSchema` response format from a Standard
 * Schema validator.
 *
 * The helper uses `~standard.jsonSchema.input()` for the model-facing schema
 * and `~standard.validate()` for parsed output. Validation must be
 * synchronous because the SDK's parse helpers are synchronous.
 */
export function standardResponseFormat<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  name: string,
  props?: StandardResponseFormatProps,
): AutoParseableResponseFormat<InferStandardOutput<Schema>> {
  const { schema, ...formatProps } = props ?? {};

  return makeParseableResponseFormat<InferStandardOutput<Schema>>(
    {
      type: 'json_schema',
      json_schema: {
        ...formatProps,
        name,
        strict: true,
        schema: resolveStandardJSONSchema(standardSchema, schema),
      },
    },
    (content) => parseStandardSchema(standardSchema, content),
  );
}

/**
 * Creates a Responses API `json_schema` text format from a Standard Schema
 * validator.
 */
export function standardTextFormat<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  name: string,
  props?: StandardTextFormatProps,
): AutoParseableTextFormat<InferStandardOutput<Schema>> {
  const { schema, ...formatProps } = props ?? {};

  return makeParseableTextFormat<InferStandardOutput<Schema>>(
    {
      type: 'json_schema',
      ...formatProps,
      name,
      strict: true,
      schema: resolveStandardJSONSchema(standardSchema, schema),
    },
    (content) => parseStandardSchema(standardSchema, content),
  );
}

/**
 * Creates a chat completion `function` tool from a Standard Schema
 * validator.
 */
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableTool<{
  arguments: InferStandardOutput<Parameters>;
  name: string;
  function: (args: InferStandardOutput<Parameters>) => unknown;
}> {
  // @ts-expect-error TODO
  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name: options.name,
        parameters: resolveStandardJSONSchema(options.parameters, options.schema),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
      },
    },
    {
      callback: options.function,
      parser: (args) => parseStandardSchema(options.parameters, args),
    },
  );
}

/**
 * Creates a Responses API `function` tool from a Standard Schema validator.
 */
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableResponseTool<{
  arguments: InferStandardOutput<Parameters>;
  name: string;
  function: (args: InferStandardOutput<Parameters>) => unknown;
}> {
  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name: options.name,
      parameters: resolveStandardJSONSchema(options.parameters, options.schema),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => parseStandardSchema(options.parameters, args),
    },
  );
}
