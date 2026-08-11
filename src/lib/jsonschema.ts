// File mostly copied from @types/json-schema, but stripped down a bit for brevity
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/817274f3280152ba2929a6067c93df8b34c4c9aa/types/json-schema/index.d.ts
//
// ==================================================================================================
// JSON Schema Draft 07
// ==================================================================================================
// https://tools.ietf.org/html/draft-handrews-json-schema-validation-01
// --------------------------------------------------------------------------------------------------

/**
 * A JSON value category accepted by a schema's `type` keyword.
 * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.1.1
 */
export type JSONSchemaTypeName =
  // oxlint-disable-next-line typescript/ban-types -- The empty intersection preserves literal-union widening for arbitrary JSON Schema type names.
  ({} & string) | 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/**
 * Any JSON-serializable primitive, object, array, or `null` value.
 * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.1.1
 */
export type JSONSchemaType =
  | string //
  | number
  | boolean
  | JSONSchemaObject
  | JSONSchemaArray
  | null;

/** A JSON object whose property values may themselves be nested JSON values. */
export interface JSONSchemaObject {
  /** A JSON-serializable property value addressed by its object key. */
  [key: string]: JSONSchemaType;
}

/** An array of JSON-serializable values, including nested arrays and objects. */
export interface JSONSchemaArray extends Array<JSONSchemaType> {
  /** The JSON-serializable value at a numeric array position. */
  [index: number]: JSONSchemaType;
}

/**
 * Meta schema
 *
 * Recommended values:
 * - 'http://json-schema.org/schema#'
 * - 'http://json-schema.org/hyper-schema#'
 * - 'http://json-schema.org/draft-07/schema#'
 * - 'http://json-schema.org/draft-07/hyper-schema#'
 *
 * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-5
 */
export type JSONSchemaVersion = string;

/**
 * JSON Schema v7
 * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01
 */
export type JSONSchemaDefinition = JSONSchema | boolean;
/** A JSON Schema document or subschema accepted by SDK function and structured-output helpers. */
export interface JSONSchema {
  /** URI identifying the JSON Schema dialect used by this document. */
  $schema?: JSONSchemaVersion | undefined;
  /** URI identifying this schema resource and establishing its reference base. */
  $id?: string | undefined;
  /** Implementation-facing comment that does not affect instance validation. */
  $comment?: string | undefined;

  /**
   * JSON value category, or categories, accepted by this schema.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.1
   */
  type?: JSONSchemaTypeName | JSONSchemaTypeName[] | undefined;
  /** The complete set of literal values accepted by this schema. */
  enum?: JSONSchemaType[] | undefined;
  /** The single literal value accepted by this schema. */
  const?: JSONSchemaType | undefined;

  /**
   * Requires a numeric instance to be an exact multiple of this value.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.2
   */
  multipleOf?: number | undefined;
  /** The greatest numeric value accepted, including the boundary. */
  maximum?: number | undefined;
  /** The upper numeric boundary, which the instance must be strictly less than. */
  exclusiveMaximum?: number | undefined;
  /** The smallest numeric value accepted, including the boundary. */
  minimum?: number | undefined;
  /** The lower numeric boundary, which the instance must be strictly greater than. */
  exclusiveMinimum?: number | undefined;

  /**
   * The maximum number of Unicode characters accepted in a string.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.3
   */
  maxLength?: number | undefined;
  /** The minimum number of Unicode characters required in a string. */
  minLength?: number | undefined;
  /** A regular expression that matching string instances must satisfy. */
  pattern?: string | undefined;
  /** Encoding used by a string that represents non-text content, such as `base64`. */
  contentEncoding?: string | undefined;
  /** Media type describing content represented by a string instance. */
  contentMediaType?: string | undefined;

  /**
   * A schema shared by array items, or position-specific schemas for tuple items.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.4
   */
  items?: JSONSchemaDefinition | JSONSchemaDefinition[] | undefined;
  /** Schema applied to array items beyond the explicitly defined tuple positions. */
  additionalItems?: JSONSchemaDefinition | undefined;
  /** The maximum number of items accepted in an array. */
  maxItems?: number | undefined;
  /** The minimum number of items required in an array. */
  minItems?: number | undefined;
  /** Whether every array item must be distinct from every other item. */
  uniqueItems?: boolean | undefined;
  /** A schema that at least one array item must satisfy. */
  contains?: JSONSchemaDefinition | undefined;

  /**
   * The maximum number of properties accepted in an object.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.5
   */
  maxProperties?: number | undefined;
  /** The minimum number of properties required in an object. */
  minProperties?: number | undefined;
  /** Property names that must be present in a valid object. */
  required?: string[] | undefined;
  /** Schemas associated with explicitly named object properties. */
  properties?: Record<string, JSONSchemaDefinition> | undefined;
  /** Schemas applied to properties whose names match each regular-expression key. */
  patternProperties?: Record<string, JSONSchemaDefinition> | undefined;
  /** Schema for properties not covered by `properties` or `patternProperties`. */
  additionalProperties?: JSONSchemaDefinition | undefined;
  /** Schema that every property name in an object must satisfy. */
  propertyNames?: JSONSchemaDefinition | undefined;

  /**
   * Condition that selects the `then` or `else` validation schema.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.6
   */
  if?: JSONSchemaDefinition | undefined;
  /** Schema applied when the instance satisfies the `if` condition. */
  then?: JSONSchemaDefinition | undefined;
  /** Schema applied when the instance does not satisfy the `if` condition. */
  else?: JSONSchemaDefinition | undefined;

  /**
   * Subschemas that the instance must all satisfy.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.7
   */
  allOf?: JSONSchemaDefinition[] | undefined;
  /** Alternative subschemas, at least one of which the instance must satisfy. */
  anyOf?: JSONSchemaDefinition[] | undefined;
  /** Alternative subschemas, exactly one of which the instance must satisfy. */
  oneOf?: JSONSchemaDefinition[] | undefined;
  /** A subschema that the instance must not satisfy. */
  not?: JSONSchemaDefinition | undefined;

  /**
   * Reusable subschemas that can be targeted by local `$ref` pointers.
   *
   * @see https://json-schema.org/draft/2020-12/json-schema-core.html#section-8.2.4
   */
  $defs?: Record<string, JSONSchemaDefinition> | undefined;

  /**
   * Legacy reusable subschemas that can be targeted by local `$ref` pointers.
   *
   * @deprecated Use $defs instead (draft 2019-09+)
   * @see https://tools.ietf.org/doc/html/draft-handrews-json-schema-validation-01#page-22
   */
  definitions?: Record<string, JSONSchemaDefinition> | undefined;

  /**
   * URI reference identifying another schema to apply at this position.
   *
   * @see https://json-schema.org/draft/2020-12/json-schema-core#ref
   */
  $ref?: string | undefined;

  /**
   * Semantic format annotation, such as `date-time`, `email`, or `uri`.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-7
   */
  format?: string | undefined;

  /**
   * A short, human-readable title describing the schema.
   *
   * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-10
   */
  title?: string | undefined;
  /** Human-readable explanation of the value accepted by the schema. */
  description?: string | undefined;
  /** Suggested value to use when an instance value is not provided. */
  default?: JSONSchemaType | undefined;
  /** Whether this value should be treated as read-only by consumers. */
  readOnly?: boolean | undefined;
  /** Whether this value should be treated as write-only by consumers. */
  writeOnly?: boolean | undefined;
  /** Representative example value or values illustrating this schema. */
  examples?: JSONSchemaType | undefined;
}
