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

const MERGEABLE_OBJECT_ALL_OF_KEYWORDS = new Set([
  ...JSON_SCHEMA_ANNOTATION_KEYWORDS,
  'additionalProperties',
  'properties',
  'required',
  'type',
]);

export function toStrictJsonSchema(schema: JSONSchema): JSONSchema {
  if (schema.type !== 'object') {
    throw new Error(
      `Root schema must have type: 'object' but got type: ${schema.type ? `'${schema.type}'` : 'undefined'}`,
    );
  }

  const schemaCopy = structuredClone(schema);
  validateRefSchemas(schemaCopy, []);
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

  // Closing each object branch in an allOf independently changes the
  // intersection: sibling branches' properties become forbidden extras. Merge
  // the small object-intersection subset that can be represented exactly before
  // applying strict object closure, and fail closed for the rest.
  if (mergeObjectAllOf(jsonSchema, path)) {
    return ensureStrictJsonSchema(jsonSchema, path, root);
  }

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

  // Draft 7 only applies additionalItems to tuple-style items arrays. Recurse
  // into schema-valued extras so nested objects are strictified too; reject an
  // ignored additionalItems rather than sending a keyword whose semantics may
  // differ under Structured Outputs.
  const additionalItems = jsonSchema.additionalItems;
  if (additionalItems !== undefined) {
    if (!Array.isArray(items)) {
      throw new Error(
        `Schema at \`${
          path.join('/') || '<root>'
        }\` uses \`additionalItems\` without tuple \`items\`, which cannot be represented in strict Structured Outputs.`,
      );
    }
    if (typeof additionalItems !== 'boolean') {
      jsonSchema.additionalItems = ensureStrictJsonSchema(
        additionalItems,
        [...path, 'additionalItems'],
        root,
      );
    }
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
  if (ref === '#') {
    throw new Error('Cannot inline a root `$ref` with sibling annotations');
  }

  const resolved = resolveLocalRef(root, ref);
  if (resolved === undefined) {
    throw new Error(`Key not found while resolving ${ref}`);
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

function hasObjectShape(schema: JSONSchema): boolean {
  const typ = schema.type;
  return (
    typ === 'object' ||
    (Array.isArray(typ) && typ.includes('object')) ||
    (typ === undefined && hasObjectKeywords(schema))
  );
}

function validateRefSchemas(schema: JSONSchemaDefinition, path: string[]): void {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    return;
  }

  const ref = schema.$ref;
  if (ref !== undefined) {
    if (typeof ref !== 'string') {
      throw new TypeError(`Received non-string $ref - ${ref}; path=${path.join('/')}`);
    }
    if (ref !== '#' && !ref.startsWith('#/')) {
      throw new Error(
        `External $ref at \`${
          path.join('/') || '<root>'
        }\` is not supported in strict Structured Outputs: ${JSON.stringify(ref)}`,
      );
    }
    if (!hasOnlyRefAndAnnotations(schema)) {
      throw new Error(
        `Schema $ref at \`${
          path.join('/') || '<root>'
        }\` has non-annotation siblings that Draft 7 ignores and cannot be represented in strict Structured Outputs.`,
      );
    }
  }

  for (const keyword of JSON_SCHEMA_SINGLE_SCHEMA_KEYWORDS) {
    validateRefSchemas((schema as any)[keyword], [...path, keyword]);
  }

  for (const keyword of JSON_SCHEMA_ARRAY_SCHEMA_KEYWORDS) {
    const children = (schema as any)[keyword];
    if (Array.isArray(children)) {
      for (const [index, child] of children.entries()) {
        validateRefSchemas(child, [...path, keyword, String(index)]);
      }
    } else {
      validateRefSchemas(children, [...path, keyword]);
    }
  }

  for (const keyword of JSON_SCHEMA_MAP_SCHEMA_KEYWORDS) {
    const children = (schema as any)[keyword];
    if (isObject(children)) {
      for (const [key, child] of Object.entries(children)) {
        validateRefSchemas(child as JSONSchemaDefinition, [...path, keyword, key]);
      }
    }
  }
}

function mergeObjectAllOf(jsonSchema: JSONSchema, path: string[]): boolean {
  const allOf = jsonSchema.allOf;
  if (!Array.isArray(allOf) || allOf.length === 0) {
    return false;
  }

  const parentHasObjectShape = hasObjectShapeWithoutAllOf(jsonSchema);
  const objectBranches = allOf.filter(
    (entry): entry is JSONSchema => isObject(entry) && hasObjectShapeWithoutAllOf(entry),
  );
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
      !MERGEABLE_OBJECT_ALL_OF_KEYWORDS.has(keyword)
    ) {
      fail();
    }
  }

  const branches: JSONSchema[] = [];
  if (parentHasObjectShape) {
    branches.push(jsonSchema);
  }
  for (const entry of allOf) {
    if (!isObject(entry)) {
      fail();
    }
    const branch = entry as JSONSchema;
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

  const mergedProperties: Record<string, JSONSchemaDefinition> = {};
  const mergedRequired = new Set<string>();
  const closedPropertySets: Set<string>[] = [];
  let sawProperties = false;
  let sawRequired = false;
  let hasExplicitObjectType = false;

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
  for (const entry of allOf) {
    if (isObject(entry)) mergeAnnotations(entry);
  }

  for (const branch of branches) {
    for (const keyword of Object.keys(branch)) {
      if (keyword === 'allOf' && branch === jsonSchema) continue;
      if ((keyword === '$defs' || keyword === 'definitions') && branch === jsonSchema) continue;
      if (!MERGEABLE_OBJECT_ALL_OF_KEYWORDS.has(keyword)) {
        fail();
      }
    }

    if (branch.type !== undefined) {
      if (branch.type !== 'object') {
        fail();
      }
      hasExplicitObjectType = true;
    }

    if (branch.properties !== undefined) {
      if (!isObject(branch.properties)) {
        fail();
      }
      sawProperties = true;
      for (const [key, propertySchema] of Object.entries(branch.properties)) {
        if (key in mergedProperties && !schemasEqual(mergedProperties[key], propertySchema)) {
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

  if (hasExplicitObjectType) merged.type = 'object';
  if (sawProperties) merged.properties = mergedProperties;
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
    return schema.type === 'object';
  }
  return Object.keys(schema).some((keyword) => JSON_SCHEMA_OBJECT_KEYWORDS.has(keyword));
}

function schemasEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
