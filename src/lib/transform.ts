import type { JSONSchema, JSONSchemaDefinition } from './jsonschema';

const JSON_SCHEMA_ANNOTATION_KEYWORDS = new Set([
  '$comment',
  'default',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

const JSON_SCHEMA_ROOT_METADATA_KEYWORDS = new Set(['$id', '$schema']);

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

const JSON_SCHEMA_SINGLE_SCHEMA_KEYWORDS = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
];

const JSON_SCHEMA_ARRAY_SCHEMA_KEYWORDS = ['allOf', 'anyOf', 'items', 'oneOf', 'prefixItems'];

const JSON_SCHEMA_MAP_SCHEMA_KEYWORDS = [
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
  'patternProperties',
  'properties',
];

const JSON_SCHEMA_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  'allOf',
  'contains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'else',
  'if',
  'maxContains',
  'maxProperties',
  'minContains',
  'minProperties',
  'not',
  'patternProperties',
  'prefixItems',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
]);

const MERGEABLE_OBJECT_ALL_OF_KEYWORDS = new Set([
  ...JSON_SCHEMA_ANNOTATION_KEYWORDS,
  'additionalProperties',
  'properties',
  'required',
  'type',
]);

type JSONSchemaChildVisitor = (schema: unknown, path: string[], keyword: string) => void;

/**
 * Visits only values carried by JSON Schema keywords that contain schemas.
 * Literal payloads such as enum, const, and default deliberately do not
 * participate.
 */
export function forEachJSONSchemaChild(
  schema: JSONSchema | Record<string, unknown>,
  path: string[],
  visit: JSONSchemaChildVisitor,
): void {
  const record = schema as Record<string, unknown>;

  for (const keyword of JSON_SCHEMA_SINGLE_SCHEMA_KEYWORDS) {
    if (keyword in record) {
      visit(record[keyword], [...path, keyword], keyword);
    }
  }

  for (const keyword of JSON_SCHEMA_ARRAY_SCHEMA_KEYWORDS) {
    const children = record[keyword];
    if (Array.isArray(children)) {
      for (const [index, child] of children.entries()) {
        visit(child, [...path, keyword, String(index)], keyword);
      }
    } else if (children !== undefined) {
      visit(children, [...path, keyword], keyword);
    }
  }

  for (const keyword of JSON_SCHEMA_MAP_SCHEMA_KEYWORDS) {
    const children = record[keyword];
    if (!isObject(children)) continue;

    for (const [key, child] of Object.entries(children)) {
      // Draft 7 dependencies also permits property dependency arrays. They
      // are not schemas and must not be traversed as literal JSON payloads.
      if (keyword === 'dependencies' && !isSchemaDefinition(child)) continue;
      visit(child, [...path, keyword, key], keyword);
    }
  }
}

export function toStrictJsonSchema(schema: JSONSchema): JSONSchema {
  const schemaCopy = structuredClone(schema);
  // JSON serialization omits undefined object properties. Drop optional
  // placeholders before any structural checks so they cannot accidentally
  // look like validation-bearing schema keywords.
  stripUndefinedSchemaKeywords(schemaCopy);
  normalizeSingletonTypeArrays(schemaCopy);
  // Root ref/allOf normalization can promote a nested branch into the root.
  // Reject separate resource scopes while their original nesting is still
  // visible so branch-local definitions cannot be rebound at the root.
  assertNoNestedSchemaIds(schemaCopy);
  normalizeRootRefAndAllOf(schemaCopy);

  if (schemaCopy.type !== 'object') {
    throw new Error(
      `Root schema must have type: 'object' but got type: ${
        schemaCopy.type ? `'${schemaCopy.type}'` : 'undefined'
      }`,
    );
  }
  if (schemaCopy.anyOf !== undefined) {
    throw new Error(
      'Root schema must not use `anyOf` because strict Structured Outputs requires a root object without a union.',
    );
  }

  validateRefSchemas(schemaCopy, [], schemaCopy);
  preserveAllOfRefTargets(schemaCopy);
  validateRefSchemas(schemaCopy, [], schemaCopy);
  // Resolve representable object intersections before recursive
  // strictification closes referenced definitions. Otherwise a definition
  // reached through an allOf ref would be closed in isolation before its
  // sibling object properties can be merged.
  normalizeObjectAllOfBranches(schemaCopy, [], schemaCopy);
  const strictSchema = ensureStrictJsonSchema(schemaCopy, [], schemaCopy);
  validateRefSchemas(strictSchema, [], strictSchema);
  return strictSchema;
}

function stripUndefinedSchemaKeywords(
  schema: JSONSchemaDefinition,
  visited: Set<JSONSchema> = new Set(),
): void {
  if (typeof schema === 'boolean' || !isObject(schema) || visited.has(schema)) {
    return;
  }
  visited.add(schema);

  const schemaRecord = schema as Record<string, unknown>;
  for (const keyword of Object.keys(schemaRecord)) {
    if (schemaRecord[keyword] === undefined) {
      delete schemaRecord[keyword];
    }
  }

  forEachJSONSchemaChild(schema, [], (child) => {
    stripUndefinedSchemaKeywords(child as JSONSchemaDefinition, visited);
  });
}

/**
 * Root ref inlining and singleton allOf flattening can expose each other.
 * Iterate until flattening no longer produces another root ref so every
 * exactly representable chain reaches its final object form before the root
 * type check runs.
 */
function normalizeRootRefAndAllOf(schema: JSONSchema): void {
  const seenRefs = new Set<string>();
  while (true) {
    if (typeof schema.$ref === 'string') {
      if (seenRefs.has(schema.$ref)) {
        throw new Error('Cyclic local $ref at `<root>` is not supported: ' + JSON.stringify(schema.$ref));
      }
      seenRefs.add(schema.$ref);
    }

    inlineRootRefObject(schema);
    preserveAllOfRefTargets(schema, true);
    normalizeRootAllOf(schema);

    if (schema.$ref === undefined) {
      return;
    }
  }
}

/**
 * Some Standard Schema converters emit the root object through a local ref,
 * with the referenced schema stored in a root definition map. Structured
 * Outputs requires the root itself to be an object, so inline that safe,
 * definition-only form while keeping the root maps available for every local
 * pointer in the schema.
 */
function inlineRootRefObject(schema: JSONSchema): void {
  let ref = schema.$ref;
  if (ref === undefined) {
    return;
  }

  assertLocalRootRef(ref);
  if (!hasOnlyRootRefAndDefinitions(schema)) {
    throw new Error(
      'Schema $ref at `<root>` has non-metadata siblings that Draft 7 ignores and cannot be represented in strict Structured Outputs.',
    );
  }

  const seenRefs = new Set<string>();
  // Ref siblings are annotations in Draft 7, so keep them while following
  // aliases. Add outer annotations first so they win over inner aliases and
  // the final target when the effective root is assembled.
  const inheritedAnnotations: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).filter(([keyword]) => JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword)),
  );
  let resolved: JSONSchema;
  while (true) {
    if (seenRefs.has(ref)) {
      throw new Error('Cyclic local $ref at `<root>` is not supported: ' + JSON.stringify(ref));
    }
    seenRefs.add(ref);

    const target = resolveLocalRef(schema, ref);
    if (target === undefined) {
      throw new Error(
        'Local $ref at `<root>` does not resolve to an object or boolean schema: ' + JSON.stringify(ref),
      );
    }
    if (typeof target === 'boolean') {
      throw new TypeError('Expected object schema but got boolean; path=<root>');
    }

    const nextRef = target.$ref;
    if (nextRef === undefined) {
      resolved = target;
      break;
    }
    assertLocalRootRef(nextRef);
    if (seenRefs.has(nextRef)) {
      throw new Error('Cyclic local $ref at `<root>` is not supported: ' + JSON.stringify(nextRef));
    }
    if (!hasOnlyRefAndAnnotations(target)) {
      throw new Error(
        'Schema $ref in root chain has non-annotation siblings that Draft 7 ignores and cannot be represented in strict Structured Outputs.',
      );
    }
    for (const keyword of JSON_SCHEMA_ANNOTATION_KEYWORDS) {
      if (!(keyword in inheritedAnnotations) && keyword in target) {
        inheritedAnnotations[keyword] = (target as Record<string, unknown>)[keyword];
      }
    }
    ref = nextRef;
  }

  const rootDefinitions = schema.$defs;
  const legacyDefinitions = schema.definitions;
  const rootMetadata = Object.fromEntries(
    Object.entries(schema).filter(
      ([keyword]) =>
        JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword) || JSON_SCHEMA_ROOT_METADATA_KEYWORDS.has(keyword),
    ),
  );
  const inlined = structuredClone(resolved);
  // A target's definition map lives below the target's original pointer, not
  // at the document root. Keep the outer document map at the root so existing
  // absolute refs retain their meaning; the retained outer map also keeps the
  // target's nested map reachable at its original pointer.
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (schema[keyword] !== undefined && inlined[keyword] !== undefined) {
      delete inlined[keyword];
    }
  }
  const schemaRecord = schema as Record<string, unknown>;

  for (const keyword of Object.keys(schema)) {
    delete schemaRecord[keyword];
  }
  Object.assign(schema, inlined, inheritedAnnotations, rootMetadata);
  if (rootDefinitions !== undefined) {
    schema.$defs = rootDefinitions;
  }
  if (legacyDefinitions !== undefined) {
    schema.definitions = legacyDefinitions;
  }
}

/**
 * Root object validation runs before recursive strictification, so normalize
 * the same exactly representable allOf forms here that the recursive pass
 * handles for nested schemas.
 */
function normalizeRootAllOf(schema: JSONSchema): void {
  while (schema.allOf !== undefined) {
    if (mergeObjectAllOf(schema, [], schema)) {
      return;
    }

    const allOf = schema.allOf;
    if (!Array.isArray(allOf) || allOf.length !== 1 || !hasOnlyRootAllOfMetadataSiblings(schema)) {
      return;
    }

    const branch = allOf[0];
    if (typeof branch === 'boolean' || !isObject(branch)) {
      return;
    }

    const rootMetadata = { ...schema };
    delete rootMetadata.allOf;
    const normalized = structuredClone(branch);
    const schemaRecord = schema as Record<string, unknown>;

    for (const keyword of Object.keys(schema)) {
      delete schemaRecord[keyword];
    }
    Object.assign(schema, normalized, rootMetadata);
  }
}

function assertLocalRootRef(ref: unknown): asserts ref is string {
  if (typeof ref !== 'string') {
    throw new TypeError('Received non-string $ref - ' + String(ref) + '; path=<root>');
  }
  if (!ref.startsWith('#')) {
    throw new Error(
      'External $ref at `<root>` is not supported in strict Structured Outputs: ' + JSON.stringify(ref),
    );
  }
}

function hasOnlyRootRefAndDefinitions(schema: JSONSchema): boolean {
  return Object.keys(schema).every(
    (keyword) =>
      keyword === '$ref' ||
      keyword === '$defs' ||
      keyword === 'definitions' ||
      JSON_SCHEMA_ROOT_METADATA_KEYWORDS.has(keyword) ||
      JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword),
  );
}

/**
 * Draft 7 permits `type` to be either a string or an array of strings. A
 * singleton array has exactly the same validation semantics as its scalar
 * form, so canonicalize it before root validation and recursive strictifying.
 * Multi-type arrays carry real union semantics and must remain unchanged.
 */
function normalizeSingletonTypeArrays(schema: JSONSchemaDefinition): void {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return;
  }

  if (Array.isArray(schema.type) && schema.type.length === 1) {
    schema.type = schema.type[0]!;
  }

  forEachJSONSchemaChild(schema, [], (child) => {
    normalizeSingletonTypeArrays(child as JSONSchemaDefinition);
  });
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

  // Closing each object branch in an allOf independently changes the
  // intersection: sibling branches' properties become forbidden extras. Merge
  // the small object-intersection subset that can be represented exactly before
  // applying strict object closure, and fail closed for the rest.
  if (mergeObjectAllOf(jsonSchema, path, root)) {
    return ensureStrictJsonSchema(jsonSchema, path, root);
  }

  // Closing a type: object wrapper around object union branches without any
  // own properties would turn it into an empty object and forbid every branch
  // property. A bare object type is redundant when every branch already proves
  // the value is an object, so remove only that exact constraint; fail closed
  // for wrappers whose object constraints cannot be preserved mechanically.
  normalizeObjectUnionWrapper(jsonSchema, path, root);

  // Add additionalProperties: false to object schemas. Draft 7 permits object
  // keywords without an explicit type, so those implicit object shapes need
  // the same strict handling as type: 'object'. Explicitly open object schemas
  // cannot be represented in Structured Outputs strict mode.
  if (hasObjectShape(jsonSchema)) {
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
  if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) {
    throw new TypeError(
      `Expected \`required\` to be an array of strings; path=${path.join('/') || '<root>'}`,
    );
  }

  // Handle object properties
  const properties = jsonSchema.properties;
  if (hasObjectShape(jsonSchema)) {
    for (const key of required) {
      if (!isObject(properties) || !Object.prototype.hasOwnProperty.call(properties, key)) {
        throw new Error(
          `Object schema at \`${
            path.join('/') || '<root>'
          }\` requires property \`${key}\` but does not declare it in \`properties\`.`,
        );
      }
    }
  }
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
  }

  // Structured Outputs accepts one schema for every array item and does not
  // support Draft 7 tuples or additionalItems. Reject both forms rather than
  // advertising a schema whose array validation the API cannot preserve.
  const items = jsonSchema.items;
  const additionalItems = jsonSchema.additionalItems;
  if (Array.isArray(items)) {
    throw new Error(
      `Schema at \`${
        path.join('/') || '<root>'
      }\` uses tuple-form \`items\`, which cannot be represented in strict Structured Outputs.`,
    );
  }
  if (additionalItems !== undefined) {
    throw new Error(
      `Schema at \`${
        path.join('/') || '<root>'
      }\` uses unsupported keyword \`additionalItems\` and cannot be represented in strict Structured Outputs.`,
    );
  }

  // Handle intersections (allOf)
  const allOf = jsonSchema.allOf;
  if (Array.isArray(allOf)) {
    if (allOf.length === 1 && hasOnlyAnnotationSiblings(jsonSchema, 'allOf')) {
      const branch = allOf[0]!;
      if (branch === false) {
        throw new Error(
          `Schema at \`${
            path.join('/') || '<root>'
          }\` uses \`allOf: [false]\`, which cannot be represented in strict Structured Outputs.`,
        );
      }
      if (branch === true) {
        // true is the neutral schema for an intersection, so removing this
        // branch preserves validation while retaining the parent annotations.
        delete jsonSchema.allOf;
      } else {
        const resolved = ensureStrictJsonSchema(branch, [...path, 'allOf', '0'], root);
        const annotations = { ...jsonSchema };
        delete annotations.allOf;
        Object.assign(jsonSchema, resolved, annotations);
        delete jsonSchema.allOf;
      }
    }
  }

  normalizeArrayUnionWrapper(jsonSchema, root);

  const schemaRecord = jsonSchema as Record<string, unknown>;
  for (const keyword of JSON_SCHEMA_UNSUPPORTED_SCHEMA_KEYWORDS) {
    // Optional converter output often keeps undefined placeholders on the
    // JavaScript object even though JSON serialization omits them. They carry
    // no validation semantics, so treat only undefined as absent; every
    // defined value remains unsupported.
    if (schemaRecord[keyword] !== undefined) {
      throw new Error(
        `Schema at \`${
          path.join('/') || '<root>'
        }\` uses unsupported keyword \`${keyword}\` and cannot be represented in strict Structured Outputs.`,
      );
    }
    delete schemaRecord[keyword];
  }

  const type = jsonSchema.type;
  const currentItems = jsonSchema.items;
  if ((type === 'array' || (Array.isArray(type) && type.includes('array'))) && currentItems === undefined) {
    throw new Error(
      `Schema at \`${
        path.join('/') || '<root>'
      }\` declares an array without \`items\`, which cannot be represented in strict Structured Outputs.`,
    );
  }

  forEachJSONSchemaChild(jsonSchema, path, (child, childPath, keyword) => {
    // These boolean forms are already handled as parent-keyword semantics:
    // additionalProperties: false closes objects, while boolean
    // additionalItems does not contain a nested schema to strictify.
    if (typeof child === 'boolean' && (keyword === 'additionalProperties' || keyword === 'additionalItems')) {
      return;
    }

    ensureStrictJsonSchema(child as JSONSchemaDefinition, childPath, root);
  });

  // Strip `null` defaults as there's no meaningful distinction
  if (jsonSchema.default === null) {
    delete jsonSchema.default;
  }

  return jsonSchema;
}

function parseLocalRef(ref: string): string[] | undefined {
  if (!ref.startsWith('#')) {
    return undefined;
  }

  let pointer: string;
  try {
    // A local $ref is a URI fragment containing a JSON Pointer. RFC 6901
    // decodes the complete fragment before tokenizing the pointer, so an
    // encoded slash is a separator rather than part of a literal key.
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    return undefined;
  }

  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    return undefined;
  }

  const parts: string[] = [];
  for (const encodedPart of pointer.slice(1).split('/')) {
    // JSON Pointer only defines ~0 and ~1 escapes. Reject malformed escape
    // sequences instead of looking up a different literal key.
    if (/~(?:[^01]|$)/.test(encodedPart)) {
      return undefined;
    }
    parts.push(encodedPart.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  return parts;
}

function resolvePointerPart(resolved: unknown, part: string): unknown | undefined {
  if (Array.isArray(resolved)) {
    if (!/^(?:0|[1-9]\d*)$/.test(part)) {
      return undefined;
    }

    const index = Number(part);
    if (!Object.prototype.hasOwnProperty.call(resolved, index)) {
      return undefined;
    }
    return resolved[index];
  }

  if (!isObject(resolved) || !Object.prototype.hasOwnProperty.call(resolved, part)) {
    return undefined;
  }
  return resolved[part];
}

export function resolveLocalRef(root: JSONSchema, ref: string): JSONSchemaDefinition | undefined {
  const parts = parseLocalRef(ref);
  if (parts === undefined) {
    return undefined;
  }

  // Literal payloads such as `default`, `enum`, and `const` can contain
  // object-shaped values, but they are not schemas and are never traversed by
  // strictification. Resolve only the schema-bearing locations visited by
  // forEachJSONSchemaChild so every accepted target is normalized before we
  // advertise the result as strict.
  let resolved: unknown = root;
  for (let index = 0; index < parts.length; ) {
    if (!isObject(resolved)) {
      return undefined;
    }

    const keyword = parts[index]!;
    if (JSON_SCHEMA_SINGLE_SCHEMA_KEYWORDS.includes(keyword)) {
      resolved = resolvePointerPart(resolved, keyword);
      index += 1;
      continue;
    }

    if (JSON_SCHEMA_ARRAY_SCHEMA_KEYWORDS.includes(keyword)) {
      resolved = resolvePointerPart(resolved, keyword);
      index += 1;
      if (Array.isArray(resolved)) {
        if (index >= parts.length) {
          return undefined;
        }
        resolved = resolvePointerPart(resolved, parts[index]!);
        index += 1;
      }
      continue;
    }

    if (JSON_SCHEMA_MAP_SCHEMA_KEYWORDS.includes(keyword)) {
      const children = resolvePointerPart(resolved, keyword);
      index += 1;
      if (!isObject(children) || index >= parts.length) {
        return undefined;
      }

      resolved = resolvePointerPart(children, parts[index]!);
      if (keyword === 'dependencies' && !isSchemaDefinition(resolved)) {
        return undefined;
      }
      index += 1;
      continue;
    }

    return undefined;
  }

  return isSchemaDefinition(resolved) ? resolved : undefined;
}

function isObject<T>(obj: T | Array<any>): obj is Extract<T, Record<string, any>> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isSchemaDefinition(value: unknown): value is JSONSchemaDefinition {
  return typeof value === 'boolean' || isObject(value);
}

function isObjectOnlySchema(
  schema: JSONSchemaDefinition,
  root: JSONSchema,
  seenRefs: Set<string> = new Set(),
): boolean {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return false;
  }

  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== 'string' || !hasOnlyRefAndAnnotations(schema) || seenRefs.has(schema.$ref)) {
      return false;
    }

    const resolved = resolveLocalRef(root, schema.$ref);
    if (resolved === undefined) {
      return false;
    }

    return isObjectOnlySchema(resolved, root, new Set([...seenRefs, schema.$ref]));
  }

  return (
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'object')
  );
}

function isArrayOnlySchema(
  schema: JSONSchemaDefinition,
  root: JSONSchema,
  seenRefs: Set<string> = new Set(),
): boolean {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return false;
  }

  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== 'string' || !hasOnlyRefAndAnnotations(schema) || seenRefs.has(schema.$ref)) {
      return false;
    }

    const resolved = resolveLocalRef(root, schema.$ref);
    if (resolved === undefined) {
      return false;
    }

    return isArrayOnlySchema(resolved, root, new Set([...seenRefs, schema.$ref]));
  }

  return (
    schema.type === 'array' ||
    (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'array')
  );
}

export function hasOnlyRefAndAnnotations(schema: JSONSchema): boolean {
  return Object.keys(schema).every(
    // Definition maps do not add sibling validation constraints, and keeping
    // them in place preserves local pointers into a nested alias's scope.
    (keyword) =>
      keyword === '$ref' ||
      keyword === '$defs' ||
      keyword === 'definitions' ||
      JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword),
  );
}

function hasOnlyAnnotationSiblings(schema: JSONSchema, keyword: string): boolean {
  const schemaRecord = schema as Record<string, unknown>;
  return Object.keys(schema).every(
    // Definition maps do not add sibling validation constraints. Keep them
    // beside a flattened singleton allOf so refs into this nested scope stay
    // reachable at their original pointers.
    (schemaKeyword) =>
      schemaKeyword === keyword ||
      ((schemaKeyword === '$defs' || schemaKeyword === 'definitions') &&
        isObject(schemaRecord[schemaKeyword])) ||
      JSON_SCHEMA_ANNOTATION_KEYWORDS.has(schemaKeyword),
  );
}

function hasOnlyRootAllOfMetadataSiblings(schema: JSONSchema): boolean {
  return Object.keys(schema).every(
    (keyword) =>
      keyword === 'allOf' ||
      keyword === '$defs' ||
      keyword === 'definitions' ||
      JSON_SCHEMA_ROOT_METADATA_KEYWORDS.has(keyword) ||
      JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword),
  );
}

function hasObjectKeywords(schema: JSONSchema): boolean {
  return Object.keys(schema).some((keyword) => JSON_SCHEMA_OBJECT_KEYWORDS.has(keyword));
}

function hasObjectShape(schema: JSONSchema): boolean {
  const typ = schema.type;
  return (
    typ === 'object' ||
    (Array.isArray(typ) && typ.includes('object')) ||
    (typ === undefined && hasObjectKeywords(schema))
  );
}

function normalizeObjectUnionWrapper(jsonSchema: JSONSchema, path: string[], root: JSONSchema): void {
  if (jsonSchema.anyOf === undefined) {
    return;
  }

  const hasEmptyProperties =
    isObject(jsonSchema.properties) && Object.keys(jsonSchema.properties).length === 0;
  const hasEmptyRequired = Array.isArray(jsonSchema.required) && jsonSchema.required.length === 0;
  if (hasEmptyProperties) {
    delete jsonSchema.properties;
  }
  if (hasEmptyRequired) {
    delete jsonSchema.required;
  }

  if (!hasObjectShape(jsonSchema)) {
    return;
  }

  const hasOwnObjectConstraints = Object.keys(jsonSchema).some((keyword) =>
    JSON_SCHEMA_OBJECT_KEYWORDS.has(keyword),
  );
  if (
    jsonSchema.type === 'object' &&
    !hasOwnObjectConstraints &&
    Array.isArray(jsonSchema.anyOf) &&
    jsonSchema.anyOf.every((branch) => isObjectOnlySchema(branch, root))
  ) {
    delete jsonSchema.type;
    return;
  }

  throw new Error(
    'Object anyOf schema at `' +
      (path.join('/') || '<root>') +
      '` cannot be represented in strict Structured Outputs without changing Draft 7 validation.',
  );
}

function normalizeArrayUnionWrapper(jsonSchema: JSONSchema, root: JSONSchema): void {
  if (
    jsonSchema.type === 'array' &&
    jsonSchema.items === undefined &&
    Array.isArray(jsonSchema.anyOf) &&
    jsonSchema.anyOf.every((branch) => isArrayOnlySchema(branch, root))
  ) {
    // Every union branch already proves the value is an array. Keeping the
    // redundant wrapper would require an outer items schema that does not
    // contribute any Draft 7 validation.
    delete jsonSchema.type;
  }
}

export function assertNoNestedSchemaIds(schema: JSONSchema): void {
  const visit = (value: JSONSchemaDefinition, path: string[]): void => {
    if (typeof value === 'boolean' || !isObject(value)) {
      return;
    }

    if (path.length > 0 && value.$id !== undefined) {
      throw new Error(
        'Nested $id at ' +
          JSON.stringify(path.join('/')) +
          ' establishes a separate JSON Schema resource scope and cannot be represented in strict Structured Outputs.',
      );
    }

    forEachJSONSchemaChild(value, path, (child, childPath) => {
      visit(child as JSONSchemaDefinition, childPath);
    });
  };

  visit(schema, []);
}

function refTargetsAllOfBranch(root: JSONSchema, ref: string): boolean {
  const parts = parseLocalRef(ref);
  if (parts === undefined) {
    return false;
  }

  let resolved: unknown = root;
  for (const [index, part] of parts.entries()) {
    if (
      part === 'allOf' &&
      isObject(resolved) &&
      Array.isArray(resolved['allOf']) &&
      index < parts.length - 1
    ) {
      return true;
    }

    resolved = resolvePointerPart(resolved, part);
    if (resolved === undefined) {
      return false;
    }
  }

  return false;
}

function escapeJSONPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function encodeJSONPointerTokenForURIFragment(token: string): string {
  // `$` is a valid URI fragment sub-delimiter and keeping it readable retains
  // the conventional `#/$defs/...` spelling. Everything else that could
  // invalidate or retokenize the fragment (notably `%` and spaces) is encoded
  // after JSON Pointer escaping.
  return encodeURIComponent(escapeJSONPointerToken(token)).replace(/%24/g, '$');
}

/**
 * Standard Schema normalization moves representable oneOf branches to anyOf.
 * Rewrite only pointers that traverse an actual oneOf schema array while the
 * original tree is still intact, preserving escaped tokens for every other
 * path segment.
 */
export function rewriteLocalRefsIntoMovedOneOfBranches(root: JSONSchema): void {
  const rewriteRef = (ref: string): string => {
    const parts = parseLocalRef(ref);
    if (parts === undefined || parts.length === 0) {
      return ref;
    }

    let resolved: unknown = root;
    let changed = false;
    for (const [index, part] of parts.entries()) {
      if (
        part === 'oneOf' &&
        index < parts.length - 1 &&
        isObject(resolved) &&
        Array.isArray(resolved['oneOf'])
      ) {
        parts[index] = 'anyOf';
        changed = true;
      }

      resolved = resolvePointerPart(resolved, part);
      if (resolved === undefined) {
        return ref;
      }
    }

    return changed ? '#/' + parts.map(encodeJSONPointerTokenForURIFragment).join('/') : ref;
  };

  const rewriteRefs = (value: JSONSchemaDefinition): void => {
    if (typeof value === 'boolean' || !isObject(value)) {
      return;
    }

    if (typeof value.$ref === 'string') {
      value.$ref = rewriteRef(value.$ref);
    }

    forEachJSONSchemaChild(value, [], (child) => {
      rewriteRefs(child as JSONSchemaDefinition);
    });
  };

  rewriteRefs(root);
}

/**
 * Strictification removes every representable allOf. Preserve any schema
 * referenced through an allOf branch under a stable root definition first so
 * structural flattening cannot leave a dangling local pointer behind.
 */
function preserveAllOfRefTargets(root: JSONSchema, rootOnly = false): void {
  const refsToPreserve = new Set<string>();
  const collectRefs = (value: JSONSchemaDefinition): void => {
    if (typeof value === 'boolean' || !isObject(value)) {
      return;
    }

    if (typeof value.$ref === 'string' && refTargetsAllOfBranch(root, value.$ref)) {
      const pointerParts = parseLocalRef(value.$ref);
      if (!rootOnly || pointerParts?.[0] === 'allOf') {
        refsToPreserve.add(value.$ref);
      }
    }

    forEachJSONSchemaChild(value, [], (child) => {
      collectRefs(child as JSONSchemaDefinition);
    });
  };
  collectRefs(root);

  if (refsToPreserve.size === 0) {
    return;
  }

  if (root.$defs !== undefined && !isObject(root.$defs)) {
    throw new Error('Root schema has invalid $defs and cannot preserve local allOf references.');
  }
  const definitions = (root.$defs ??= {});
  const rewrittenRefs = new Map<string, string>();
  let aliasIndex = 0;

  for (const ref of refsToPreserve) {
    const target = resolveLocalRef(root, ref);
    if (!isSchemaDefinition(target)) {
      if (rootOnly) {
        continue;
      }
      throw new Error('Local $ref cannot be preserved before allOf flattening: ' + JSON.stringify(ref));
    }

    let alias = '__openai_strict_allOf_ref_' + aliasIndex++;
    while (Object.prototype.hasOwnProperty.call(definitions, alias)) {
      alias = '__openai_strict_allOf_ref_' + aliasIndex++;
    }
    definitions[alias] = structuredClone(target);
    rewrittenRefs.set(ref, '#/$defs/' + escapeJSONPointerToken(alias));
  }

  const rewriteRefs = (value: JSONSchemaDefinition): void => {
    if (typeof value === 'boolean' || !isObject(value)) {
      return;
    }

    if (typeof value.$ref === 'string') {
      value.$ref = rewrittenRefs.get(value.$ref) ?? value.$ref;
    }

    forEachJSONSchemaChild(value, [], (child) => {
      rewriteRefs(child as JSONSchemaDefinition);
    });
  };
  rewriteRefs(root);
}

function validateRefSchemas(schema: JSONSchemaDefinition, path: string[], root: JSONSchema): void {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return;
  }

  const ref = schema.$ref;
  if (ref !== undefined) {
    if (typeof ref !== 'string') {
      throw new TypeError(`Received non-string $ref - ${ref}; path=${path.join('/')}`);
    }
    if (!ref.startsWith('#')) {
      throw new Error(
        `External $ref at \`${
          path.join('/') || '<root>'
        }\` is not supported in strict Structured Outputs: ${JSON.stringify(ref)}`,
      );
    }
    const resolved = resolveLocalRef(root, ref);
    if (resolved === undefined || !isSchemaDefinition(resolved)) {
      throw new Error(
        `Local $ref at \`${
          path.join('/') || '<root>'
        }\` does not resolve to an object or boolean schema: ${JSON.stringify(ref)}`,
      );
    }
    if (typeof resolved === 'boolean') {
      throw new TypeError(`Expected object schema but got boolean; path=${path.join('/')}`);
    }
    if (!hasOnlyRefAndAnnotations(schema)) {
      throw new Error(
        `Schema $ref at \`${
          path.join('/') || '<root>'
        }\` has non-annotation siblings that Draft 7 ignores and cannot be represented in strict Structured Outputs.`,
      );
    }
  }

  forEachJSONSchemaChild(schema, path, (child, childPath) => {
    validateRefSchemas(child as JSONSchemaDefinition, childPath, root);
  });
}

type ResolvedObjectAllOfBranch = {
  schema: JSONSchema;
  refChain: JSONSchema[];
};

/**
 * Resolve only local aliases whose siblings carry no validation semantics.
 * Keeping this separate from general ref validation lets allOf merging inspect
 * the effective object shape without broadening which refs or sibling
 * constraints are accepted.
 */
function resolveObjectAllOfBranch(
  schema: JSONSchema,
  root: JSONSchema,
): ResolvedObjectAllOfBranch | undefined {
  const refChain = [schema];
  const seenRefs = new Set<string>();
  let resolved = schema;

  while (resolved.$ref !== undefined) {
    const ref = resolved.$ref;
    if (typeof ref !== 'string' || !hasOnlyRefAndAnnotations(resolved) || seenRefs.has(ref)) {
      return undefined;
    }
    seenRefs.add(ref);

    const target = resolveLocalRef(root, ref);
    if (typeof target === 'boolean' || !isObject(target)) {
      return undefined;
    }

    resolved = target;
    refChain.push(resolved);
  }

  return { schema: resolved, refChain };
}

function normalizeObjectAllOfBranches(schema: JSONSchemaDefinition, path: string[], root: JSONSchema): void {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return;
  }

  if (mergeObjectAllOf(schema, path, root)) {
    normalizeObjectAllOfBranches(schema, path, root);
    return;
  }

  forEachJSONSchemaChild(schema, path, (child, childPath) => {
    normalizeObjectAllOfBranches(child as JSONSchemaDefinition, childPath, root);
  });
}

/**
 * Standard Schema needs to prove oneOf branches exclusive before it rewrites
 * them to anyOf. Inspect a cloned branch through the same conservative object
 * allOf merger without mutating the caller's schema or broadening failures.
 */
export function normalizeObjectAllOfForExclusivity(
  schema: JSONSchema,
  root: JSONSchema,
): JSONSchema | undefined {
  const normalized = structuredClone(schema);
  try {
    return mergeObjectAllOf(normalized, [], root) ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function mergeObjectAllOf(jsonSchema: JSONSchema, path: string[], root: JSONSchema): boolean {
  const allOf = jsonSchema.allOf;
  if (!Array.isArray(allOf) || allOf.length === 0) {
    return false;
  }

  const parentHasObjectShape = hasObjectShapeWithoutAllOf(jsonSchema);
  const resolvedEntries = allOf.map((entry) =>
    isObject(entry) ? resolveObjectAllOfBranch(entry, root) : undefined,
  );
  const objectBranches = resolvedEntries
    .map((entry) => entry?.schema)
    .filter((entry): entry is JSONSchema => entry !== undefined && hasObjectShapeWithoutAllOf(entry));
  if (!parentHasObjectShape && objectBranches.length === 0) {
    return false;
  }
  // A lone object branch with no object-valued parent is handled by the
  // existing safe single-allOf flattening path below.
  if (!parentHasObjectShape && allOf.length === 1) {
    return false;
  }

  const fail = (): never => {
    throw new Error(
      `Object allOf at \`${
        path.join('/') || '<root>'
      }\` cannot be merged without changing Draft 7 validation.`,
    );
  };

  if (
    !parentHasObjectShape &&
    ['additionalProperties', 'properties', 'required', 'type'].some((keyword) => keyword in jsonSchema)
  ) {
    fail();
  }

  for (const keyword of Object.keys(jsonSchema)) {
    if (
      keyword !== 'allOf' &&
      keyword !== '$defs' &&
      keyword !== 'definitions' &&
      !(path.length === 0 && JSON_SCHEMA_ROOT_METADATA_KEYWORDS.has(keyword)) &&
      !MERGEABLE_OBJECT_ALL_OF_KEYWORDS.has(keyword)
    ) {
      fail();
    }
  }

  const branches: JSONSchema[] = [];
  if (parentHasObjectShape) {
    branches.push(jsonSchema);
  }
  for (const [index, entry] of allOf.entries()) {
    if (!isObject(entry)) {
      fail();
    }
    const resolvedEntry = resolvedEntries[index];
    if (resolvedEntry === undefined) {
      return fail();
    }
    const branch = resolvedEntry.schema;
    if (hasObjectShapeWithoutAllOf(branch)) {
      branches.push(branch);
    } else if (!Object.keys(branch).every((keyword) => JSON_SCHEMA_ANNOTATION_KEYWORDS.has(keyword))) {
      fail();
    }
  }

  const merged: JSONSchema = {};
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (jsonSchema[keyword] !== undefined) {
      merged[keyword] = jsonSchema[keyword];
    }
  }
  if (path.length === 0) {
    for (const keyword of JSON_SCHEMA_ROOT_METADATA_KEYWORDS) {
      if (keyword in jsonSchema) {
        (merged as Record<string, unknown>)[keyword] = (jsonSchema as Record<string, unknown>)[keyword];
      }
    }
  }

  const mergedProperties = Object.create(null) as Record<string, JSONSchemaDefinition>;
  const mergedRequired = new Set<string>();
  const closedPropertySets: Set<string>[] = [];
  let sawProperties = false;
  let sawRequired = false;
  let hasExplicitObjectType = false;
  let hasExplicitNullableObjectType = false;

  const mergeAnnotations = (schema: JSONSchema) => {
    for (const keyword of JSON_SCHEMA_ANNOTATION_KEYWORDS) {
      if (!(keyword in schema)) continue;
      if (keyword in merged && !schemasEqual((merged as any)[keyword], (schema as any)[keyword])) {
        fail();
      }
      (merged as any)[keyword] = (schema as any)[keyword];
    }
  };

  mergeAnnotations(jsonSchema);
  for (const resolvedEntry of resolvedEntries) {
    if (resolvedEntry === undefined) continue;
    for (const entry of resolvedEntry.refChain) {
      mergeAnnotations(entry);
    }
  }

  for (const branch of branches) {
    for (const keyword of Object.keys(branch)) {
      if (keyword === 'allOf' && branch === jsonSchema) continue;
      if (
        (keyword === '$defs' || keyword === 'definitions') &&
        isObject((branch as Record<string, unknown>)[keyword])
      ) {
        continue;
      }
      if (branch === jsonSchema && path.length === 0 && JSON_SCHEMA_ROOT_METADATA_KEYWORDS.has(keyword)) {
        continue;
      }
      if (!MERGEABLE_OBJECT_ALL_OF_KEYWORDS.has(keyword)) {
        fail();
      }
    }

    if (branch.type !== undefined) {
      if (!isMergeableObjectType(branch.type)) {
        fail();
      }
      if (branch.type === 'object') {
        hasExplicitObjectType = true;
      } else {
        hasExplicitNullableObjectType = true;
      }
    }

    if (branch.properties !== undefined) {
      if (!isObject(branch.properties)) {
        fail();
      }
      sawProperties = true;
      for (const [key, propertySchema] of Object.entries(branch.properties)) {
        if (
          Object.prototype.hasOwnProperty.call(mergedProperties, key) &&
          !schemasEqual(mergedProperties[key], propertySchema)
        ) {
          fail();
        }
        mergedProperties[key] = propertySchema;
      }
    }

    if (branch.required !== undefined) {
      if (!Array.isArray(branch.required) || branch.required.some((key) => typeof key !== 'string')) {
        fail();
      }
      sawRequired = true;
      for (const key of branch.required) mergedRequired.add(key);
    }

    if ('additionalProperties' in branch) {
      if (branch.additionalProperties !== false) {
        fail();
      }
      closedPropertySets.push(new Set(Object.keys(branch.properties ?? {})));
    }
  }

  const mergedPropertyNames = Object.keys(mergedProperties);
  if (closedPropertySets.some((keys) => mergedPropertyNames.some((key) => !keys.has(key)))) {
    fail();
  }

  if (hasExplicitObjectType || hasExplicitNullableObjectType) {
    merged.type = hasExplicitObjectType ? 'object' : ['object', 'null'];
  }
  if (sawProperties) merged.properties = Object.fromEntries(Object.entries(mergedProperties));
  if (sawRequired) merged.required = [...mergedRequired];
  if (closedPropertySets.length > 0) merged.additionalProperties = false;

  for (const keyword of Object.keys(jsonSchema)) {
    delete (jsonSchema as any)[keyword];
  }
  Object.assign(jsonSchema, merged);
  return true;
}

function hasObjectShapeWithoutAllOf(schema: JSONSchema): boolean {
  if (schema.type !== undefined) {
    return isMergeableObjectType(schema.type);
  }
  return Object.keys(schema).some((keyword) => JSON_SCHEMA_OBJECT_KEYWORDS.has(keyword));
}

function isMergeableObjectType(type: JSONSchema['type']): boolean {
  return (
    type === 'object' ||
    (Array.isArray(type) && type.length === 2 && type.includes('object') && type.includes('null'))
  );
}

function schemasEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => schemasEqual(value, right[index]));
  }

  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key, index) => key === rightKeys[index] && schemasEqual(leftRecord[key], rightRecord[key]),
  );
}
