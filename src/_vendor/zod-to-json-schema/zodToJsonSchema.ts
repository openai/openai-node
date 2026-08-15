import type { ZodSchema } from 'zod/v3';
import type { Options, Targets } from './Options';
import type { JsonSchema7Type } from './parseDef';
import { parseDef } from './parseDef';
import { getRefs } from './Refs';
import { zodDef, isEmptyObj } from './util';

function validateStrictRootSerializationHook(schema: object): void {
  for (let target: object | null = schema; target !== null; target = Object.getPrototypeOf(target)) {
    const serializationHook = Object.getOwnPropertyDescriptor(target, 'toJSON');
    if (!serializationHook) {
      continue;
    }
    if (!('value' in serializationHook) || typeof serializationHook.value === 'function') {
      throw new Error("Root schema cannot contain a callable or accessor-backed 'toJSON' property");
    }
    break;
  }
}

function validateStrictRootShape(schema: object): void {
  if (Array.isArray(schema)) {
    throw new TypeError('Root schema must serialize to a JSON object');
  }

  for (const unbox of [String.prototype.valueOf, Number.prototype.valueOf, Boolean.prototype.valueOf]) {
    try {
      Reflect.apply(unbox, schema, []);
    } catch {
      // Primitive intrinsics reject objects without their matching internal slot.
      continue;
    }

    throw new TypeError('Root schema must serialize to a JSON object');
  }
}

function validateStrictRootSchema(schema: object, openaiStrictMode: boolean | undefined): void {
  if (!openaiStrictMode) {
    return;
  }

  validateStrictRootShape(schema);
  const descriptors = Object.getOwnPropertyDescriptors(schema);
  for (const keyword of ['type', 'nullable', '$ref'] as const) {
    const descriptor = descriptors[keyword];
    if (descriptor?.enumerable && !('value' in descriptor)) {
      throw new Error(`Root schema validation keyword '${keyword}' must be a data property`);
    }
  }

  validateStrictRootSerializationHook(schema);

  const type = descriptors['type']?.enumerable ? descriptors['type'].value : undefined;
  const nullable = descriptors['nullable']?.enumerable && descriptors['nullable'].value === true;
  if (type !== 'object' || nullable) {
    const actualType = nullable && type ? `${type},null` : type;
    throw new Error(
      `Root schema must have type: 'object' but got type: ${actualType ? `'${actualType}'` : 'undefined'}`,
    );
  }
  const reference = descriptors['$ref'];
  if (
    reference?.enumerable &&
    reference.value !== undefined &&
    typeof reference.value !== 'function' &&
    typeof reference.value !== 'symbol'
  ) {
    throw new Error("Root schema must be a concrete object and cannot contain '$ref'");
  }
}

function cloneStrictRootSchemaDefinitions(refs: ReturnType<typeof getRefs>): void {
  if (refs.openaiStrictMode) {
    refs.definitions = { ...refs.definitions };
  }
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

  const main =
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

  validateStrictRootSchema(main, refs.openaiStrictMode);

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
