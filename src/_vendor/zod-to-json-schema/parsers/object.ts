import type { ZodObjectDef } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

function decideAdditionalProperties(def: ZodObjectDef, refs: Refs) {
  if (refs.removeAdditionalStrategy === 'strict') {
    return def.catchall._def.typeName === 'ZodNever'
      ? def.unknownKeys !== 'strict'
      : (parseDef(def.catchall._def, {
          ...refs,
          currentPath: [...refs.currentPath, 'additionalProperties'],
        }) ?? true);
  }
  return def.catchall._def.typeName === 'ZodNever'
    ? def.unknownKeys === 'passthrough'
    : (parseDef(def.catchall._def, {
        ...refs,
        currentPath: [...refs.currentPath, 'additionalProperties'],
      }) ?? true);
}

export type JsonSchema7ObjectType = {
  type: 'object';
  properties: Record<string, JsonSchema7Type>;
  additionalProperties: boolean | JsonSchema7Type;
  required?: string[];
};

export function parseObjectDef(def: ZodObjectDef, refs: Refs) {
  const properties: Record<string, JsonSchema7Type> = {};
  const required: string[] = [];
  for (const [propName, propDef] of Object.entries(def.shape())) {
    if (propDef === undefined || propDef._def === undefined) {
      continue;
    }
    const propertyPath = [...refs.currentPath, 'properties', propName];
    if (propName === '__proto__') {
      throw new Error(
        `Zod field at \`${propertyPath.join('/')}\` uses unsupported property name \`__proto__\`, which Zod omits from parsed output.`,
      );
    }
    const parsedDef = parseDef(propDef._def, {
      ...refs,
      currentPath: propertyPath,
      propertyPath,
    });
    if (parsedDef === undefined) {
      continue;
    }
    if (
      refs.openaiStrictMode &&
      propDef.isOptional() &&
      !propDef.isNullable() &&
      propDef._def?.defaultValue === undefined
    ) {
      throw new Error(
        `Zod field at \`${propertyPath.join(
          '/',
        )}\` uses \`.optional()\` without \`.nullable()\` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required`,
      );
    }
    properties[propName] = parsedDef;
    if (!propDef.isOptional() || refs.openaiStrictMode) {
      required.push(propName);
    }
  }

  const result: JsonSchema7ObjectType = {
    type: 'object',
    properties,
    required,
    additionalProperties: decideAdditionalProperties(def, refs),
  };
  if (!result.required!.length) {
    delete result.required;
  }
  return result;
}
