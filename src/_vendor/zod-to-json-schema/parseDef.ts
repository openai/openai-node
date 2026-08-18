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
import {
  acceptsEveryJSONNumber,
  acceptsJSONNumber,
  applyNestedNumericOverlaps,
  applySafeIntegerBounds,
  applyUnsafeBigIntBounds,
  convertsJSONPipelineInput,
  findIncompatibleParsedOutputs,
  findNestedNumericOverlaps,
  hasConstrainedPipelineOutput,
  hasDeclaredSchemaPropertyAtPath,
  hasOpaqueJSONValidation,
  hasOpaquePipelineTransform,
  producesBigIntAtPath,
  producesDateAtPath,
  producesBigIntOutput,
  requiresAsynchronousJSONInput,
  throwsOnFractionalBigIntInput,
} from './schema-capabilities';
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
const constrainedReferenceContext = Symbol('openaiConstrainedReferenceContext');
const expectedPipelineOutput = Symbol('openaiExpectedPipelineOutput');

type PreprocessedRefs = Refs & {
  [jsonInputPreprocessor]?: true;
  [constrainedReferenceContext]?: true;
  [expectedPipelineOutput]?: ZodTypeDef;
};

const hasJSONInputPreprocessor = (refs: Refs): boolean =>
  (refs as PreprocessedRefs)[jsonInputPreprocessor] === true;
const registeredDefinitionInputContexts = new WeakMap<Seen, 'preprocessed' | 'unprocessed' | 'mixed'>();

const recordDefinitionInputContext = (
  def: ZodTypeDef,
  seen: Seen,
  refs: Refs,
  preprocessed: boolean,
  extractedDefinitionName?: string,
) => {
  const definitionName = extractedDefinitionName ?? seen.path[refs.basePath.length + 1];
  const definition = definitionName === undefined ? undefined : refs.definitions[definitionName];
  if (
    (extractedDefinitionName === undefined &&
      (seen.path.length !== refs.basePath.length + 2 ||
        seen.path[refs.basePath.length] !== refs.definitionPath)) ||
    definitionName === undefined ||
    definition === undefined ||
    !hasOwn(refs.definitions, definitionName) ||
    zodDef(definition) !== def
  ) {
    return;
  }

  const context = preprocessed ? 'preprocessed' : 'unprocessed';
  const previous = registeredDefinitionInputContexts.get(seen);
  registeredDefinitionInputContexts.set(seen, previous && previous !== context ? 'mixed' : context);
};

export const getDefinitionInputRefs = (def: ZodTypeDef, refs: Refs): Refs => {
  const seen = refs.seen.get(def);
  if (!seen || registeredDefinitionInputContexts.get(seen) !== 'preprocessed') {
    return refs;
  }

  const preprocessedRefs: PreprocessedRefs = { ...refs, [jsonInputPreprocessor]: true };
  return preprocessedRefs;
};

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
  if (refs.openaiStrictMode && seenItem && !forceResolution) {
    recordDefinitionInputContext(def, seenItem, refs, isPreprocessed);
  }
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
  // inside the conversion context. Constrained union branches similarly need
  // materialized copies instead of unsupported allOf ref overlays.
  const materializeConstrainedReference =
    refs.openaiStrictMode === true && (refs as PreprocessedRefs)[constrainedReferenceContext] === true;
  const inlinePreprocessedType =
    (isPreprocessed || materializeConstrainedReference) &&
    (needsPreprocessing || (seenItem !== undefined && seenItem.jsonSchema !== undefined));

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
        if (refs.openaiStrictMode) {
          recordDefinitionInputContext(item.def, item, refs, hasJSONInputPreprocessor(refs), name);
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

const assertFiniteStrictSchemaValue = (value: unknown, keyword: string, refs: Refs): void => {
  if (refs.openaiStrictMode && typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` cannot represent the non-finite \`${keyword}\` value in JSON Structured Outputs.`,
    );
  }
};

const normalizeStrictBigIntValue = (value: bigint, keyword: string, refs: Refs): number => {
  if (keyword === 'multipleOf' && value <= 0n) {
    throw new RangeError(
      `Zod field at \`${refs.currentPath.join('/')}\` uses \`ZodBigInt\` and requires a strictly positive \`multipleOf\` value for JSON Structured Outputs.`,
    );
  }
  const normalized = Number(value);

  if (!Number.isSafeInteger(normalized)) {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` uses \`ZodBigInt\` and cannot represent the \`${keyword}\` value as a safe JSON integer.`,
    );
  }

  return normalized;
};

const strictDefaultPrototypeChain = (value: object, keyword: string, refs: Refs): object[] => {
  const prototypes: object[] = [];
  const visited = new WeakSet<object>([value]);
  let prototype: object | null = Object.getPrototypeOf(value) as object | null;
  while (prototype) {
    if (visited.has(prototype) || prototypes.length >= 128) {
      throw new TypeError(
        `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent the cyclic or excessive \`${keyword}\` prototype chain in JSON Structured Outputs.`,
      );
    }
    visited.add(prototype);
    prototypes.push(prototype);
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return prototypes;
};

const strictDefaultDescriptors = (
  value: object,
  keyword: string,
  refs: Refs,
  prototypes: readonly object[],
): [string, PropertyDescriptor][] => {
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
  for (const [key, descriptor] of descriptors) {
    if (descriptor.get || descriptor.set) {
      throw new TypeError(
        `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent the \`${keyword}.${key}\` accessor in JSON Structured Outputs.`,
      );
    }
    if (key === 'toJSON' && typeof descriptor.value === 'function') {
      throw new TypeError(
        `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent a callable \`${keyword}.toJSON\` serializer in JSON Structured Outputs.`,
      );
    }
  }

  for (const prototype of prototypes) {
    const serializer = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    if (serializer && (serializer.get || serializer.set || typeof serializer.value === 'function')) {
      throw new TypeError(
        `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent an inherited \`${keyword}.toJSON\` serializer in JSON Structured Outputs.`,
      );
    }
  }
  return descriptors;
};

const trustedDatePrototypeMethods = new Map<PropertyKey, unknown>([
  ['getTime', Date.prototype.getTime],
  ['toJSON', Date.prototype.toJSON],
  ['toISOString', Date.prototype.toISOString],
  ['valueOf', Date.prototype.valueOf],
  [Symbol.toPrimitive, Date.prototype[Symbol.toPrimitive]],
]);
const trustedDateGetTime = Date.prototype.getTime;
const trustedBoxedPrimitiveMethods = [
  BigInt.prototype.valueOf,
  Symbol.prototype.valueOf,
  Number.prototype.valueOf,
  String.prototype.valueOf,
  Boolean.prototype.valueOf,
];

const isCanonicalDateDefault = (value: Date): boolean =>
  Object.getPrototypeOf(value) === Date.prototype &&
  Number.isFinite(trustedDateGetTime.call(value)) &&
  [...trustedDatePrototypeMethods].every(
    ([property, method]) =>
      Object.getOwnPropertyDescriptor(Date.prototype, property)?.value === method &&
      !Object.getOwnPropertyDescriptor(value, property),
  );

const invisibleDeclaredDefaultProperty = (
  descriptors: readonly [string, PropertyDescriptor][],
  prototypes: readonly object[],
  definition: ZodTypeDef,
  path: readonly (string | number)[],
): { key: string; visibility: 'non-enumerable' | 'inherited' } | undefined => {
  const hidden = descriptors.find(
    ([key, descriptor]) => !descriptor.enumerable && hasDeclaredSchemaPropertyAtPath(definition, path, key),
  );
  if (hidden) {
    return { key: hidden[0], visibility: 'non-enumerable' };
  }

  const ownProperties = new Set(descriptors.map(([key]) => key));
  const inherited = prototypes
    .flatMap((prototype) => Object.getOwnPropertyNames(prototype))
    .find((key) => !ownProperties.has(key) && hasDeclaredSchemaPropertyAtPath(definition, path, key));
  return inherited === undefined ? undefined : { key: inherited, visibility: 'inherited' };
};

const normalizeStrictDefaultValue = (
  value: unknown,
  definition: ZodTypeDef,
  refs: Refs,
  keyword = 'default',
  seen = new WeakMap<object, unknown>(),
  path: readonly (string | number)[] = [],
  rootValue: unknown = value,
  active = new WeakSet<object>(),
): unknown => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` cannot represent the non-finite \`${keyword}\` value in JSON Structured Outputs.`,
    );
  }
  if (typeof value === 'bigint') {
    if (!producesBigIntAtPath(definition, path, rootValue)) {
      throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodBigInt, refs);
    }
    return normalizeStrictBigIntValue(value, keyword, refs);
  }
  if (value === undefined || typeof value === 'symbol' || typeof value === 'function') {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` cannot represent the non-JSON \`${keyword}\` value in JSON Structured Outputs.`,
    );
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const prototypes = strictDefaultPrototypeChain(value, keyword, refs);
  if (value instanceof Set || value instanceof Map) {
    const typeName = value instanceof Set ? ZodFirstPartyTypeKind.ZodSet : ZodFirstPartyTypeKind.ZodMap;
    throwUnrepresentableStrictZodType(typeName, refs);
  }

  if (active.has(value)) {
    throw new TypeError(
      `Zod field at \`${refs.currentPath.join('/')}\` cannot represent the cyclic \`${keyword}\` value in JSON Structured Outputs.`,
    );
  }
  const previous = seen.get(value);
  if (previous !== undefined) {
    normalizeStrictDefaultValue(
      value,
      definition,
      refs,
      keyword,
      new WeakMap<object, unknown>(),
      path,
      rootValue,
      active,
    );
    return previous;
  }

  active.add(value);
  try {
    if (value instanceof Date) {
      if (!isCanonicalDateDefault(value)) {
        throw new TypeError(
          `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent the invalid or customized \`${keyword}\` Date in JSON Structured Outputs.`,
        );
      }
      if (!producesDateAtPath(definition, path, rootValue)) {
        throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodDate, refs);
      }
      return value;
    }

    const boxedPrimitive = trustedBoxedPrimitiveMethods.some((valueOf) => {
      try {
        Reflect.apply(valueOf, value, []);
        return true;
      } catch {
        return false;
      }
    });
    if (boxedPrimitive) {
      throw new TypeError('Zod default cannot safely represent a boxed primitive in JSON Structured Outputs');
    }

    const descriptors = strictDefaultDescriptors(value, keyword, refs, prototypes);
    if (Array.isArray(value)) {
      const normalized: unknown[] = [];
      seen.set(value, normalized);
      let changed = false;
      const ownDescriptors = new Map(descriptors);

      for (let index = 0; index < value.length; index += 1) {
        const descriptor = ownDescriptors.get(String(index));
        if (!descriptor) {
          throw new TypeError('Zod default cannot safely represent an inherited or sparse array index');
        }
        const item: unknown = descriptor.value;
        const normalizedItem = normalizeStrictDefaultValue(
          item,
          definition,
          refs,
          `${keyword}[${index}]`,
          seen,
          [...path, index],
          rootValue,
          active,
        );
        normalized.push(normalizedItem);
        changed ||= normalizedItem !== item;
      }

      if (!changed) {
        seen.set(value, value);
        return value;
      }
      return normalized;
    }

    const hiddenSchemaProperty = invisibleDeclaredDefaultProperty(descriptors, prototypes, definition, path);
    if (hiddenSchemaProperty) {
      throw new TypeError(
        `Zod field at \`${refs.currentPath.join('/')}\` cannot safely represent the ${hiddenSchemaProperty.visibility} \`${keyword}.${hiddenSchemaProperty.key}\` schema property in JSON Structured Outputs.`,
      );
    }

    const prototype: unknown = prototypes[0] ?? null;
    const plainPrototype = prototype === null ? null : Object.prototype;
    const normalized = Object.create(plainPrototype) as Record<string, unknown>;
    seen.set(value, normalized);
    let changed = prototype !== plainPrototype;
    for (const [key, descriptor] of descriptors.filter(([, item]) => item.enumerable)) {
      const item: unknown = descriptor.value;
      const normalizedItem = normalizeStrictDefaultValue(
        item,
        definition,
        refs,
        `${keyword}.${key}`,
        seen,
        [...path, key],
        rootValue,
        active,
      );
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
  } finally {
    active.delete(value);
  }
};

const isNumericSchemaType = (type: unknown) => type === 'number' || type === 'integer';

const mergeStrictSchemas = (left: JsonSchema7Type, right: JsonSchema7Type): JsonSchema7Type | undefined => {
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  if (
    '$ref' in first ||
    '$ref' in second ||
    (first['type'] !== second['type'] &&
      !(isNumericSchemaType(first['type']) && isNumericSchemaType(second['type'])))
  ) {
    return undefined;
  }

  const merged: Record<string, unknown> = { ...first };
  for (const [keyword, value] of Object.entries(second)) {
    if (value === undefined || merged[keyword] === undefined || Object.is(merged[keyword], value)) {
      merged[keyword] = value;
    } else if (
      keyword === 'minimum' ||
      keyword === 'exclusiveMinimum' ||
      keyword === 'minLength' ||
      keyword === 'minItems'
    ) {
      merged[keyword] = Math.max(merged[keyword] as number, value as number);
    } else if (
      keyword === 'maximum' ||
      keyword === 'exclusiveMaximum' ||
      keyword === 'maxLength' ||
      keyword === 'maxItems'
    ) {
      merged[keyword] = Math.min(merged[keyword] as number, value as number);
    } else if (keyword === 'properties' && value && typeof value === 'object') {
      const original = merged[keyword] as Record<string, JsonSchema7Type>;
      const properties = value as Record<string, JsonSchema7Type>;
      if (Object.keys(original).length !== Object.keys(properties).length) {
        return undefined;
      }
      const combined: Record<string, JsonSchema7Type> = {};
      for (const [name, property] of Object.entries(properties)) {
        const existing = original[name];
        if (!hasOwn(original, name) || !existing) {
          return undefined;
        }
        const nested = mergeStrictSchemas(existing, property);
        if (!nested) {
          return undefined;
        }
        combined[name] = nested;
      }
      merged[keyword] = combined;
    } else if (keyword === 'items' && value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = mergeStrictSchemas(merged[keyword] as JsonSchema7Type, value as JsonSchema7Type);
      if (!nested) {
        return undefined;
      }
      merged[keyword] = nested;
    } else if (keyword === 'enum' && Array.isArray(merged[keyword]) && Array.isArray(value)) {
      const intersection = (merged[keyword] as unknown[]).filter((candidate) => value.includes(candidate));
      if (intersection.length === 0) {
        return undefined;
      }
      merged[keyword] = intersection;
    } else if (keyword === 'required' && Array.isArray(merged[keyword]) && Array.isArray(value)) {
      merged[keyword] = [...new Set([...(merged[keyword] as string[]), ...(value as string[])])];
    } else if (keyword === 'type' && isNumericSchemaType(merged[keyword]) && isNumericSchemaType(value)) {
      merged[keyword] = 'integer';
    } else {
      return undefined;
    }
  }
  if (Array.isArray(merged['enum']) && hasOwn(merged, 'const') && !merged['enum'].includes(merged['const'])) {
    return undefined;
  }

  return merged as JsonSchema7Type;
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
      if (refs.openaiStrictMode && requiresAsynchronousJSONInput(def.type._def)) {
        const nonempty = (def.minLength?.value ?? 0) > 0 || (def.exactLength?.value ?? 0) > 0;
        if (nonempty) {
          throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodPromise, refs);
        }
        return {
          type: 'array',
          items: {},
          maxItems: 0,
        };
      }
      return parseArrayDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const originalOptions = (def.options instanceof Map ? [...def.options.values()] : def.options) as {
        _def: ZodTypeDef & {
          typeName: ZodFirstPartyTypeKind;
          value?: unknown;
        };
      }[];
      const options = refs.openaiStrictMode
        ? originalOptions.filter((option) => !requiresAsynchronousJSONInput(option._def))
        : originalOptions;
      const omittedAsynchronousOptions = options.length !== originalOptions.length;
      if (refs.openaiStrictMode && options.length === 0) {
        throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodPromise, refs);
      }

      const bigintIndex = options.findIndex((option) => producesBigIntOutput(option._def));
      const hasBigIntLiteral = options.some(
        (option) =>
          option._def.typeName === ZodFirstPartyTypeKind.ZodLiteral && typeof option._def.value === 'bigint',
      );
      const hasNonFiniteLiteral = options.some(
        (option) =>
          option._def.typeName === ZodFirstPartyTypeKind.ZodLiteral &&
          typeof option._def.value === 'number' &&
          !Number.isFinite(option._def.value),
      );
      const nestedOverlaps = refs.openaiStrictMode
        ? options.map((consumer, consumerIndex) =>
            options.flatMap((producer, producerIndex) =>
              producerIndex === consumerIndex
                ? []
                : findNestedNumericOverlaps(producer._def, consumer._def)
                    .filter(
                      (overlap) =>
                        overlap.path.length > 0 &&
                        (producerIndex < consumerIndex ||
                          !acceptsEveryJSONNumber(overlap.consumer) ||
                          hasOpaqueJSONValidation(consumer._def)),
                    )
                    .map((overlap) => ({
                      ...overlap,
                      producerPrecedesConsumer: producerIndex < consumerIndex,
                    })),
            ),
          )
        : [];

      if (
        refs.openaiStrictMode &&
        (omittedAsynchronousOptions ||
          bigintIndex !== -1 ||
          hasBigIntLiteral ||
          hasNonFiniteLiteral ||
          nestedOverlaps.some((overlaps) => overlaps.length > 0))
      ) {
        const branches = options
          .map((option, index) => {
            const fallibleNumber = !acceptsEveryJSONNumber(option._def);
            const boundNumber =
              bigintIndex !== -1 &&
              !producesBigIntOutput(option._def) &&
              acceptsJSONNumber(option._def) &&
              (index > bigintIndex || fallibleNumber);
            const branchOverlaps = nestedOverlaps[index] ?? [];
            const branch = parseDef(
              option._def,
              {
                ...refs,
                currentPath: [...refs.currentPath, 'anyOf', String(index)],
                ...(boundNumber || branchOverlaps.length > 0
                  ? { [constrainedReferenceContext]: true as const }
                  : undefined),
              },
              boundNumber || branchOverlaps.length > 0,
            );

            if (branch === undefined) {
              return branch;
            }
            const boundedBranch = applyNestedNumericOverlaps(branch, branchOverlaps);
            if (!boundNumber) {
              return boundedBranch;
            }

            const competingBigInts = options.filter(
              (candidate, candidateIndex) =>
                candidateIndex !== index &&
                producesBigIntOutput(candidate._def) &&
                (candidateIndex < index || fallibleNumber),
            );
            const bounded = applyUnsafeBigIntBounds(
              boundedBranch,
              competingBigInts.map((candidate) => candidate._def),
            );
            const fractionalTransform = options.some(
              (candidate, candidateIndex) =>
                candidateIndex < index && throwsOnFractionalBigIntInput(candidate._def, bounded),
            );
            return fractionalTransform ? ({ ...bounded, type: 'integer' } as JsonSchema7Type) : bounded;
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
      if (refs.openaiStrictMode) {
        const mismatch = findIncompatibleParsedOutputs(def.left._def, def.right._def);
        if (mismatch) {
          throw new TypeError(
            `ZodIntersection arms have incompatible parsed outputs: ${mismatch.left} and ${mismatch.right}`,
          );
        }
      }
      const intersectionRefs: PreprocessedRefs = refs.openaiStrictMode
        ? { ...refs, [constrainedReferenceContext]: true as const }
        : refs;
      const schema = parseIntersectionDef(def, intersectionRefs);
      if (!refs.openaiStrictMode || !schema || !('allOf' in schema)) {
        return schema;
      }

      const [first, ...remaining] = (schema as JsonSchema7AllOfType).allOf;
      if (!first) {
        return schema;
      }
      let merged: JsonSchema7Type | undefined = first;
      for (const next of remaining) {
        if (!merged) {
          break;
        }
        merged = mergeStrictSchemas(merged, next);
      }
      return merged ?? schema;
    }
    case ZodFirstPartyTypeKind.ZodTuple: {
      return parseTupleDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      return parseRecordDef(def, refs);
    }
    case ZodFirstPartyTypeKind.ZodLiteral: {
      assertFiniteStrictSchemaValue(def.value, 'const', refs);
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
      const schema = parseNativeEnumDef(def);
      for (const value of schema.enum) {
        assertFiniteStrictSchemaValue(value, 'enum', refs);
      }
      return schema;
    }
    case ZodFirstPartyTypeKind.ZodNullable: {
      if (refs.openaiStrictMode && requiresAsynchronousJSONInput(def.innerType._def)) {
        return { type: 'null' };
      }
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
      if (refs.openaiStrictMode) {
        throwUnrepresentableStrictZodType(ZodFirstPartyTypeKind.ZodPromise, refs);
      }
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

      const numericTransform =
        refs.openaiStrictMode === true &&
        def.effect?.type === 'transform' &&
        acceptsJSONNumber(def.schema._def);
      const expectedOutput = (refs as PreprocessedRefs)[expectedPipelineOutput];
      const transform = def.effect?.transform as unknown;
      const exactBigIntTransform = refs.openaiStrictMode === true && transform === BigInt;
      const boundNumericTransform =
        numericTransform &&
        (exactBigIntTransform || (expectedOutput && producesBigIntOutput(expectedOutput)));
      const schema = parseEffectsDef(
        def,
        refs,
        forceResolution || boundNumericTransform === true || exactBigIntTransform,
      );

      if (exactBigIntTransform && schema !== undefined) {
        if ('type' in schema && schema.type === 'string') {
          const pattern = '^[+-]?[0-9]+$';
          if ('pattern' in schema && schema.pattern !== undefined && schema.pattern !== pattern) {
            throw new Error(
              `ZodEffects BigInt transform at \`${refs.currentPath.join('/')}\` cannot combine an existing string constraint with the required integer-string pattern in strict Structured Outputs.`,
            );
          }
          return { ...schema, pattern } as JsonSchema7Type;
        }
        if (!('type' in schema) || !isNumericSchemaType(schema.type)) {
          throw new Error(
            `ZodEffects BigInt transform at \`${refs.currentPath.join('/')}\` requires a directly representable numeric JSON input in strict Structured Outputs.`,
          );
        }
      }

      if (!boundNumericTransform || schema === undefined) {
        return schema;
      }

      const bounded = applySafeIntegerBounds(schema);
      if (transform === BigInt && 'type' in bounded && bounded.type === 'number') {
        bounded.type = 'integer';
      }
      return bounded;
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
        schema.default = normalizeStrictDefaultValue(schema.default, def.innerType._def, refs);
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
      if (refs.openaiStrictMode) {
        const catchRefs: PreprocessedRefs = {
          ...refs,
          [jsonInputPreprocessor]: true,
        };
        return parseCatchDef(def, catchRefs, forceResolution);
      }
      return parseCatchDef(def, refs, forceResolution);
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      if (refs.openaiStrictMode) {
        const outputRefs: PreprocessedRefs = convertsJSONPipelineInput(def.in._def, def.out._def)
          ? { ...refs, [jsonInputPreprocessor]: true as const }
          : refs;
        const outputPathRefs: PreprocessedRefs = {
          ...outputRefs,
          currentPath: [...refs.currentPath, 'output'],
        };
        let output = parseDef(def.out._def, outputPathRefs);
        if (output && '$ref' in output) {
          output = parseDef(def.out._def, outputPathRefs, true);
        }
        const inputRefs: PreprocessedRefs =
          outputRefs === refs ? refs : { ...refs, [expectedPipelineOutput]: def.out._def };
        let input = parsePipelineDef(def, inputRefs, forceResolution, outputRefs);
        if (input && '$ref' in input) {
          const materializedInputRefs: PreprocessedRefs = {
            ...inputRefs,
            [constrainedReferenceContext]: true,
          };
          input = parseDef(def.in._def, materializedInputRefs, true);
        }
        if (!input || !output) {
          return input;
        }

        if (hasOpaquePipelineTransform(def.in._def)) {
          if (hasConstrainedPipelineOutput(def.out._def)) {
            throw new Error(
              `ZodPipeline output constraints at \`${refs.currentPath.join('/')}\` cannot be safely projected across an opaque transform in strict Structured Outputs.`,
            );
          }
          return input;
        }

        const combined = mergeStrictSchemas(input, output);
        if (combined) {
          return combined;
        }
        const alternatives = (output as Record<string, unknown>)['anyOf'];
        if (Array.isArray(alternatives)) {
          const projected = alternatives.map((alternative) =>
            mergeStrictSchemas(input, alternative as JsonSchema7Type),
          );
          if (projected.every((alternative) => alternative !== undefined)) {
            return { anyOf: projected } as JsonSchema7Type;
          }
          throw new Error(
            `ZodPipeline output constraints at \`${refs.currentPath.join('/')}\` cannot be represented in strict Structured Outputs.`,
          );
        }

        if (outputRefs !== refs) {
          const outputDef = def.out._def as ZodTypeDef & {
            typeName: ZodFirstPartyTypeKind;
            checks?: unknown[];
          };
          const structurallyConstrained =
            outputDef.typeName === ZodFirstPartyTypeKind.ZodLiteral ||
            outputDef.typeName === ZodFirstPartyTypeKind.ZodObject ||
            outputDef.typeName === ZodFirstPartyTypeKind.ZodArray ||
            (outputDef.checks?.length ?? 0) > 0;
          if (!structurallyConstrained) {
            return input;
          }
        }

        throw new Error(
          `ZodPipeline output constraints at \`${refs.currentPath.join('/')}\` cannot be represented in strict Structured Outputs.`,
        );
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
