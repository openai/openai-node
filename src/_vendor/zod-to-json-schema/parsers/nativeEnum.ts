import type { ZodNativeEnumDef } from 'zod/v3';

export type JsonSchema7NativeEnumType = {
  type: 'string' | 'number' | ['string', 'number'];
  enum: (string | number)[];
};

export function parseNativeEnumDef(def: ZodNativeEnumDef): JsonSchema7NativeEnumType {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter(
    (key: string) => typeof object[object[key]!] !== 'number',
  );

  const actualValues = actualKeys.map((key: string) => object[key]!);

  const parsedTypes = [...new Set(actualValues.map((values: string | number) => typeof values))];
  let type: 'string' | 'number' | ['string', 'number'] = ['string', 'number'];
  if (parsedTypes.length === 1) {
    type = parsedTypes[0] === 'string' ? 'string' : 'number';
  }

  return {
    type,
    enum: actualValues,
  };
}
