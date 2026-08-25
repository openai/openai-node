import type { ZodSchema, ZodTypeDef } from 'zod/v3';
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
/** The inner def of a `ZodOptional`, or `undefined` for anything else. */
const innerTypeOfOptional = (def: unknown): ZodTypeDef | undefined => {
  const candidate = def as { typeName?: unknown; innerType?: { _def?: ZodTypeDef } };
  if (candidate?.typeName !== 'ZodOptional') {
    return undefined;
  }
  return candidate.innerType?._def;
};

const reduceNeverBranches = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(reduceNeverBranches);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const walked: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walked[key] = reduceNeverBranches(child);
  }

  const branches = walked['anyOf'];
  if (!Array.isArray(branches) || branches.length !== 2) {
    return walked;
  }
  const [first, second] = branches as [unknown, unknown];
  const isNever =
    !!first &&
    typeof first === 'object' &&
    Object.keys(first as object).length === 1 &&
    typeof (first as Record<string, unknown>)['not'] === 'object' &&
    (first as Record<string, unknown>)['not'] !== null &&
    Object.keys((first as Record<string, unknown>)['not'] as object).length === 0;
  if (!isNever || !second || typeof second !== 'object' || Array.isArray(second)) {
    return walked;
  }

  const { anyOf: _dropped, ...siblings } = walked;
  return { ...(second as Record<string, unknown>), ...siblings };
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
        // The property treatment a definition needs is exactly one thing: the outer
        // optional wrapper is dropped, the way `parseOptionalDef` drops it inside a
        // property. Doing that here, rather than handing the definition a property
        // path, keeps the treatment off every descendant -- a path prefix matches
        // the whole subtree, so a nested union or array would be parsed as though it
        // too sat directly in a property and would lose the entries it holds by
        // branch or by position.
        const unwrapped =
          originatedInsideProperty(refs.seen.get(def)) ? innerTypeOfOptional(def) : undefined;

        let materialized =
          parseDef(unwrapped ?? def, { ...refs, currentPath: definitionPath }, true) ?? {};
        const outerDescription = (def as { description?: string }).description;
        if (unwrapped && outerDescription !== undefined) {
          // `parseDef` attached the inner type's metadata; the wrapper's own
          // `.describe()` still has to land, as it would on the inline occurrence.
          materialized = { ...materialized, description: outerDescription };
        }
        // `not` is outside the subset strict Structured Outputs accepts (see
        // `toStrictJsonSchema` in `lib/transform`), so a standalone optional cannot keep
        // its `anyOf: [{ not: {} }, ...]` spelling there. Rewriting the finished
        // definition is deliberate: giving it a property context instead would change how
        // everything nested inside it parses, and a container that holds an entry by
        // position or by branch loses that entry when its parser returns nothing.
        definitions[key] =
          refs.openaiStrictMode ?
            (reduceNeverBranches(materialized) as JsonSchema7Type)
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
