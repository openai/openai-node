import type { JSONSchema, JSONSchemaDefinition } from './jsonschema';

const JSON_SCHEMA_ANNOTATION_KEYWORDS = new Set([
  'default',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

const JSON_SCHEMA_OBJECT_KEYWORDS = new Set([
  'additionalProperties',
  'dependencies',
  'maxProperties',
  'minProperties',
  'patternProperties',
  'properties',
  'propertyNames',
  'required',
]);

export function toStrictJsonSchema(schema: JSONSchema): JSONSchema {
  if (schema.type !== 'object') {
    throw new Error(
      `Root schema must have type: 'object' but got type: ${schema.type ? `'${schema.type}'` : 'undefined'}`,
    );
  }

  const schemaCopy = structuredClone(schema);
  return ensureStrictJsonSchema(schemaCopy, [], schemaCopy);
}

function isNullable(
  schema: JSONSchemaDefinition,
  root: JSONSchema,
  seenRefs: Set<string> = new Set(),
): boolean {
  if (typeof schema === 'boolean') {
    return schema;
  }

  const ref = schema.$ref;
  if (ref !== undefined) {
    // Annotation keywords do not constrain validation, so they are safe beside
    // a local ref. Keep the proof conservative for every other sibling because
    // resolving those correctly would require intersecting the referenced
    // schema and its sibling constraints.
    if (typeof ref !== 'string' || !hasOnlyRefAndAnnotations(schema) || seenRefs.has(ref)) {
      return false;
    }

    const resolved = resolveLocalRef(root, ref);
    if (resolved === undefined) {
      return false;
    }

    return isNullable(resolved, root, new Set([...seenRefs, ref]));
  }

  if (
    schema.type !== undefined &&
    schema.type !== 'null' &&
    !(Array.isArray(schema.type) && schema.type.includes('null'))
  ) {
    return false;
  }

  if ('const' in schema && schema.const !== null) {
    return false;
  }

  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.includes(null))) {
    return false;
  }

  if (schema.allOf !== undefined) {
    if (!Array.isArray(schema.allOf) || !schema.allOf.every((variant) => isNullable(variant, root))) {
      return false;
    }
  }

  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.some((variant) => isNullable(variant, root))) {
      return false;
    }
  }

  if (schema.oneOf !== undefined) {
    if (
      !Array.isArray(schema.oneOf) ||
      schema.oneOf.filter((variant) => isNullable(variant, root)).length !== 1
    ) {
      return false;
    }
  }

  // Conditional and negated schemas need a full JSON Schema evaluator to prove
  // that null is allowed. Treat them conservatively instead of accepting an
  // optional field that may not actually accept null.
  if (
    schema.not !== undefined ||
    schema.if !== undefined ||
    schema.then !== undefined ||
    schema.else !== undefined
  ) {
    return false;
  }

  return true;
}

/**
 * Mutates the given JSON schema to ensure it conforms to the `strict` standard
 * that the API expects.
 */
function ensureStrictJsonSchema(
  jsonSchema: JSONSchemaDefinition,
  path: string[],
  root: JSONSchema,
): JSONSchema {
  if (typeof jsonSchema === 'boolean') {
    throw new TypeError(`Expected object schema but got boolean; path=${path.join('/')}`);
  }

  if (!isObject(jsonSchema)) {
    throw new TypeError(`Expected ${JSON.stringify(jsonSchema)} to be an object; path=${path.join('/')}`);
  }

  // Handle $defs (non-standard but sometimes used)
  const defs = (jsonSchema as any).$defs;
  if (isObject(defs)) {
    for (const [defName, defSchema] of Object.entries(defs)) {
      ensureStrictJsonSchema(defSchema as JSONSchema, [...path, '$defs', defName], root);
    }
  }

  // Handle definitions (draft-04 style, deprecated in draft-07 but still used)
  const definitions = (jsonSchema as any).definitions;
  if (isObject(definitions)) {
    for (const [definitionName, definitionSchema] of Object.entries(definitions)) {
      ensureStrictJsonSchema(definitionSchema as JSONSchema, [...path, 'definitions', definitionName], root);
    }
  }

  // Add additionalProperties: false to object schemas. Draft 7 permits object
  // keywords without an explicit type, so those implicit object shapes need
  // the same strict handling as type: 'object'. Explicitly open object schemas
  // cannot be represented in Structured Outputs strict mode.
  const typ = jsonSchema.type;
  if (
    typ === 'object' ||
    (Array.isArray(typ) && typ.includes('object')) ||
    (typ === undefined && hasObjectKeywords(jsonSchema))
  ) {
    if (!('additionalProperties' in jsonSchema)) {
      jsonSchema.additionalProperties = false;
    } else if (jsonSchema.additionalProperties !== false) {
      throw new Error(
        `Object schema at \`${
          path.join('/') || '<root>'
        }\` must set \`additionalProperties: false\` to be compatible with strict Structured Outputs.`,
      );
    }
  }

  const required = jsonSchema.required ?? [];

  // Handle object properties
  const properties = jsonSchema.properties;
  if (isObject(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      if (!isNullable(value, root) && !required.includes(key)) {
        throw new Error(
          `Schema field at \`${[...path, 'properties', key].join(
            '/',
          )}\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required`,
        );
      }
    }
    jsonSchema.required = Object.keys(properties);
    jsonSchema.properties = Object.fromEntries(
      Object.entries(properties).map(([key, propSchema]) => [
        key,
        ensureStrictJsonSchema(propSchema, [...path, 'properties', key], root),
      ]),
    );
  }

  // Handle arrays
  const items = jsonSchema.items;
  if (Array.isArray(items)) {
    jsonSchema.items = items.map((item, i) =>
      ensureStrictJsonSchema(item, [...path, 'items', String(i)], root),
    );
  } else if (items !== undefined) {
    jsonSchema.items = ensureStrictJsonSchema(items, [...path, 'items'], root);
  }

  // Handle unions (anyOf)
  const anyOf = jsonSchema.anyOf;
  if (Array.isArray(anyOf)) {
    jsonSchema.anyOf = anyOf.map((variant, i) =>
      ensureStrictJsonSchema(variant, [...path, 'anyOf', String(i)], root),
    );
  }

  // Handle intersections (allOf)
  const allOf = jsonSchema.allOf;
  if (Array.isArray(allOf)) {
    if (allOf.length === 1 && hasOnlyAnnotationSiblings(jsonSchema, 'allOf')) {
      const resolved = ensureStrictJsonSchema(allOf[0]!, [...path, 'allOf', '0'], root);
      const annotations = { ...jsonSchema };
      delete annotations.allOf;
      Object.assign(jsonSchema, resolved, annotations);
      delete jsonSchema.allOf;
    } else {
      jsonSchema.allOf = allOf.map((entry, i) =>
        ensureStrictJsonSchema(entry, [...path, 'allOf', String(i)], root),
      );
    }
  }

  // Strip `null` defaults as there's no meaningful distinction
  if (jsonSchema.default === null) {
    delete jsonSchema.default;
  }

  // Handle $ref with additional properties
  const ref = (jsonSchema as any).$ref;
  if (ref && hasMoreThanNKeys(jsonSchema, 1)) {
    if (typeof ref !== 'string') {
      throw new TypeError(`Received non-string $ref - ${ref}; path=${path.join('/')}`);
    }

    const resolved = resolveRef(root, ref);
    if (typeof resolved === 'boolean') {
      throw new Error(`Expected \`$ref: ${ref}\` to resolve to an object schema but got boolean`);
    }
    if (!isObject(resolved)) {
      throw new Error(
        `Expected \`$ref: ${ref}\` to resolve to an object but got ${JSON.stringify(resolved)}`,
      );
    }

    // Properties from the json schema take priority over the ones on the `$ref`
    Object.assign(jsonSchema, { ...resolved, ...jsonSchema });
    delete (jsonSchema as any).$ref;

    // Since the schema expanded from `$ref` might not have `additionalProperties: false` applied,
    // we call `ensureStrictJsonSchema` again to fix the inlined schema and ensure it's valid.
    return ensureStrictJsonSchema(jsonSchema, path, root);
  }

  return jsonSchema;
}

function resolveRef(root: JSONSchema, ref: string): JSONSchemaDefinition {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unexpected $ref format ${JSON.stringify(ref)}; Does not start with #/`);
  }

  const pathParts = ref.slice(2).split('/');
  let resolved: any = root;

  for (const key of pathParts) {
    if (!isObject(resolved)) {
      throw new Error(`encountered non-object entry while resolving ${ref} - ${JSON.stringify(resolved)}`);
    }
    const value = resolved[key];
    if (value === undefined) {
      throw new Error(`Key ${key} not found while resolving ${ref}`);
    }
    resolved = value;
  }

  return resolved;
}

function resolveLocalRef(root: JSONSchema, ref: string): JSONSchemaDefinition | undefined {
  if (ref === '#') {
    return root;
  }
  if (!ref.startsWith('#/')) {
    return undefined;
  }

  let resolved: unknown = root;
  for (const encodedPart of ref.slice(2).split('/')) {
    const part = encodedPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(resolved) || !(part in resolved)) {
      return undefined;
    }
    resolved = resolved[part];
  }

  return resolved as JSONSchemaDefinition;
}

function isObject<T>(obj: T | Array<any>): obj is Extract<T, Record<string, any>> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function hasOnlyRefAndAnnotations(schema: JSONSchema): boolean {
  return Object.keys(schema).every(
    (keyword) => keyword === '$ref' || JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword),
  );
}

function hasOnlyAnnotationSiblings(schema: JSONSchema, keyword: string): boolean {
  return Object.keys(schema).every(
    (schemaKeyword) => schemaKeyword === keyword || JSON_SCHEMA_ANNOTATION_KEYWORDS.has(schemaKeyword),
  );
}

function hasObjectKeywords(schema: JSONSchema): boolean {
  return Object.keys(schema).some((keyword) => JSON_SCHEMA_OBJECT_KEYWORDS.has(keyword));
}

function hasMoreThanNKeys(obj: Record<string, any>, n: number): boolean {
  let i = 0;
  for (const _ in obj) {
    i++;
    if (i > n) {
      return true;
    }
  }
  return false;
}
