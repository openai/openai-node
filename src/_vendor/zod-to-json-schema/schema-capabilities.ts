import type { ZodTypeDef } from 'zod/v3';
import { ZodFirstPartyTypeKind } from 'zod/v3';
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
type Traversal = 'input' | 'output' | 'conversion' | 'default' | 'unconditional-number';
type Inspector = (definition: InspectableDefinition) => boolean | null | undefined;

type TraversalChildren = { values: SchemaType[]; every: boolean };

const pipelineChildren = (def: InspectableDefinition, traversal: Traversal): SchemaType[] => {
  if (traversal === 'input' || traversal === 'unconditional-number') {
    return [def.in];
  }
  if (traversal === 'conversion') {
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
    case ZodFirstPartyTypeKind.ZodBranded:
    case ZodFirstPartyTypeKind.ZodPromise: {
      return { values: [def.type], every: false };
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      return { values: [def.schema], every: false };
    }
    case ZodFirstPartyTypeKind.ZodLazy: {
      return { values: [def.getter()], every: false };
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return { values: pipelineChildren(def, traversal), every: false };
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const values = def.options instanceof Map ? [...def.options.values()] : def.options;
      return { values, every: traversal === 'conversion' || traversal === 'default' };
    }
    case ZodFirstPartyTypeKind.ZodIntersection: {
      return {
        values: [def.left, def.right],
        every: traversal === 'input' || traversal === 'unconditional-number',
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

export const acceptsEveryJSONNumber = (definition: ZodTypeDef): boolean =>
  visitDefinition(
    definition,
    (def) => {
      switch (def.typeName) {
        case ZodFirstPartyTypeKind.ZodNumber:
        case ZodFirstPartyTypeKind.ZodAny:
        case ZodFirstPartyTypeKind.ZodUnknown: {
          return true;
        }
        case ZodFirstPartyTypeKind.ZodEffects: {
          return false;
        }
        default: {
          return null;
        }
      }
    },
    'unconditional-number',
  );

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
    'output',
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

export const producesBigIntAtPath = (
  definition: ZodTypeDef,
  path: readonly (string | number)[] = [],
): boolean =>
  visitDefinition(
    definition,
    (def) => {
      if (path.length === 0) {
        if (def.typeName === ZodFirstPartyTypeKind.ZodBigInt) {
          return true;
        }
        return def.typeName === ZodFirstPartyTypeKind.ZodLiteral ? typeof def.value === 'bigint' : undefined;
      }

      const [key, ...remaining] = path;
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
        case ZodFirstPartyTypeKind.ZodTuple: {
          child =
            typeof key === 'number' ? ((def.items[key] ?? def.rest) as SchemaType | undefined) : undefined;
          break;
        }
        case ZodFirstPartyTypeKind.ZodRecord: {
          child = typeof key === 'string' ? (def.valueType as SchemaType) : undefined;
          break;
        }
        default: {
          return;
        }
      }

      return child !== undefined && producesBigIntAtPath(child._def, remaining);
    },
    'default',
  );
