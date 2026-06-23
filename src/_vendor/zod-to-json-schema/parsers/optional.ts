import { ZodOptionalDef } from 'zod/v3';
import { JsonSchema7Type, parseDef } from '../parseDef';
import { Refs } from '../Refs';

export const parseOptionalDef = (
  def: ZodOptionalDef,
  refs: Refs,
  forceResolution: boolean,
): JsonSchema7Type | undefined => {
  if (
    refs.propertyPath &&
    refs.currentPath.slice(0, refs.propertyPath.length).toString() === refs.propertyPath.toString()
  ) {
    return parseDef(def.innerType._def, { ...refs, currentPath: refs.currentPath }, forceResolution);
  }

  const innerSchema = parseDef(
    def.innerType._def,
    {
      ...refs,
      currentPath: [...refs.currentPath, 'anyOf', '1'],
    },
    forceResolution,
  );

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
