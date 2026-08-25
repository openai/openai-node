import type { ZodOptionalDef } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

export const parseOptionalDef = (
  def: ZodOptionalDef,
  refs: Refs,
  forceResolution: boolean,
): JsonSchema7Type | undefined => {
  if (
    refs.propertyPath &&
    refs.currentPath.slice(0, refs.propertyPath.length).toString() === refs.propertyPath.toString()
  ) {
    const inner = parseDef(
      def.innerType._def,
      { ...refs, currentPath: refs.currentPath },
      forceResolution,
    );
    if (inner !== undefined) {
      return inner;
    }
    // An inner type that produces no schema. Inside a plain property that means
    // "omit the property", which is what `parseObjectDef` does with `undefined`.
    // A definition being materialized cannot be omitted, though: something already
    // holds a `$ref` to it, and returning nothing loses the `.describe()` text with
    // it, because `parseDef` only attaches metadata to a schema it actually got.
    // `forceResolution` is set only while materializing a definition.
    return forceResolution ? {} : undefined;
  }

  const innerSchema = parseDef(
    def.innerType._def,
    {
      ...refs,
      currentPath: [...refs.currentPath, 'anyOf', '1'],
    },
    forceResolution,
  );

  return innerSchema
    ? {
        anyOf: [
          {
            not: {},
          },
          innerSchema,
        ],
      }
    : {};
};
