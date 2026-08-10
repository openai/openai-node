import { ZodCatchDef } from 'zod/v3';
import { parseDef } from '../parseDef';
import { Refs } from '../Refs';

export const parseCatchDef = (def: ZodCatchDef<any>, refs: Refs, forceResolution: boolean) =>
  parseDef(def.innerType._def, refs, forceResolution);
