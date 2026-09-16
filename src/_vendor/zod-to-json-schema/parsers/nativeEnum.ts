import type { ZodNativeEnumDef } from 'zod/v3';

export type JsonSchema7NativeEnumType = {
  type: 'string' | 'number' | ['string', 'number'];
  enum: (string | number)[];
};

export function parseNativeEnumDef(def: ZodNativeEnumDef): JsonSchema7NativeEnumType {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter(
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Numeric enum reverse mappings must be distinguished from the literal values emitted into JSON Schema.
    (key: string) => typeof object[object[key]!] !== 'number',
  );

  const actualValues = actualKeys.map((key: string) => object[key]!);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Numeric enum reverse mappings must be distinguished from the literal values emitted into JSON Schema.
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
