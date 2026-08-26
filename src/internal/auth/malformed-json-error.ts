const MAX_JSON_ERROR_CAUSES = 32;
const getErrorDescriptor = Object.getOwnPropertyDescriptor;
const getErrorPrototype = Object.getPrototypeOf;
const errorFunctionSource = Function.prototype.toString;
const nativeObjectSource = errorFunctionSource.call(Object);
const nativeErrorSource = errorFunctionSource.call(Error);
const nativeSyntaxErrorSource = errorFunctionSource.call(SyntaxError);
const nativeTypeErrorSource = errorFunctionSource.call(TypeError);
const nativeErrorBrandDescriptor = getErrorDescriptor(Error, 'isError');
const nativeStructuredCloneDescriptor = getErrorDescriptor(globalThis, 'structuredClone');
const nativeStackDescriptor = getErrorDescriptor(new Error('native stack descriptor validation'), 'stack');
const nativeStackFormatterDescriptor = getErrorDescriptor(Error, 'prepareStackTrace');

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

type StructuredClone = (value: object) => unknown;

interface StructuredCloneIntrinsics {
  clone: StructuredClone;
  getCloneFailureName: (this: object) => unknown;
  getCloneFailureMessage: (this: object) => unknown;
  nativeErrorDiagnostics: readonly { name: string; kind: string }[];
}

function hasNativeStructuredCloneSource(candidate: StructuredClone): boolean {
  const source = errorFunctionSource.call(candidate);
  const nativeBrowserSource = /^function structuredClone\([^)]*\)\s*\{\s*\[native code\]\s*\}$/u;
  const nativeNodeSource =
    source.startsWith('function structuredClone(value, options) {\n  if (arguments.length === 0) {') &&
    source.includes('const idlOptions = webidl.converters.StructuredSerializeOptions(') &&
    source.includes('const serializedData = nativeStructuredClone(value, idlOptions);') &&
    source.endsWith('\n  return serializedData;\n}');
  return nativeBrowserSource.test(source) || nativeNodeSource;
}

// Capture trusted DataCloneError accessors before an untrusted proxy can replace them.
function getCloneFailureIntrinsics(
  clone: StructuredClone,
  probe: object,
  onProxyAccess: () => void,
): StructuredCloneIntrinsics | undefined {
  let proxyFailure: unknown;
  try {
    clone(new Proxy(probe, { get: onProxyAccess }));
    return undefined;
  } catch (error) {
    proxyFailure = error;
  }

  if (typeof proxyFailure !== 'object' || proxyFailure === null) {
    return undefined;
  }
  const prototype = getErrorPrototype(proxyFailure) as object | null;
  if (!prototype) {
    return undefined;
  }

  const name = getErrorDescriptor(prototype, 'name');
  const message = getErrorDescriptor(prototype, 'message');
  if (!name || !message || 'value' in name || 'value' in message || !name.get || !message.get) {
    return undefined;
  }
  if (
    name.get.call(proxyFailure) !== 'DataCloneError' ||
    typeof message.get.call(proxyFailure) !== 'string'
  ) {
    return undefined;
  }

  return {
    clone,
    getCloneFailureName: name.get,
    getCloneFailureMessage: message.get,
    nativeErrorDiagnostics: Reflect.ownKeys(probe).flatMap((key) => {
      if (
        typeof key !== 'string' ||
        key === 'name' ||
        key === 'message' ||
        key === 'stack' ||
        key === 'cause' ||
        key === 'toJSON'
      ) {
        return [];
      }

      const descriptor = getErrorDescriptor(probe, key);
      return descriptor && 'value' in descriptor && !descriptor.enumerable
        ? [{ name: key, kind: typeof descriptor.value }]
        : [];
    }),
  };
}

function getNativeStructuredClone(): StructuredCloneIntrinsics | undefined {
  if (
    !nativeStructuredCloneDescriptor ||
    !('value' in nativeStructuredCloneDescriptor) ||
    typeof nativeStructuredCloneDescriptor.value !== 'function'
  ) {
    return undefined;
  }

  try {
    const candidate = nativeStructuredCloneDescriptor.value as StructuredClone;
    if (!hasNativeStructuredCloneSource(candidate)) {
      return undefined;
    }

    const clone = candidate.bind(globalThis) as StructuredClone;
    const nativeProbe = new SyntaxError('structured clone validation');
    Reflect.deleteProperty(nativeProbe, 'stack');
    let serializationHookRead = false;
    Object.defineProperty(nativeProbe, 'toJSON', {
      configurable: true,
      get: () => {
        serializationHookRead = true;
      },
    });
    const clonedNative = clone(nativeProbe);
    if (
      serializationHookRead ||
      typeof clonedNative !== 'object' ||
      clonedNative === null ||
      getErrorPrototype(clonedNative) !== SyntaxError.prototype
    ) {
      return undefined;
    }

    const clonedForgery = clone(Object.create(SyntaxError.prototype) as object);
    if (
      typeof clonedForgery !== 'object' ||
      clonedForgery === null ||
      getErrorPrototype(clonedForgery) !== Object.prototype
    ) {
      return undefined;
    }

    const intrinsics = getCloneFailureIntrinsics(clone, nativeProbe, () => {
      serializationHookRead = true;
    });
    return serializationHookRead ? undefined : intrinsics;
  } catch {
    return undefined;
  }
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

function isError(_error: object): boolean {
  return false;
}

function hasNativeErrorBrandDescriptors(candidate: ErrorBrand): boolean {
  const name = getErrorDescriptor(candidate, 'name');
  const length = getErrorDescriptor(candidate, 'length');
  return Boolean(
    name &&
    'value' in name &&
    name.value === 'isError' &&
    name.configurable &&
    !name.enumerable &&
    !name.writable &&
    length &&
    'value' in length &&
    length.value === 1 &&
    length.configurable &&
    !length.enumerable &&
    !length.writable,
  );
}

function hasNativeErrorBrandBehavior(candidate: ErrorBrand): boolean {
  let proxyAccessed = false;
  const rejectProxyAccess = (): undefined => {
    proxyAccessed = true;
    return undefined;
  };
  const proxy = new Proxy(new Error('native error brand validation'), {
    get: rejectProxyAccess,
    getOwnPropertyDescriptor: rejectProxyAccess,
  });
  return Boolean(
    candidate(new Error('native error brand validation')) &&
    candidate(new SyntaxError('native error brand validation')) &&
    !candidate(Object.create(Error.prototype) as object) &&
    !candidate(Object.create(SyntaxError.prototype) as object) &&
    !candidate({}) &&
    !candidate(proxy) &&
    !proxyAccessed,
  );
}

function getNativeErrorBrand(): ErrorBrand | undefined {
  if (runtimeErrorTypes?.isNativeError) {
    return runtimeErrorTypes.isNativeError;
  }
  if (
    !nativeErrorBrandDescriptor ||
    !('value' in nativeErrorBrandDescriptor) ||
    typeof nativeErrorBrandDescriptor.value !== 'function'
  ) {
    return undefined;
  }

  try {
    const candidate = nativeErrorBrandDescriptor.value as ErrorBrand;
    const source = errorFunctionSource.call(candidate);
    if (!/^function isError\(\)\s*\{\s*\[native code\]\s*\}$/u.test(source)) {
      return undefined;
    }

    const boundProbe = Function.prototype.bind.call(isError, null) as ErrorBrand;
    // JavaScriptCore exposes the same native-looking source for bound user functions.
    if (source === errorFunctionSource.call(boundProbe)) {
      return undefined;
    }
    return hasNativeErrorBrandDescriptors(candidate) && hasNativeErrorBrandBehavior(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function getNativeStackFormatter(): unknown {
  if (
    !nativeStackFormatterDescriptor ||
    !('value' in nativeStackFormatterDescriptor) ||
    typeof nativeStackFormatterDescriptor.value !== 'function'
  ) {
    return undefined;
  }

  try {
    const formatter = nativeStackFormatterDescriptor.value as (...args: unknown[]) => unknown;
    const source = errorFunctionSource.call(formatter);
    const nativeSource = /^function ErrorPrepareStackTrace\([^)]*\)\s*\{\s*\[native code\]\s*\}$/u;
    const nativeNodeSource =
      /^function ErrorPrepareStackTrace\(error, trace\)\s*\{\s*return internalPrepareStackTrace\(error, trace\);\s*\}$/u;
    return nativeSource.test(source) || nativeNodeSource.test(source) ? formatter : undefined;
  } catch {
    return undefined;
  }
}

const nativeErrorBrand = getNativeErrorBrand();
const nativeProxyBrand = runtimeErrorTypes?.isProxy;
const nativeStructuredCloneIntrinsics = getNativeStructuredClone();
const nativeStructuredClone = nativeStructuredCloneIntrinsics?.clone;
const nativeStackFormatter = getNativeStackFormatter();

type JSONErrorKind = 'error' | 'syntax' | 'unknown' | 'unsafe';
type JSONErrorBrand = 'native' | 'native-syntax' | 'proxy' | 'tagged-wrapper' | 'unknown' | 'unsafe';
type ClonedErrorBrand = 'native' | 'native-syntax' | 'proxy' | 'parser-proxy' | 'unknown' | 'unavailable';
type ClonePropertySafety = 'safe' | 'proxy' | 'parser-proxy' | 'unknown' | 'unavailable';

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

function hasNativeSyntaxStack(stack: PropertyDescriptor | undefined): boolean {
  return Boolean(
    stack && 'value' in stack && typeof stack.value === 'string' && /^SyntaxError(?::|\s)/u.test(stack.value),
  );
}

function hasStackOnlyNativeSyntaxProxyDescriptors(
  error: object,
  stack: PropertyDescriptor | undefined,
): boolean {
  return Boolean(
    stack &&
    !stack.enumerable &&
    (hasNativeSyntaxStack(stack) || (!('value' in stack) && typeof stack.get === 'function')) &&
    classifyCrossRealmError(error) === 'syntax',
  );
}

function hasNativeProxyErrorDescriptors(error: object): boolean {
  const message = getErrorDescriptor(error, 'message');
  const stack = getErrorDescriptor(error, 'stack');
  if (
    message &&
    (('value' in message && typeof message.value === 'string' && !message.enumerable) ||
      (stack &&
        !stack.enumerable &&
        (('value' in stack && typeof stack.value === 'string') ||
          (!('value' in stack) && typeof stack.get === 'function'))))
  ) {
    return true;
  }

  if (!message && hasStackOnlyNativeSyntaxProxyDescriptors(error, stack)) {
    return true;
  }

  // Proxies can conceal configurable diagnostics from descriptors and their own-key list.
  const keys = Reflect.ownKeys(error);
  if ((!message && keys.includes('message')) || (!stack && keys.includes('stack'))) {
    return true;
  }

  const nativeDiagnostics = nativeStructuredCloneIntrinsics?.nativeErrorDiagnostics;
  return Boolean(
    nativeDiagnostics &&
    nativeDiagnostics.length > 1 &&
    nativeDiagnostics.every(({ name, kind }) => {
      if (!keys.includes(name)) {
        return false;
      }

      const descriptor = getErrorDescriptor(error, name);
      return Boolean(
        descriptor && 'value' in descriptor && !descriptor.enumerable && typeof descriptor.value === kind,
      );
    }),
  );
}

function hasCapturedNativeDiagnosticKeys(keys: readonly PropertyKey[]): boolean {
  const diagnostics = nativeStructuredCloneIntrinsics?.nativeErrorDiagnostics;
  return Boolean(
    diagnostics && diagnostics.length > 1 && diagnostics.every(({ name }) => keys.includes(name)),
  );
}

function classifyGenericProxyCloneFailure(target: object): JSONErrorKind {
  const name = getErrorDescriptor(target, 'name');
  if (
    name &&
    (!('value' in name) || typeof name.value !== 'string' || !/^[A-Za-z]*Error$/u.test(name.value))
  ) {
    // A diagnostic-free clone cannot distinguish custom-named parser and transport proxies.
    return 'unsafe';
  }
  if (!hasNativeProxyErrorDescriptors(target)) {
    return 'unknown';
  }

  const message = getErrorDescriptor(target, 'message');
  const stack = getErrorDescriptor(target, 'stack');
  const keys = Reflect.ownKeys(target);
  if ((!message && keys.includes('message')) || (!stack && keys.includes('stack'))) {
    return 'unsafe';
  }
  if (hasNativeSyntaxStack(stack)) {
    return 'syntax';
  }

  const kind = classifyCrossRealmError(target);
  if (
    !stack &&
    kind !== 'syntax' &&
    hasCapturedNativeDiagnosticKeys(keys) &&
    (!message || !nativeProxyBrand)
  ) {
    return 'unsafe';
  }
  return kind === 'unknown' ? 'error' : kind;
}

function classifyProxyCloneFailure(target: object, failure: unknown): JSONErrorKind {
  if (!nativeStructuredCloneIntrinsics || typeof failure !== 'object' || failure === null) {
    return 'unsafe';
  }

  try {
    if (nativeStructuredCloneIntrinsics.getCloneFailureName.call(failure) !== 'DataCloneError') {
      return 'unsafe';
    }

    const detail: unknown = nativeStructuredCloneIntrinsics.getCloneFailureMessage.call(failure);
    if (typeof detail !== 'string') {
      return 'unsafe';
    }

    if (detail === 'The object can not be cloned.') {
      return classifyGenericProxyCloneFailure(target);
    }

    const syntax = /^SyntaxError(?::|\s)/u.test(detail);
    if (syntax || /^[A-Za-z]*Error(?::|\s)/u.test(detail)) {
      // Clone-failure text reflects an unbranded record's prototype as well as native errors.
      if (!hasNativeProxyErrorDescriptors(target)) {
        // A real parser diagnostic can remain visible only inside the trusted clone failure.
        return syntax &&
          detail.startsWith('SyntaxError:') &&
          !getErrorDescriptor(target, 'message') &&
          !getErrorDescriptor(target, 'stack')
          ? 'syntax'
          : 'unknown';
      }
      return syntax ? 'syntax' : 'error';
    }
    return detail.startsWith('#<') || detail.startsWith('[object ') || detail === ' could not be cloned.'
      ? 'unknown'
      : 'unsafe';
  } catch {
    return 'unsafe';
  }
}

function classifyNativeProxyTarget(target: object): JSONErrorKind {
  if (!nativeStructuredClone) {
    return 'unsafe';
  }

  try {
    // Native serialization rejects a proxy without invoking its traps or getters.
    nativeStructuredClone(target);
    return 'unsafe';
  } catch (error) {
    return classifyProxyCloneFailure(target, error);
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

// A custom or proxied prototype can replace checked diagnostics before cloning.
function hasSafeClonePrototypeChain(error: object): boolean {
  let prototype: object | null = getErrorPrototype(error) as object | null;

  for (let depth = 0; prototype !== null; depth += 1) {
    if (depth >= MAX_JSON_ERROR_CAUSES) {
      return false;
    }

    const constructor = getErrorDescriptor(prototype, 'constructor');
    if (!constructor || !('value' in constructor) || typeof constructor.value !== 'function') {
      return false;
    }

    const originalPrototype = getErrorDescriptor(constructor.value, 'prototype');
    if (!originalPrototype || !('value' in originalPrototype) || originalPrototype.value !== prototype) {
      return false;
    }

    const source = errorFunctionSource.call(constructor.value);
    if (source === nativeObjectSource) {
      return getErrorPrototype(prototype) === null;
    }
    if (
      source !== nativeErrorSource &&
      source !== nativeSyntaxErrorSource &&
      source !== nativeTypeErrorSource
    ) {
      return false;
    }

    prototype = getErrorPrototype(prototype) as object | null;
  }

  return false;
}

function hasSafeNativeStackAccessor(descriptor: PropertyDescriptor): boolean {
  if (
    'value' in descriptor ||
    descriptor.enumerable ||
    !nativeStackDescriptor ||
    'value' in nativeStackDescriptor ||
    descriptor.get !== nativeStackDescriptor.get ||
    descriptor.set !== nativeStackDescriptor.set
  ) {
    return false;
  }

  const formatter = getErrorDescriptor(Error, 'prepareStackTrace');
  return Boolean(
    !formatter ||
    ('value' in formatter &&
      (formatter.value === undefined || (nativeStackFormatter && formatter.value === nativeStackFormatter))),
  );
}

function classifyCloneDiagnostic(
  error: object,
  name: 'name' | 'message' | 'stack' | 'cause',
  allowNativeStackAccessor = false,
): 'safe' | 'unsafe' | object {
  let current: object | null = error;

  for (let depth = 0; current !== null; depth += 1) {
    if (depth >= MAX_JSON_ERROR_CAUSES) {
      return 'unsafe';
    }

    const descriptor = getErrorDescriptor(current, name);
    if (descriptor) {
      if (!('value' in descriptor)) {
        return name === 'stack' && allowNativeStackAccessor && hasSafeNativeStackAccessor(descriptor)
          ? 'safe'
          : 'unsafe';
      }
      if (name !== 'cause') {
        return typeof descriptor.value === 'string' ? 'safe' : 'unsafe';
      }
      if (descriptor.value === null) {
        return 'safe';
      }

      const kind = typeof descriptor.value;
      if (kind === 'object') {
        return descriptor.value as object;
      }
      return kind === 'function' || kind === 'symbol' ? 'unsafe' : 'safe';
    }

    current = getErrorPrototype(current) as object | null;
  }

  return 'safe';
}

function hasSafeCloneCause(cause: object, visited: Set<object>): boolean {
  if (visited.has(cause)) {
    return true;
  }
  if (visited.size >= MAX_JSON_ERROR_CAUSES || !hasSafeClonePrototypeChain(cause)) {
    return false;
  }
  visited.add(cause);

  for (const name of ['name', 'message', 'stack', 'cause'] as const) {
    const diagnostic = classifyCloneDiagnostic(cause, name, true);
    if (
      diagnostic === 'unsafe' ||
      (typeof diagnostic === 'object' && !hasSafeCloneCause(diagnostic, visited))
    ) {
      return false;
    }
  }

  const keys = Reflect.ownKeys(cause);
  if (keys.length > MAX_JSON_ERROR_CAUSES) {
    return false;
  }
  for (const key of keys) {
    if (typeof key !== 'string') {
      continue;
    }
    const descriptor = getErrorDescriptor(cause, key);
    if (!descriptor) {
      return false;
    }
    if (!descriptor.enumerable) {
      continue;
    }
    if (!('value' in descriptor)) {
      return false;
    }
    if (descriptor.value !== null) {
      const kind = typeof descriptor.value;
      if (
        kind === 'function' ||
        kind === 'symbol' ||
        (kind === 'object' && !hasSafeCloneCause(descriptor.value as object, visited))
      ) {
        return false;
      }
    }
  }

  return true;
}

function hasSafeCloneDiagnostic(
  error: object,
  name: 'name' | 'message' | 'stack' | 'cause',
  visited?: Set<object>,
): boolean {
  const diagnostic = classifyCloneDiagnostic(error, name);
  return (
    diagnostic === 'safe' ||
    (typeof diagnostic === 'object' && hasSafeCloneCause(diagnostic, visited ?? new Set([error])))
  );
}

function classifyCloneProperties(error: object, visited: Set<object>): ClonePropertySafety {
  const keys = Reflect.ownKeys(error);
  if (keys.length > MAX_JSON_ERROR_CAUSES) {
    return 'unavailable';
  }

  for (const key of keys) {
    if (typeof key !== 'string') {
      continue;
    }

    const descriptor = getErrorDescriptor(error, key);
    if (!descriptor) {
      const kind = classifyNativeProxyTarget(error);
      if (kind === 'unknown') {
        return 'unknown';
      }
      return kind === 'syntax' || kind === 'unsafe' ? 'parser-proxy' : 'proxy';
    }
    if (!descriptor.enumerable) {
      continue;
    }
    if (!('value' in descriptor)) {
      return 'unavailable';
    }
    if (descriptor.value !== null) {
      const kind = typeof descriptor.value;
      if (
        kind === 'function' ||
        kind === 'symbol' ||
        (kind === 'object' && !hasSafeCloneCause(descriptor.value as object, visited))
      ) {
        return 'unavailable';
      }
    }
  }

  return 'safe';
}

function hasAmbiguousSyntaxErrorName(name: PropertyDescriptor | undefined): boolean {
  // Ordinary assignment creates an enumerable, writable shadow rather than a native syntax brand.
  return Boolean(
    name &&
    'value' in name &&
    name.value === 'SyntaxError' &&
    name.configurable &&
    (!name.enumerable || !name.writable),
  );
}

function hasSafeCloneStackFormatters(visited: Set<object>): boolean {
  const usesNativeStackAccessor = [...visited].some((value) => {
    const stack = getErrorDescriptor(value, 'stack');
    return Boolean(stack && !('value' in stack));
  });
  return (
    !usesNativeStackAccessor ||
    Boolean(nativeStackDescriptor && hasSafeNativeStackAccessor(nativeStackDescriptor))
  );
}

function classifyStructuredError(target: object): ClonedErrorBrand {
  if (!nativeStructuredClone || !hasSafeClonePrototypeChain(target)) {
    return 'unavailable';
  }

  const visited = new Set([target]);
  for (const name of ['name', 'message', 'stack', 'cause'] as const) {
    if (!hasSafeCloneDiagnostic(target, name, visited)) {
      return 'unavailable';
    }
  }

  const properties = classifyCloneProperties(target, visited);
  if (properties !== 'safe') {
    return properties;
  }

  if (!hasSafeCloneStackFormatters(visited)) {
    return 'unavailable';
  }

  let clone: unknown;
  try {
    clone = nativeStructuredClone(target);
  } catch (error) {
    // Structured cloning rejects proxies before invoking their getters or traps.
    const kind = classifyProxyCloneFailure(target, error);
    if (kind === 'unknown') {
      return 'unknown';
    }
    return kind === 'syntax' || kind === 'unsafe' ? 'parser-proxy' : 'proxy';
  }

  if (typeof clone !== 'object' || clone === null) {
    return 'unknown';
  }

  const kind = classifyCrossRealmError(clone);
  if (kind !== 'syntax') {
    return kind === 'error' ? 'native' : 'unknown';
  }

  const name = getErrorDescriptor(target, 'name');
  return name &&
    'value' in name &&
    name.value === 'SyntaxError' &&
    !hasAmbiguousSyntaxErrorName(name) &&
    classifyCrossRealmError(target) !== 'syntax'
    ? 'native'
    : 'native-syntax';
}

function classifyUnbrandedError(error: object): JSONErrorBrand {
  if (nativeProxyBrand) {
    if (!nativeProxyBrand(error)) {
      return 'unknown';
    }

    if (classifyCrossRealmError(error) === 'unsafe') {
      return 'unsafe';
    }

    const kind = classifyNativeProxyTarget(error);
    if (kind === 'syntax' || kind === 'unsafe') {
      return 'unsafe';
    }
    return kind === 'error' ? 'proxy' : 'unknown';
  }

  const kind = classifyCrossRealmError(error);
  if (kind === 'unsafe') {
    return 'unsafe';
  }
  if (kind === 'unknown') {
    return classifyStructuredError(error) === 'parser-proxy' ? 'unsafe' : 'unknown';
  }

  const clone = classifyStructuredError(error);
  if (clone === 'parser-proxy') {
    return 'unsafe';
  }
  if (clone !== 'unavailable') {
    return clone;
  }

  if (hasNativeErrorDescriptors(error) || hasNativeProxyErrorDescriptors(error)) {
    return 'proxy';
  }

  return 'unknown';
}

function classifyBrandedNativeError(error: object): JSONErrorBrand {
  return hasAmbiguousSyntaxErrorName(getErrorDescriptor(error, 'name')) ? 'native-syntax' : 'native';
}

function classifyErrorBrand(error: object): JSONErrorBrand {
  try {
    if (nativeErrorBrand) {
      return nativeErrorBrand(error) ? classifyBrandedNativeError(error) : classifyUnbrandedError(error);
    }

    const kind = classifyCrossRealmError(error);
    if (kind === 'unsafe') {
      return 'unsafe';
    }
    if (kind === 'unknown') {
      return classifyStructuredError(error) === 'parser-proxy' ? 'unsafe' : 'unknown';
    }

    const clone = classifyStructuredError(error);
    if (clone === 'parser-proxy') {
      return 'unsafe';
    }
    if (clone !== 'unavailable') {
      return clone;
    }

    const message = getErrorDescriptor(error, 'message');
    if (kind === 'syntax' && message && !('value' in message)) {
      return 'unsafe';
    }
    if (hasNativeErrorDescriptors(error) || hasNativeProxyErrorDescriptors(error)) {
      return 'native';
    }
    if (kind === 'syntax') {
      return hasSafeCloneDiagnostic(error, 'message') ? 'unknown' : 'unsafe';
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
    // Configurable own parser markers can be hidden by a proxy's descriptor trap.
    return Reflect.ownKeys(error).includes('type');
  }
  if (!('value' in parserType)) {
    return !options?.preserveAccessors;
  }
  return parserType.value === 'invalid-json';
}

function classifyParserErrorKind(error: object, brand: JSONErrorBrand): JSONErrorKind {
  const kind = classifyCrossRealmError(error);
  if (
    kind === 'error' &&
    brand === 'native' &&
    hasAmbiguousSyntaxErrorName(getErrorDescriptor(error, 'name'))
  ) {
    return 'syntax';
  }
  return kind === 'unknown' && brand === 'proxy' ? classifyNativeProxyTarget(error) : kind;
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
      if (brand === 'unsafe' || brand === 'native-syntax') {
        return true;
      }
      if (brand !== 'native' && brand !== 'proxy' && brand !== 'tagged-wrapper') {
        return false;
      }
      if (current instanceof SyntaxError) {
        return true;
      }
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);

      const kind = classifyParserErrorKind(current, brand);
      if (kind === 'syntax' || kind === 'unsafe') {
        return true;
      }
      if (kind !== 'error') {
        return false;
      }

      if (brand !== 'tagged-wrapper' && isMalformedParserMarker(current, options)) {
        return true;
      }

      const cause = getErrorDescriptor(current, 'cause');
      if (!cause) {
        // A proxy can hide a configurable parser cause from descriptors while retaining its own key.
        return Reflect.ownKeys(current).includes('cause');
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
