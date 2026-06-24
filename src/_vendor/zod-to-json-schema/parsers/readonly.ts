import { ZodReadonlyDef } from 'zod/v3';
import { parseDef } from '../parseDef';
import { Refs } from '../Refs';

export const parseReadonlyDef = (def: ZodReadonlyDef<any>, refs: Refs, forceResolution: boolean) => {
  return parseDef(def.innerType._def, refs, forceResolution);
};
