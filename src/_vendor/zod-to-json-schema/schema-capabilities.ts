import type { ZodTypeDef } from 'zod/v3';
import { ZodFirstPartyTypeKind } from 'zod/v3';
import type { JsonSchema7Type } from './parseDef';
import { hasOwn } from '../../internal/utils/values';

type SchemaType = { _def: ZodTypeDef };
type InspectableDefinition = ZodTypeDef & {
  typeName: ZodFirstPartyTypeKind;
  innerType: SchemaType;
  type: SchemaType;
  schema: SchemaType;
  getter: () => SchemaType;
  in: SchemaType;
  out: SchemaType;
  options: SchemaType[] | Map<unknown, SchemaType>;
  left: SchemaType;
  right: SchemaType;
  value: unknown;
  values: Record<string, unknown>;
  effect: { type: string; transform?: unknown };
  coerce?: boolean;
  checks?: { kind: string; value?: bigint | number; inclusive?: boolean }[];
  minSize?: { value: number };
  maxSize?: { value: number };
  shape: () => Record<string, SchemaType>;
  catchall: SchemaType;
  items: SchemaType[];
  rest?: SchemaType;
  valueType: SchemaType;
  minLength?: { value: number };
  exactLength?: { value: number };
};
type Traversal =
  | 'input'
  | 'output'
  | 'compatible-output'
  | 'unsafe-output'
  | 'conversion'
  | 'async-input'
  | 'default'
  | 'unconditional-number';
type Inspector = (definition: InspectableDefinition) => boolean | null | undefined;

type TraversalChildren = { values: SchemaType[]; every: boolean };
const asynchronousOutputTraversals = new Set<Traversal>([
  'output',
  'compatible-output',
  'unsafe-output',
  'default',
]);
const universalIntersectionTraversals = new Set<Traversal>([
  'input',
  'conversion',
  'compatible-output',
  'unsafe-output',
  'unconditional-number',
]);

const pipelineChildren = (def: InspectableDefinition, traversal: Traversal): SchemaType[] => {
  if (traversal === 'input') {
    return [def.in];
  }
  if (traversal === 'conversion' || traversal === 'async-input' || traversal === 'unconditional-number') {
    return [def.in, def.out];
  }
  return [def.out];
};

const childDefinitions = (def: InspectableDefinition, traversal: Traversal): TraversalChildren | null => {
  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return { values: [def.innerType], every: false };
    }
    case ZodFirstPartyTypeKind.ZodCatch: {
      return traversal === 'async-input' ? null : { values: [def.innerType], every: false };
    }
    case ZodFirstPartyTypeKind.ZodBranded: {
      return { values: [def.type], every: false };
    }
    case ZodFirstPartyTypeKind.ZodPromise: {
      return asynchronousOutputTraversals.has(traversal) ? null : { values: [def.type], every: false };
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return { values: [def.schema], every: false };
    }
    case ZodFirstPartyTypeKind.ZodLazy: {
      return { values: [def.getter()], every: false };
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return {
        values: pipelineChildren(def, traversal),
        every: traversal === 'unconditional-number',
      };
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const values = def.options instanceof Map ? [...def.options.values()] : def.options;
      return { values, every: traversal === 'conversion' || traversal === 'async-input' };
    }
    case ZodFirstPartyTypeKind.ZodIntersection: {
      return {
        values: [def.left, def.right],
        every: universalIntersectionTraversals.has(traversal),
      };
    }
    default: {
      return null;
    }
  }
};

const asynchronousContainerChildren = (
  def: InspectableDefinition,
  traversal: Traversal,
): TraversalChildren | null | undefined => {
  if (traversal !== 'async-input') {
    return undefined;
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodNullable) {
    return null;
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodObject) {
    return { values: Object.values(def.shape()), every: false };
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodTuple) {
    return { values: def.items, every: false };
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodArray) {
    const nonempty = (def.minLength?.value ?? 0) > 0 || (def.exactLength?.value ?? 0) > 0;
    return nonempty ? { values: [def.type], every: false } : null;
  }
  return undefined;
};

const visitDefinition = (
  definition: ZodTypeDef,
  inspect: Inspector,
  traversal: Traversal,
  active = new Set<ZodTypeDef>(),
): boolean => {
  if (active.has(definition)) {
    return false;
  }
  active.add(definition);

  try {
    const def = definition as InspectableDefinition;
    const result = inspect(def);
    if (result !== undefined && result !== null) {
      return result;
    }

    const containerChildren = asynchronousContainerChildren(def, traversal);
    const children = containerChildren === undefined ? childDefinitions(def, traversal) : containerChildren;
    if (!children) {
      return false;
    }
    return children.every
      ? children.values.every((child) => visitDefinition(child._def, inspect, traversal, active))
      : children.values.some((child) => visitDefinition(child._def, inspect, traversal, active));
  } finally {
    active.delete(definition);
  }
};

export const requiresAsynchronousJSONInput = (definition: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => (def.typeName === ZodFirstPartyTypeKind.ZodPromise ? true : undefined),
    'async-input',
  );

const isExactBigIntTransform = (definition: InspectableDefinition): boolean =>
  definition.typeName === ZodFirstPartyTypeKind.ZodEffects &&
  definition.effect.type === 'transform' &&
  definition.effect.transform === BigInt;

export const producesBigIntOutput = (definition: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (def.typeName === ZodFirstPartyTypeKind.ZodBigInt || isExactBigIntTransform(def)) {
        return true;
      }
      return def.typeName === ZodFirstPartyTypeKind.ZodLiteral ? typeof def.value === 'bigint' : undefined;
    },
    'output',
  );

const definiteParsedOutputKinds = new Set<ZodFirstPartyTypeKind>([
  ZodFirstPartyTypeKind.ZodBigInt,
  ZodFirstPartyTypeKind.ZodNumber,
  ZodFirstPartyTypeKind.ZodString,
  ZodFirstPartyTypeKind.ZodBoolean,
  ZodFirstPartyTypeKind.ZodDate,
  ZodFirstPartyTypeKind.ZodNull,
  ZodFirstPartyTypeKind.ZodObject,
  ZodFirstPartyTypeKind.ZodArray,
]);

export const knownParsedOutputType = (
  definition: ZodTypeDef,
  active = new Set<ZodTypeDef>(),
): ZodFirstPartyTypeKind | undefined => {
  if (active.has(definition)) {
    return undefined;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (isExactBigIntTransform(def)) {
      return ZodFirstPartyTypeKind.ZodBigInt;
    }
    if (def.typeName === ZodFirstPartyTypeKind.ZodTuple) {
      return ZodFirstPartyTypeKind.ZodArray;
    }
    if (definiteParsedOutputKinds.has(def.typeName)) {
      return def.typeName;
    }
    if (def.typeName === ZodFirstPartyTypeKind.ZodEffects && def.effect.type === 'transform') {
      return undefined;
    }
    if (
      def.typeName === ZodFirstPartyTypeKind.ZodNullable ||
      def.typeName === ZodFirstPartyTypeKind.ZodOptional ||
      def.typeName === ZodFirstPartyTypeKind.ZodCatch ||
      def.typeName === ZodFirstPartyTypeKind.ZodUnion ||
      def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion ||
      def.typeName === ZodFirstPartyTypeKind.ZodIntersection
    ) {
      return undefined;
    }
    const children = childDefinitions(def, 'output');
    const child = children?.values[0];
    return children?.values.length === 1 && child !== undefined
      ? knownParsedOutputType(child._def, active)
      : undefined;
  } finally {
    active.delete(definition);
  }
};

type ParsedOutputMismatch = {
  left: ZodFirstPartyTypeKind;
  right: ZodFirstPartyTypeKind;
  path: readonly string[];
};

const parsedOutputContainer = (
  definition: ZodTypeDef,
  kind: ZodFirstPartyTypeKind,
  active = new Set<ZodTypeDef>(),
): InspectableDefinition | undefined => {
  if (active.has(definition)) {
    return undefined;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (
      def.typeName === kind ||
      (kind === ZodFirstPartyTypeKind.ZodArray && def.typeName === ZodFirstPartyTypeKind.ZodTuple)
    ) {
      return def;
    }
    const children = childDefinitions(def, 'output');
    const child = children?.values[0];
    return children?.values.length === 1 && child !== undefined
      ? parsedOutputContainer(child._def, kind, active)
      : undefined;
  } finally {
    active.delete(definition);
  }
};

const parsedArrayOutputItem = (definition: InspectableDefinition, index?: number): SchemaType | undefined => {
  if (definition.typeName !== ZodFirstPartyTypeKind.ZodTuple) {
    return definition.type;
  }
  return index === undefined ? definition.rest : (definition.items[index] ?? definition.rest);
};

const findIncompatibleArrayOutputs = (
  first: InspectableDefinition,
  second: InspectableDefinition,
  path: readonly string[],
  active: Map<ZodTypeDef, Set<ZodTypeDef>>,
  recurse: (
    left: ZodTypeDef,
    right: ZodTypeDef,
    path: readonly string[],
    active: Map<ZodTypeDef, Set<ZodTypeDef>>,
  ) => ParsedOutputMismatch | undefined,
): ParsedOutputMismatch | undefined => {
  const firstLength = first.typeName === ZodFirstPartyTypeKind.ZodTuple ? first.items.length : 0;
  const secondLength = second.typeName === ZodFirstPartyTypeKind.ZodTuple ? second.items.length : 0;
  const length = Math.max(firstLength, secondLength);
  for (let index = 0; index < length; index += 1) {
    const firstItem = parsedArrayOutputItem(first, index);
    const secondItem = parsedArrayOutputItem(second, index);
    if (!firstItem || !secondItem) {
      continue;
    }

    const mismatch = recurse(firstItem._def, secondItem._def, [...path, String(index)], active);
    if (mismatch) {
      return mismatch;
    }
  }

  const firstRest = parsedArrayOutputItem(first);
  const secondRest = parsedArrayOutputItem(second);
  return firstRest && secondRest
    ? recurse(firstRest._def, secondRest._def, [...path, '[]'], active)
    : undefined;
};

export const findIncompatibleParsedOutputs = (
  left: ZodTypeDef,
  right: ZodTypeDef,
  path: readonly string[] = [],
  active = new Map<ZodTypeDef, Set<ZodTypeDef>>(),
): ParsedOutputMismatch | undefined => {
  const existing = active.get(left);
  if (existing?.has(right)) {
    return undefined;
  }
  const current = existing ?? new Set<ZodTypeDef>();
  active.set(left, current);
  current.add(right);
  try {
    const leftKind = knownParsedOutputType(left);
    const rightKind = knownParsedOutputType(right);
    if (leftKind === undefined || rightKind === undefined) {
      return undefined;
    }
    if (leftKind !== rightKind) {
      return { left: leftKind, right: rightKind, path };
    }
    if (leftKind !== ZodFirstPartyTypeKind.ZodObject && leftKind !== ZodFirstPartyTypeKind.ZodArray) {
      return undefined;
    }
    const first = parsedOutputContainer(left, leftKind);
    const second = parsedOutputContainer(right, rightKind);
    if (!first || !second) {
      return undefined;
    }
    if (leftKind === ZodFirstPartyTypeKind.ZodArray) {
      return findIncompatibleArrayOutputs(first, second, path, active, findIncompatibleParsedOutputs);
    }
    const firstShape = first.shape();
    const secondShape = second.shape();
    for (const [key, child] of Object.entries(firstShape)) {
      if (!hasOwn(secondShape, key)) {
        continue;
      }
      const sibling = secondShape[key];
      if (sibling) {
        const mismatch = findIncompatibleParsedOutputs(child._def, sibling._def, [...path, key], active);
        if (mismatch) {
          return mismatch;
        }
      }
    }
    return undefined;
  } finally {
    current.delete(right);
    if (current.size === 0) {
      active.delete(left);
    }
  }
};

const acceptsOverlappingFractionalInput = (
  definition: InspectableDefinition,
  schema: JsonSchema7Type,
): boolean => {
  const input = schema as Record<string, unknown>;
  if (input['type'] !== 'number') {
    return false;
  }
  if (
    definition.checks?.some(
      (check) =>
        check.kind === 'int' ||
        (check.kind === 'multipleOf' && typeof check.value === 'number' && Number.isInteger(check.value)),
    )
  ) {
    return false;
  }
  let minimum = typeof input['minimum'] === 'number' ? input['minimum'] : -Infinity;
  let maximum = typeof input['maximum'] === 'number' ? input['maximum'] : Infinity;
  if (typeof input['exclusiveMinimum'] === 'number') {
    minimum = Math.max(minimum, input['exclusiveMinimum']);
  }
  if (typeof input['exclusiveMaximum'] === 'number') {
    maximum = Math.min(maximum, input['exclusiveMaximum']);
  }
  for (const check of definition.checks ?? []) {
    if (check.kind === 'min' && typeof check.value === 'number') {
      minimum = Math.max(minimum, check.value);
    } else if (check.kind === 'max' && typeof check.value === 'number') {
      maximum = Math.min(maximum, check.value);
    }
  }
  return minimum < maximum || (minimum === maximum && !Number.isInteger(minimum));
};

export const throwsOnFractionalBigIntInput = (definition: ZodTypeDef, schema: JsonSchema7Type): boolean =>
  visitDefinition(
    definition,
    (def) =>
      isExactBigIntTransform(def)
        ? visitDefinition(
            def.schema._def,
            (input) =>
              input.typeName === ZodFirstPartyTypeKind.ZodNumber
                ? acceptsOverlappingFractionalInput(input, schema)
                : undefined,
            'input',
          )
        : undefined,
    'output',
  );

const nativeEnumValues = (definition: InspectableDefinition): readonly (string | number)[] => {
  const values = definition.values as Record<string, string | number>;
  return Object.entries(values)
    .filter(([, value]) => typeof values[value] !== 'number')
    .map(([, value]) => value);
};

export const acceptsJSONNumber = (definition: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => {
      switch (def.typeName) {
        case ZodFirstPartyTypeKind.ZodNumber:
        case ZodFirstPartyTypeKind.ZodAny:
        case ZodFirstPartyTypeKind.ZodUnknown: {
          return true;
        }
        case ZodFirstPartyTypeKind.ZodLiteral: {
          return typeof def.value === 'number';
        }
        case ZodFirstPartyTypeKind.ZodNativeEnum: {
          return nativeEnumValues(def).some((value) => typeof value === 'number');
        }
        case ZodFirstPartyTypeKind.ZodEffects: {
          return def.effect.type === 'preprocess' ? true : undefined;
        }
        default: {
          return def.coerce === true ? true : undefined;
        }
      }
    },
    'input',
  );

type JSONNumberAcceptance = 'total' | 'represented' | 'opaque';

const classifyJSONNumberChecks = (checks: InspectableDefinition['checks'] = []): JSONNumberAcceptance => {
  if (checks.some((check) => !['int', 'min', 'max', 'multipleOf', 'finite'].includes(check.kind))) {
    return 'opaque';
  }

  return checks.some((check) => check.kind !== 'finite') ? 'represented' : 'total';
};

const classifyJSONNumberAcceptance = (
  definition: ZodTypeDef,
  active = new Set<ZodTypeDef>(),
): JSONNumberAcceptance => {
  if (active.has(definition)) {
    return 'opaque';
  }
  active.add(definition);

  try {
    const def = definition as InspectableDefinition;
    switch (def.typeName) {
      case ZodFirstPartyTypeKind.ZodNumber: {
        return classifyJSONNumberChecks(def.checks);
      }
      case ZodFirstPartyTypeKind.ZodAny:
      case ZodFirstPartyTypeKind.ZodUnknown: {
        return 'total';
      }
      case ZodFirstPartyTypeKind.ZodLiteral:
      case ZodFirstPartyTypeKind.ZodNativeEnum: {
        return 'represented';
      }
      case ZodFirstPartyTypeKind.ZodEffects:
      case ZodFirstPartyTypeKind.ZodPromise: {
        return 'opaque';
      }
      default: {
        const children = childDefinitions(def, 'unconditional-number');
        if (!children) {
          return acceptsJSONNumber(def) ? 'opaque' : 'represented';
        }

        const union =
          def.typeName === ZodFirstPartyTypeKind.ZodUnion ||
          def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion;
        const values = union
          ? children.values.filter((child) => acceptsJSONNumber(child._def))
          : children.values;
        const capabilities = values.map((child) => classifyJSONNumberAcceptance(child._def, active));
        if (children.every) {
          if (capabilities.includes('opaque')) {
            return 'opaque';
          }
          return capabilities.every((capability) => capability === 'total') ? 'total' : 'represented';
        }
        if (capabilities.includes('total')) {
          return 'total';
        }
        return capabilities.includes('opaque') ? 'opaque' : 'represented';
      }
    }
  } finally {
    active.delete(definition);
  }
};

export const acceptsEveryJSONNumber = (definition: ZodTypeDef): boolean =>
  classifyJSONNumberAcceptance(definition) !== 'opaque';

const validationChildren = (def: InspectableDefinition): SchemaType[] => {
  if (def.typeName === ZodFirstPartyTypeKind.ZodObject) {
    return Object.values(def.shape());
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodArray) {
    return [def.type];
  }
  return childDefinitions(def, 'input')?.values ?? [];
};

export const hasOpaqueJSONValidation = (definition: ZodTypeDef, active = new Set<ZodTypeDef>()): boolean => {
  if (active.has(definition)) {
    return true;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (
      def.typeName === ZodFirstPartyTypeKind.ZodEffects ||
      def.typeName === ZodFirstPartyTypeKind.ZodPromise
    ) {
      return true;
    }
    return validationChildren(def).some((child) => hasOpaqueJSONValidation(child._def, active));
  } finally {
    active.delete(definition);
  }
};

export const hasOpaquePipelineTransform = (
  definition: ZodTypeDef,
  active = new Set<ZodTypeDef>(),
): boolean => {
  if (active.has(definition)) {
    return true;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (
      def.typeName === ZodFirstPartyTypeKind.ZodCatch ||
      (def.typeName === ZodFirstPartyTypeKind.ZodEffects &&
        (def.effect.type === 'preprocess' ||
          (def.effect.type === 'transform' && !isExactBigIntTransform(def))))
    ) {
      return true;
    }
    const children =
      def.typeName === ZodFirstPartyTypeKind.ZodPipeline ? [def.in, def.out] : validationChildren(def);
    return children.some((child) => hasOpaquePipelineTransform(child._def, active));
  } finally {
    active.delete(definition);
  }
};

export const hasConstrainedPipelineOutput = (
  definition: ZodTypeDef,
  active = new Set<ZodTypeDef>(),
): boolean => {
  if (active.has(definition)) {
    return true;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (
      (def.checks?.length ?? 0) > 0 ||
      (def.minSize !== undefined && def.minSize !== null) ||
      (def.maxSize !== undefined && def.maxSize !== null) ||
      [
        ZodFirstPartyTypeKind.ZodLiteral,
        ZodFirstPartyTypeKind.ZodEnum,
        ZodFirstPartyTypeKind.ZodNativeEnum,
        ZodFirstPartyTypeKind.ZodObject,
        ZodFirstPartyTypeKind.ZodArray,
        ZodFirstPartyTypeKind.ZodEffects,
      ].includes(def.typeName)
    ) {
      return true;
    }
    return (childDefinitions(def, 'output')?.values ?? []).some((child) =>
      hasConstrainedPipelineOutput(child._def, active),
    );
  } finally {
    active.delete(definition);
  }
};

type UnsafeIntegerSide = 'minimum' | 'maximum';

export const capturesUnsafeBigIntInput = (definition: ZodTypeDef, side: UnsafeIntegerSide): boolean =>
  visitDefinition(
    definition,
    (def) => {
      const boundary = side === 'minimum' ? 'min' : 'max';
      if (isExactBigIntTransform(def)) {
        const input = def.schema._def as InspectableDefinition;
        const safeLimit = side === 'minimum' ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        return !input.checks?.some(
          (check) =>
            check.kind === boundary &&
            typeof check.value === 'number' &&
            (side === 'minimum' ? check.value >= safeLimit : check.value <= safeLimit),
        );
      }
      if (def.typeName !== ZodFirstPartyTypeKind.ZodBigInt) {
        return;
      }

      const safeLimit = BigInt(side === 'minimum' ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
      return !(def.checks as { kind: string; value?: bigint }[] | undefined)?.some(
        (check) =>
          check.kind === boundary &&
          typeof check.value === 'bigint' &&
          (side === 'minimum' ? check.value >= safeLimit : check.value <= safeLimit),
      );
    },
    'unsafe-output',
  );

export const acceptsUnsafeJSONInteger = (schema: unknown, side: UnsafeIntegerSide): boolean => {
  if (!schema || typeof schema !== 'object') {
    return true;
  }

  const record = schema as Record<string, unknown>;
  const { type } = record;
  if (
    (typeof type === 'string' && type !== 'number' && type !== 'integer') ||
    (Array.isArray(type) && !type.includes('number') && !type.includes('integer'))
  ) {
    return false;
  }

  let minimum = typeof record['minimum'] === 'number' ? Math.ceil(record['minimum']) : -Infinity;
  let maximum = typeof record['maximum'] === 'number' ? Math.floor(record['maximum']) : Infinity;
  if (typeof record['exclusiveMinimum'] === 'number') {
    minimum = Math.max(minimum, Math.floor(record['exclusiveMinimum']) + 1);
  }
  if (typeof record['exclusiveMaximum'] === 'number') {
    maximum = Math.min(maximum, Math.ceil(record['exclusiveMaximum']) - 1);
  }
  if (typeof record['const'] === 'number') {
    minimum = Math.max(minimum, record['const']);
    maximum = Math.min(maximum, record['const']);
  }

  if (side === 'minimum') {
    maximum = Math.min(maximum, Number.MIN_SAFE_INTEGER - 1);
  } else {
    minimum = Math.max(minimum, Number.MAX_SAFE_INTEGER + 1);
  }
  if (minimum > maximum) {
    return false;
  }

  const { anyOf, allOf } = record;
  if (Array.isArray(anyOf) && !anyOf.some((branch) => acceptsUnsafeJSONInteger(branch, side))) {
    return false;
  }
  if (Array.isArray(allOf) && !allOf.every((branch) => acceptsUnsafeJSONInteger(branch, side))) {
    return false;
  }

  return true;
};

export const convertsJSONPipelineInput = (definition: ZodTypeDef, output: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (def.typeName === ZodFirstPartyTypeKind.ZodEffects) {
        return def.effect.type === 'transform' || def.effect.type === 'preprocess' ? true : undefined;
      }
      if (def.coerce !== true) {
        return;
      }

      return visitDefinition(
        output,
        (candidate) => (candidate.typeName === def.typeName ? true : undefined),
        'compatible-output',
      );
    },
    'conversion',
  );

const acceptsJSONNumberAtPath = (definition: ZodTypeDef, path: readonly (string | number)[]): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (path.length === 0) {
        return acceptsJSONNumber(def);
      }
      if (
        def.typeName === ZodFirstPartyTypeKind.ZodAny ||
        def.typeName === ZodFirstPartyTypeKind.ZodUnknown
      ) {
        return true;
      }
      const [key, ...remaining] = path;
      let child: SchemaType | undefined;
      if (def.typeName === ZodFirstPartyTypeKind.ZodObject && typeof key === 'string') {
        const shape = def.shape();
        child = hasOwn(shape, key) ? shape[key] : def.catchall;
      } else if (def.typeName === ZodFirstPartyTypeKind.ZodArray && typeof key === 'number') {
        child = def.type;
      } else {
        return;
      }
      return child !== undefined && acceptsJSONNumberAtPath(child._def, remaining);
    },
    'input',
  );

const acceptsJSONStringAtPath = (definition: ZodTypeDef, path: readonly (string | number)[]): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (path.length === 0) {
        if (
          def.typeName === ZodFirstPartyTypeKind.ZodString ||
          def.typeName === ZodFirstPartyTypeKind.ZodAny ||
          def.typeName === ZodFirstPartyTypeKind.ZodUnknown
        ) {
          return true;
        }
        if (def.typeName === ZodFirstPartyTypeKind.ZodLiteral) {
          return typeof def.value === 'string';
        }
        if (def.typeName === ZodFirstPartyTypeKind.ZodNativeEnum) {
          return nativeEnumValues(def).some((value) => typeof value === 'string');
        }
        if (def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
          return true;
        }
        return def.coerce === true ? true : undefined;
      }
      const [key, ...remaining] = path;
      let child: SchemaType | undefined;
      if (def.typeName === ZodFirstPartyTypeKind.ZodObject && typeof key === 'string') {
        const shape = def.shape();
        child = hasOwn(shape, key) ? shape[key] : def.catchall;
      } else if (def.typeName === ZodFirstPartyTypeKind.ZodArray && typeof key === 'number') {
        child = def.type;
      } else {
        return;
      }
      return child !== undefined && acceptsJSONStringAtPath(child._def, remaining);
    },
    'input',
  );

const discriminatorValues = (
  definition: ZodTypeDef,
  active = new Set<ZodTypeDef>(),
): readonly unknown[] | undefined => {
  if (active.has(definition)) {
    return undefined;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    switch (def.typeName) {
      case ZodFirstPartyTypeKind.ZodLiteral: {
        return [def.value];
      }
      case ZodFirstPartyTypeKind.ZodEnum: {
        return Object.values(def.values);
      }
      case ZodFirstPartyTypeKind.ZodNativeEnum: {
        return nativeEnumValues(def);
      }
      case ZodFirstPartyTypeKind.ZodEffects: {
        return def.effect.type === 'refinement' ? discriminatorValues(def.schema._def, active) : undefined;
      }
      case ZodFirstPartyTypeKind.ZodBranded: {
        return discriminatorValues(def.type._def, active);
      }
      case ZodFirstPartyTypeKind.ZodReadonly:
      case ZodFirstPartyTypeKind.ZodDefault: {
        return discriminatorValues(def.innerType._def, active);
      }
      case ZodFirstPartyTypeKind.ZodLazy: {
        return discriminatorValues(def.getter()._def, active);
      }
      default: {
        return undefined;
      }
    }
  } finally {
    active.delete(definition);
  }
};

const serializedNativeDefault = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Date) {
    return Date.prototype.toISOString.call(value);
  }
  return value;
};

const matchesPrimitiveDefaultInput = (definition: InspectableDefinition, value: unknown): boolean => {
  if (definition.coerce) {
    return true;
  }
  const serialized = serializedNativeDefault(value);
  switch (definition.typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      return typeof serialized === 'string';
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      return typeof serialized === 'number';
    }
    case ZodFirstPartyTypeKind.ZodBoolean: {
      return typeof serialized === 'boolean';
    }
    case ZodFirstPartyTypeKind.ZodNull: {
      return serialized === null;
    }
    case ZodFirstPartyTypeKind.ZodArray: {
      return Array.isArray(serialized);
    }
    default: {
      return true;
    }
  }
};

const matchesDefaultDiscriminators = (
  definition: ZodTypeDef,
  value: unknown,
  active = new Set<ZodTypeDef>(),
): boolean => {
  if (active.has(definition)) {
    return true;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    switch (def.typeName) {
      case ZodFirstPartyTypeKind.ZodBranded: {
        return matchesDefaultDiscriminators(def.type._def, value, active);
      }
      case ZodFirstPartyTypeKind.ZodReadonly:
      case ZodFirstPartyTypeKind.ZodDefault: {
        return matchesDefaultDiscriminators(def.innerType._def, value, active);
      }
      case ZodFirstPartyTypeKind.ZodEffects: {
        return def.effect.type === 'refinement'
          ? matchesDefaultDiscriminators(def.schema._def, value, active)
          : true;
      }
      case ZodFirstPartyTypeKind.ZodLazy: {
        return matchesDefaultDiscriminators(def.getter()._def, value, active);
      }
      case ZodFirstPartyTypeKind.ZodObject: {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return false;
        }
        break;
      }
      default: {
        return matchesPrimitiveDefaultInput(def, value);
      }
    }
    const record = value as Record<string, unknown>;
    return Object.entries(def.shape()).every(([key, child]) => {
      if (!hasOwn(record, key)) {
        return true;
      }
      const literals = discriminatorValues(child._def);
      const serialized = serializedNativeDefault(record[key]);
      return literals
        ? literals.some((candidate) => Object.is(candidate, serialized))
        : matchesDefaultDiscriminators(child._def, record[key], active);
    });
  } finally {
    active.delete(definition);
  }
};

type NativeDefaultType = ZodFirstPartyTypeKind.ZodBigInt | ZodFirstPartyTypeKind.ZodDate;

const producesSelectedNativeUnion = (
  options: readonly SchemaType[],
  path: readonly (string | number)[],
  value: unknown,
  nativeType: NativeDefaultType,
  producesNative: (
    definition: ZodTypeDef,
    path: readonly (string | number)[],
    value: unknown,
    nativeType: NativeDefaultType,
  ) => boolean,
): boolean => {
  for (const option of options) {
    if (!matchesDefaultDiscriminators(option._def, value)) {
      continue;
    }
    if (producesNative(option._def, path, value, nativeType)) {
      return true;
    }
    const intercepts =
      nativeType === ZodFirstPartyTypeKind.ZodBigInt
        ? acceptsJSONNumberAtPath(option._def, path)
        : acceptsJSONStringAtPath(option._def, path);
    if (intercepts && path.length === 0) {
      const scalar = serializedNativeDefault(value);
      const literals = discriminatorValues(option._def);
      if (literals && !literals.some((candidate) => Object.is(candidate, scalar))) {
        continue;
      }
      const candidate = option._def as InspectableDefinition;
      if (
        candidate.typeName === ZodFirstPartyTypeKind.ZodNumber &&
        typeof scalar === 'number' &&
        candidate.checks?.some((check) => {
          const boundary = Number(check.value);
          if (check.kind === 'min') {
            return scalar < boundary || (check.inclusive === false && scalar === boundary);
          }
          if (check.kind === 'max') {
            return scalar > boundary || (check.inclusive === false && scalar === boundary);
          }
          return false;
        })
      ) {
        continue;
      }
    }
    if (intercepts) {
      return false;
    }
  }
  return false;
};

const producesNativeAtPath = (
  definition: ZodTypeDef,
  path: readonly (string | number)[],
  value: unknown,
  nativeType: NativeDefaultType,
): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (
        def.typeName === ZodFirstPartyTypeKind.ZodUnion ||
        def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion
      ) {
        const options = def.options instanceof Map ? [...def.options.values()] : def.options;
        return producesSelectedNativeUnion(options, path, value, nativeType, producesNativeAtPath);
      }
      if (path.length === 0) {
        if (def.typeName === nativeType) {
          return true;
        }
        return def.typeName === ZodFirstPartyTypeKind.ZodLiteral
          ? nativeType === ZodFirstPartyTypeKind.ZodBigInt && typeof def.value === 'bigint'
          : undefined;
      }

      const [key, ...remaining] = path;
      if (key === undefined) {
        return false;
      }
      let child: SchemaType | undefined;
      switch (def.typeName) {
        case ZodFirstPartyTypeKind.ZodObject: {
          if (typeof key !== 'string') {
            return false;
          }
          const shape = def.shape() as Record<string, SchemaType>;
          child = hasOwn(shape, key) ? shape[key] : def.catchall;
          break;
        }
        case ZodFirstPartyTypeKind.ZodArray: {
          child = typeof key === 'number' ? (def.type as SchemaType) : undefined;
          break;
        }
        default: {
          return;
        }
      }

      const nestedValue =
        value && typeof value === 'object' ? (value as Record<string | number, unknown>)[key] : undefined;
      return child !== undefined && producesNativeAtPath(child._def, remaining, nestedValue, nativeType);
    },
    'default',
  );

export const producesBigIntAtPath = (
  definition: ZodTypeDef,
  path: readonly (string | number)[] = [],
  value?: unknown,
): boolean => producesNativeAtPath(definition, path, value, ZodFirstPartyTypeKind.ZodBigInt);

export const producesDateAtPath = (
  definition: ZodTypeDef,
  path: readonly (string | number)[] = [],
  value?: unknown,
): boolean => producesNativeAtPath(definition, path, value, ZodFirstPartyTypeKind.ZodDate);

type NumericPathSegment = { kind: 'property'; key: string } | { kind: 'array' };

export type NestedNumericOverlap = {
  path: readonly NumericPathSegment[];
  producer: ZodTypeDef;
  consumer: ZodTypeDef;
  producerPrecedesConsumer?: boolean;
};

type PairedChild = {
  producer: SchemaType;
  consumer: SchemaType;
  segment: NumericPathSegment;
};

const jsonPrimitiveKinds = new Map<ZodFirstPartyTypeKind, string>([
  [ZodFirstPartyTypeKind.ZodString, 'string'],
  [ZodFirstPartyTypeKind.ZodNumber, 'number'],
  [ZodFirstPartyTypeKind.ZodBoolean, 'boolean'],
  [ZodFirstPartyTypeKind.ZodNull, 'null'],
  [ZodFirstPartyTypeKind.ZodObject, 'object'],
  [ZodFirstPartyTypeKind.ZodArray, 'array'],
]);

const leafJSONInputTypes = (def: InspectableDefinition): Set<string> | null | undefined => {
  const primitive = jsonPrimitiveKinds.get(def.typeName);
  if (primitive !== undefined) {
    return def.coerce ? null : new Set([primitive]);
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodLiteral) {
    const { value } = def;
    if (value === null) {
      return new Set(['null']);
    }
    const primitiveType = typeof value;
    return ['string', 'number', 'boolean'].includes(primitiveType) ? new Set([primitiveType]) : null;
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return new Set(Object.values(def.values).map((value) => typeof value));
  }
  if (def.typeName === ZodFirstPartyTypeKind.ZodNativeEnum) {
    return new Set(nativeEnumValues(def).map((value) => typeof value));
  }
  return undefined;
};

const transparentJSONInput = (def: InspectableDefinition): ZodTypeDef | undefined => {
  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return def.innerType._def;
    }
    case ZodFirstPartyTypeKind.ZodBranded: {
      return def.type._def;
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return def.effect.type === 'preprocess' ? undefined : def.schema._def;
    }
    case ZodFirstPartyTypeKind.ZodLazy: {
      return def.getter()._def;
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return def.in._def;
    }
    default: {
      return undefined;
    }
  }
};

const jsonInputTypes = (definition: ZodTypeDef, active = new Set<ZodTypeDef>()): Set<string> | undefined => {
  if (active.has(definition)) {
    return undefined;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    const leaf = leafJSONInputTypes(def);
    if (leaf !== undefined) {
      return leaf ?? undefined;
    }
    const transparent = transparentJSONInput(def);
    if (transparent !== undefined) {
      return jsonInputTypes(transparent, active);
    }

    switch (def.typeName) {
      case ZodFirstPartyTypeKind.ZodNullable: {
        const inner = jsonInputTypes(def.innerType._def, active);
        return inner && new Set([...inner, 'null']);
      }
      case ZodFirstPartyTypeKind.ZodUnion:
      case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
        const options = def.options instanceof Map ? [...def.options.values()] : def.options;
        const types = options.map((option) => jsonInputTypes(option._def, active));
        return types.some((option) => option === undefined)
          ? undefined
          : new Set(types.flatMap((option) => [...(option ?? [])]));
      }
      case ZodFirstPartyTypeKind.ZodIntersection: {
        const left = jsonInputTypes(def.left._def, active);
        const right = jsonInputTypes(def.right._def, active);
        if (!left || !right) {
          return left ?? right;
        }
        return new Set([...left].filter((type) => right.has(type)));
      }
      default: {
        return undefined;
      }
    }
  } finally {
    active.delete(definition);
  }
};

const haveDisjointDiscriminators = (
  producer: ZodTypeDef,
  consumer: ZodTypeDef,
  active = new Map<ZodTypeDef, Set<ZodTypeDef>>(),
): boolean => {
  if (active.get(producer)?.has(consumer)) {
    return false;
  }
  const consumers = active.get(producer) ?? new Set<ZodTypeDef>();
  active.set(producer, consumers);
  consumers.add(consumer);
  try {
    const left = producer as InspectableDefinition;
    const right = consumer as InspectableDefinition;
    const leftValues = discriminatorValues(left);
    const rightValues = discriminatorValues(right);
    if (leftValues && rightValues) {
      return leftValues.every((value) => !rightValues.includes(value));
    }
    const leftTypes = jsonInputTypes(left);
    const rightTypes = jsonInputTypes(right);
    if (leftTypes && rightTypes && [...leftTypes].every((type) => !rightTypes.has(type))) {
      return true;
    }

    if (
      left.typeName !== ZodFirstPartyTypeKind.ZodObject ||
      right.typeName !== ZodFirstPartyTypeKind.ZodObject
    ) {
      return false;
    }
    const leftShape = left.shape();
    return Object.entries(right.shape()).some(([key, value]) => {
      const candidate = hasOwn(leftShape, key) ? leftShape[key] : undefined;
      return candidate !== undefined && haveDisjointDiscriminators(candidate._def, value._def, active);
    });
  } finally {
    consumers.delete(consumer);
  }
};

const objectChildren = (producer: InspectableDefinition, consumer: InspectableDefinition): PairedChild[] => {
  const producerShape = producer.shape();
  const consumerShape = consumer.shape();
  const sharedKeys = Object.keys(consumerShape).filter((key) => hasOwn(producerShape, key));
  if (haveDisjointDiscriminators(producer, consumer)) {
    return [];
  }

  return sharedKeys.flatMap((key) => {
    const left = producerShape[key];
    const right = consumerShape[key];
    return left && right ? [{ producer: left, consumer: right, segment: { kind: 'property', key } }] : [];
  });
};

const pairedContainerChildren = (
  producer: InspectableDefinition,
  consumer: InspectableDefinition,
): PairedChild[] => {
  if (
    producer.typeName === ZodFirstPartyTypeKind.ZodObject &&
    consumer.typeName === ZodFirstPartyTypeKind.ZodObject
  ) {
    return objectChildren(producer, consumer);
  }
  if (
    producer.typeName === ZodFirstPartyTypeKind.ZodArray &&
    consumer.typeName === ZodFirstPartyTypeKind.ZodArray
  ) {
    return [{ producer: producer.type, consumer: consumer.type, segment: { kind: 'array' } }];
  }
  return [];
};

const collectNestedNumericOverlaps = (
  producer: ZodTypeDef,
  consumer: ZodTypeDef,
  path: readonly NumericPathSegment[],
  overlaps: NestedNumericOverlap[],
  active: Map<ZodTypeDef, Map<ZodTypeDef, readonly NumericPathSegment[]>>,
  traversal: {
    recursivePaths: (readonly NumericPathSegment[])[];
    lazyTargets: WeakMap<ZodTypeDef, SchemaType>;
  },
): void => {
  let activeConsumers = active.get(producer);
  const recursivePath = activeConsumers?.get(consumer);
  if (recursivePath) {
    traversal.recursivePaths.push(recursivePath);
    return;
  }
  if (!activeConsumers) {
    activeConsumers = new Map();
    active.set(producer, activeConsumers);
  }
  activeConsumers.set(consumer, path);

  try {
    if (producesBigIntOutput(producer) && acceptsJSONNumber(consumer)) {
      overlaps.push({ path, producer, consumer });
      return;
    }

    const left = producer as InspectableDefinition;
    const right = consumer as InspectableDefinition;
    if (left.typeName === ZodFirstPartyTypeKind.ZodLazy || right.typeName === ZodFirstPartyTypeKind.ZodLazy) {
      const unwrap = (definition: InspectableDefinition): ZodTypeDef => {
        if (definition.typeName !== ZodFirstPartyTypeKind.ZodLazy) {
          return definition;
        }
        let target = traversal.lazyTargets.get(definition);
        if (!target) {
          target = definition.getter();
          traversal.lazyTargets.set(definition, target);
        }
        return target._def;
      };
      collectNestedNumericOverlaps(unwrap(left), unwrap(right), path, overlaps, active, traversal);
      return;
    }

    const containers = pairedContainerChildren(left, right);
    if (containers.length > 0) {
      for (const child of containers) {
        collectNestedNumericOverlaps(
          child.producer._def,
          child.consumer._def,
          [...path, child.segment],
          overlaps,
          active,
          traversal,
        );
      }
      return;
    }

    for (const child of childDefinitions(left, 'output')?.values ?? []) {
      collectNestedNumericOverlaps(child._def, consumer, path, overlaps, active, traversal);
    }
    for (const child of childDefinitions(right, 'input')?.values ?? []) {
      collectNestedNumericOverlaps(producer, child._def, path, overlaps, active, traversal);
    }
  } finally {
    activeConsumers.delete(consumer);
    if (activeConsumers.size === 0) {
      active.delete(producer);
    }
  }
};

export const findNestedNumericOverlaps = (
  producer: ZodTypeDef,
  consumer: ZodTypeDef,
): NestedNumericOverlap[] => {
  const overlaps: NestedNumericOverlap[] = [];
  const traversal = {
    recursivePaths: [] as (readonly NumericPathSegment[])[],
    lazyTargets: new WeakMap<ZodTypeDef, SchemaType>(),
  };
  collectNestedNumericOverlaps(producer, consumer, [], overlaps, new Map(), traversal);
  if (
    overlaps.some(
      (overlap) =>
        (capturesUnsafeBigIntInput(overlap.producer, 'minimum') ||
          capturesUnsafeBigIntInput(overlap.producer, 'maximum')) &&
        traversal.recursivePaths.some((recursivePath) =>
          recursivePath.every((segment, index) => {
            const candidate = overlap.path[index];
            return (
              candidate?.kind === segment.kind &&
              (segment.kind !== 'property' ||
                (candidate.kind === 'property' && candidate.key === segment.key))
            );
          }),
        ),
    )
  ) {
    throw new Error(
      'Recursive BigInt and number union alternatives cannot safely preserve integer precision in strict Structured Outputs.',
    );
  }

  return overlaps;
};

const applyIntegerBounds = (schema: JsonSchema7Type, minimum: boolean, maximum: boolean): JsonSchema7Type => {
  if (!minimum && !maximum) {
    return schema;
  }

  if ('$ref' in schema) {
    throw new Error(
      'A constrained JSON Schema reference must be materialized before applying integer bounds.',
    );
  }

  const record = schema as Record<string, unknown>;
  if (minimum) {
    record['minimum'] = Math.max(
      typeof record['minimum'] === 'number' ? record['minimum'] : Number.MIN_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    );
  }
  if (maximum) {
    record['maximum'] = Math.min(
      typeof record['maximum'] === 'number' ? record['maximum'] : Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
  }
  return schema;
};

export const applyUnsafeBigIntBounds = (
  schema: JsonSchema7Type,
  producers: readonly ZodTypeDef[],
): JsonSchema7Type =>
  applyIntegerBounds(
    schema,
    producers.some((candidate) => capturesUnsafeBigIntInput(candidate, 'minimum')) &&
      (acceptsUnsafeJSONInteger(schema, 'minimum') || (!('type' in schema) && !('$ref' in schema))),
    producers.some((candidate) => capturesUnsafeBigIntInput(candidate, 'maximum')) &&
      (acceptsUnsafeJSONInteger(schema, 'maximum') || (!('type' in schema) && !('$ref' in schema))),
  );

export const applySafeIntegerBounds = (schema: JsonSchema7Type): JsonSchema7Type =>
  applyIntegerBounds(
    schema,
    acceptsUnsafeJSONInteger(schema, 'minimum'),
    acceptsUnsafeJSONInteger(schema, 'maximum'),
  );

const boundNestedNumericPath = (
  schema: JsonSchema7Type,
  path: readonly NumericPathSegment[],
  overlap: NestedNumericOverlap,
): JsonSchema7Type => {
  if (path.length === 0) {
    const bounded = applyUnsafeBigIntBounds(schema, [overlap.producer]);
    return overlap.producerPrecedesConsumer && throwsOnFractionalBigIntInput(overlap.producer, bounded)
      ? ({ ...bounded, type: 'integer' } as JsonSchema7Type)
      : bounded;
  }

  const [segment, ...remaining] = path;
  if (!segment) {
    return schema;
  }
  const record = schema as Record<string, unknown>;
  if ('$ref' in record) {
    throw new Error(
      'A constrained nested JSON Schema reference must be materialized before applying bounds.',
    );
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    const alternatives = record[keyword];
    if (Array.isArray(alternatives)) {
      record[keyword] = alternatives.map((alternative) =>
        alternative && typeof alternative === 'object'
          ? boundNestedNumericPath(alternative as JsonSchema7Type, path, overlap)
          : alternative,
      );
      return schema;
    }
  }
  if (segment.kind === 'property') {
    const properties = record['properties'] as Record<string, JsonSchema7Type> | undefined;
    const property = properties?.[segment.key];
    if (properties && property) {
      properties[segment.key] = boundNestedNumericPath(property, remaining, overlap);
    }
    return schema;
  }

  const child = record['items'] as JsonSchema7Type | undefined;
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    record['items'] = boundNestedNumericPath(child, remaining, overlap);
  }
  return schema;
};

export const applyNestedNumericOverlaps = (
  schema: JsonSchema7Type,
  overlaps: readonly NestedNumericOverlap[],
): JsonSchema7Type => {
  let bounded = schema;
  for (const overlap of overlaps) {
    bounded = boundNestedNumericPath(bounded, overlap.path, overlap);
  }
  return bounded;
};
