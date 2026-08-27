import { OpenAIError } from '../error';
import type { AutoParseableResponseFormat, AutoParseableTextFormat, AutoParseableTool } from '../lib/parser';
import {
  makeParseableResponseFormat,
  makeParseableTextFormat,
  makeParseableTool,
  parseResponseFormatContent,
} from '../lib/parser';
import type { AutoParseableResponseTool } from '../lib/ResponsesParser';
import { makeParseableResponseTool } from '../lib/ResponsesParser';
import type { JSONSchema } from '../lib/jsonschema';
import {
  assertNoNestedSchemaIds,
  forEachJSONSchemaChild,
  hasOnlyRefAndAnnotations,
  normalizeObjectAllOfForExclusivity,
  resolveLocalRef,
  rewriteLocalRefsIntoMovedOneOfBranches,
  toStrictJsonSchema,
} from '../lib/transform';
import type { ResponseFormatJSONSchema } from '../resources/index';
import type { ResponseFormatTextJSONSchemaConfig } from '../resources/responses/responses';

/** Validation issue returned by a Standard Schema-compatible validator. */
type StandardSchemaIssue = {
  /** Human-readable explanation of the validation failure. */
  readonly message: string;

  /** Optional path identifying the input property or array element that failed validation. */
  readonly path?:
    | readonly (
        | PropertyKey
        | {
            /** Property name, symbol, or array index associated with this path segment. */
            readonly key: PropertyKey;
          }
      )[]
    | undefined;
};

/** Successful parsed output or validation issues produced by a Standard Schema validator. */
type StandardSchemaResult<Output> =
  | {
      /** Parsed and validated value returned by a successful validation. */
      readonly value: Output;

      /** Validation issues are absent when parsing succeeds. */
      readonly issues?: undefined;
    }
  | {
      /** Validation issues describing why the input could not be parsed. */
      readonly issues: readonly StandardSchemaIssue[];
    };

/** JSON Schema conversion settings passed to a Standard Schema implementation. */
type StandardJSONSchemaOptions = {
  /** JSON Schema dialect required by the SDK's structured-output helpers. */
  readonly target: 'draft-07';

  /** Optional validator-specific JSON Schema conversion settings. */
  readonly libraryOptions?: Record<string, unknown> | undefined;
};

/** Minimal Standard Schema v1 validator contract accepted by the public parsing helpers. */
type StandardSchemaLike<Input = unknown, Output = Input> = {
  /** Standard Schema metadata, validation entrypoint, and optional JSON Schema conversion. */
  readonly '~standard': {
    /** Standard Schema specification version supported by the validator. */
    readonly version: 1;

    /** Identifier of the library that implements this Standard Schema validator. */
    readonly vendor: string;

    /** Optional type-level input and output metadata used to infer parsed result types. */
    readonly types?:
      | {
          /** Type accepted by the validator before parsing or transformation. */
          readonly input: Input;

          /** Type produced after successful validation or transformation. */
          readonly output: Output;
        }
      | undefined;

    /**
     * Validates model output; SDK parsing helpers require this method to finish synchronously.
     * Promise-returning validators are rejected when a response is parsed.
     */
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;

    /** Optional JSON Schema conversion methods; provide an explicit `schema` when absent. */
    readonly jsonSchema?:
      | {
          /** Produces the model-facing input JSON Schema for the requested dialect. */
          readonly input: (options: StandardJSONSchemaOptions) => Record<string, unknown>;

          /** Produces an optional output JSON Schema; structured-output helpers use `input` instead. */
          readonly output?: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
        }
      | undefined;
  };
};

/** Extracts parsed Standard Schema output, falling back to `unknown` without type metadata. */
type InferStandardOutput<Schema extends StandardSchemaLike> = [
  NonNullable<Schema['~standard']['types']>,
] extends [never]
  ? unknown
  : NonNullable<Schema['~standard']['types']> extends {
        /** Parsed output type declared by the Standard Schema validator's type metadata. */
        readonly output: infer Output;
      }
    ? Output
    : unknown;

/** Supplies a model-facing JSON Schema when a validator cannot generate one itself. */
type StandardSchemaJSONSchemaProps = {
  /**
   * A JSON Schema override for Standard Schema implementations that do not
   * expose `~standard.jsonSchema.input()`.
   */
  schema?: JSONSchema | Record<string, unknown> | undefined;
};

/** Optional Chat Completions response-format metadata and explicit JSON Schema override. */
type StandardResponseFormatProps = Omit<ResponseFormatJSONSchema.JSONSchema, 'schema' | 'strict' | 'name'> &
  StandardSchemaJSONSchemaProps;

/** Optional Responses API text-format metadata and explicit JSON Schema override. */
type StandardTextFormatProps = Omit<
  ResponseFormatTextJSONSchemaConfig,
  'schema' | 'type' | 'strict' | 'name'
> &
  StandardSchemaJSONSchemaProps;

/** Function callback invoked with arguments validated by a Standard Schema implementation. */
type StandardToolFunction<Parameters extends StandardSchemaLike> = (
  args: InferStandardOutput<Parameters>,
) => unknown | Promise<unknown>;

/** Model-facing function-tool settings and optional Standard Schema validation callback. */
type StandardToolOptions<Parameters extends StandardSchemaLike> = {
  /** Model-visible function name used to identify matching tool calls. */
  name: string;

  /** Standard Schema validator used to describe and validate the function's arguments. */
  parameters: Parameters;
  /**
   * A JSON Schema override for Standard Schema implementations that do not
   * expose `~standard.jsonSchema.input()`.
   */
  schema?: JSONSchema | Record<string, unknown> | undefined;

  /** Optional callback retained on the tool and invoked by compatible chat `runTools()` helpers. */
  function?: StandardToolFunction<Parameters> | undefined;

  /** Optional model-visible explanation of when and how the function should be used. */
  description?: string | undefined;
};

/** Type-level function-tool metadata preserving validated arguments and callback availability. */
type StandardToolReturnOptions<
  Parameters extends StandardSchemaLike,
  ToolFunction extends StandardToolFunction<Parameters> | undefined,
> = {
  /** Inferred argument type returned by the Standard Schema validator. */
  arguments: InferStandardOutput<Parameters>;

  /** Model-visible name used to match generated function calls. */
  name: string;

  /** Callback type when supplied, or `undefined` for a parse-only function tool. */
  function: ToolFunction;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

function formatStandardSchemaIssues(issues: readonly StandardSchemaIssue[]): string {
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
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return undefined;
  }

  const type = (schema as Record<string, unknown>)['type'];
  if (type === undefined) {
    return getLiteralSchemaTypes(schema);
  }
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
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return undefined;
  }

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

function getLiteralSchemaTypes(schema: unknown): Set<string> | undefined {
  const literalValues = getLiteralValues(schema);
  if (!literalValues) {
    return undefined;
  }

  return new Set(
    literalValues.map((value) => {
      if (value === null) {
        return 'null';
      }
      return typeof value;
    }),
  );
}

function haveDisjointLiteralValues(left: unknown, right: unknown): boolean {
  const leftValues = getLiteralValues(left);
  const rightValues = getLiteralValues(right);
  if (!leftValues || !rightValues) {
    return false;
  }

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

function haveDisjointObjectDiscriminator(left: unknown, right: unknown, root: JSONSchema): boolean {
  if (!isObjectOnlySchema(left) || !isObjectOnlySchema(right)) {
    return false;
  }

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
        resolveLocalRefForExclusivity((leftProperties as Record<string, unknown>)[property], root),
        resolveLocalRefForExclusivity((rightProperties as Record<string, unknown>)[property], root),
      )
    ) {
      return true;
    }
  }

  return false;
}

function getClosedObjectPropertySet(
  schema: unknown,
): { properties: Set<string>; required: string[] } | undefined {
  if (!isObjectOnlySchema(schema)) {
    return undefined;
  }

  const record = schema as Record<string, unknown>;
  const properties = record['properties'];
  const required = record['required'];
  if (
    record['additionalProperties'] !== false ||
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties) ||
    !Array.isArray(required) ||
    required.some((property) => typeof property !== 'string')
  ) {
    return undefined;
  }

  const propertySet = new Set(Object.keys(properties));
  const requiredProperties = required as string[];
  // A required undeclared property makes a closed branch unsatisfiable, but
  // the strictifier rejects that shape rather than representing it. Keep this
  // exclusivity proof conservative and let the normal validation path fail.
  if (requiredProperties.some((property) => !propertySet.has(property))) {
    return undefined;
  }

  return { properties: propertySet, required: requiredProperties };
}

function haveDisjointClosedObjectPropertySets(left: unknown, right: unknown): boolean {
  const leftShape = getClosedObjectPropertySet(left);
  const rightShape = getClosedObjectPropertySet(right);
  if (!leftShape || !rightShape) {
    return false;
  }

  // If either closed branch requires a property the other branch does not
  // declare, every instance satisfying the first is rejected by the second as
  // an additional property. This proves oneOf exclusivity without widening
  // overlapping closed shapes.
  return (
    leftShape.required.some((property) => !rightShape.properties.has(property)) ||
    rightShape.required.some((property) => !leftShape.properties.has(property))
  );
}

function areMutuallyExclusive(left: unknown, right: unknown, root: JSONSchema): boolean {
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

  return (
    haveDisjointLiteralValues(left, right) ||
    haveDisjointObjectDiscriminator(left, right, root) ||
    haveDisjointClosedObjectPropertySets(left, right)
  );
}

function resolveLocalRefForExclusivity(
  schema: unknown,
  root: JSONSchema,
  seenRefs = new Set<string>(),
): unknown | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const record = schema as Record<string, unknown>;
  const ref = record['$ref'];
  if (ref !== undefined) {
    // Annotation keywords do not affect Draft 7 validation, so they are safe
    // to retain while proving the referenced branches are mutually exclusive.
    // Keep the proof conservative for every other sibling constraint.
    if (typeof ref !== 'string' || !hasOnlyRefAndAnnotations(record as JSONSchema)) {
      return undefined;
    }
    if (seenRefs.has(ref)) {
      return undefined;
    }

    const resolved = resolveLocalRef(root, ref);
    if (resolved === undefined) {
      return undefined;
    }

    return resolveLocalRefForExclusivity(resolved, root, new Set([...seenRefs, ref]));
  }

  if (record['allOf'] !== undefined) {
    if (!Array.isArray(record['allOf'])) {
      return undefined;
    }
    const normalized = normalizeObjectAllOfForExclusivity(record as JSONSchema, root);
    if (normalized === undefined) {
      return undefined;
    }

    // Flattening a singleton allOf can expose a bare local ref. Feed that
    // result through this same resolver so URI-fragment decoding and the
    // existing local-ref cycle guard still apply before exclusivity analysis.
    return resolveLocalRefForExclusivity(normalized, root, seenRefs);
  }

  return schema;
}

function areOneOfBranchesMutuallyExclusive(branches: unknown[], root: JSONSchema): boolean {
  for (let index = 0; index < branches.length; index++) {
    for (let otherIndex = index + 1; otherIndex < branches.length; otherIndex++) {
      const left = resolveLocalRefForExclusivity(branches[index], root);
      const right = resolveLocalRefForExclusivity(branches[otherIndex], root);
      if (left === undefined || right === undefined || !areMutuallyExclusive(left, right, root)) {
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
  const visitedSchemas = new Set<Record<string, unknown>>();

  const visitSchema = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (visitedSchemas.has(record)) {
      return;
    }
    visitedSchemas.add(record);

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
      // `false` can never validate, so it cannot overlap another oneOf
      // branch. Keep it in place until the existing anyOf normalization runs
      // so local refs into surviving branch indices can be rewritten before
      // the impossible alternatives are removed.
      const possibleBranches = record['oneOf'].filter((branch) => branch !== false);
      if (!areOneOfBranchesMutuallyExclusive(possibleBranches, normalizedSchema)) {
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

type StandardSchemaBinding<Schema extends StandardSchemaLike> = {
  standard: Schema['~standard'];
  validate: Schema['~standard']['validate'];
};

function bindStandardSchema<Schema extends StandardSchemaLike>(standardSchema: Schema) {
  let binding: StandardSchemaBinding<Schema> | undefined;

  return (): StandardSchemaBinding<Schema> => {
    if (!binding) {
      const standard = standardSchema['~standard'];
      binding = { standard, validate: standard.validate };
    }
    return binding;
  };
}

function parseStandardSchema<Schema extends StandardSchemaLike>(
  getBinding: () => StandardSchemaBinding<Schema>,
  content: string,
): InferStandardOutput<Schema> {
  const parsed = parseResponseFormatContent({ type: 'json_schema', $parseRaw: undefined }, content);
  const { standard, validate } = getBinding();
  const result = Reflect.apply(validate, standard, [parsed]);

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

function resolveStandardJSONSchema<Schema extends StandardSchemaLike>(
  getBinding: () => StandardSchemaBinding<Schema>,
  schemaOverride?: JSONSchema | Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schema = (schemaOverride ?? getBinding().standard.jsonSchema?.input({ target: 'draft-07' })) as
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
 *
 * Pass the returned format to `client.chat.completions.parse()` to populate
 * `message.parsed`. Supply `props.schema` when the validator does not implement
 * `~standard.jsonSchema.input()`.
 *
 * @param standardSchema Standard Schema v1 validator used to describe and parse output.
 * @param name Model-visible name of the generated strict JSON Schema.
 * @param props Optional response-format metadata and explicit JSON Schema override.
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardResponseFormat<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  name: string,
  props?: StandardResponseFormatProps,
): AutoParseableResponseFormat<InferStandardOutput<Schema>> {
  const { schema, ...formatProps } = props ?? {};
  const getBinding = bindStandardSchema(standardSchema);

  return makeParseableResponseFormat<InferStandardOutput<Schema>>(
    {
      type: 'json_schema',
      json_schema: {
        ...formatProps,
        name,
        strict: true,
        schema: resolveStandardJSONSchema(getBinding, schema),
      },
    },
    (content) => parseStandardSchema(getBinding, content),
  );
}

/**
 * Creates a Responses API `json_schema` text format from a Standard Schema
 * validator.
 *
 * Pass the returned format as `text.format` to `client.responses.parse()` to
 * populate `response.output_parsed`. Validation must be synchronous. Supply
 * `props.schema` when the validator cannot generate its own input JSON Schema.
 *
 * @param standardSchema Standard Schema v1 validator used to describe and parse output.
 * @param name Model-visible name of the generated strict JSON Schema.
 * @param props Optional text-format metadata and explicit JSON Schema override.
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardTextFormat<Schema extends StandardSchemaLike>(
  standardSchema: Schema,
  name: string,
  props?: StandardTextFormatProps,
): AutoParseableTextFormat<InferStandardOutput<Schema>> {
  const { schema, ...formatProps } = props ?? {};
  const getBinding = bindStandardSchema(standardSchema);

  return makeParseableTextFormat<InferStandardOutput<Schema>>(
    {
      type: 'json_schema',
      ...formatProps,
      name,
      strict: true,
      schema: resolveStandardJSONSchema(getBinding, schema),
    },
    (content) => parseStandardSchema(getBinding, content),
  );
}

/**
 * Creates a chat completion `function` tool from a Standard Schema
 * validator and a callback that can be invoked by `chat.completions.runTools()`.
 *
 * The generated tool uses strict JSON Schema, and arguments are validated
 * synchronously before the callback receives them. Supply `options.schema`
 * when the validator cannot generate an input JSON Schema.
 *
 * @param options Model-visible function details, synchronous parameter validator,
 * optional schema override, and required execution callback.
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardFunction<
  Parameters extends StandardSchemaLike,
  ToolFunction extends StandardToolFunction<Parameters>,
>(
  options: StandardToolOptions<Parameters> & {
    /** Callback invoked with synchronously validated arguments by chat `runTools()`. */
    function: ToolFunction;
  },
): AutoParseableTool<StandardToolReturnOptions<Parameters, ToolFunction>>;

/**
 * Creates a parse-only Chat Completions function tool without an execution callback.
 *
 * Arguments are validated synchronously by `chat.completions.parse()` or
 * `.stream()`. Callback-free tools cannot be executed by `runTools()`.
 *
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters> & {
    /** No execution callback is attached to this parse-only function tool. */
    function?: undefined;
  },
): AutoParseableTool<StandardToolReturnOptions<Parameters, undefined>>;

/**
 * Creates a strict Chat Completions function tool with an optionally available callback.
 * The validator must support synchronous validation and provide or receive a JSON Schema.
 *
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableTool<StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>>;

/** Builds a strict Chat Completions function tool from a synchronous Standard Schema validator. */
export function standardFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
) {
  const name = options.name;
  const parameters = options.parameters;
  const getBinding = bindStandardSchema(parameters);

  return makeParseableTool<any>(
    {
      type: 'function',
      function: {
        name,
        parameters: resolveStandardJSONSchema(getBinding, options.schema),
        strict: true,
        ...(options.description ? { description: options.description } : undefined),
      },
    },
    {
      callback: options.function,
      parser: (args) => parseStandardSchema(getBinding, args),
    },
  );
}

/**
 * Creates a strict Responses API function tool from a Standard Schema validator and callback.
 *
 * `client.responses.parse()` validates matching function-call arguments and
 * exposes them as `parsed_arguments`; it does not execute the attached callback
 * or submit tool results. Validation must complete synchronously.
 *
 * @param options Model-visible function details, synchronous parameter validator,
 * optional schema override, and callback metadata.
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardResponsesFunction<
  Parameters extends StandardSchemaLike,
  ToolFunction extends StandardToolFunction<Parameters>,
>(
  options: StandardToolOptions<Parameters> & {
    /** Callback retained on the tool; `responses.parse()` does not execute it. */
    function: ToolFunction;
  },
): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, ToolFunction>>;

/**
 * Creates a parse-only Responses API function tool without an execution callback.
 * `responses.parse()` exposes synchronously validated arguments as `parsed_arguments`.
 *
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters> & {
    /** No execution callback is attached to this parse-only function tool. */
    function?: undefined;
  },
): AutoParseableResponseTool<StandardToolReturnOptions<Parameters, undefined>>;

/**
 * Creates a strict Responses API function tool with an optionally available callback.
 * Argument validation is synchronous; `responses.parse()` does not execute callbacks.
 *
 * @throws {OpenAIError} If no JSON Schema is available or its `oneOf` branches
 * cannot be represented safely.
 * @throws {Error} If strict normalization rejects another unsupported or
 * unrepresentable JSON Schema feature.
 * @throws {TypeError} If malformed JSON Schema values have unexpected structural types.
 */
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
): AutoParseableResponseTool<
  StandardToolReturnOptions<Parameters, StandardToolFunction<Parameters> | undefined>
>;

/** Builds a strict Responses API function tool from a synchronous Standard Schema validator. */
export function standardResponsesFunction<Parameters extends StandardSchemaLike>(
  options: StandardToolOptions<Parameters>,
) {
  const name = options.name;
  const parameters = options.parameters;
  const getBinding = bindStandardSchema(parameters);

  return makeParseableResponseTool<any>(
    {
      type: 'function',
      name,
      parameters: resolveStandardJSONSchema(getBinding, options.schema),
      strict: true,
      ...(options.description ? { description: options.description } : undefined),
    },
    {
      callback: options.function,
      parser: (args) => parseStandardSchema(getBinding, args),
    },
  );
}
