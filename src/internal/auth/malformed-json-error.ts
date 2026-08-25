const MAX_JSON_ERROR_CAUSES = 32;
const getErrorDescriptor = Object.getOwnPropertyDescriptor;
const getErrorPrototype = Object.getPrototypeOf;
const errorFunctionSource = Function.prototype.toString;
const nativeErrorSource = errorFunctionSource.call(Error);
const nativeSyntaxErrorSource = errorFunctionSource.call(SyntaxError);
const nativeErrorBrandDescriptor = getErrorDescriptor(Error, 'isError');

type ErrorBrand = (error: object) => boolean;

interface RuntimeErrorTypes {
  isNativeError: ErrorBrand | undefined;
  isProxy: ErrorBrand | undefined;
}

interface MalformedJSONErrorOptions {
  /**
   * Preserve Azure IMDS's established identity behavior for safe parser accessors.
   * OAuth fails closed instead, and neither policy invokes the accessor.
   */
  preserveAccessors?: boolean;
}

function getRuntimeErrorIntrinsic(types: object, name: 'isNativeError' | 'isProxy'): ErrorBrand | undefined {
  const descriptor = getErrorDescriptor(types, name);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    return undefined;
  }
  return descriptor.value.bind(types) as ErrorBrand;
}

function getBuiltinErrorTypes(runtimeProcess: object): object | undefined {
  const loader = getErrorDescriptor(runtimeProcess, 'getBuiltinModule');
  if (!loader || !('value' in loader) || typeof loader.value !== 'function') {
    return undefined;
  }

  const utility: unknown = loader.value.call(runtimeProcess, 'node:util');
  if (typeof utility !== 'object' || utility === null) {
    return undefined;
  }

  const types = getErrorDescriptor(utility, 'types');
  if (!types || !('value' in types) || typeof types.value !== 'object' || types.value === null) {
    return undefined;
  }
  return types.value;
}

function getRuntimeErrorTypes(): RuntimeErrorTypes | undefined {
  try {
    const runtimeProcess = (globalThis as { process?: object }).process;
    if (!runtimeProcess) {
      return undefined;
    }

    const types = getBuiltinErrorTypes(runtimeProcess);
    if (!types) {
      return undefined;
    }

    return {
      isNativeError: getRuntimeErrorIntrinsic(types, 'isNativeError'),
      isProxy: getRuntimeErrorIntrinsic(types, 'isProxy'),
    };
  } catch {
    return undefined;
  }
}

const runtimeErrorTypes = getRuntimeErrorTypes();
const nativeErrorBrand =
  nativeErrorBrandDescriptor &&
  'value' in nativeErrorBrandDescriptor &&
  typeof nativeErrorBrandDescriptor.value === 'function'
    ? (nativeErrorBrandDescriptor.value.bind(Error) as ErrorBrand)
    : runtimeErrorTypes?.isNativeError;
const nativeProxyBrand = runtimeErrorTypes?.isProxy;

type JSONErrorKind = 'error' | 'syntax' | 'unknown' | 'unsafe';

function classifyCrossRealmError(error: object): JSONErrorKind {
  try {
    let prototype: object | null = getErrorPrototype(error) as object | null;

    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_JSON_ERROR_CAUSES) {
        return 'unsafe';
      }

      const name = getErrorDescriptor(prototype, 'name');
      const constructor = getErrorDescriptor(prototype, 'constructor');
      if (
        name &&
        'value' in name &&
        (name.value === 'Error' || name.value === 'SyntaxError') &&
        constructor &&
        'value' in constructor &&
        typeof constructor.value === 'function'
      ) {
        const originalPrototype = getErrorDescriptor(constructor.value, 'prototype');
        const nativeSource = name.value === 'SyntaxError' ? nativeSyntaxErrorSource : nativeErrorSource;
        if (
          originalPrototype &&
          'value' in originalPrototype &&
          originalPrototype.value === prototype &&
          errorFunctionSource.call(constructor.value) === nativeSource
        ) {
          return name.value === 'SyntaxError' ? 'syntax' : 'error';
        }
      }

      prototype = getErrorPrototype(prototype) as object | null;
    }

    return 'unknown';
  } catch {
    return 'unsafe';
  }
}

function hasNativeErrorDescriptors(error: object): boolean {
  const message = getErrorDescriptor(error, 'message');
  const stack = getErrorDescriptor(error, 'stack');
  return Boolean(
    message &&
    'value' in message &&
    typeof message.value === 'string' &&
    !message.enumerable &&
    (!stack ||
      (!stack.enumerable &&
        (('value' in stack && typeof stack.value === 'string') ||
          (!('value' in stack) && typeof stack.get === 'function')))),
  );
}

function classifyUnbrandedError(error: object): 'unknown' | 'unsafe' {
  if (nativeProxyBrand) {
    return nativeProxyBrand(error) ? 'unsafe' : 'unknown';
  }

  const kind = classifyCrossRealmError(error);
  if (kind === 'unsafe') {
    return 'unsafe';
  }
  if (kind === 'unknown') {
    return 'unknown';
  }

  return hasNativeErrorDescriptors(error) ? 'unsafe' : 'unknown';
}

function classifyErrorBrand(error: object): 'native' | 'tagged-wrapper' | 'unknown' | 'unsafe' {
  try {
    if (nativeErrorBrand) {
      return nativeErrorBrand(error) ? 'native' : classifyUnbrandedError(error);
    }

    const kind = classifyCrossRealmError(error);
    if (kind === 'unsafe') {
      return 'unsafe';
    }
    if (kind === 'unknown') {
      return 'unknown';
    }
    if (hasNativeErrorDescriptors(error)) {
      return 'native';
    }

    const cause = getErrorDescriptor(error, 'cause');
    return kind === 'error' && cause && 'value' in cause ? 'tagged-wrapper' : 'unknown';
  } catch {
    return 'unsafe';
  }
}

function isMalformedParserMarker(error: object, options?: MalformedJSONErrorOptions): boolean {
  const parserType = getErrorDescriptor(error, 'type');
  if (!parserType) {
    return false;
  }
  if (!('value' in parserType)) {
    return !options?.preserveAccessors;
  }
  return parserType.value === 'invalid-json';
}

/**
 * Identifies real malformed-JSON parser failures without exposing hostile diagnostics.
 * Provider-specific accessor policies preserve existing public rejection contracts.
 */
export function isMalformedJSONError(error: unknown, options?: MalformedJSONErrorOptions): boolean {
  try {
    const visited = new Set<object>();
    let current = error;

    for (let depth = 0; depth < MAX_JSON_ERROR_CAUSES; depth += 1) {
      if (typeof current !== 'object' || current === null) {
        return false;
      }

      const brand = classifyErrorBrand(current);
      if (brand === 'unsafe') {
        return true;
      }
      if (brand !== 'native' && brand !== 'tagged-wrapper') {
        return false;
      }
      if (current instanceof SyntaxError) {
        return true;
      }
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);

      const kind = current instanceof Error ? 'error' : classifyCrossRealmError(current);
      if (kind === 'syntax' || kind === 'unsafe') {
        return true;
      }
      if (kind !== 'error') {
        return false;
      }

      if (brand === 'native' && isMalformedParserMarker(current, options)) {
        return true;
      }

      const cause = getErrorDescriptor(current, 'cause');
      if (!cause) {
        return false;
      }
      if (!('value' in cause)) {
        return !options?.preserveAccessors;
      }
      current = cause.value;
    }

    return true;
  } catch {
    return true;
  }
}
