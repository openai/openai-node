import type { ZodTypeDef } from 'zod/v3';
import { ZodFirstPartyTypeKind } from 'zod/v3';
import { hasOwn } from '../../internal/utils/values';
import type { JsonSchema7AnyType } from './parsers/any';
import { parseAnyDef } from './parsers/any';
import type { JsonSchema7ArrayType } from './parsers/array';
import { parseArrayDef } from './parsers/array';
import type { JsonSchema7BigintType } from './parsers/bigint';
import { parseBigintDef } from './parsers/bigint';
import type { JsonSchema7BooleanType } from './parsers/boolean';
import { parseBooleanDef } from './parsers/boolean';
import { parseBrandedDef } from './parsers/branded';
import { parseCatchDef } from './parsers/catch';
import type { JsonSchema7DateType } from './parsers/date';
import { parseDateDef } from './parsers/date';
import { parseDefaultDef } from './parsers/default';
import { parseEffectsDef } from './parsers/effects';
import type { JsonSchema7EnumType } from './parsers/enum';
import { parseEnumDef } from './parsers/enum';
import type { JsonSchema7AllOfType } from './parsers/intersection';
import { parseIntersectionDef } from './parsers/intersection';
import type { JsonSchema7LiteralType } from './parsers/literal';
import { parseLiteralDef } from './parsers/literal';
import type { JsonSchema7MapType } from './parsers/map';
import { parseMapDef } from './parsers/map';
import type { JsonSchema7NativeEnumType } from './parsers/nativeEnum';
import { parseNativeEnumDef } from './parsers/nativeEnum';
import type { JsonSchema7NeverType } from './parsers/never';
import { parseNeverDef } from './parsers/never';
import type { JsonSchema7NullType } from './parsers/null';
import { parseNullDef } from './parsers/null';
import type { JsonSchema7NullableType } from './parsers/nullable';
import { parseNullableDef } from './parsers/nullable';
import type { JsonSchema7NumberType } from './parsers/number';
import { parseNumberDef } from './parsers/number';
import type { JsonSchema7ObjectType } from './parsers/object';
import { parseObjectDef } from './parsers/object';
import { parseOptionalDef } from './parsers/optional';
import { parsePipelineDef } from './parsers/pipeline';
import { parsePromiseDef } from './parsers/promise';
import type { JsonSchema7RecordType } from './parsers/record';
import { parseRecordDef } from './parsers/record';
import type { JsonSchema7SetType } from './parsers/set';
import { parseSetDef } from './parsers/set';
import type { JsonSchema7StringType } from './parsers/string';
import { parseStringDef } from './parsers/string';
import type { JsonSchema7TupleType } from './parsers/tuple';
import { parseTupleDef } from './parsers/tuple';
import type { JsonSchema7UndefinedType } from './parsers/undefined';
import { parseUndefinedDef } from './parsers/undefined';
import type { JsonSchema7UnionType } from './parsers/union';
import { parseUnionDef } from './parsers/union';
import type { JsonSchema7UnknownType } from './parsers/unknown';
import { parseUnknownDef } from './parsers/unknown';
import type { Refs, Seen } from './Refs';
import { parseReadonlyDef } from './parsers/readonly';
import { ignoreOverride } from './Options';
import { zodDef } from './util';

type JsonSchema7RefType = { $ref: string };
type JsonSchema7Meta = {
  title?: string;
  default?: any;
  description?: string;
  markdownDescription?: string;
};

export type JsonSchema7TypeUnion =
  | JsonSchema7StringType
  | JsonSchema7ArrayType
  | JsonSchema7NumberType
  | JsonSchema7BigintType
  | JsonSchema7BooleanType
  | JsonSchema7DateType
  | JsonSchema7EnumType
  | JsonSchema7LiteralType
  | JsonSchema7NativeEnumType
  | JsonSchema7NullType
  | JsonSchema7NumberType
  | JsonSchema7ObjectType
  | JsonSchema7RecordType
  | JsonSchema7TupleType
  | JsonSchema7UnionType
  | JsonSchema7UndefinedType
  | JsonSchema7RefType
  | JsonSchema7NeverType
  | JsonSchema7MapType
  | JsonSchema7AnyType
  | JsonSchema7NullableType
  | JsonSchema7AllOfType
  | JsonSchema7UnknownType
  | JsonSchema7SetType;

export type JsonSchema7Type = JsonSchema7TypeUnion & JsonSchema7Meta;

export function parseDef(
  def: ZodTypeDef,
  refs: Refs,
  forceResolution = false, // Forces a new schema to be instantiated even though its def has been seen. Used for improving refs in definitions. See https://github.com/StefanTerdell/zod-to-json-schema/pull/61.
): JsonSchema7Type | undefined {
  const seenItem = refs.seen.get(def);

  if (refs.override) {
    const overrideResult = refs.override?.(def, refs, seenItem, forceResolution);

    if (overrideResult !== ignoreOverride) {
      return overrideResult;
    }
  }

  if (seenItem && !forceResolution) {
    const seenSchema = get$ref(seenItem, refs);

    if (seenSchema !== undefined) {
      if ('$ref' in seenSchema) {
        refs.seenRefs.add(seenSchema.$ref);
      }

      return seenSchema;
    }
  }

  const newItem: Seen = { def, path: refs.currentPath, jsonSchema: undefined };

  refs.seen.set(def, newItem);

  try {
    const jsonSchema = selectParser(def, (def as any).typeName, refs, forceResolution);

    if (jsonSchema) {
      addMeta(def, refs, jsonSchema);
    }

    newItem.jsonSchema = jsonSchema;

    return jsonSchema;
  } finally {
    if (forceResolution && seenItem) {
      // Materializing a definition temporarily moves it to the definition path. Restore the
      // original path so later references to a shared inner type don't inherit wrapper metadata.
      refs.seen.set(def, seenItem);
    }
  }
}

const get$ref = (
  item: Seen,
  refs: Refs,
):
  | {
      $ref: string;
    }
  | {}
  | undefined => {
  switch (refs.$refStrategy) {
    case 'root': {
      return { $ref: item.path.join('/') };
    }
    // this case is needed as OpenAI strict mode doesn't support top-level `$ref`s, i.e.
    // the top-level schema *must* be `{"type": "object", "properties": {...}}` but if we ever
    // need to define a `$ref`, relative `$ref`s aren't supported, so we need to extract
    // the schema to `#/definitions/` and reference that.
    //
    // e.g. if we need to reference a schema at
    // `["#","definitions","contactPerson","properties","person1","properties","name"]`
    // then we'll extract it out to `contactPerson_properties_person1_properties_name`
    case 'extract-to-root': {
      const baseName = item.path
        .slice(refs.basePath.length + 1)
        // The first part is either the root schema name or an extracted definition
        // name that is being materialized. Keep it stable so recursive definitions
        // do not generate a new name each time they are resolved.
        .map((part, index) => (index === 0 ? part : encodeDefinitionPathPart(part)))
        .join('_');
      let name = baseName;

      // we don't need to extract the root schema in this case, as it's already
      // been added to the definitions
      const isRootSchema =
        name === refs.name &&
        item.path.length === refs.basePath.length + 2 &&
        item.path[refs.basePath.length] === refs.definitionPath;

      if (!isRootSchema && refs.nameStrategy === 'duplicate-ref') {
        const hasDifferentDefinition = (definitionName: string): boolean => {
          if (!hasOwn(refs.definitions, definitionName)) {
            return false;
          }

          const existingDefinition = refs.definitions[definitionName];
          return existingDefinition === undefined || zodDef(existingDefinition) !== item.def;
        };
        let suffix = 0;
        while (name === refs.name || hasDifferentDefinition(name)) {
          suffix += 1;
          name = `${baseName}_${suffix}`;
        }

        if (!hasOwn(refs.definitions, name)) {
          refs.definitions[name] = item.def;
        }
      }

      return { $ref: [...refs.basePath, refs.definitionPath, name].join('/') };
    }
    case 'relative': {
      return { $ref: getRelativePath(refs.currentPath, item.path) };
    }
    case 'none':
    case 'seen': {
      if (
        item.path.length < refs.currentPath.length &&
        item.path.every((value, index) => refs.currentPath[index] === value)
      ) {
        console.warn(`Recursive reference detected at ${refs.currentPath.join('/')}! Defaulting to any`);

        return {};
      }

      return refs.$refStrategy === 'seen' ? {} : undefined;
    }
  }
};

const encodedDefinitionPathPartPrefix = '_x_';

const encodeDefinitionPathPart = (part: string) => {
  if (/^[A-Za-z0-9_-]*$/.test(part) && !part.startsWith(encodedDefinitionPathPartPrefix)) {
    return part;
  }

  let encoded = encodedDefinitionPathPartPrefix;
  for (let i = 0; i < part.length; i++) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- preserve UTF-16 code-unit encoding
    encoded += part.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return encoded;
};

const getRelativePath = (pathA: string[], pathB: string[]) => {
  let i = 0;
  for (; i < pathA.length && i < pathB.length; i++) {
    if (pathA[i] !== pathB[i]) {
      break;
    }
  }
  return [(pathA.length - i).toString(), ...pathB.slice(i)].join('/');
};

const selectParser = (
  def: any,
  typeName: ZodFirstPartyTypeKind,
  refs: Refs,
  forceResolution: boolean,
): JsonSchema7Type | undefined => {
  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      return parseStringDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      return parseNumberDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      return parseObjectDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodBigInt: {
      return parseBigintDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodBoolean: {
      return parseBooleanDef();
    }
    case ZodFirstPartyTypeKind.ZodDate: {
      return parseDateDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodUndefined: {
      return parseUndefinedDef();
    }
    case ZodFirstPartyTypeKind.ZodNull: {
      return parseNullDef(refs);
    }
    case ZodFirstPartyTypeKind.ZodArray: {
      return parseArrayDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      return parseUnionDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodIntersection: {
      return parseIntersectionDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodTuple: {
      return parseTupleDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      return parseRecordDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodLiteral: {
      return parseLiteralDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodEnum: {
      return parseEnumDef(def);
    }
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      return parseNativeEnumDef(def);
    }
    case ZodFirstPartyTypeKind.ZodNullable: {
      return parseNullableDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodOptional: {
      return parseOptionalDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodMap: {
      return parseMapDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodSet: {
      return parseSetDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodLazy: {
      return parseDef(def.getter()._def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodPromise: {
      return parsePromiseDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodNaN:
    case ZodFirstPartyTypeKind.ZodNever: {
      return parseNeverDef();
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return parseEffectsDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodAny: {
      return parseAnyDef();
    }
    case ZodFirstPartyTypeKind.ZodUnknown: {
      return parseUnknownDef();
    }
    case ZodFirstPartyTypeKind.ZodDefault: {
      return parseDefaultDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodBranded: {
      return parseBrandedDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return parseReadonlyDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodCatch: {
      return parseCatchDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return parsePipelineDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodFunction:
    case ZodFirstPartyTypeKind.ZodVoid:
    case ZodFirstPartyTypeKind.ZodSymbol: {
      return undefined;
    }
    default: {
      return ((_: never) => undefined)(typeName);
    }
  }
};

const addMeta = (def: ZodTypeDef, refs: Refs, jsonSchema: JsonSchema7Type): JsonSchema7Type => {
  if (def.description) {
    jsonSchema.description = def.description;

    if (refs.markdownDescription) {
      jsonSchema.markdownDescription = def.description;
    }
  }
  return jsonSchema;
};
