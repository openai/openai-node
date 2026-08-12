import type { ZodDefaultDef } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

export function parseDefaultDef(
  _def: ZodDefaultDef,
  refs: Refs,
  forceResolution: boolean,
): JsonSchema7Type & { default: any } {
  return {
    ...parseDef(_def.innerType._def, refs, forceResolution),
    default: _def.defaultValue(),
  };
}
