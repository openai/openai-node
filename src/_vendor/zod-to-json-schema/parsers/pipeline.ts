import type { ZodPipelineDef } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';
import type { JsonSchema7AllOfType } from './intersection';

export const parsePipelineDef = (
  def: ZodPipelineDef<any, any>,
  refs: Refs,
  forceResolution: boolean,
  outputRefs: Refs = refs,
): JsonSchema7AllOfType | JsonSchema7Type | undefined => {
  if (refs.pipeStrategy === 'input') {
    return parseDef(def.in._def, refs, forceResolution);
  } else if (refs.pipeStrategy === 'output') {
    return parseDef(def.out._def, outputRefs, forceResolution);
  }

  const a = parseDef(def.in._def, {
    ...refs,
    currentPath: [...refs.currentPath, 'allOf', '0'],
  });
  const b = parseDef(def.out._def, {
    ...outputRefs,
    currentPath: [...refs.currentPath, 'allOf', a ? '1' : '0'],
  });

  return {
    allOf: [a, b].filter((x): x is JsonSchema7Type => x !== undefined),
  };
};
