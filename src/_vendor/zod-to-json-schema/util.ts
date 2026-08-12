import type { ZodSchema, ZodTypeDef } from 'zod/v3';

export const zodDef = (zodSchema: ZodSchema | ZodTypeDef): ZodTypeDef =>
  '_def' in zodSchema ? zodSchema._def : zodSchema;

export function isEmptyObj(obj: object | null | undefined): boolean {
  if (!obj) {
    return true;
  }
  // oxlint-disable-next-line guard-for-in -- inherited enumerable properties make the object non-empty
  for (const _k in obj) {
    return false;
  }
  return true;
}
