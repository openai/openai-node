import type { ZodSchema } from 'zod/v3';
import type { Options, Targets } from './Options';
import type { JsonSchema7Type } from './parseDef';
import { parseDef } from './parseDef';
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
  // Draft-7 `dependencies` also carries property-dependency arrays, which are
  // not schemas; `schemaChildren` skips those. Both keywords are recognized by
  // the canonical traversal in `src/lib/transform.ts`, and
  // `tests/helpers/zod-shared-optional-definitions.test.ts` asserts this map
  // stays a superset of it so the two cannot drift apart.
  ['dependencies', 'map'],
  ['contentSchema', 'schema'],
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
 * The same guard for array entries. `override` can hand back an array whose
 * indices are accessors; indexing it would run caller code, and a throwing
 * getter would take the conversion down on a schema the base revision returns
 * untouched.
 */
const hasArrayAccessor = (values: unknown[]): boolean => {
  // By index rather than `some`, which reads each element to hand it to the
  // callback -- the very thing being guarded against.
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor || !('value' in descriptor)) {
      return true;
    }
  }
  return false;
};

/** The value of an own data element, or `undefined` for an accessor. */
const elementValue = (values: unknown[], index: number): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(values, index);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

/**
 * A plain copy, built without iterating the original.
 *
 * Spreading or destructuring consults `Symbol.iterator`, which an `override`
 * can define; serialization ignores it, so running it would be a side effect of
 * inspection alone.
 */
const elementsOf = (values: unknown[]): unknown[] => {
  const copy: unknown[] = [];
  for (let index = 0; index < values.length; index++) {
    copy[index] = elementValue(values, index);
  }
  return copy;
};

/** Whether an array carries a caller-defined iterator hook. */
const hasCustomIterator = (values: unknown[]): boolean =>
  Object.getOwnPropertyDescriptor(values, Symbol.iterator) !== undefined;

/**
 * `anyOf: [{ not: {} }, X]` collapsed to `X`, with annotation siblings kept.
 *
 * The first branch matches nothing, so the union is exactly `X` -- an identity in
 * JSON Schema. A validation keyword beside the union applies on top of the
 * branch, so a schema carrying one is left standing rather than merged: spreading
 * it over the branch would widen what the document accepts.
 */
/**
 * A two-branch `anyOf` this can read without running caller code.
 *
 * Everything below reads entries by descriptor, but the array itself still has
 * to be safe to walk: an `override` can define accessors on the indices or an
 * iterator hook, neither of which serialization consults.
 */
const isInspectableBranchList = (branches: unknown): branches is unknown[] =>
  Array.isArray(branches) &&
  branches.length === 2 &&
  !hasArrayAccessor(branches) &&
  !hasCustomIterator(branches);

/**
 * The siblings of the union that may move onto the surviving branch, or `null`
 * when one of them cannot.
 */
const carriedSiblings = (
  schema: Record<string, unknown>,
  second: Record<string, unknown>,
): Record<string, unknown> | null => {
  const carried: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    if (key === 'anyOf') {
      continue;
    }
    // `nullable` is how the OpenAPI targets spell a nullable, and
    // `parseNullableDef` writes it beside the union rather than as a branch.
    // The union is an identity, so moving the sibling onto the branch is the
    // encoding the same schema gets inline. A branch that already says the same
    // thing is the redundant-wrapper case and coalesces; one that disagrees is
    // two claims, and choosing between them is not this function's business.
    const branchNullable = dataValue(second, 'nullable');
    const isOpenApiNullable =
      key === 'nullable' &&
      (Object.getOwnPropertyDescriptor(second, 'nullable') === undefined ||
        branchNullable === dataValue(schema, 'nullable'));
    if (!ANNOTATION_KEYWORDS.has(key) && !isOpenApiNullable) {
      return null;
    }
    carried[key] = dataValue(schema, key);
  }
  return carried;
};

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
  if (!isInspectableBranchList(branches)) {
    return -1;
  }
  for (const [nullIndex, otherIndex] of [
    [1, 0],
    [0, 1],
  ]) {
    const candidate = elementValue(branches, nullIndex as number);
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
  // Accessor entries are left untouched: every read below -- destructuring
  // included -- would otherwise run caller code from `override`.
  if (!isInspectableBranchList(branches)) {
    return schema;
  }
  const throughNullable = nullableBranchIndex(branches);
  if (throughNullable !== -1) {
    const inner = elementValue(branches, throughNullable);
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
    const rebuilt = elementsOf(branches);
    rebuilt[throughNullable] = collapsedInner;
    return { ...schema, anyOf: rebuilt };
  }
  const first = elementValue(branches, 0);
  const second = elementValue(branches, 1);
  if (!isPlainObject(first) || !isPlainObject(second) || hasAccessor(first) || hasAccessor(second)) {
    return schema;
  }
  const not = dataValue(first, 'not');
  if (Object.keys(first).length !== 1 || !isPlainObject(not) || Object.keys(not).length > 0) {
    return schema;
  }
  const carried = carriedSiblings(schema, second);
  if (!carried) {
    return schema;
  }
  // Both branches leave their old paths, so a reference into either one is a
  // reference into something the collapse removes.
  wrapperSegments.push([...prefix, 'anyOf', '0'], [...prefix, 'anyOf', '1']);
  return { ...second, ...carried };
};

/**
 * A reference as its pointer, not as the caller happened to spell it.
 *
 * `$ref` is a URI reference, so `#%2Fdefinitions%2FA` and `#/definitions/A`
 * name the same place. `resolveLocalRef` in `lib/transform` decodes before
 * splitting the pointer, and comparing raw strings here would miss the encoded
 * spelling of a reference into a wrapper about to be removed.
 */
const normalizedRef = (ref: string): string => {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
};

/**
 * Every reference the document emits, with whether it sits inside an object
 * property.
 *
 * Both questions the collapse has to answer are about the emitted document
 * rather than about how a def was reached: a definition is only the encoding a
 * property asked for if a property actually references it, and a wrapper is
 * only stranded if a reference names something inside it. Reading the output
 * answers both without inferring either.
 */
const collectRefs = (value: unknown): { ref: string; insideProperty: boolean }[] => {
  const found: { ref: string; insideProperty: boolean }[] = [];
  const pending: { value: unknown; insideProperty: boolean }[] = [{ value, insideProperty: false }];
  // Keyed by context as well as identity: a subtree shared between a property
  // and something else has to be walked once for each, or whichever the stack
  // reached first would decide the answer for both.
  const seen = { true: new Set<unknown>(), false: new Set<unknown>() };

  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) {
      break;
    }
    const { value: current, insideProperty } = next;
    const visited = seen[insideProperty ? 'true' : 'false'];
    if (typeof current !== 'object' || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index++) {
        pending.push({ value: elementValue(current, index), insideProperty });
      }
      continue;
    }
    if (!isPlainObject(current)) {
      continue;
    }

    const ref = dataValue(current, '$ref');
    if (typeof ref === 'string') {
      found.push({ ref: normalizedRef(ref), insideProperty });
    }

    for (const [key, kind] of SCHEMA_CHILDREN) {
      const child = dataValue(current, key);
      // Anything below `properties` was reached through one, which is the
      // context `parseOptionalDef` encodes for.
      const nested = insideProperty || key === 'properties';
      if (kind === 'map' && isPlainObject(child)) {
        for (const name of Object.keys(child)) {
          const entry = dataValue(child, name);
          if (key === 'dependencies' && !isPlainObject(entry)) {
            continue;
          }
          pending.push({ value: entry, insideProperty: nested });
        }
      } else {
        pending.push({ value: child, insideProperty: nested });
      }
    }
  }

  return found;
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
const someSchemaNode = (value: unknown, matches: (node: Record<string, unknown>) => boolean): boolean => {
  // An explicit stack rather than recursion: an `override` can hand back a
  // schema of any depth, and this walks the whole document.
  const pending: unknown[] = [value];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      // `JSON.stringify` calls `toJSON` on an array too, so the list itself is
      // offered to the predicate before its entries are walked. By index: an
      // `override` can hand back accessor entries, and both indexing and `some`
      // would run caller code during what is only an inspection.
      if (matches(current as unknown as Record<string, unknown>)) {
        return true;
      }
      for (let index = 0; index < current.length; index++) {
        pending.push(elementValue(current, index));
      }
      continue;
    }

    if (!isPlainObject(current)) {
      continue;
    }
    if (matches(current)) {
      return true;
    }
    for (const [key, kind] of SCHEMA_CHILDREN) {
      const child = dataValue(current, key);
      if (kind === 'map' && isPlainObject(child)) {
        for (const name of Object.keys(child)) {
          const entry = dataValue(child, name);
          // Draft-7 `dependencies` also holds property-dependency arrays. They
          // are lists of property names rather than schemas, so they are not
          // walked.
          if (key === 'dependencies' && !isPlainObject(entry)) {
            continue;
          }
          pending.push(entry);
        }
      } else {
        pending.push(child);
      }
    }
  }

  return false;
};

/**
 * A reference this cannot read without running caller code.
 *
 * `dataValue` reports an accessor as absent, which is right for reading and
 * wrong for deciding: `JSON.stringify` will call the getter, and what it
 * returns can be a pointer into a wrapper being removed. That applies to
 * `$ref` itself and equally to any keyword carrying schemas, since a hidden
 * subtree hides every reference inside it. The getters are never invoked --
 * their presence alone is enough to leave the wrappers standing.
 */
const hasHiddenReference = (node: Record<string, unknown>): boolean => {
  // Over the keys the node has rather than every keyword it could have: this
  // runs on every node of every definition.
  for (const key of Object.keys(node)) {
    if (key !== '$ref' && !SCHEMA_CHILDREN.has(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor !== undefined && !('value' in descriptor)) {
      return true;
    }
  }
  return false;
};

/**
 * Whether anything in this document makes moving a wrapper unsafe.
 *
 * Each of these is a reference the scan cannot follow to a pointer it can
 * compare: one whose meaning depends on where it sits, one that only exists
 * once `JSON.stringify` asks, and one behind a getter this deliberately does
 * not call. None can be ruled out without running caller code, so the wrappers
 * stay -- which is what the base revision does anyway.
 */
const wrappersMustStay = (value: unknown): boolean =>
  // One traversal rather than three: this runs over the whole definitions map.
  someSchemaNode(value, (node) => {
    if ('toJSON' in node || hasHiddenReference(node)) {
      return true;
    }
    const ref = dataValue(node, '$ref');
    return typeof ref === 'string' && !ref.startsWith('#');
  });

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
    // Nothing is collapsed while definitions are still being built: a later one
    // can add a `$ref` into a branch an earlier collapse removed, so each is
    // held here and decided once the document is complete.
    const materializedDefinitions: {
      key: string;
      definitionPath: string[];
      materialized: JsonSchema7Type;
    }[] = [];

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
        // Collapse decided below, once every definition exists: a definition
        // materialized later can add a reference into a branch removed here.
        // Whether this one collapses cannot be answered yet: the property that
        // references it may live in a definition materialized later, and the
        // reference context only exists once that has happened. Definition
        // insertion order would otherwise decide the output.
        materializedDefinitions.push({ key, definitionPath, materialized });
        definitions[key] = materialized;
        processedDefinitions.add(key);
      }
    }

    // Which definitions a collapse could apply to at all. Computed before any
    // reference scan because an ordinary schema has none, and the scans below
    // walk the whole document -- including a schema an `override` supplied,
    // which can be arbitrarily deep.
    const candidates: {
      key: string;
      path: string;
      collapsed: JsonSchema7Type;
      wrapperPaths: string[];
    }[] = [];
    for (const { key, definitionPath, materialized } of materializedDefinitions) {
      if (!isPlainObject(materialized)) {
        continue;
      }
      const removedWrappers: string[][] = [];
      const collapsed = collapseNeverBranch(materialized, removedWrappers) as JsonSchema7Type;
      if (collapsed !== materialized) {
        candidates.push({
          key,
          path: definitionPath.join('/'),
          collapsed,
          wrapperPaths: removedWrappers.map((segments) => [...definitionPath, ...segments].join('/')),
        });
      }
    }
    if (candidates.length === 0) {
      return definitions;
    }

    // Every reference the document actually emits, gathered once, now that
    // every definition exists and each one's reference context is final.
    // `refs.seen` answers which Zod defs were reached and in what context,
    // which is not the same question: it is keyed by def, so aliases share one
    // entry, definition order decides which context is recorded, and a read
    // that emitted no `$ref` counts the same as one that did. The finished
    // document answers it directly.
    // Wrapped so the walk reads `definitions` as a map of schemas; its own keys
    // are names, not keywords.
    const emitted = [...collectRefs(main), ...collectRefs({ definitions })];
    const referencedFromProperty = new Set<string>();
    const referencedElsewhere = new Set<string>();
    // A wrapper is stranded when a pointer names it or anything under it, so
    // the prefixes are indexed rather than re-scanned per candidate -- that
    // scan is O(references) inside a loop over candidates, and both grow with
    // the number of shared optionals.
    const referencedPrefixes = new Set<string>();
    for (const { ref, insideProperty } of emitted) {
      (insideProperty ? referencedFromProperty : referencedElsewhere).add(ref);
      const segments = ref.split('/');
      for (let end = 1; end <= segments.length; end++) {
        referencedPrefixes.add(segments.slice(0, end).join('/'));
      }
    }

    // Only when every reference to a definition came from a property is the
    // property encoding the one it owes all of them.
    const pendingCollapses = candidates.filter(
      ({ path }) => referencedFromProperty.has(path) && !referencedElsewhere.has(path),
    );
    if (pendingCollapses.length === 0) {
      return definitions;
    }

    // Two things make every wrapper move unsafe rather than only the ones a
    // pointer names: a relative reference, whose depth is part of its meaning,
    // and a serialization hook, which can produce a reference the scan cannot
    // see without running caller code.
    const unsafeToMove = wrappersMustStay(main) || wrappersMustStay({ definitions });

    for (const { key, collapsed, wrapperPaths } of pendingCollapses) {
      const stranded =
        unsafeToMove || wrapperPaths.some((wrapperPath) => referencedPrefixes.has(wrapperPath));
      if (!stranded) {
        definitions[key] = collapsed;
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
