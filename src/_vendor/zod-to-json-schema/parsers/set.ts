import type { ZodSetDef } from 'zod/v3';
import type { ErrorMessages } from '../errorMessages';
import { setResponseValueAndErrors } from '../errorMessages';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

export type JsonSchema7SetType = {
  type: 'array';
  uniqueItems?: true;
  items?: JsonSchema7Type | undefined;
  minItems?: number;
  maxItems?: number;
  errorMessage?: ErrorMessages<JsonSchema7SetType>;
};

export function parseSetDef(def: ZodSetDef, refs: Refs): JsonSchema7SetType {
  if (refs.openaiStrictMode && (def.minSize?.value ?? 0) > 1) {
    throw new Error(
      `Zod field at \`${refs.currentPath.join('/')}\` uses \`ZodSet\` size constraints, which cannot be represented without the unsupported \`uniqueItems\` keyword.`,
    );
  }

  const items = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, 'items'],
  });

  const schema: JsonSchema7SetType = {
    type: 'array',
    ...(refs.openaiStrictMode ? undefined : { uniqueItems: true as const }),
    items,
  };

  if (def.minSize) {
    setResponseValueAndErrors(schema, 'minItems', def.minSize.value, def.minSize.message, refs);
  }

  if (def.maxSize) {
    setResponseValueAndErrors(schema, 'maxItems', def.maxSize.value, def.maxSize.message, refs);
  }

  return schema;
}
