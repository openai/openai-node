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
  effect: { type: string };
  coerce?: boolean;
  checks?: { kind: string; value?: bigint }[];
  shape: () => Record<string, SchemaType>;
  catchall: SchemaType;
  items: SchemaType[];
  rest?: SchemaType;
  valueType: SchemaType;
};
type Traversal = 'input' | 'output' | 'unsafe-output' | 'conversion' | 'default' | 'unconditional-number';
type Inspector = (definition: InspectableDefinition) => boolean | null | undefined;

type TraversalChildren = { values: SchemaType[]; every: boolean };
const asynchronousOutputTraversals = new Set<Traversal>(['output', 'unsafe-output', 'default']);
const universalIntersectionTraversals = new Set<Traversal>([
  'input',
  'conversion',
  'unsafe-output',
  'unconditional-number',
]);

const pipelineChildren = (def: InspectableDefinition, traversal: Traversal): SchemaType[] => {
  if (traversal === 'input') {
    return [def.in];
  }
  if (traversal === 'conversion' || traversal === 'unconditional-number') {
    return [def.in, def.out];
  }
  return [def.out];
};

const childDefinitions = (def: InspectableDefinition, traversal: Traversal): TraversalChildren | null => {
  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodCatch:
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return { values: [def.innerType], every: false };
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
      return { values, every: traversal === 'conversion' };
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

    const children = childDefinitions(def, traversal);
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

export const producesBigIntOutput = (definition: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (def.typeName === ZodFirstPartyTypeKind.ZodBigInt) {
        return true;
      }
      return def.typeName === ZodFirstPartyTypeKind.ZodLiteral ? typeof def.value === 'bigint' : undefined;
    },
    'output',
  );

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
          return Object.values(def.values).some((value) => typeof value === 'number');
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

type UnsafeIntegerSide = 'minimum' | 'maximum';

export const capturesUnsafeBigIntInput = (definition: ZodTypeDef, side: UnsafeIntegerSide): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (def.typeName !== ZodFirstPartyTypeKind.ZodBigInt) {
        return;
      }

      const boundary = side === 'minimum' ? 'min' : 'max';
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
        'output',
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
      case ZodFirstPartyTypeKind.ZodEnum:
      case ZodFirstPartyTypeKind.ZodNativeEnum: {
        return Object.values(def.values);
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

const matchesDefaultDiscriminators = (
  definition: ZodTypeDef,
  value: unknown,
  active = new Set<ZodTypeDef>(),
): boolean => {
  if (active.has(definition) || !value || typeof value !== 'object' || Array.isArray(value)) {
    return true;
  }
  active.add(definition);
  try {
    const def = definition as InspectableDefinition;
    if (def.typeName !== ZodFirstPartyTypeKind.ZodObject) {
      return true;
    }
    const record = value as Record<string, unknown>;
    return Object.entries(def.shape()).every(([key, child]) => {
      if (!hasOwn(record, key)) {
        return true;
      }
      const literals = discriminatorValues(child._def);
      return literals
        ? literals.includes(record[key])
        : matchesDefaultDiscriminators(child._def, record[key], active);
    });
  } finally {
    active.delete(definition);
  }
};

export const producesBigIntAtPath = (
  definition: ZodTypeDef,
  path: readonly (string | number)[] = [],
  value?: unknown,
): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (
        def.typeName === ZodFirstPartyTypeKind.ZodUnion ||
        def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion
      ) {
        const options = def.options instanceof Map ? [...def.options.values()] : def.options;
        for (const option of options) {
          if (!matchesDefaultDiscriminators(option._def, value)) {
            continue;
          }
          if (producesBigIntAtPath(option._def, path, value)) {
            return true;
          }
          if (acceptsJSONNumberAtPath(option._def, path)) {
            return false;
          }
        }
        return false;
      }
      if (path.length === 0) {
        if (def.typeName === ZodFirstPartyTypeKind.ZodBigInt) {
          return true;
        }
        return def.typeName === ZodFirstPartyTypeKind.ZodLiteral ? typeof def.value === 'bigint' : undefined;
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
      return child !== undefined && producesBigIntAtPath(child._def, remaining, nestedValue);
    },
    'default',
  );

type NumericPathSegment = { kind: 'property'; key: string } | { kind: 'array' };

export type NestedNumericOverlap = {
  path: readonly NumericPathSegment[];
  producer: ZodTypeDef;
  consumer: ZodTypeDef;
};

type PairedChild = {
  producer: SchemaType;
  consumer: SchemaType;
  segment: NumericPathSegment;
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
  active: Map<ZodTypeDef, Set<ZodTypeDef>>,
  traversal: { recursive: boolean; lazyTargets: WeakMap<ZodTypeDef, SchemaType> },
): void => {
  let activeConsumers = active.get(producer);
  if (activeConsumers?.has(consumer)) {
    traversal.recursive = true;
    return;
  }
  if (!activeConsumers) {
    activeConsumers = new Set();
    active.set(producer, activeConsumers);
  }
  activeConsumers.add(consumer);

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
  const traversal = { recursive: false, lazyTargets: new WeakMap<ZodTypeDef, SchemaType>() };
  collectNestedNumericOverlaps(producer, consumer, [], overlaps, new Map(), traversal);
  if (
    traversal.recursive &&
    overlaps.some(
      (overlap) =>
        capturesUnsafeBigIntInput(overlap.producer, 'minimum') ||
        capturesUnsafeBigIntInput(overlap.producer, 'maximum'),
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
  producer: ZodTypeDef,
): JsonSchema7Type => {
  if (path.length === 0) {
    return applyUnsafeBigIntBounds(schema, [producer]);
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
  if (segment.kind === 'property') {
    const properties = record['properties'] as Record<string, JsonSchema7Type> | undefined;
    const property = properties?.[segment.key];
    if (properties && property) {
      properties[segment.key] = boundNestedNumericPath(property, remaining, producer);
    }
    return schema;
  }

  const child = record['items'] as JsonSchema7Type | undefined;
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    record['items'] = boundNestedNumericPath(child, remaining, producer);
  }
  return schema;
};

export const applyNestedNumericOverlaps = (
  schema: JsonSchema7Type,
  overlaps: readonly NestedNumericOverlap[],
): JsonSchema7Type => {
  let bounded = schema;
  for (const overlap of overlaps) {
    bounded = boundNestedNumericPath(bounded, overlap.path, overlap.producer);
  }
  return bounded;
};
