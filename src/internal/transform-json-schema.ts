import { pop } from './utils';

export type JSONSchema = Record<string, any>;

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function transformJSONSchema(jsonSchema: JSONSchema): JSONSchema {
  const workingCopy = deepClone(jsonSchema);
  return _transformJSONSchema(workingCopy);
}

function _transformJSONSchema(jsonSchema: JSONSchema): JSONSchema {
  const defs = pop(jsonSchema, '$defs');
  if (defs !== undefined) {
    const strictDefs: Record<string, any> = {};
    jsonSchema['$defs'] = strictDefs;
    for (const [name, defSchema] of Object.entries(defs)) {
      strictDefs[name] = _transformJSONSchema(defSchema as JSONSchema);
    }
  }

  const type = jsonSchema['type'];
  const anyOf = pop(jsonSchema, 'anyOf');
  const oneOf = pop(jsonSchema, 'oneOf');
  const allOf = pop(jsonSchema, 'allOf');

  if (Array.isArray(anyOf)) {
    jsonSchema['anyOf'] = anyOf.map((variant) => _transformJSONSchema(variant as JSONSchema));
  } else if (Array.isArray(oneOf)) {
    jsonSchema['anyOf'] = oneOf.map((variant) => _transformJSONSchema(variant as JSONSchema));
  } else if (Array.isArray(allOf)) {
    jsonSchema['allOf'] = allOf.map((entry) => _transformJSONSchema(entry as JSONSchema));
  } else {
    if (type === undefined) {
      throw new Error('JSON schema must have a type defined if anyOf/oneOf/allOf are not used');
    }

    switch (type) {
      case 'object': {
        const properties = pop(jsonSchema, 'properties') || {};
        jsonSchema['properties'] = Object.fromEntries(
          Object.entries(properties).map(([key, propSchema]) => [
            key,
            _transformJSONSchema(propSchema as JSONSchema),
          ]),
        );
        break;
      }
      case 'array': {
        const items = pop(jsonSchema, 'items');
        if (items !== undefined) {
          jsonSchema['items'] = _transformJSONSchema(items as JSONSchema);
        }
        break;
      }
    }
  }

  return jsonSchema;
}
