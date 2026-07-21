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
import {
  assertNoNestedSchemaIds,
  forEachJSONSchemaChild,
  hasOnlyRefAndAnnotations,
  resolveLocalRef,
  rewriteLocalRefsIntoMovedOneOfBranches,
  toStrictJsonSchema,
} from '../lib/transform';
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
  readonly target: 'draft-07';
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

type StandardToolFunction<Parameters extends StandardSchemaLike> = (
  args: InferStandardOutput<Parameters>,
) => unknown | Promise<unknown>;

type StandardToolOptions<Parameters extends StandardSchemaLike> = {
  name: string;
  parameters: Parameters;
  /**
   * A JSON Schema override for Standard Schema implementations that do not
   * expose `~standard.jsonSchema.input()`.
   */
  schema?: JSONSchema | Record<string, unknown> | undefined;
  function?: StandardToolFunction<Parameters> | undefined;
  description?: string | undefined;
};

type StandardToolReturnOptions<
  Parameters extends StandardSchemaLike,
  Function extends StandardToolFunction<Parameters> | undefined,
> = {
  arguments: InferStandardOutput<Parameters>;
  name: string;
  function: Function;
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

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

type JSONPrimitive = string | number | boolean | null;

function getSchemaTypes(schema: unknown): Set<string> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;

  const type = (schema as Record<string, unknown>)['type'];
  const types = Array.isArray(type) ? type : [type];
  if (
    types.length === 0 ||
    !types.every((value) => typeof value === 'string' && JSON_SCHEMA_TYPES.has(value))
  ) {
    return undefined;
  }

  return new Set(types);
}

function isJSONPrimitive(value: unknown): value is JSONPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function getLiteralValues(schema: unknown): JSONPrimitive[] | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;

  const record = schema as Record<string, unknown>;
  if ('const' in record && isJSONPrimitive(record['const'])) {
    return [record['const']];
  }

  const enumValues = record['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0 && enumValues.every(isJSONPrimitive)) {
    return enumValues;
  }

  return undefined;
}

function haveDisjointLiteralValues(left: unknown, right: unknown): boolean {
  const leftValues = getLiteralValues(left);
  const rightValues = getLiteralValues(right);
  if (!leftValues || !rightValues) return false;

  return leftValues.every((leftValue) => !rightValues.some((rightValue) => leftValue === rightValue));
}

function schemaTypesOverlap(left: string, right: string): boolean {
  return (
    left === right || (left === 'integer' && right === 'number') || (left === 'number' && right === 'integer')
  );
}

function isObjectOnlySchema(schema: unknown): boolean {
  const types = getSchemaTypes(schema);
  return types?.size === 1 && types.has('object');
}

function haveDisjointObjectDiscriminator(left: unknown, right: unknown): boolean {
  if (!isObjectOnlySchema(left) || !isObjectOnlySchema(right)) return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftProperties = leftRecord['properties'];
  const rightProperties = rightRecord['properties'];
  const leftRequired = leftRecord['required'];
  const rightRequired = rightRecord['required'];
  if (
    !leftProperties ||
    typeof leftProperties !== 'object' ||
    Array.isArray(leftProperties) ||
    !rightProperties ||
    typeof rightProperties !== 'object' ||
    Array.isArray(rightProperties) ||
    !Array.isArray(leftRequired) ||
    !Array.isArray(rightRequired)
  ) {
    return false;
  }

  for (const property of leftRequired) {
    if (
      typeof property === 'string' &&
      rightRequired.includes(property) &&
      haveDisjointLiteralValues(
        (leftProperties as Record<string, unknown>)[property],
        (rightProperties as Record<string, unknown>)[property],
      )
    ) {
      return true;
    }
  }

  return false;
}

function areMutuallyExclusive(left: unknown, right: unknown): boolean {
  const leftTypes = getSchemaTypes(left);
  const rightTypes = getSchemaTypes(right);
  if (
    leftTypes &&
    rightTypes &&
    [...leftTypes].every((leftType) =>
      [...rightTypes].every((rightType) => !schemaTypesOverlap(leftType, rightType)),
    )
  ) {
    return true;
  }

  return haveDisjointLiteralValues(left, right) || haveDisjointObjectDiscriminator(left, right);
}

function resolveLocalRefForExclusivity(
  schema: unknown,
  root: JSONSchema,
  seenRefs: Set<string> = new Set(),
): unknown | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;

  const record = schema as Record<string, unknown>;
  const ref = record['$ref'];
  if (ref === undefined) return schema;

  // Annotation keywords do not affect Draft 7 validation, so they are safe to
  // retain while proving the referenced branches are mutually exclusive.
  // Keep the proof conservative for every other sibling constraint.
  if (typeof ref !== 'string' || !hasOnlyRefAndAnnotations(record as JSONSchema)) {
    return undefined;
  }
  if (seenRefs.has(ref)) return undefined;

  const resolved = resolveLocalRef(root, ref);
  if (resolved === undefined) return undefined;

  return resolveLocalRefForExclusivity(resolved, root, new Set([...seenRefs, ref]));
}

function areOneOfBranchesMutuallyExclusive(branches: unknown[], root: JSONSchema): boolean {
  for (let index = 0; index < branches.length; index++) {
    for (let otherIndex = index + 1; otherIndex < branches.length; otherIndex++) {
      const left = resolveLocalRefForExclusivity(branches[index], root);
      const right = resolveLocalRefForExclusivity(branches[otherIndex], root);
      if (left === undefined || right === undefined || !areMutuallyExclusive(left, right)) {
        return false;
      }
    }
  }

  return true;
}

function normalizeStructuredOutputSchema(schema: JSONSchema): JSONSchema {
  assertNoNestedSchemaIds(schema);
  const normalizedSchema = structuredClone(schema);
  const oneOfSchemas: Record<string, unknown>[] = [];

  const visitSchema = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (record['oneOf'] !== undefined) {
      if (!Array.isArray(record['oneOf'])) {
        throw new OpenAIError(
          'Standard JSON Schema generated an invalid `oneOf`, which cannot be represented in an OpenAI strict schema',
        );
      }
      if (record['anyOf'] !== undefined) {
        throw new OpenAIError(
          'Standard JSON Schema generated both `anyOf` and `oneOf`, which cannot be represented in an OpenAI strict schema',
        );
      }
      if (!areOneOfBranchesMutuallyExclusive(record['oneOf'], normalizedSchema)) {
        throw new OpenAIError(
          'Standard JSON Schema generated a `oneOf` whose branches are not provably mutually exclusive. OpenAI strict schemas do not support `oneOf`; use `anyOf` or add a discriminator with distinct literal values.',
        );
      }
      oneOfSchemas.push(record);
    }

    forEachJSONSchemaChild(record, [], (child) => visitSchema(child));
  };

  visitSchema(normalizedSchema);
  rewriteLocalRefsIntoMovedOneOfBranches(normalizedSchema);
  for (const record of oneOfSchemas) {
    record['anyOf'] = record['oneOf'];
    delete record['oneOf'];
  }
  return normalizedSchema;
}

function parseStandardSchema<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  content: string,
): InferStandardOutput<Schema> {
  const result = standardSchema['~standard'].validate(JSON.parse(content));

  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => undefined);
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
export function standardFunction<
  Parameters extends StandardSchemaLike,
  Function extends StandardToolFunction<Parameters>,
>(
  options: StandardToolOptions<Parameters> & { function: Function },
): AutoParseableTool<StandardToolReturnOptions<Parameters, Function>>;
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters> & { function?: undefined },
): AutoParseableTool<StandardToolReturnOptions<Parameters, undefined>>;
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableTool<StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>>;
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
) {
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
export function standardResponsesFunction<
  Parameters extends StandardSchemaLike,
  Function extends StandardToolFunction<Parameters>,
>(
  options: StandardToolOptions<Parameters> & { function: Function },
): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, Function>>;
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters> & { function?: undefined },
): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, undefined>>;
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableResponseTool<
  StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>
>;
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
) {
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
