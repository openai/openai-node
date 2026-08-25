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
  if (!propertyPath) {
    return false;
  }
  return seen!.path.slice(0, propertyPath.length).toString() === propertyPath.toString();
};

/**
 * `anyOf: [{ not: {} }, X]` collapsed to `X`, everywhere it appears.
 *
 * The first branch matches nothing, so the union is exactly `X` — an identity in
 * JSON Schema, and the only spelling strict Structured Outputs will take. Any
 * sibling keywords, `description` among them, are carried onto the result.
 *
 * This walks the whole materialized definition rather than only its root: a
 * container supplied through `schemaDefinitions` holds its optional elements
 * nested, and a `not` left down there is rejected just the same.
 */
/**
 * Keywords whose value is a schema, a list of schemas, or a map of schemas.
 *
 * Everything else -- `default`, `const`, `enum`, `examples`, `required` -- holds
 * literal JSON that happens to be an object, and walking into it would rewrite a
 * value the caller declared. `toStrictJsonSchema` in `lib/transform` draws the
 * same line.
 */
const SCHEMA_KEYWORD = 'schema';
const SCHEMA_LIST_KEYWORD = 'list';
const SCHEMA_MAP_KEYWORD = 'map';

const SCHEMA_CHILDREN: Record<string, typeof SCHEMA_KEYWORD | typeof SCHEMA_LIST_KEYWORD | typeof SCHEMA_MAP_KEYWORD> =
  {
    not: SCHEMA_KEYWORD,
    if: SCHEMA_KEYWORD,
    then: SCHEMA_KEYWORD,
    else: SCHEMA_KEYWORD,
    contains: SCHEMA_KEYWORD,
    additionalItems: SCHEMA_KEYWORD,
    additionalProperties: SCHEMA_KEYWORD,
    unevaluatedItems: SCHEMA_KEYWORD,
    unevaluatedProperties: SCHEMA_KEYWORD,
    propertyNames: SCHEMA_KEYWORD,
    anyOf: SCHEMA_LIST_KEYWORD,
    oneOf: SCHEMA_LIST_KEYWORD,
    allOf: SCHEMA_LIST_KEYWORD,
    prefixItems: SCHEMA_LIST_KEYWORD,
    properties: SCHEMA_MAP_KEYWORD,
    patternProperties: SCHEMA_MAP_KEYWORD,
    dependentSchemas: SCHEMA_MAP_KEYWORD,
    definitions: SCHEMA_MAP_KEYWORD,
    $defs: SCHEMA_MAP_KEYWORD,
  };

/** Keywords that describe a schema without constraining what it accepts. */
const ANNOTATION_KEYWORDS = new Set([
  'description',
  'markdownDescription',
  'title',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `anyOf: [{ not: {} }, X]` collapsed to `X`, with any sibling keywords kept.
 *
 * The first branch matches nothing, so the union is exactly `X` -- an identity in
 * JSON Schema, and the only spelling strict Structured Outputs will take.
 */
const collapseNeverBranch = (schema: Record<string, unknown>): Record<string, unknown> => {
  const branches = schema['anyOf'];
  if (!Array.isArray(branches) || branches.length !== 2) {
    return schema;
  }
  const [first, second] = branches as [unknown, unknown];
  const isNever =
    isPlainObject(first) &&
    Object.keys(first).length === 1 &&
    isPlainObject(first['not']) &&
    Object.keys(first['not'] as object).length === 0;
  if (!isNever || !isPlainObject(second)) {
    return schema;
  }
  // Only annotations move across. `addMeta` is what puts them there, and they
  // constrain nothing. A validation keyword sitting beside the union -- an
  // `override` can return one -- means both it and the branch's own copy apply,
  // and letting the outer one win would widen what the document accepts.
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'anyOf' && ANNOTATION_KEYWORDS.has(key)) {
      carried[key] = value;
    }
  }
  const collidesOnConstraint = Object.keys(schema).some(
    (key) => key !== 'anyOf' && !ANNOTATION_KEYWORDS.has(key),
  );
  if (collidesOnConstraint) {
    return schema;
  }
  return { ...second, ...carried };
};

/** `collapseNeverBranch` at every schema position, literal payloads left alone. */
const collapseNeverBranchesDeep = (value: unknown): unknown => {
  if (!isPlainObject(value)) {
    return value;
  }
  const walked: Record<string, unknown> = { ...value };
  for (const [key, child] of Object.entries(value)) {
    const kind = SCHEMA_CHILDREN[key];
    if (kind === SCHEMA_KEYWORD) {
      walked[key] = collapseNeverBranchesDeep(child);
    } else if (kind === SCHEMA_LIST_KEYWORD && Array.isArray(child)) {
      walked[key] = child.map(collapseNeverBranchesDeep);
    } else if (kind === SCHEMA_MAP_KEYWORD && isPlainObject(child)) {
      // A null-prototype map: plain assignment of a `__proto__` key reaches the
      // inherited setter instead of creating an own property, which drops the
      // entry and installs it as the object's prototype.
      const mapped: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [name, sub] of Object.entries(child)) {
        mapped[name] = collapseNeverBranchesDeep(sub);
      }
      walked[key] = { ...mapped };
    } else if (key === 'items') {
      // `items` is a schema in draft 2020-12 and either a schema or a positional
      // list before it.
      walked[key] = Array.isArray(child) ? child.map(collapseNeverBranchesDeep) : (
          collapseNeverBranchesDeep(child)
        );
    }
  }
  return collapseNeverBranch(walked);
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
        const materialized =
          parseDef(def, { ...refs, currentPath: definitionPath }, true) ?? {};
        // `not` is outside the subset strict Structured Outputs accepts (see
        // `toStrictJsonSchema` in `lib/transform`), so a standalone optional cannot keep
        // its `anyOf: [{ not: {} }, ...]` spelling there. Rewriting the finished
        // definition is deliberate: giving it a property context instead would change how
        // everything nested inside it parses, and a container that holds an entry by
        // position or by branch loses that entry when its parser returns nothing.
        definitions[key] =
          refs.openaiStrictMode ?
            // `not` is outside the subset strict Structured Outputs accepts, at any
            // depth (see `toStrictJsonSchema` in `lib/transform`).
            (collapseNeverBranchesDeep(materialized) as JsonSchema7Type)
          : originatedInsideProperty(refs.seen.get(def)) ?
            // Only the outer wrapper: the inline occurrence of this same schema is
            // encoded without it, and the two have to agree.
            (collapseNeverBranch(materialized as Record<string, unknown>) as JsonSchema7Type)
          : materialized;
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
