import { ZodOptionalDef } from 'zod';
import { JsonSchema7Type, parseDef } from '../parseDef';
import { Refs } from '../Refs';

export const parseOptionalDef = (def: ZodOptionalDef, refs: Refs): JsonSchema7Type | undefined => {
  if (refs.openaiStrictMode) {
    const fieldName = refs.propertyPath?.slice(-1)[0] || 'unknown';
    console.warn(
      `Warning: Field "${fieldName}" uses .optional() which is not supported by OpenAI API Structured Outputs. ` +
      `Please use .nullable() instead. ` +
      `See: https://platform.openai.com/docs/guides/structured-outputs#all-fields-must-be-required`
    );
  }

  if (refs.currentPath.toString() === refs.propertyPath?.toString()) {
    return parseDef(def.innerType._def, refs);
  }

  const innerSchema = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, 'anyOf', '1'],
  });

  return innerSchema ?
      {
        anyOf: [
          {
            not: {},
          },
          innerSchema,
        ],
      }
    : {};
};
