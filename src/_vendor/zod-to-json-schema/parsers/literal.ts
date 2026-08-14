import type { ZodLiteralDef } from 'zod/v3';
import type { Refs } from '../Refs';
import { parseNullDef } from './null';

export type JsonSchema7LiteralType =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean';
      const: string | number | boolean;
    }
  | {
      type: 'null';
      const?: null;
    }
  | {
      type: 'object' | 'array';
    };

export function parseLiteralDef(def: ZodLiteralDef, refs: Refs): JsonSchema7LiteralType {
  if (def.value === null) {
    return refs.target === 'openApi3' ? parseNullDef(refs) : { type: 'null', const: null };
  }

  const parsedType = typeof def.value;
  if (
    parsedType !== 'bigint' &&
    parsedType !== 'number' &&
    parsedType !== 'boolean' &&
    parsedType !== 'string'
  ) {
    return {
      type: Array.isArray(def.value) ? 'array' : 'object',
    };
  }

  if (refs.target === 'openApi3') {
    return {
      type: parsedType === 'bigint' ? 'integer' : parsedType,
      enum: [def.value],
    } as any;
  }

  return {
    type: parsedType === 'bigint' ? 'integer' : parsedType,
    const: def.value,
  };
}
