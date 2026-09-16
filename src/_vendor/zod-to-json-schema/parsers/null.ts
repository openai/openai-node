import type { Refs } from '../Refs';

export type JsonSchema7NullType = {
  type: 'null';
};

export function parseNullDef(refs: Refs): JsonSchema7NullType {
  // SAFETY: The OpenAPI target uses nullable plus enum because its null representation differs from the JSON Schema return type.
  return refs.target === 'openApi3'
    ? ({
        enum: ['null'],
        nullable: true,
      } as any)
    : {
        type: 'null',
      };
}
