import type { ZodTupleDef, ZodTupleItems, ZodTypeAny } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

export type JsonSchema7TupleType = {
  type: 'array';
  minItems: number;
  items: JsonSchema7Type[];
} & (
  | {
      maxItems: number;
    }
  | {
      additionalItems?: JsonSchema7Type | undefined;
    }
);

export function parseTupleDef(
  def: ZodTupleDef<ZodTupleItems | [], ZodTypeAny | null>,
  refs: Refs,
): JsonSchema7TupleType {
  if (def.rest) {
    return {
      type: 'array',
      minItems: def.items.length,
      items: def.items
        .map((x, i) =>
          parseDef(x._def, {
            ...refs,
            currentPath: [...refs.currentPath, 'items', `${i}`],
          }),
        )
        .filter((x): x is JsonSchema7Type => x !== undefined),
      additionalItems: parseDef(def.rest._def, {
        ...refs,
        currentPath: [...refs.currentPath, 'additionalItems'],
      }),
    };
  }
  return {
    type: 'array',
    minItems: def.items.length,
    maxItems: def.items.length,
    items: def.items
      .map((x, i) =>
        parseDef(x._def, {
          ...refs,
          currentPath: [...refs.currentPath, 'items', `${i}`],
        }),
      )
      .filter((x): x is JsonSchema7Type => x !== undefined),
  };
}
