import type { JSONSchema } from '../lib/jsonschema';
import { pop } from '../internal/utils';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function transformJSONSchema(jsonSchema: JSONSchema): JSONSchema {
  const workingCopy = deepClone(jsonSchema);
  return _transformJSONSchema(workingCopy);
}

function _transformJSONSchema(jsonSchema: JSONSchema): JSONSchema {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    // e.g. base case for additionalProperties
    return jsonSchema;
  }

  const defs = pop(jsonSchema, '$defs');
  if (defs !== undefined) {
    const strictDefs: Record<string, JSONSchema> = {};
    jsonSchema.$defs = strictDefs;
    for (const [name, defSchema] of Object.entries(defs)) {
      strictDefs[name] = _transformJSONSchema(defSchema as JSONSchema);
    }
  }

  const type = jsonSchema.type;
  const anyOf = pop(jsonSchema, 'anyOf');
  const oneOf = pop(jsonSchema, 'oneOf');
  const allOf = pop(jsonSchema, 'allOf');
  const not = pop(jsonSchema, 'not');

  const shouldHaveType = [anyOf, oneOf, allOf, not].some(Array.isArray);
  if (!shouldHaveType && type === undefined) {
    throw new Error('JSON schema must have a type defined if anyOf/oneOf/allOf are not used');
  }

  if (Array.isArray(anyOf)) {
    jsonSchema.anyOf = anyOf.map((variant) => _transformJSONSchema(variant as JSONSchema));
  }

  if (Array.isArray(oneOf)) {
    // replace all oneOfs to anyOf
    jsonSchema.anyOf = oneOf.map((variant) => _transformJSONSchema(variant as JSONSchema));
    delete jsonSchema.oneOf;
  }

  if (Array.isArray(allOf)) {
    jsonSchema.allOf = allOf.map((entry) => _transformJSONSchema(entry as JSONSchema));
  }

  if (not !== undefined) {
    jsonSchema.not = _transformJSONSchema(not as JSONSchema);
  }

  const additionalProperties = pop(jsonSchema, 'additionalProperties');
  if (additionalProperties !== undefined) {
    jsonSchema.additionalProperties = _transformJSONSchema(additionalProperties as JSONSchema);
  }

  switch (type) {
    case 'object': {
      const properties = pop(jsonSchema, 'properties');
      if (properties !== undefined) {
        jsonSchema.properties = Object.fromEntries(
          Object.entries(properties).map(([key, propSchema]) => [
            key,
            _transformJSONSchema(propSchema as JSONSchema),
          ]),
        );
      }
      break;
    }
    case 'array': {
      const items = pop(jsonSchema, 'items');
      if (items !== undefined) {
        jsonSchema.items = _transformJSONSchema(items as JSONSchema);
      }
      break;
    }
  }

  return jsonSchema;
}
