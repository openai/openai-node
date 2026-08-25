import type { ZodSchema } from 'zod/v3';
import type { Options, Targets } from './Options';
import type { JsonSchema7Type } from './parseDef';
import { parseDef } from './parseDef';
import type { Seen } from './Refs';
import { getRefs } from './Refs';
import { zodDef, isEmptyObj } from './util';

function ownStrictRootSchema(
  schema: unknown,
  name: string | undefined,
  nameStrategy: string,
): JsonSchema7Type {
  if (schema === null || typeof schema !== 'object') {
    throw new TypeError('Root schema must be a plain JSON-schema record');
  }

  const prototype = Object.getPrototypeOf(schema) as object | null;
  if (![null, Object.prototype].includes(prototype)) {
    throw new TypeError('Root schema must be a plain JSON-schema record');
  }

  const owned: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(schema))) {
    if (!descriptor.enumerable) {
      continue;
    }
    if (!('value' in descriptor)) {
      throw new TypeError(`Root schema property '${key}' must be a data property`);
    }

    const value: unknown = descriptor.value;
    if (key === 'toJSON' && typeof value === 'function') {
      throw new TypeError("Root schema cannot contain a callable 'toJSON' property");
    }
    if (['undefined', 'function', 'symbol'].includes(typeof value)) {
      continue;
    }

    Object.defineProperty(owned, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  const { type, nullable, $ref: reference } = owned;
  if (!['undefined', 'boolean'].includes(typeof nullable)) {
    throw new TypeError("Root schema 'nullable' must be a boolean");
  }
  if (type !== 'object' || nullable === true) {
    let actualType: string | undefined;
    if (typeof type === 'string') {
      actualType = nullable === true ? `${type},null` : type;
    } else if (Array.isArray(type)) {
      actualType = type.join(',');
    }
    throw new Error(
      `Root schema must have type: 'object' but got type: ${actualType ? `'${actualType}'` : 'undefined'}`,
    );
  }
  if (reference !== undefined) {
    throw new Error("Root schema must be a concrete object and cannot contain '$ref'");
  }

  if (name !== undefined && nameStrategy !== 'duplicate-ref') {
    throw new Error("Root schema must have type: 'object' but got type: undefined");
  }

  return owned as JsonSchema7Type;
}

/**
 * Whether the def was first reached from inside an object property.
 *
 * `Seen.propertyPath` is the nearest enclosing property at the reference site, and
 * `Seen.path` is where the def itself sat. The def is inside that property when its path
 * starts with it -- the same test `parseOptionalDef` applies.
 */
const originatedInsideProperty = (seen: Seen | undefined): boolean => {
  const propertyPath = seen?.propertyPath;
  if (!seen || !propertyPath) {
    return false;
  }
  // `referencePath` is set for a def pre-seeded from `definitions`, where `path`
  // points at the definition rather than the place it was referenced from.
  const from = seen.referencePath ?? seen.path;
  return from.slice(0, propertyPath.length).toString() === propertyPath.toString();
};

/**
 * Keywords that describe a schema without constraining what it accepts. JSON
 * Schema files all of these under annotations, so they can move when the wrapper
 * around them is removed.
 */
const ANNOTATION_KEYWORDS = new Set([
  'description',
  'markdownDescription',
  'title',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
  'default',
  'examples',
]);

/** Keywords whose value is a schema, a list of schemas, or a map of schemas. */
const SCHEMA_CHILDREN = new Map<string, 'schema' | 'list' | 'map'>([
  ['not', 'schema'],
  ['if', 'schema'],
  ['then', 'schema'],
  ['else', 'schema'],
  ['items', 'list'],
  ['prefixItems', 'list'],
  ['contains', 'schema'],
  ['additionalItems', 'schema'],
  ['additionalProperties', 'schema'],
  ['unevaluatedItems', 'schema'],
  ['unevaluatedProperties', 'schema'],
  ['propertyNames', 'schema'],
  ['anyOf', 'list'],
  ['oneOf', 'list'],
  ['allOf', 'list'],
  ['properties', 'map'],
  ['patternProperties', 'map'],
  ['dependentSchemas', 'map'],
  ['definitions', 'map'],
  ['$defs', 'map'],
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The value of an own enumerable data property, or `undefined` for anything else.
 *
 * A schema can reach here from the public `override` hook, where a key may be an
 * accessor. Reading one runs caller code before anything has validated it, and a
 * throwing getter would take the conversion down.
 */
const dataValue = (value: Record<string, unknown>, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  // `enumerable` as well: serialization emits own enumerable properties, so a
  // non-enumerable one is not in the document this is normalizing.
  return descriptor && descriptor.enumerable && 'value' in descriptor ? descriptor.value : undefined;
};

const hasAccessor = (value: Record<string, unknown>): boolean =>
  Object.keys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !('value' in descriptor);
  });

/**
 * `anyOf: [{ not: {} }, X]` collapsed to `X`, with annotation siblings kept.
 *
 * The first branch matches nothing, so the union is exactly `X` -- an identity in
 * JSON Schema. A validation keyword beside the union applies on top of the
 * branch, so a schema carrying one is left standing rather than merged: spreading
 * it over the branch would widen what the document accepts.
 */
/**
 * `anyOf: [X, { type: 'null' }]` -- how `parseNullableDef` spells a nullable in
 * this target. Returns the index of the non-null branch, or -1.
 *
 * Optionality is not always the outermost wrapper: `z.string().optional().nullable()`
 * puts the union inside. Inline, `propertyPath` reaches through the nullable and
 * the inner wrapper is dropped; the extracted definition has to match. This is the
 * one wrapper it steps through -- it is transparent by construction, unlike an
 * arbitrary container whose entries are positional or alternative.
 */
const nullableBranchIndex = (branches: unknown[]): number => {
  if (branches.length !== 2) {
    return -1;
  }
  for (const [nullIndex, otherIndex] of [
    [1, 0],
    [0, 1],
  ]) {
    const candidate = branches[nullIndex as number];
    if (
      isPlainObject(candidate) &&
      !hasAccessor(candidate) &&
      Object.keys(candidate).length === 1 &&
      dataValue(candidate, 'type') === 'null'
    ) {
      return otherIndex as number;
    }
  }
  return -1;
};

const collapseNeverBranch = (
  schema: Record<string, unknown>,
  wrapperSegments: string[][] = [],
  prefix: string[] = [],
): Record<string, unknown> => {
  if (hasAccessor(schema)) {
    return schema;
  }
  const branches = dataValue(schema, 'anyOf');
  if (!Array.isArray(branches) || branches.length !== 2) {
    return schema;
  }
  const throughNullable = nullableBranchIndex(branches);
  if (throughNullable !== -1) {
    const inner = branches[throughNullable];
    if (!isPlainObject(inner)) {
      return schema;
    }
    const collapsedInner = collapseNeverBranch(inner, wrapperSegments, [
      ...prefix,
      'anyOf',
      String(throughNullable),
    ]);
    if (collapsedInner === inner) {
      return schema;
    }
    const rebuilt = [...branches];
    rebuilt[throughNullable] = collapsedInner;
    return { ...schema, anyOf: rebuilt };
  }
  const [first, second] = branches as [unknown, unknown];
  if (!isPlainObject(first) || !isPlainObject(second) || hasAccessor(first) || hasAccessor(second)) {
    return schema;
  }
  const not = dataValue(first, 'not');
  if (Object.keys(first).length !== 1 || !isPlainObject(not) || Object.keys(not).length > 0) {
    return schema;
  }
  const carried: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    if (key === 'anyOf') {
      continue;
    }
    if (!ANNOTATION_KEYWORDS.has(key)) {
      return schema;
    }
    carried[key] = dataValue(schema, key);
  }
  wrapperSegments.push([...prefix, 'anyOf', '1']);
  return { ...second, ...carried };
};

/**
 * Whether anything reachable through JSON Schema keywords points at a path that
 * only exists while the wrapper is in place.
 *
 * Collapsing removes an `anyOf/1` segment from every pointer below it, and
 * references were generated against the uncollapsed shape. Where one aims inside,
 * the wrapper stays: a redundant `anyOf` still means what it says, a broken
 * `$ref` does not. Literal payloads are not searched -- a reference-shaped string
 * inside a `default` is data, not a reference.
 */
const referencesWrapperPath = (value: unknown, wrapperPath: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => referencesWrapperPath(item, wrapperPath));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  const ref = dataValue(value, '$ref');
  if (typeof ref === 'string' && ref.includes(wrapperPath)) {
    return true;
  }
  for (const [key, kind] of SCHEMA_CHILDREN) {
    const child = dataValue(value, key);
    if (kind === 'map' && isPlainObject(child)) {
      if (Object.keys(child).some((name) => referencesWrapperPath(dataValue(child, name), wrapperPath))) {
        return true;
      }
    } else if (referencesWrapperPath(child, wrapperPath)) {
      return true;
    }
  }
  return false;
};

const zodToJsonSchema = <Target extends Targets = 'jsonSchema7'>(
  schema: ZodSchema<any>,
  options?: Partial<Options<Target>> | string,
): (Target extends 'jsonSchema7' ? JsonSchema7Type : object) & {
  $schema?: string;
  definitions?: Record<
    string,
    Target extends 'jsonSchema7'
      ? JsonSchema7Type
      : Target extends 'jsonSchema2019-09'
        ? JsonSchema7Type
        : object
  >;
} => {
  const refs = getRefs(options);
  if (refs.openaiStrictMode) {
    refs.definitions = { ...refs.definitions };
  }

  let name: string | undefined;
  if (typeof options === 'string') {
    name = options;
  } else if (options?.nameStrategy !== 'title') {
    name = options?.name;
  }

  const parsed =
    parseDef(
      schema._def,
      name === undefined
        ? refs
        : {
            ...refs,
            currentPath: [...refs.basePath, refs.definitionPath, name],
          },
      refs.openaiStrictMode === true,
    ) ?? {};
  const main = refs.openaiStrictMode ? ownStrictRootSchema(parsed, name, refs.nameStrategy) : parsed;

  const title = refs.nameStrategy === 'title' ? refs.name : undefined;

  if (title !== undefined) {
    main.title = title;
  }

  const definitions = (() => {
    if (isEmptyObj(refs.definitions)) {
      return undefined;
    }

    const definitions: Record<string, any> = {};
    const processedDefinitions = new Set();

    // the call to `parseDef()` here might itself add more entries to `.definitions`
    // so we need to continually evaluate definitions until we've resolved all of them
    //
    // we have a generous iteration limit here to avoid blowing up the stack if there
    // are any bugs that would otherwise result in us iterating indefinitely
    for (let i = 0; i < 500; i++) {
      const newDefinitions = Object.entries(refs.definitions).filter(
        ([key]) => !processedDefinitions.has(key),
      );
      if (newDefinitions.length === 0) {
        break;
      }

      for (const [key, schema] of newDefinitions) {
        const def = zodDef(schema);
        const definitionPath = [...refs.basePath, refs.definitionPath, key];
        // A definition extracted from a property has to be parsed as though it were still
        // in that property, or the wrapper parsers encode it differently from the inline
        // occurrence of the same Zod schema -- `parseOptionalDef` falls back to its
        // standalone `anyOf: [{ not: {} }, ...]` form. Definitions reached from anywhere
        // else keep no property context: that is what they were parsed with the first
        // time, and the standalone encoding is the correct one for them.
        //
        // Parsed with no property context, so nothing below the definition is
        // treated as though it sat directly in a property -- a path prefix matches
        // the whole subtree, and a nested union or array would lose the entries it
        // holds by branch or by position. The one thing a property-derived
        // definition does need, dropping its outer optional wrapper, is the same
        // identity the strict reduction applies, so it is done afterwards on the
        // finished schema. The def itself still goes through `parseDef`, so
        // `override` and `.describe()` behave exactly as they did.
        const materialized = parseDef(def, { ...refs, currentPath: definitionPath }, true) ?? {};
        // `not` is outside the subset strict Structured Outputs accepts (see
        // `toStrictJsonSchema` in `lib/transform`), so a standalone optional cannot keep
        // its `anyOf: [{ not: {} }, ...]` spelling there. Rewriting the finished
        // definition is deliberate: giving it a property context instead would change how
        // everything nested inside it parses, and a container that holds an entry by
        // position or by branch loses that entry when its parser returns nothing.
        // The one thing a property-derived definition needs is its outer optional
        // wrapper dropped: the inline occurrence of the same Zod schema is encoded
        // without it, and the two have to agree. Nothing below the definition is
        // touched, and the wrapper stays wherever removing it would strand a
        // pointer generated against the uncollapsed shape.
        let finished: JsonSchema7Type = materialized;
        if (originatedInsideProperty(refs.seen.get(def)) && isPlainObject(materialized)) {
          const removedWrappers: string[][] = [];
          const collapsed = collapseNeverBranch(materialized, removedWrappers) as JsonSchema7Type;
          // Every path the collapse actually removed, not just the outer one:
          // stepping through a nullable puts the wrapper a level down.
          const stranded = removedWrappers.some((segments) =>
            referencesWrapperPath(materialized, [...definitionPath, ...segments].join('/')),
          );
          if (collapsed !== materialized && !stranded) {
            finished = collapsed;
          }
        }
        definitions[key] = finished;
        processedDefinitions.add(key);
      }
    }

    return definitions;
  })();

  let combined: ReturnType<typeof zodToJsonSchema<Target>>;
  if (name === undefined) {
    combined = definitions
      ? {
          ...main,
          [refs.definitionPath]: definitions,
        }
      : main;
  } else if (refs.nameStrategy === 'duplicate-ref') {
    combined = {
      ...main,
      ...(definitions || refs.seenRefs.size
        ? {
            [refs.definitionPath]: {
              ...definitions,
              // only actually duplicate the schema definition if it was ever referenced
              // otherwise the duplication is completely pointless
              ...(refs.seenRefs.size ? { [name]: main } : undefined),
            },
          }
        : undefined),
    };
  } else {
    combined = {
      $ref: [...(refs.$refStrategy === 'relative' ? [] : refs.basePath), refs.definitionPath, name].join('/'),
      [refs.definitionPath]: {
        ...definitions,
        [name]: main,
      },
    };
  }

  if (refs.target === 'jsonSchema7') {
    combined.$schema = 'http://json-schema.org/draft-07/schema#';
  } else if (refs.target === 'jsonSchema2019-09') {
    combined.$schema = 'https://json-schema.org/draft/2019-09/schema#';
  }

  return combined;
};

export { zodToJsonSchema };
