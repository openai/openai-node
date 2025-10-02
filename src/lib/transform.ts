import type { JSONSchema, JSONSchemaDefinition } from './jsonschema';

export function toStrictJsonSchema(schema: JSONSchema): JSONSchema {
  return ensureStrictJsonSchema(schema, [], schema);
}

function isNullable(schema: JSONSchemaDefinition): boolean {
  if (typeof schema === 'boolean') {
    return false;
  }
  for (const oneOfVariant of schema.oneOf ?? []) {
    if (typeof oneOfVariant !== 'boolean' && oneOfVariant.type === 'null') {
      return true;
    }
  }
  for (const allOfVariant of schema.anyOf ?? []) {
    if (typeof allOfVariant !== 'boolean' && allOfVariant.type === 'null') {
      return true;
    }
  }
  return false;
}

function ensureStrictJsonSchema(
  jsonSchema: JSONSchemaDefinition,
  path: string[],
  root: JSONSchema,
): JSONSchema {
  /**
   * Mutates the given JSON schema to ensure it conforms to the `strict` standard
   * that the API expects.
   */
  if (typeof jsonSchema === 'boolean') {
    throw new TypeError(`Expected object schema but got boolean; path=${path.join('/')}`);
  }

  if (!isDict(jsonSchema)) {
    throw new TypeError(`Expected ${JSON.stringify(jsonSchema)} to be a dictionary; path=${path.join('/')}`);
  }

  // Handle $defs (non-standard but sometimes used)
  const defs = (jsonSchema as any).$defs;
  if (isDict(defs)) {
    for (const [defName, defSchema] of Object.entries(defs)) {
      ensureStrictJsonSchema(defSchema, [...path, '$defs', defName], root);
    }
  }

  // Handle definitions (draft-04 style, deprecated in draft-07 but still used)
  const definitions = (jsonSchema as any).definitions;
  if (isDict(definitions)) {
    for (const [definitionName, definitionSchema] of Object.entries(definitions)) {
      ensureStrictJsonSchema(definitionSchema, [...path, 'definitions', definitionName], root);
    }
  }

  // Add additionalProperties: false to object types
  const typ = jsonSchema.type;
  if (typ === 'object' && !('additionalProperties' in jsonSchema)) {
    jsonSchema.additionalProperties = false;
  }

  const required = jsonSchema.required ?? [];

  // Handle object properties
  const properties = jsonSchema.properties;
  if (isDict(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      if (!isNullable(value) && !required.includes(key)) {
        throw new Error(
          `Zod field at \`${[...path, 'properties', key].join(
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
  if (isDict(items)) {
    // @ts-ignore(2345)
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
    if (allOf.length === 1) {
      const resolved = ensureStrictJsonSchema(allOf[0]!, [...path, 'allOf', '0'], root);
      Object.assign(jsonSchema, resolved);
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
      throw new TypeError(`Received non-string $ref - ${ref}`);
    }

    const resolved = resolveRef(root, ref);
    if (typeof resolved === 'boolean') {
      throw new Error(`Expected \`$ref: ${ref}\` to resolve to an object schema but got boolean`);
    }
    if (!isDict(resolved)) {
      throw new Error(
        `Expected \`$ref: ${ref}\` to resolve to a dictionary but got ${JSON.stringify(resolved)}`,
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
    if (!isDict(resolved)) {
      throw new Error(
        `encountered non-dictionary entry while resolving ${ref} - ${JSON.stringify(resolved)}`,
      );
    }
    const value = resolved[key];
    if (value === undefined) {
      throw new Error(`Key ${key} not found while resolving ${ref}`);
    }
    resolved = value;
  }

  return resolved;
}

function isDict(obj: any): obj is Record<string, any> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
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
