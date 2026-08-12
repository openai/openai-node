import type { ZodMapDef, ZodRecordDef, ZodTypeAny } from 'zod/v3';
import { ZodFirstPartyTypeKind } from 'zod/v3';
import type { JsonSchema7Type } from '../parseDef';
import { parseDef } from '../parseDef';
import type { Refs } from '../Refs';
import type { JsonSchema7EnumType } from './enum';
import type { JsonSchema7ObjectType } from './object';
import type { JsonSchema7StringType } from './string';
import { parseStringDef } from './string';

type JsonSchema7RecordPropertyNamesType =
  | Omit<JsonSchema7StringType, 'type'>
  | Omit<JsonSchema7EnumType, 'type'>;

export type JsonSchema7RecordType = {
  type: 'object';
  additionalProperties: JsonSchema7Type;
  propertyNames?: JsonSchema7RecordPropertyNamesType;
};

export function parseRecordDef(
  def: ZodRecordDef<ZodTypeAny, ZodTypeAny> | ZodMapDef,
  refs: Refs,
): JsonSchema7RecordType {
  if (refs.target === 'openApi3' && def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      type: 'object',
      required: def.keyType._def.values,
      properties: Object.fromEntries(
        def.keyType._def.values.map((key: string) => [
          key,
          parseDef(def.valueType._def, {
            ...refs,
            currentPath: [...refs.currentPath, 'properties', key],
          }) ?? {},
        ]),
      ),
      additionalProperties: false,
    } satisfies JsonSchema7ObjectType as any;
  }

  const schema: JsonSchema7RecordType = {
    type: 'object',
    additionalProperties:
      parseDef(def.valueType._def, {
        ...refs,
        currentPath: [...refs.currentPath, 'additionalProperties'],
      }) ?? {},
  };

  if (refs.target === 'openApi3') {
    return schema;
  }

  if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.checks?.length) {
    const keyType = Object.fromEntries(
      Object.entries(parseStringDef(def.keyType._def, refs)).filter(([key]) => key !== 'type'),
    ) as JsonSchema7RecordPropertyNamesType;

    return {
      ...schema,
      propertyNames: keyType,
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      ...schema,
      propertyNames: {
        enum: def.keyType._def.values,
      },
    };
  }

  return schema;
}
