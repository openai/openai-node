import { ZodBrandedDef } from 'zod/v3';
import { parseDef } from '../parseDef';
import { Refs } from '../Refs';

export function parseBrandedDef(_def: ZodBrandedDef<any>, refs: Refs, forceResolution: boolean) {
  return parseDef(_def.type._def, refs, forceResolution);
}
