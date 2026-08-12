import type { ZodEffectsDef } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';

export function parseEffectsDef(
  _def: ZodEffectsDef,
  refs: Refs,
  forceResolution: boolean,
): JsonSchema7Type | undefined {
  return refs.effectStrategy === 'input' ? parseDef(_def.schema._def, refs, forceResolution) : {};
}
