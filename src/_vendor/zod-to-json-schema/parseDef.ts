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

const jsonInputPreprocessor = Symbol('openaiJsonInputPreprocessor');

type PreprocessedRefs = Refs & { [jsonInputPreprocessor]?: true };

const hasJSONInputPreprocessor = (refs: Refs): boolean =>
  (refs as PreprocessedRefs)[jsonInputPreprocessor] === true;

const requiresJSONInputPreprocessor = (def: ZodTypeDef): boolean => {
  const schema = def as ZodTypeDef & {
    typeName: ZodFirstPartyTypeKind;
    coerce?: boolean;
    value?: unknown;
  };

  switch (schema.typeName) {
    case ZodFirstPartyTypeKind.ZodBigInt:
    case ZodFirstPartyTypeKind.ZodDate: {
      return !schema.coerce;
    }
    case ZodFirstPartyTypeKind.ZodMap:
    case ZodFirstPartyTypeKind.ZodSet: {
      return true;
    }
    case ZodFirstPartyTypeKind.ZodLiteral: {
      return typeof schema.value === 'bigint';
    }
    default: {
      return false;
    }
  }
};

const producesBigIntOutput = (def: any, seen = new Set<ZodTypeDef>()): boolean => {
  if (seen.has(def)) {
    return false;
  }
  seen.add(def);

  switch (def.typeName as ZodFirstPartyTypeKind) {
    case ZodFirstPartyTypeKind.ZodBigInt: {
      return true;
    }
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodCatch:
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return producesBigIntOutput(def.innerType._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodBranded: {
      return producesBigIntOutput(def.type._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return producesBigIntOutput(def.schema._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return producesBigIntOutput(def.out._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = def.options instanceof Map ? [...def.options.values()] : def.options;
      return options.some((option: { _def: ZodTypeDef }) => producesBigIntOutput(option._def, seen));
    }
    default: {
      return false;
    }
  }
};

const acceptsJSONNumber = (def: any, seen = new Set<ZodTypeDef>()): boolean => {
  if (seen.has(def)) {
    return false;
  }
  seen.add(def);

  switch (def.typeName as ZodFirstPartyTypeKind) {
    case ZodFirstPartyTypeKind.ZodNumber:
    case ZodFirstPartyTypeKind.ZodAny:
    case ZodFirstPartyTypeKind.ZodUnknown: {
      return true;
    }
    case ZodFirstPartyTypeKind.ZodLiteral: {
      return typeof def.value === 'number';
    }
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodCatch:
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return acceptsJSONNumber(def.innerType._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodBranded: {
      return acceptsJSONNumber(def.type._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return def.effect.type === 'preprocess' || acceptsJSONNumber(def.schema._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return acceptsJSONNumber(def.in._def, seen);
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = def.options instanceof Map ? [...def.options.values()] : def.options;
      return options.some((option: { _def: ZodTypeDef }) => acceptsJSONNumber(option._def, seen));
    }
    default: {
      return def.coerce === true;
    }
  }
};

const convertsJSONPipelineInput = (def: any): boolean => {
  if (def.typeName === ZodFirstPartyTypeKind.ZodEffects) {
    return (
      def.effect.type === 'transform' ||
      def.effect.type === 'preprocess' ||
      convertsJSONPipelineInput(def.schema._def)
    );
  }

  if (def.typeName === ZodFirstPartyTypeKind.ZodPipeline) {
    return convertsJSONPipelineInput(def.in._def) || convertsJSONPipelineInput(def.out._def);
  }

  const inner = def.innerType?._def ?? def.type?._def;
  return inner ? convertsJSONPipelineInput(inner) : def.coerce === true;
};

const hasJSONIntegerBranch = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  const record = schema as Record<string, unknown>;
  const { type } = record;
  if (type === 'integer' || (Array.isArray(type) && type.includes('integer'))) {
    return true;
  }

  const branches = record['anyOf'] ?? record['allOf'];
  return Array.isArray(branches) && branches.some((branch) => hasJSONIntegerBranch(branch));
};

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

  const needsPreprocessing = refs.openaiStrictMode === true && requiresJSONInputPreprocessor(def);
  const isPreprocessed = hasJSONInputPreprocessor(refs);
  if (needsPreprocessing && !isPreprocessed) {
    const registeredDefinitionPath =
      seenItem?.jsonSchema === undefined &&
      seenItem?.path.length === refs.basePath.length + 2 &&
      seenItem.path[refs.basePath.length] === refs.definitionPath
        ? seenItem.path
        : undefined;
    const diagnosticRefs = registeredDefinitionPath
      ? { ...refs, currentPath: registeredDefinitionPath }
      : refs;

    throwUnrepresentableStrictZodType((def as { typeName: ZodFirstPartyTypeKind }).typeName, diagnosticRefs);
  }

  // Native leaves and their already-materialized shared ancestors must remain
  // inside the conversion context. In-progress recursive definitions still use
  // references so recursive schemas terminate normally.
  const inlinePreprocessedType =
    isPreprocessed && (needsPreprocessing || (seenItem !== undefined && seenItem.jsonSchema !== undefined));

  if (seenItem && !forceResolution && !inlinePreprocessedType) {
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
    if ((forceResolution || inlinePreprocessedType) && seenItem) {
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

const throwUnrepresentableStrictZodType = (typeName: ZodFirstPartyTypeKind, refs: Refs): never => {
  throw new Error(
    `Zod field at \`${refs.currentPath.join('/')}\` uses \`${typeName}\`, which cannot be represented in JSON Structured Outputs. Use a JSON-compatible schema or a supported coercion.`,
  );
};

const normalizeStrictBigIntValue = (value: bigint, keyword: string, refs: Refs): number => {
  const normalized = Number(value);

  if (!Number.isSafeInteger(normalized)) {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` uses \`ZodBigInt\` and cannot represent the \`${keyword}\` value as a safe JSON integer.`,
    );
  }

  return normalized;
};

const normalizeStrictDefaultValue = (
  value: unknown,
  refs: Refs,
  keyword = 'default',
  seen = new WeakMap<object, unknown>(),
): unknown => {
  if (typeof value === 'bigint') {
    return normalizeStrictBigIntValue(value, keyword, refs);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const previous = seen.get(value);
  if (previous !== undefined) {
    return previous;
  }

  if (Array.isArray(value)) {
    const normalized: unknown[] = [];
    seen.set(value, normalized);
    let changed = false;

    for (const [index, item] of value.entries()) {
      const normalizedItem = normalizeStrictDefaultValue(item, refs, `${keyword}[${index}]`, seen);
      normalized.push(normalizedItem);
      changed ||= normalizedItem !== item;
    }

    if (!changed) {
      seen.set(value, value);
      return value;
    }
    return normalized;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const normalized = Object.create(prototype) as Record<string, unknown>;
  seen.set(value, normalized);
  let changed = false;
  for (const [key, item] of Object.entries(value)) {
    const normalizedItem = normalizeStrictDefaultValue(item, refs, `${keyword}.${key}`, seen);
    Object.defineProperty(normalized, key, {
      value: normalizedItem,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    changed ||= normalizedItem !== item;
  }

  if (!changed) {
    seen.set(value, value);
    return value;
  }
  return normalized;
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
      const schema = parseBigintDef(def, refs);
      if (refs.openaiStrictMode) {
        const record = schema as unknown as Record<string, unknown>;
        for (const [keyword, value] of Object.entries(schema)) {
          if (typeof value === 'bigint') {
            record[keyword] = normalizeStrictBigIntValue(value, keyword, refs);
          }
        }

        record['minimum'] ??= Number.MIN_SAFE_INTEGER;
        record['maximum'] ??= Number.MAX_SAFE_INTEGER;

        let lowerBound = BigInt(record['minimum'] as number);
        let upperBound = BigInt(record['maximum'] as number);
        const { exclusiveMinimum, exclusiveMaximum } = record;
        if (typeof exclusiveMinimum === 'number') {
          const exclusiveLowerBound = BigInt(exclusiveMinimum) + 1n;
          lowerBound = exclusiveLowerBound > lowerBound ? exclusiveLowerBound : lowerBound;
        }
        if (typeof exclusiveMaximum === 'number') {
          const exclusiveUpperBound = BigInt(exclusiveMaximum) - 1n;
          upperBound = exclusiveUpperBound < upperBound ? exclusiveUpperBound : upperBound;
        }

        if (lowerBound > upperBound) {
          throw new RangeError(
            `Zod field at \`${refs.currentPath.join('/')}\` uses \`ZodBigInt\` but has no safe JSON integer values that satisfy its bounds.`,
          );
        }
      }

      return schema;
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
      const options = (def.options instanceof Map ? [...def.options.values()] : def.options) as {
        _def: {
          typeName: ZodFirstPartyTypeKind;
          value?: unknown;
        };
      }[];
      const bigintIndex = options.findIndex((option) => producesBigIntOutput(option._def));
      const hasBigIntLiteral = options.some(
        (option) =>
          option._def.typeName === ZodFirstPartyTypeKind.ZodLiteral && typeof option._def.value === 'bigint',
      );

      if (refs.openaiStrictMode && (bigintIndex !== -1 || hasBigIntLiteral)) {
        const branches = options
          .map((option, index) => {
            const boundNumber = bigintIndex !== -1 && index > bigintIndex && acceptsJSONNumber(option._def);
            const branch = parseDef(
              option._def as ZodTypeDef,
              {
                ...refs,
                currentPath: [...refs.currentPath, 'anyOf', String(index)],
              },
              boundNumber,
            );

            if (!boundNumber || branch === undefined) {
              return branch;
            }

            if ('$ref' in branch) {
              return {
                allOf: [
                  branch,
                  {
                    minimum: Number.MIN_SAFE_INTEGER,
                    maximum: Number.MAX_SAFE_INTEGER,
                  } as JsonSchema7Type,
                ],
              };
            }

            const record = branch as unknown as Record<string, unknown>;
            record['minimum'] = Math.max(
              typeof record['minimum'] === 'number' ? record['minimum'] : Number.MIN_SAFE_INTEGER,
              Number.MIN_SAFE_INTEGER,
            );
            record['maximum'] = Math.min(
              typeof record['maximum'] === 'number' ? record['maximum'] : Number.MAX_SAFE_INTEGER,
              Number.MAX_SAFE_INTEGER,
            );
            return branch;
          })
          .filter(
            (branch): branch is JsonSchema7Type =>
              branch !== undefined && (!refs.strictUnions || Object.keys(branch).length > 0),
          );

        return branches.length > 0 ? { anyOf: branches } : undefined;
      }

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
      const schema = parseLiteralDef(def, refs);
      if (refs.openaiStrictMode && typeof def.value === 'bigint') {
        const record = schema as unknown as Record<string, unknown>;
        const value = normalizeStrictBigIntValue(def.value, 'const', refs);
        if ('const' in record) {
          record['const'] = value;
        }
        if (Array.isArray(record['enum'])) {
          record['enum'] = [value];
        }
      }

      return schema;
    }
    case ZodFirstPartyTypeKind.ZodEnum: {
      return parseEnumDef(def);
    }
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      return parseNativeEnumDef(def);
    }
    case ZodFirstPartyTypeKind.ZodNullable: {
      if (refs.openaiStrictMode && def.innerType._def.typeName === ZodFirstPartyTypeKind.ZodBigInt) {
        const inner = parseDef(
          def.innerType._def,
          {
            ...refs,
            currentPath: [...refs.currentPath, 'anyOf', '0'],
          },
          forceResolution,
        );

        return inner && { anyOf: [inner, { type: 'null' }] };
      }

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
      if (refs.openaiStrictMode && def.effect?.type === 'preprocess') {
        const preprocessedRefs: PreprocessedRefs = {
          ...refs,
          [jsonInputPreprocessor]: true,
        };

        return parseEffectsDef(def, preprocessedRefs, forceResolution);
      }

      return parseEffectsDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodAny: {
      return parseAnyDef();
    }
    case ZodFirstPartyTypeKind.ZodUnknown: {
      return parseUnknownDef();
    }
    case ZodFirstPartyTypeKind.ZodDefault: {
      const schema = parseDefaultDef(def, refs, forceResolution);
      if (refs.openaiStrictMode) {
        if (typeof schema.default === 'bigint' && !hasJSONIntegerBranch(schema)) {
          throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodBigInt, refs);
        }

        schema.default = normalizeStrictDefaultValue(schema.default, refs);
      }

      return schema;
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
      if (refs.openaiStrictMode && convertsJSONPipelineInput(def.in._def)) {
        const outputRefs: PreprocessedRefs = {
          ...refs,
          [jsonInputPreprocessor]: true,
        };

        return parsePipelineDef(def, refs, forceResolution, outputRefs);
      }

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
