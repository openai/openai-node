import type { ZodSchema } from 'zod/v3';
import type { Options, Targets } from './Options';
import type { JsonSchema7Type } from './parseDef';
import { parseDef } from './parseDef';
import { getRefs } from './Refs';
import { zodDef, isEmptyObj } from './util';

function validateStrictRootSchema(schema: object, openaiStrictMode: boolean | undefined): void {
  if (!openaiStrictMode) {
    return;
  }

  const typeProperty = Object.getOwnPropertyDescriptor(schema, 'type');
  const nullableProperty = Object.getOwnPropertyDescriptor(schema, 'nullable');
  if ((typeProperty && !('value' in typeProperty)) || (nullableProperty && !('value' in nullableProperty))) {
    throw new Error('Accessor-backed root schema properties are not supported');
  }

  const type = typeProperty?.value;
  const nullable = nullableProperty?.value === true;
  if (type !== 'object' || nullable) {
    const actualType = nullable && type ? `${type},null` : type;
    throw new Error(
      `Root schema must have type: 'object' but got type: ${actualType ? `'${actualType}'` : 'undefined'}`,
    );
  }
  if (Object.getOwnPropertyDescriptor(schema, '$ref')) {
    throw new Error("Root schema must be a concrete object and cannot contain '$ref'");
  }
}

function validateRootSchemaDataProperties(schema: object): void {
  const descriptors = Reflect.ownKeys(schema).map((key) => Object.getOwnPropertyDescriptor(schema, key));
  if (descriptors.some((descriptor) => descriptor?.enumerable && !('value' in descriptor))) {
    throw new Error('Accessor-backed root schema properties are not supported');
  }
}

function cloneStrictRootSchemaDefinitions(refs: ReturnType<typeof getRefs>): void {
  if (refs.openaiStrictMode) {
    refs.definitions = { ...refs.definitions };
  }
}

function resolveStrictRootSchemaReference(
  schema: JsonSchema7Type,
  definitions: Record<string, JsonSchema7Type>,
  definitionPrefix: string,
): JsonSchema7Type {
  const maxReferences = Object.keys(definitions).length;
  const visitedReferences = new Set<string>();
  let resolved = schema;

  while (true) {
    const reference = Object.getOwnPropertyDescriptor(resolved, '$ref');
    if (!reference) {
      break;
    }
    if (!('value' in reference)) {
      throw new Error('Accessor-backed local root schema references are not supported');
    }

    const { value } = reference;
    if (
      typeof value !== 'string' ||
      !definitionPrefix.startsWith('#/') ||
      !value.startsWith(definitionPrefix)
    ) {
      break;
    }
    if (visitedReferences.has(value)) {
      throw new Error(`Cyclic local root schema reference: ${value}`);
    }

    const definition = Object.getOwnPropertyDescriptor(definitions, value.slice(definitionPrefix.length));
    if (
      !definition ||
      !('value' in definition) ||
      !definition.value ||
      typeof definition.value !== 'object'
    ) {
      break;
    }
    if (visitedReferences.size >= maxReferences) {
      throw new Error(`Cyclic local root schema reference: ${value}`);
    }
    visitedReferences.add(value);
    resolved = definition.value;
  }

  return resolved;
}

function materializeStrictRootSchema(
  schema: JsonSchema7Type,
  definitions: Record<string, JsonSchema7Type> | undefined,
  openaiStrictMode: boolean | undefined,
  definitionPath: string[],
): JsonSchema7Type {
  if (!openaiStrictMode || !definitions) {
    return schema;
  }

  const rootReference = Object.getOwnPropertyDescriptor(schema, '$ref');
  if (rootReference && !('value' in rootReference)) {
    throw new Error('Accessor-backed local root schema references are not supported');
  }
  if (typeof rootReference?.value !== 'string') {
    return schema;
  }

  const resolved = resolveStrictRootSchemaReference(schema, definitions, `${definitionPath.join('/')}/`);
  validateStrictRootSchema(resolved, openaiStrictMode);
  validateRootSchemaDataProperties(schema);
  validateRootSchemaDataProperties(resolved);

  const rootMetadata = { ...schema } as Record<string, unknown>;
  delete rootMetadata['$ref'];
  return { ...resolved, ...rootMetadata };
}

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
  cloneStrictRootSchemaDefinitions(refs);

  let name: string | undefined;
  if (typeof options === 'string') {
    name = options;
  } else if (options?.nameStrategy !== 'title') {
    name = options?.name;
  }

  let main =
    parseDef(
      schema._def,
      name === undefined
        ? refs
        : {
            ...refs,
            currentPath: [...refs.basePath, refs.definitionPath, name],
          },
      false,
    ) ?? {};

  const title =
    typeof options === 'object' && options.name !== undefined && options.nameStrategy === 'title'
      ? options.name
      : undefined;

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
        definitions[key] =
          parseDef(
            zodDef(schema),
            { ...refs, currentPath: [...refs.basePath, refs.definitionPath, key] },
            true,
          ) ?? {};
        processedDefinitions.add(key);
      }
    }

    return definitions;
  })();

  main = materializeStrictRootSchema(main, definitions, refs.openaiStrictMode, [
    ...refs.basePath,
    refs.definitionPath,
  ]);
  validateStrictRootSchema(main, refs.openaiStrictMode);

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

  validateStrictRootSchema(combined, refs.openaiStrictMode);

  return combined;
};

export { zodToJsonSchema };
