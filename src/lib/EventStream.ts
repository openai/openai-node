import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ContentFilterFinishReasonError,
  InternalServerError,
  InvalidWebhookSignatureError,
  LengthFinishReasonError,
  NotFoundError,
  OAuthError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
  SubjectTokenProviderError,
  UnprocessableEntityError,
} from '../error';

const MAX_BUFFERED_ITERATOR_EVENTS = 4096;
const MAX_BUFFERED_ITERATOR_BYTES = 8 * 1024 * 1024;
// Typed-array own-key enumeration materializes every dense index before custom keys.
const MAX_INSPECTABLE_TYPED_ARRAY_ELEMENTS = 4096;
// Structured JSON may nest 128 levels before stream-event wrappers are added.
const MAX_BUFFERED_EVENT_DEPTH = 256;
const bufferedJSONStringify = JSON.stringify;
const bufferedJSONParse = JSON.parse;
const sdkOwnedBufferedEventArguments = new WeakSet<object>();

const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'buffer',
)?.get;
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'length',
)?.get;
const dataViewBufferGetter = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')?.get;
const symbolDescriptionGetter = Object.getOwnPropertyDescriptor(Symbol.prototype, 'description')?.get;
const dateTimestampGetter = Date.prototype.getTime;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === 'function'
    ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get
    : undefined;
// V8 uses the same trusted lazy-stack accessor pair for native Error instances.
const errorStackDescriptor = Object.getOwnPropertyDescriptor(new Error('native stack descriptor'), 'stack');
const functionToString = Function.prototype.toString;
const objectToString = Object.prototype.toString;
const errorBrandDescriptor = Object.getOwnPropertyDescriptor(Error, 'isError');
const nativeErrorBrand =
  errorBrandDescriptor && 'value' in errorBrandDescriptor && typeof errorBrandDescriptor.value === 'function'
    ? (errorBrandDescriptor.value as (value: unknown) => boolean)
    : undefined;
const nativeErrorConstructorSource = functionToString.call(Error);
const nativeDateConstructorSource = functionToString.call(Date);
const nativeFunctionConstructorSource = functionToString.call(Function);
const trustedIntrinsicPrototypes = new Set<object>([
  APIConnectionError.prototype,
  APIConnectionTimeoutError.prototype,
  APIError.prototype,
  OpenAIError.prototype,
  APIUserAbortError.prototype,
  AuthenticationError.prototype,
  BadRequestError.prototype,
  ConflictError.prototype,
  ContentFilterFinishReasonError.prototype,
  InternalServerError.prototype,
  InvalidWebhookSignatureError.prototype,
  LengthFinishReasonError.prototype,
  NotFoundError.prototype,
  OAuthError.prototype,
  PermissionDeniedError.prototype,
  RateLimitError.prototype,
  SubjectTokenProviderError.prototype,
  UnprocessableEntityError.prototype,
]);
const trustedNativeConstructorSources = new Set<string>();
const canonicalIntrinsicDescriptors = new Map<string, ReadonlyMap<PropertyKey, PropertyDescriptor>>();
const foreignErrorStackDescriptors = new WeakMap<object, PropertyDescriptor>();

type NativeErrorConstructor = (...args: never[]) => unknown;

function captureNativeProxyDetector(): ((value: object) => boolean) | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }

  try {
    const loader = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    if (!loader || !('value' in loader) || typeof loader.value !== 'function') {
      return undefined;
    }
    const util: unknown = Reflect.apply(loader.value, process, ['node:util']);
    if (typeof util !== 'object' || util === null) {
      return undefined;
    }
    const types = Object.getOwnPropertyDescriptor(util, 'types');
    if (!types || !('value' in types) || typeof types.value !== 'object' || types.value === null) {
      return undefined;
    }
    const detector = Object.getOwnPropertyDescriptor(types.value, 'isProxy');
    if (!detector || !('value' in detector) || typeof detector.value !== 'function') {
      return undefined;
    }
    return detector.value as (value: object) => boolean;
  } catch {
    return undefined;
  }
}

// Transparent proxies have no portable ECMAScript brand. Newer Node runtimes
// expose one without adding a Node-only import to browser-compatible bundles.
const nativeProxyDetector = captureNativeProxyDetector();

function rememberTrustedIntrinsic(constructor: unknown): void {
  if (typeof constructor !== 'function') {
    return;
  }

  const prototypeDescriptor = Object.getOwnPropertyDescriptor(constructor, 'prototype');
  if (
    !prototypeDescriptor ||
    !('value' in prototypeDescriptor) ||
    (typeof prototypeDescriptor.value !== 'object' && typeof prototypeDescriptor.value !== 'function')
  ) {
    return;
  }

  trustedIntrinsicPrototypes.add(prototypeDescriptor.value as object);
  const source = functionToString.call(constructor);
  if (
    /^function [A-Za-z_$][\w$]*\(\) \{ \[native code\] \}$/u.test(source) &&
    prototypeDescriptor.configurable === false &&
    prototypeDescriptor.writable === false
  ) {
    trustedNativeConstructorSources.add(source);
    const descriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (const key of Reflect.ownKeys(prototypeDescriptor.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototypeDescriptor.value, key);
      if (descriptor) {
        descriptors.set(key, descriptor);
      }
    }
    canonicalIntrinsicDescriptors.set(source, descriptors);
  }
}

for (const constructor of [
  Object,
  Function,
  Array,
  Date,
  Map,
  Set,
  ArrayBuffer,
  DataView,
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
]) {
  rememberTrustedIntrinsic(constructor);
}

for (const name of [
  'SharedArrayBuffer',
  'AggregateError',
  'Float16Array',
  'BigInt64Array',
  'BigUint64Array',
  'Blob',
  'File',
  'Headers',
] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor && 'value' in descriptor) {
    rememberTrustedIntrinsic(descriptor.value);
  }
}

const typedArrayConstructorDescriptor = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'constructor',
);
if (typedArrayConstructorDescriptor && 'value' in typedArrayConstructorDescriptor) {
  rememberTrustedIntrinsic(typedArrayConstructorDescriptor.value);
}

if (typeof Buffer === 'function') {
  rememberTrustedIntrinsic(Buffer);
}

const blobInternalHandlePrototype = (() => {
  if (typeof Blob !== 'function') {
    return undefined;
  }

  try {
    const blob = new Blob([]);
    for (const key of Object.getOwnPropertySymbols(blob)) {
      const descriptor = Object.getOwnPropertyDescriptor(blob, key);
      if (descriptor && 'value' in descriptor && typeof descriptor.value === 'object' && descriptor.value) {
        return Object.getPrototypeOf(descriptor.value) as object;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
})();
const mapEntries = Map.prototype.entries;
const setValues = Set.prototype.values;
const headersEntriesDescriptor =
  typeof Headers === 'function' ? Object.getOwnPropertyDescriptor(Headers.prototype, 'entries') : undefined;
const headersEntries =
  headersEntriesDescriptor &&
  'value' in headersEntriesDescriptor &&
  typeof headersEntriesDescriptor.value === 'function'
    ? (headersEntriesDescriptor.value as typeof Headers.prototype.entries)
    : undefined;
const retainedStorageBrands = new Set([
  'ArrayBuffer',
  'SharedArrayBuffer',
  'Blob',
  'File',
  'Map',
  'Date',
  'Set',
  'Headers',
]);

interface TrustedForeignIntrinsic {
  constructor: NativeErrorConstructor;
  descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>;
  functionPrototype: object;
}

function getTrustedForeignIntrinsic(prototype: object): TrustedForeignIntrinsic | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    return undefined;
  }

  const constructor = descriptor.value as NativeErrorConstructor;
  const source = functionToString.call(constructor);
  const descriptors = canonicalIntrinsicDescriptors.get(source);
  if (!trustedNativeConstructorSources.has(source) || !descriptors) {
    return undefined;
  }

  const constructorPrototype = Object.getOwnPropertyDescriptor(constructor, 'prototype');
  if (
    !constructorPrototype ||
    !('value' in constructorPrototype) ||
    constructorPrototype.value !== prototype ||
    constructorPrototype.configurable !== false ||
    constructorPrototype.writable !== false
  ) {
    return undefined;
  }

  return { constructor, descriptors, functionPrototype: Object.getPrototypeOf(constructor) as object };
}

function isTrustedIntrinsicPrototype(prototype: object): boolean {
  return trustedIntrinsicPrototypes.has(prototype) || getTrustedForeignIntrinsic(prototype) !== undefined;
}

function isCanonicalIntrinsicFunction(
  value: unknown,
  canonical: unknown,
  functionPrototype: object,
): boolean {
  if (canonical === undefined) {
    return value === undefined;
  }

  if (typeof value !== 'function' || typeof canonical !== 'function') {
    return false;
  }

  const source = functionToString.call(canonical);
  if (functionToString.call(value) !== source) {
    return false;
  }

  const actualFunctionPrototype = Object.getPrototypeOf(value) as object;
  if (actualFunctionPrototype === functionPrototype) {
    return true;
  }
  if (!/^function [A-Za-z_$][\w$]*\(\) \{ \[native code\] \}$/u.test(source)) {
    return false;
  }

  const intrinsic = getTrustedForeignIntrinsic(actualFunctionPrototype);
  return (
    intrinsic !== undefined &&
    functionToString.call(intrinsic.constructor) === nativeFunctionConstructorSource
  );
}

function isCanonicalIntrinsicDescriptor(
  descriptor: PropertyDescriptor,
  canonical: PropertyDescriptor | undefined,
  functionPrototype: object,
): boolean {
  if (
    !canonical ||
    descriptor.configurable !== canonical.configurable ||
    descriptor.enumerable !== canonical.enumerable ||
    'value' in descriptor !== 'value' in canonical
  ) {
    return false;
  }

  if ('value' in descriptor && 'value' in canonical) {
    if (descriptor.writable !== canonical.writable) {
      return false;
    }
    if (typeof canonical.value === 'function') {
      return isCanonicalIntrinsicFunction(descriptor.value, canonical.value, functionPrototype);
    }
    if (canonical.value !== null && typeof canonical.value === 'object') {
      return false;
    }
    return Object.is(descriptor.value, canonical.value);
  }

  return (
    isCanonicalIntrinsicFunction(descriptor.get, canonical.get, functionPrototype) &&
    isCanonicalIntrinsicFunction(descriptor.set, canonical.set, functionPrototype)
  );
}

function hasNativeErrorBrand(current: object): boolean {
  if (nativeErrorBrand) {
    return nativeErrorBrand.call(Error, current);
  }

  let prototype: object | null = current;
  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    if (Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)) {
      return false;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return prototype === null && objectToString.call(current) === '[object Error]';
}

function getVerifiedForeignErrorConstructor(
  current: object,
  stackDescriptor: PropertyDescriptor,
): { constructor: NativeErrorConstructor; prototype: object } | undefined {
  if (typeof stackDescriptor.get !== 'function' || typeof stackDescriptor.set !== 'function') {
    return undefined;
  }

  let prototype = Object.getPrototypeOf(current) as object | null;
  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'function') {
      const constructor = descriptor.value as NativeErrorConstructor;
      if (
        functionToString.call(constructor) === nativeErrorConstructorSource &&
        isTrustedIntrinsicPrototype(prototype)
      ) {
        const functionPrototype = Object.getPrototypeOf(constructor) as object;
        if (
          Object.getPrototypeOf(stackDescriptor.get) === functionPrototype &&
          Object.getPrototypeOf(stackDescriptor.set) === functionPrototype
        ) {
          return { constructor, prototype };
        }
        return undefined;
      }
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return undefined;
}

function isTrustedNativeErrorStack(current: object, descriptor: PropertyDescriptor): boolean {
  if (!hasNativeErrorBrand(current)) {
    return false;
  }

  if (
    errorStackDescriptor &&
    !('value' in errorStackDescriptor) &&
    typeof errorStackDescriptor.get === 'function' &&
    Object.prototype.isPrototypeOf.call(Error.prototype, current) &&
    descriptor.get === errorStackDescriptor.get &&
    descriptor.set === errorStackDescriptor.set
  ) {
    return true;
  }

  const verified = getVerifiedForeignErrorConstructor(current, descriptor);
  if (!verified) {
    return false;
  }

  let canonicalDescriptor = foreignErrorStackDescriptors.get(verified.prototype);
  if (!canonicalDescriptor) {
    const canonical = Reflect.construct(verified.constructor, []) as unknown;
    if (
      typeof canonical !== 'object' ||
      canonical === null ||
      !hasNativeErrorBrand(canonical) ||
      Object.getPrototypeOf(canonical) !== verified.prototype
    ) {
      return false;
    }

    canonicalDescriptor = Object.getOwnPropertyDescriptor(canonical, 'stack');
    if (
      !canonicalDescriptor ||
      'value' in canonicalDescriptor ||
      typeof canonicalDescriptor.get !== 'function' ||
      typeof canonicalDescriptor.set !== 'function'
    ) {
      return false;
    }
    foreignErrorStackDescriptors.set(verified.prototype, canonicalDescriptor);
  }

  return descriptor.get === canonicalDescriptor.get && descriptor.set === canonicalDescriptor.set;
}

type RetainedStorage = {
  bytes: number;
  kind: 'typed-array' | 'data-view' | 'buffer' | 'blob' | 'map' | 'date' | 'set' | 'headers';
};

type EventQueue<Value> = {
  readonly length: number;
  enqueue: (value: Value) => void;
  dequeue: () => Value | undefined;
  clear: () => void;
};

function createEventQueue<Value>(): EventQueue<Value> {
  let entries: (Value | undefined)[] = [];
  let head = 0;

  return {
    get length() {
      return entries.length - head;
    },
    enqueue(value) {
      entries.push(value);
    },
    dequeue() {
      if (head === entries.length) {
        return undefined;
      }

      const value = entries[head];
      entries[head] = undefined;
      head += 1;

      if (head === entries.length) {
        entries = [];
        head = 0;
      } else if (head >= 1024 && head * 2 >= entries.length) {
        entries = entries.slice(head);
        head = 0;
      }

      return value;
    },
    clear() {
      entries = [];
      head = 0;
    },
  };
}

function getRetainedStorageBrand(current: object): string | undefined {
  let prototype = Object.getPrototypeOf(current) as object | null;

  for (let depth = 0; prototype !== null && depth < MAX_BUFFERED_EVENT_DEPTH; depth += 1) {
    if (prototype === Date.prototype) {
      return 'Date';
    }
    if (!trustedIntrinsicPrototypes.has(prototype)) {
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      if (
        constructor &&
        'value' in constructor &&
        typeof constructor.value === 'function' &&
        functionToString.call(constructor.value) === nativeDateConstructorSource &&
        getTrustedForeignIntrinsic(prototype)
      ) {
        return 'Date';
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
    if (
      descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      retainedStorageBrands.has(descriptor.value)
    ) {
      return descriptor.value;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return undefined;
}

function estimateRetainedBufferBytes(
  current: object,
  visit: (value: unknown, depth: number) => void,
  depth: number,
): RetainedStorage | undefined {
  if (ArrayBuffer.isView(current)) {
    let buffer: unknown;
    let kind: RetainedStorage['kind'] = 'typed-array';

    try {
      buffer = typedArrayBufferGetter?.call(current) as unknown;
    } catch {
      kind = 'data-view';
      buffer = dataViewBufferGetter?.call(current) as unknown;
    }

    if (typeof buffer !== 'object' || buffer === null) {
      return { bytes: Number.POSITIVE_INFINITY, kind };
    }

    // Even a one-byte cross-realm view retains its complete backing allocation.
    visit(buffer, depth + 1);
    return { bytes: 0, kind };
  }

  const brand = getRetainedStorageBrand(current);
  if (!brand) {
    return undefined;
  }

  let getter: (() => unknown) | undefined;
  const kind: RetainedStorage['kind'] = 'buffer';
  switch (brand) {
    case 'ArrayBuffer': {
      getter = arrayBufferByteLengthGetter;
      break;
    }
    case 'SharedArrayBuffer': {
      getter = sharedArrayBufferByteLengthGetter;
      break;
    }
    case 'Blob':
    case 'File': {
      // Blob slices can retain an arbitrarily larger native backing allocation,
      // and neither browser nor Node exposes its extent or ownership. Detached
      // queues must fail closed; waiting readers bypass retained-size inspection.
      return { bytes: Number.POSITIVE_INFINITY, kind: 'blob' };
    }
    case 'Map': {
      return { bytes: 0, kind: 'map' };
    }
    case 'Date': {
      Reflect.apply(dateTimestampGetter, current, []);
      return { bytes: 8, kind: 'date' };
    }
    case 'Set': {
      return { bytes: 0, kind: 'set' };
    }
    case 'Headers': {
      return { bytes: 0, kind: 'headers' };
    }
    default: {
      return undefined;
    }
  }

  const bytes = getter?.call(current);
  return {
    bytes:
      typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0
        ? bytes
        : Number.POSITIVE_INFINITY,
    kind,
  };
}

function visitHiddenEventValues(
  current: object,
  kind: RetainedStorage['kind'] | undefined,
  visit: (value: unknown, overhead: number) => boolean,
): boolean {
  if (kind === 'map') {
    for (const [key, entry] of mapEntries.call(current)) {
      if (!visit(key, 8) || !visit(entry, 8)) {
        return false;
      }
    }
  }

  if (kind === 'set') {
    for (const entry of setValues.call(current)) {
      if (!visit(entry, 8)) {
        return false;
      }
    }
  }

  if (kind === 'headers') {
    if (!headersEntries) {
      return false;
    }
    for (const [name, value] of headersEntries.call(current as Headers)) {
      if (!visit(name, 8) || !visit(value, 8)) {
        return false;
      }
    }
  }

  return true;
}

function getInspectableEventKeys(
  current: object,
  kind: RetainedStorage['kind'] | undefined,
  availableBytes: number,
): (string | symbol)[] | undefined {
  if (Array.isArray(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'length');
    const length: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > Math.floor(availableBytes / 16)
    ) {
      return undefined;
    }
  }

  if (kind !== 'typed-array') {
    return Reflect.ownKeys(current);
  }

  const length: unknown = typedArrayLengthGetter?.call(current);
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_INSPECTABLE_TYPED_ARRAY_ELEMENTS
  ) {
    return undefined;
  }

  return Reflect.ownKeys(current).filter((key) => {
    if (typeof key !== 'string') {
      return true;
    }

    const index = Number(key);
    return !Number.isInteger(index) || index < 0 || index >= length || String(index) !== key;
  });
}

function visitInspectableEventProperties(
  current: object,
  kind: RetainedStorage['kind'] | undefined,
  depth: number,
  availableBytes: () => number,
  charge: (bytes: number) => boolean,
  visit: (value: unknown, depth: number, isBlobInternalHandle?: boolean) => void,
): boolean {
  const keys = getInspectableEventKeys(current, kind, availableBytes());
  if (keys === undefined) {
    return false;
  }

  for (const key of keys) {
    if (!charge(typeof key === 'string' ? key.length * 2 + 8 : 8)) {
      return false;
    }
    if (typeof key === 'symbol') {
      visit(key, depth + 1);
    }

    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor) {
      return false;
    }
    if (!('value' in descriptor)) {
      if (key === 'stack' && isTrustedNativeErrorStack(current, descriptor)) {
        continue;
      }
      return false;
    }
    visit(descriptor.value, depth + 1, kind === 'blob');
  }

  return true;
}

function visitRetainedEventPrototypes(
  current: object,
  depth: number,
  isBlobInternalHandle: boolean,
  visited: WeakSet<object>,
  availableBytes: () => number,
  charge: (bytes: number) => boolean,
  visit: (value: unknown, depth: number, isBlobInternalHandle?: boolean) => void,
  retainPrototype: (prototype: object, inspect: () => boolean) => boolean,
): boolean {
  let prototype = Object.getPrototypeOf(current) as object | null;

  for (let prototypeDepth = depth + 1; prototype !== null; prototypeDepth += 1) {
    if (prototypeDepth >= MAX_BUFFERED_EVENT_DEPTH) {
      return false;
    }
    if (
      trustedIntrinsicPrototypes.has(prototype) ||
      (isBlobInternalHandle && prototype === blobInternalHandlePrototype)
    ) {
      return true;
    }
    if (visited.has(prototype)) {
      visit(prototype, prototypeDepth);
      return availableBytes() >= 0;
    }

    visited.add(prototype);
    const retainedPrototype = prototype;
    const retained = retainPrototype(retainedPrototype, () => {
      if (!charge(16)) {
        return false;
      }

      const intrinsic = getTrustedForeignIntrinsic(retainedPrototype);
      if (!intrinsic) {
        return visitInspectableEventProperties(
          retainedPrototype,
          undefined,
          prototypeDepth,
          availableBytes,
          charge,
          visit,
        );
      }

      for (const key of Reflect.ownKeys(retainedPrototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(retainedPrototype, key);
        if (!descriptor) {
          return false;
        }
        if (
          isCanonicalIntrinsicDescriptor(
            descriptor,
            intrinsic.descriptors.get(key),
            intrinsic.functionPrototype,
          )
        ) {
          continue;
        }
        if (!charge(typeof key === 'string' ? key.length * 2 + 8 : 8) || !('value' in descriptor)) {
          return false;
        }
        if (typeof key === 'symbol') {
          visit(key, prototypeDepth + 1);
        }
        visit(descriptor.value, prototypeDepth + 1);
      }

      return availableBytes() >= 0;
    });
    if (!retained) {
      return false;
    }

    prototype = Object.getPrototypeOf(retainedPrototype) as object | null;
  }

  return true;
}

type BufferedRetainedIdentity = object | symbol;

type BufferedInspectedNode = {
  bytes: number;
  edges: Set<BufferedRetainedIdentity>;
};

type BufferedInspectedGraph = {
  scalarBytes: number;
  roots: Set<BufferedRetainedIdentity>;
  nodes: Map<BufferedRetainedIdentity, BufferedInspectedNode>;
};

type BufferedLedgerEntry = {
  scalarBytes: number;
  roots: Set<BufferedRetainedIdentity>;
  identities: Set<BufferedRetainedIdentity>;
};

type BufferedLedgerRecord = BufferedInspectedNode & {
  owners: Set<BufferedLedgerEntry>;
};

type BufferedLedgerChange = {
  node: BufferedInspectedNode;
  ownerDelta: number;
};

const BUFFERED_LEDGER_ENTRY_BYTES = 32;
const BUFFERED_LEDGER_NODE_BYTES = 32;
const BUFFERED_LEDGER_EDGE_BYTES = 8;
const BUFFERED_LEDGER_OWNER_BYTES = 16;
const MAX_BUFFERED_LEDGER_RECONCILIATION_WORK = 128 * 1024;

function inspectBufferedEventGraph(
  value: unknown,
  remainingBytes: number,
): BufferedInspectedGraph | undefined {
  let bytes = 0;
  let scalarBytes = 0;
  const visited = new WeakSet<object>();
  const visitedSymbols = new Set<symbol>();
  const roots = new Set<BufferedRetainedIdentity>();
  const nodes = new Map<BufferedRetainedIdentity, BufferedInspectedNode>();
  let activeNode: BufferedInspectedNode | undefined;
  const availableBytes = (): number => remainingBytes - bytes;
  const charge = (amount: number): boolean => {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      bytes = remainingBytes + 1;
      return false;
    }

    bytes += amount;
    if (activeNode) {
      activeNode.bytes += amount;
    } else {
      scalarBytes += amount;
    }
    return bytes <= remainingBytes;
  };
  const addIdentity = (identity: BufferedRetainedIdentity): void => {
    if (activeNode) {
      activeNode.edges.add(identity);
    } else {
      roots.add(identity);
    }
  };
  const retainIdentity = (identity: BufferedRetainedIdentity, inspect: () => boolean): boolean => {
    addIdentity(identity);
    const node: BufferedInspectedNode = { bytes: 0, edges: new Set() };
    nodes.set(identity, node);
    const previous = activeNode;
    activeNode = node;
    try {
      return inspect();
    } finally {
      activeNode = previous;
    }
  };

  const visitSymbol = (current: symbol): void => {
    if (visitedSymbols.has(current)) {
      addIdentity(current);
      charge(8);
      return;
    }
    visitedSymbols.add(current);

    if (
      !retainIdentity(current, () => {
        if (!symbolDescriptionGetter) {
          return false;
        }
        const description = Reflect.apply(symbolDescriptionGetter, current, []) as string | undefined;
        return charge(8 + (description?.length ?? 0) * 2);
      })
    ) {
      bytes = remainingBytes + 1;
    }
  };

  const visit = (current: unknown, depth: number, isBlobInternalHandle = false): void => {
    if (bytes > remainingBytes) {
      return;
    }

    if (typeof current === 'string') {
      charge(current.length * 2);
      return;
    }

    if (typeof current === 'symbol') {
      visitSymbol(current);
      return;
    }

    if (typeof current === 'function') {
      bytes = remainingBytes + 1;
      return;
    }

    if (current === null || typeof current !== 'object') {
      charge(8);
      return;
    }

    if (nativeProxyDetector?.(current)) {
      bytes = remainingBytes + 1;
      return;
    }

    if (depth >= MAX_BUFFERED_EVENT_DEPTH) {
      bytes = remainingBytes + 1;
      return;
    }

    if (visited.has(current)) {
      addIdentity(current);
      charge(8);
      return;
    }
    visited.add(current);

    if (
      !retainIdentity(current, () => {
        if (!charge(16)) {
          return false;
        }

        const retainedStorage = estimateRetainedBufferBytes(current, visit, depth);
        if (
          !visitRetainedEventPrototypes(
            current,
            depth,
            isBlobInternalHandle,
            visited,
            availableBytes,
            charge,
            visit,
            retainIdentity,
          )
        ) {
          return false;
        }
        if (retainedStorage !== undefined && !charge(retainedStorage.bytes)) {
          return false;
        }

        if (
          !visitHiddenEventValues(current, retainedStorage?.kind, (hiddenValue, overhead) => {
            if (!charge(overhead)) {
              return false;
            }
            visit(hiddenValue, depth + 1);
            return bytes <= remainingBytes;
          })
        ) {
          return false;
        }

        return visitInspectableEventProperties(
          current,
          retainedStorage?.kind,
          depth,
          availableBytes,
          charge,
          visit,
        );
      })
    ) {
      bytes = remainingBytes + 1;
    }
  };

  try {
    visit(value, 0);
  } catch {
    return undefined;
  }

  return bytes <= remainingBytes ? { scalarBytes, roots, nodes } : undefined;
}

function areBufferedRetainedEdgesEqual(
  first: Set<BufferedRetainedIdentity>,
  second: Set<BufferedRetainedIdentity>,
): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const identity of first) {
    if (!second.has(identity)) {
      return false;
    }
  }
  return true;
}

function getBufferedLedgerNodeBytes(node: BufferedInspectedNode, owners: number): number {
  return (
    node.bytes +
    BUFFERED_LEDGER_NODE_BYTES +
    node.edges.size * BUFFERED_LEDGER_EDGE_BYTES +
    owners * BUFFERED_LEDGER_OWNER_BYTES
  );
}

function getBufferedLedgerEntryBytes(entry: Pick<BufferedLedgerEntry, 'scalarBytes' | 'roots'>): number {
  return BUFFERED_LEDGER_ENTRY_BYTES + entry.scalarBytes + entry.roots.size * BUFFERED_LEDGER_EDGE_BYTES;
}

function collectBufferedLedgerIdentities(
  roots: Set<BufferedRetainedIdentity>,
  candidate: Map<BufferedRetainedIdentity, BufferedInspectedNode>,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  work: { remaining: number },
): Set<BufferedRetainedIdentity> | undefined {
  const identities = new Set<BufferedRetainedIdentity>();
  const pending = [...roots];

  while (pending.length) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return undefined;
    }

    const identity = pending.pop()!;
    if (identities.has(identity)) {
      continue;
    }
    const node = candidate.get(identity) ?? records.get(identity);
    if (!node) {
      return undefined;
    }
    identities.add(identity);
    for (const edge of node.edges) {
      pending.push(edge);
    }
  }

  return identities;
}

function getBufferedLedgerChange(
  identity: BufferedRetainedIdentity,
  graph: BufferedInspectedGraph,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  node?: BufferedInspectedNode,
): BufferedLedgerChange | undefined {
  const existing = changes.get(identity);
  if (existing) {
    if (node) {
      existing.node = node;
    }
    return existing;
  }

  const current = node ?? graph.nodes.get(identity) ?? records.get(identity);
  if (!current) {
    return undefined;
  }
  const update = { node: current, ownerDelta: 0 };
  changes.set(identity, update);
  return update;
}

function findBufferedLedgerAffectedOwners(
  entry: BufferedLedgerEntry,
  graph: BufferedInspectedGraph,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  work: { remaining: number },
): Set<BufferedLedgerEntry> | undefined {
  const affected = new Set<BufferedLedgerEntry>([entry]);

  for (const [identity, node] of graph.nodes) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return undefined;
    }

    const previous = records.get(identity);
    if (!previous) {
      continue;
    }
    const changedEdges = !areBufferedRetainedEdgesEqual(previous.edges, node.edges);
    if (previous.bytes !== node.bytes || changedEdges) {
      getBufferedLedgerChange(identity, graph, records, changes, node);
    }
    if (!changedEdges) {
      continue;
    }
    for (const owner of previous.owners) {
      work.remaining -= 1;
      if (work.remaining < 0) {
        return undefined;
      }
      affected.add(owner);
    }
  }

  return affected;
}

function updateBufferedLedgerMembershipChanges(
  owner: BufferedLedgerEntry,
  next: Set<BufferedRetainedIdentity>,
  graph: BufferedInspectedGraph,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  work: { remaining: number },
): boolean {
  for (const identity of owner.identities) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return false;
    }
    if (!next.has(identity)) {
      const update = getBufferedLedgerChange(identity, graph, records, changes);
      if (!update) {
        return false;
      }
      update.ownerDelta -= 1;
    }
  }

  for (const identity of next) {
    work.remaining -= 1;
    if (work.remaining < 0) {
      return false;
    }
    if (!owner.identities.has(identity)) {
      const update = getBufferedLedgerChange(identity, graph, records, changes);
      if (!update) {
        return false;
      }
      update.ownerDelta += 1;
    }
  }

  return true;
}

function collectBufferedLedgerMemberships(
  entry: BufferedLedgerEntry,
  graph: BufferedInspectedGraph,
  affected: Set<BufferedLedgerEntry>,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  work: { remaining: number },
): Map<BufferedLedgerEntry, Set<BufferedRetainedIdentity>> | undefined {
  const memberships = new Map<BufferedLedgerEntry, Set<BufferedRetainedIdentity>>();

  for (const owner of affected) {
    const roots = owner === entry ? graph.roots : owner.roots;
    const next = collectBufferedLedgerIdentities(roots, graph.nodes, records, work);
    if (!next || !updateBufferedLedgerMembershipChanges(owner, next, graph, records, changes, work)) {
      return undefined;
    }
    memberships.set(owner, next);
  }

  return memberships;
}

function projectBufferedLedgerBytes(
  currentBytes: number,
  entry: BufferedLedgerEntry,
  graph: BufferedInspectedGraph,
  isNew: boolean,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
): number | undefined {
  let projected =
    currentBytes - (isNew ? 0 : getBufferedLedgerEntryBytes(entry)) + getBufferedLedgerEntryBytes(graph);

  for (const [identity, update] of changes) {
    const previous = records.get(identity);
    const owners = (previous?.owners.size ?? 0) + update.ownerDelta;
    if (owners < 0) {
      return undefined;
    }
    if (previous) {
      projected -= getBufferedLedgerNodeBytes(previous, previous.owners.size);
    }
    if (owners) {
      projected += getBufferedLedgerNodeBytes(update.node, owners);
    }
  }

  return Number.isSafeInteger(projected) && projected >= 0 && projected <= MAX_BUFFERED_ITERATOR_BYTES
    ? projected
    : undefined;
}

function applyBufferedLedgerChanges(
  records: Map<BufferedRetainedIdentity, BufferedLedgerRecord>,
  changes: Map<BufferedRetainedIdentity, BufferedLedgerChange>,
  memberships: Map<BufferedLedgerEntry, Set<BufferedRetainedIdentity>>,
): void {
  for (const [identity, update] of changes) {
    const previous = records.get(identity);
    const owners = (previous?.owners.size ?? 0) + update.ownerDelta;
    if (!owners) {
      continue;
    }
    if (previous) {
      previous.bytes = update.node.bytes;
      previous.edges = update.node.edges;
    } else {
      records.set(identity, {
        bytes: update.node.bytes,
        edges: update.node.edges,
        owners: new Set(),
      });
    }
  }

  for (const [owner, next] of memberships) {
    for (const identity of owner.identities) {
      if (!next.has(identity)) {
        records.get(identity)?.owners.delete(owner);
      }
    }
    for (const identity of next) {
      if (!owner.identities.has(identity)) {
        records.get(identity)!.owners.add(owner);
      }
    }
    owner.identities = next;
  }

  for (const identity of changes.keys()) {
    if (records.get(identity)?.owners.size === 0) {
      records.delete(identity);
    }
  }
}

/**
 * Account for queue-owned identities once while charging bounded ownership and
 * edge metadata. Shared topology changes are reconciled for every queued owner.
 */
function createBufferedEventLedger(): {
  retain: (graph: BufferedInspectedGraph) => BufferedLedgerEntry | undefined;
  refresh: (entry: BufferedLedgerEntry, graph: BufferedInspectedGraph) => boolean;
  release: (entry: BufferedLedgerEntry) => void;
  clear: () => void;
} {
  const records = new Map<BufferedRetainedIdentity, BufferedLedgerRecord>();
  let bytes = 0;

  const reconcile = (entry: BufferedLedgerEntry, graph: BufferedInspectedGraph, isNew: boolean): boolean => {
    const work = { remaining: MAX_BUFFERED_LEDGER_RECONCILIATION_WORK };
    const changes = new Map<BufferedRetainedIdentity, BufferedLedgerChange>();
    const affected = findBufferedLedgerAffectedOwners(entry, graph, records, changes, work);
    if (!affected) {
      return false;
    }
    const memberships = collectBufferedLedgerMemberships(entry, graph, affected, records, changes, work);
    if (!memberships) {
      return false;
    }
    const projectedBytes = projectBufferedLedgerBytes(bytes, entry, graph, isNew, changes, records);
    if (projectedBytes === undefined) {
      return false;
    }

    applyBufferedLedgerChanges(records, changes, memberships);
    entry.scalarBytes = graph.scalarBytes;
    entry.roots = graph.roots;
    bytes = projectedBytes;
    return true;
  };

  const release = (entry: BufferedLedgerEntry): void => {
    bytes -= getBufferedLedgerEntryBytes(entry);
    for (const identity of entry.identities) {
      const record = records.get(identity);
      if (!record?.owners.delete(entry)) {
        continue;
      }
      bytes -= BUFFERED_LEDGER_OWNER_BYTES;
      if (record.owners.size === 0) {
        bytes -= getBufferedLedgerNodeBytes(record, 0);
        records.delete(identity);
      }
    }
    entry.identities.clear();
  };

  return {
    retain(graph) {
      const entry: BufferedLedgerEntry = { scalarBytes: 0, roots: new Set(), identities: new Set() };
      return reconcile(entry, graph, true) ? entry : undefined;
    },
    refresh(entry, graph) {
      return reconcile(entry, graph, false);
    },
    release,
    clear() {
      records.clear();
      bytes = 0;
    },
  };
}

/** An abortable event stream with typed listeners, asynchronous iteration, and lifecycle state. */
export class EventStream<EventTypes extends BaseEvents> {
  /** Controls the underlying request; aborting this controller cancels the stream. */
  controller: AbortController = new AbortController();

  #connectedPromise: Promise<void>;
  // oxlint-disable class-methods-use-this -- Deferred promise resolvers are intentionally per-instance mutable callbacks.
  #resolveConnectedPromise: () => void = () => undefined;
  #rejectConnectedPromise: (error: OpenAIError) => void = () => undefined;

  #endPromise: Promise<void>;
  #resolveEndPromise: () => void = () => undefined;
  #rejectEndPromise: (error: OpenAIError) => void = () => undefined;
  // oxlint-enable class-methods-use-this

  #listeners: {
    [Event in keyof EventTypes]?: EventListeners<EventTypes, Event>;
  } = Object.create(null);
  #abortListeners: { signal: AbortSignal; listener: () => void }[] = [];
  #emittedListenerRegistrations = new WeakMap<
    object,
    { event: PropertyKey; registration: { removed?: boolean; detached?: boolean } }
  >();
  #pendingListenerCleanup = new Set<PropertyKey>();
  #pendingBufferedEventChecks = new Set<() => void>();
  #listenerDispatchDepth = 0;

  #ended = false;
  #errored = false;
  #aborted = false;
  #catchingPromiseCreated = false;

  /** Creates an unstarted stream with independent connection and completion lifecycle promises. */
  constructor() {
    this.#connectedPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnectedPromise = resolve;
      this.#rejectConnectedPromise = reject;
    });

    this.#endPromise = new Promise<void>((resolve, reject) => {
      this.#resolveEndPromise = resolve;
      this.#rejectEndPromise = reject;
    });

    // Don't let these promises cause unhandled rejection errors.
    // we will manually cause an unhandled rejection error later
    // if the user hasn't registered any error listener or called
    // any promise-returning method.
    this.#connectedPromise.catch(() => undefined);
    this.#endPromise.catch(() => undefined);
  }

  protected _run(this: EventStream<EventTypes>, executor: () => Promise<any>) {
    // Unfortunately if we call `executor()` immediately we get runtime errors about
    // references to `this` before the `super()` constructor call returns.
    setTimeout(() => {
      let failed = false;

      Promise.resolve()
        .then(executor)
        .catch((error) => {
          failed = true;
          this.#handleError(error);
        })
        .then(() => {
          if (failed) {
            return;
          }

          try {
            this._emitFinal();
          } catch (error) {
            this.#handleError(error);
            return;
          }
          this._emit('end');
        });
    }, 0);
  }

  protected _connected(this: EventStream<EventTypes>) {
    if (this.ended) {
      return;
    }
    this.#resolveConnectedPromise();
    this._emit('connect');
  }

  /** Whether the stream has finished successfully, failed, or been aborted. */
  get ended(): boolean {
    return this.#ended;
  }

  /** Whether an error or user cancellation has been observed. */
  get errored(): boolean {
    return this.#errored;
  }

  /** Whether the stream ended because its request was cancelled. */
  get aborted(): boolean {
    return this.#aborted;
  }

  /**
   * Cancels the underlying request; {@link done} and {@link events} observe cancellation.
   * Promises returned by {@link emitted} for other events may remain pending.
   */
  abort() {
    this.controller.abort();
  }

  protected _listenForAbort(signal: AbortSignal | null | undefined) {
    if (!signal || this.ended) {
      return;
    }
    if (signal.aborted) {
      this.controller.abort();
      return;
    }

    const listener = () => this.controller.abort();
    signal.addEventListener('abort', listener, { once: true });
    this.#abortListeners.push({ signal, listener });
  }

  #removeAbortListeners() {
    for (const { signal, listener } of this.#abortListeners.splice(0)) {
      signal.removeEventListener('abort', listener);
    }
  }

  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns This stream, so that listener registration calls can be chained.
   */
  on<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> = (this.#listeners[event] ||= []);
    listeners.push({ listener });
    return this;
  }

  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns This stream, so that listener registration calls can be chained.
   */
  off<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners = this.#listeners[event];
    if (!listeners) {
      return this;
    }

    const emittedRegistration = this.#emittedListenerRegistrations.get(listener as object);
    if (
      emittedRegistration?.event === event &&
      !emittedRegistration.registration.removed &&
      !emittedRegistration.registration.detached
    ) {
      this.#removeEmittedListener(
        event,
        emittedRegistration.registration as EventListeners<EventTypes, Event>[number],
      );
      return this;
    }

    const index = listeners.findIndex((l) => !l.removed && l.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
    return this;
  }

  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns This stream, so that listener registration calls can be chained.
   */
  once<Event extends keyof EventTypes>(event: Event, listener: EventListener<EventTypes, Event>): this {
    const listeners: EventListeners<EventTypes, Event> = (this.#listeners[event] ||= []);
    listeners.push({ listener, once: true });
    return this;
  }

  #onceForEmitted<Event extends keyof EventTypes>(
    event: Event,
    listener: EventListener<EventTypes, Event>,
  ): void {
    const previousListeners = this.#listeners[event];
    const previousLength = previousListeners?.length ?? 0;
    this.once(event, listener);
    const listeners = this.#listeners[event];
    const [registration] = listeners?.slice(-1) ?? [];
    if (
      (previousListeners === undefined || listeners === previousListeners) &&
      listeners?.length === previousLength + 1 &&
      registration?.listener === listener &&
      registration.once
    ) {
      this.#emittedListenerRegistrations.set(listener as object, { event, registration });
    }
  }

  #removeEmittedListener<Event extends keyof EventTypes>(
    event: Event,
    registration: EventListeners<EventTypes, Event>[number],
  ): void {
    if (registration.removed) {
      return;
    }

    registration.removed = true;
    this.#emittedListenerRegistrations.delete(registration.listener as object);
    this.#pendingListenerCleanup.add(event);
    if (this.#listenerDispatchDepth === 0) {
      this.#cleanupEmittedListeners();
    }
  }

  #cleanupEmittedListeners(): void {
    for (const event of this.#pendingListenerCleanup) {
      const eventType = event as keyof EventTypes;
      const listeners = this.#listeners[eventType];
      if (listeners) {
        this.#listeners[eventType] = listeners.filter((listener) => !listener.removed) as any;
      }
    }
    this.#pendingListenerCleanup.clear();
  }

  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * Events without arguments resolve to `undefined`, single-argument events resolve
   * to that argument, and events with multiple arguments resolve to an argument tuple.
   *
   * @returns A promise for the next event, or a rejection if an error occurs first.
   * Requesting the `error` event resolves with the emitted error instead.
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted<Event extends keyof EventTypes>(
    event: Event,
  ): Promise<
    EventParameters<EventTypes, Event> extends [infer Param]
      ? Param
      : EventParameters<EventTypes, Event> extends []
        ? void
        : EventParameters<EventTypes, Event>
  > {
    return new Promise((resolve, reject) => {
      this.#catchingPromiseCreated = true;
      const onError = (error: OpenAIError) => {
        this.off(event, onEvent as EventListener<EventTypes, Event>);
        reject(error);
      };
      const onEvent = (...values: unknown[]) => {
        if (event !== 'error') {
          this.off('error', onError);
        }
        resolve((values.length > 1 ? values : values[0]) as any);
      };

      if (event !== 'error') {
        this.#onceForEmitted('error', onError as EventListener<EventTypes, 'error'>);
      }
      this.#onceForEmitted(event, onEvent as EventListener<EventTypes, Event>);
    });
  }

  /**
   * Returns an async iterator that yields every time the event is triggered.
   * The iterator ends when the stream ends and rejects if the stream errors
   * or is aborted. If you request the 'error' or 'abort' event, the iterator
   * yields that event instead of rejecting.
   *
   * Example:
   *
   *   for await (const [message] of stream.events('message')) {
   *     await processMessage(message);
   *   }
   */
  events<Event extends keyof EventTypes>(
    event: Event,
  ): AsyncIterableIterator<EventParameters<EventTypes, Event>> {
    type Parameters = EventParameters<EventTypes, Event>;
    return this._createIterator<Parameters>(
      (push) => {
        const onEvent = (...args: Parameters) => {
          sdkOwnedBufferedEventArguments.add(args);
          try {
            push(args);
          } finally {
            sdkOwnedBufferedEventArguments.delete(args);
          }
        };
        this.on(event, onEvent as EventListener<EventTypes, Event>);
        return () => this.off(event, onEvent as EventListener<EventTypes, Event>);
      },
      {
        // When iterating the 'error' or 'abort' event itself, yield it as a
        // value instead of rejecting the iterator.
        rejectOnError: event !== 'error',
        rejectOnAbort: event !== 'abort',
      },
    );
  }

  /**
   * Shared buffered async-iterator adapter over this stream's events.
   *
   * `attach` registers the producer listener(s) with the given `push` and
   * returns a cleanup function that removes them. Termination is handled
   * here: the iterator ends when the stream ends, listeners are removed on
   * end/return, and a terminal error is retained until buffered values have
   * drained so it is surfaced even when no reader was waiting when it fired.
   * Detached consumers have bounded event and byte queues; exceeding either
   * limit fails the stream and aborts its underlying request. Detached queues
   * also reject accessor-backed payloads because getter closures cannot be
   * safely sized without executing untrusted code.
   */
  protected _createIterator<T>(
    attach: (push: (value: T) => void) => () => void,
    {
      rejectOnError = true,
      rejectOnAbort = true,
      onReturn,
    }: { rejectOnError?: boolean; rejectOnAbort?: boolean; onReturn?: () => void } = {},
  ): AsyncIterableIterator<T> {
    type Result = IteratorResult<T>;
    type Reader = {
      resolve: (result: Result) => void;
      reject: (error: OpenAIError) => void;
    };
    type BufferedEvent = {
      retention: BufferedLedgerEntry;
      active: boolean;
      check: (() => void) | undefined;
    };

    const pushQueue = createEventQueue<T>();
    const bufferedEventSizes = createEventQueue<BufferedEvent>();
    const readQueue = createEventQueue<Reader>();
    const bufferedLedger = createBufferedEventLedger();
    let ended = this.ended;
    let failure: OpenAIError | undefined;
    let failureDelivered = false;
    let detach: () => void = () => undefined;

    const doneResult = (): Result => ({ value: undefined as never, done: true });
    const finishReaders = () => {
      while (readQueue.length) {
        readQueue.dequeue()!.resolve(doneResult());
      }
    };
    const rejectReader = () => {
      if (!failure || failureDelivered || !readQueue.length) {
        return;
      }
      failureDelivered = true;
      readQueue.dequeue()!.reject(failure);
    };
    const cleanup = () => {
      detach();
      this.off('end', onEnd);
      if (rejectOnError) {
        this.off('error', onFailure);
      }
      if (rejectOnAbort) {
        this.off('abort', onFailure);
      }
    };
    const deactivateBufferedEvent = (entry: BufferedEvent): void => {
      entry.active = false;
      if (entry.check) {
        this.#pendingBufferedEventChecks.delete(entry.check);
        entry.check = undefined;
      }
    };
    const failBufferedEvents = (discardRetained = false): OpenAIError => {
      if (discardRetained) {
        while (bufferedEventSizes.length) {
          deactivateBufferedEvent(bufferedEventSizes.dequeue()!);
        }
        pushQueue.clear();
        bufferedLedger.clear();
      }

      const error = new OpenAIError(
        `Event stream iterator buffer limit exceeded (${MAX_BUFFERED_ITERATOR_EVENTS} events or ${MAX_BUFFERED_ITERATOR_BYTES} bytes); consume events as they arrive.`,
      );
      try {
        this.#handleError(error);
      } finally {
        this.controller.abort();
      }
      return error;
    };

    const revalidateBufferedEvent = (value: T, entry: BufferedEvent): void => {
      if (!entry.active || this.#ended) {
        return;
      }

      const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
      if (!graph || !bufferedLedger.refresh(entry.retention, graph)) {
        failBufferedEvents(true);
      }
    };

    const push = (value: T) => {
      if (ended) {
        return;
      }
      const reader = readQueue.dequeue();
      if (reader) {
        reader.resolve({ value, done: false });
      } else {
        if (pushQueue.length >= MAX_BUFFERED_ITERATOR_EVENTS) {
          failBufferedEvents();
          return;
        }
        const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
        const retention = graph && bufferedLedger.retain(graph);
        if (!retention) {
          failBufferedEvents();
          return;
        }

        if (typeof value === 'object' && value !== null && sdkOwnedBufferedEventArguments.has(value)) {
          const argumentsTuple = value as unknown[];
          for (let index = 0; index < argumentsTuple.length; index += 1) {
            const argument = argumentsTuple[index];
            if (typeof argument === 'string') {
              argumentsTuple[index] = bufferedJSONParse(bufferedJSONStringify(argument)) as string;
            }
          }
        }

        const entry: BufferedEvent = { retention, active: true, check: undefined };
        pushQueue.enqueue(value);
        bufferedEventSizes.enqueue(entry);
        const check = () => {
          entry.check = undefined;
          revalidateBufferedEvent(value, entry);
        };
        entry.check = check;
        this.#pendingBufferedEventChecks.add(check);
      }
    };
    const onFailure = (error: OpenAIError) => {
      failure = error;
      if (!pushQueue.length) {
        rejectReader();
      }
    };
    const onEnd = () => {
      ended = true;
      cleanup();
      if (!pushQueue.length) {
        rejectReader();
        finishReaders();
      }
    };

    if (!ended) {
      detach = attach(push);
      this.on('end', onEnd);
      if (rejectOnError) {
        this.on('error', onFailure);
      }
      if (rejectOnAbort) {
        this.on('abort', onFailure);
      }
    }

    return {
      next: (): Promise<Result> => {
        if (pushQueue.length) {
          const value = pushQueue.dequeue()!;
          const entry = bufferedEventSizes.dequeue()!;
          deactivateBufferedEvent(entry);
          const graph = inspectBufferedEventGraph(value, MAX_BUFFERED_ITERATOR_BYTES);
          if (!graph || !bufferedLedger.refresh(entry.retention, graph)) {
            const error = failBufferedEvents(true);
            failureDelivered = true;
            return Promise.reject(error);
          }
          bufferedLedger.release(entry.retention);
          return Promise.resolve({ value, done: false });
        }

        if (failure && !failureDelivered) {
          failureDelivered = true;
          return Promise.reject(failure);
        }

        if (ended) {
          return Promise.resolve(doneResult());
        }

        return new Promise<Result>((resolve, reject) => {
          readQueue.enqueue({ resolve, reject });
        });
      },
      return: () => {
        ended = true;
        while (bufferedEventSizes.length) {
          deactivateBufferedEvent(bufferedEventSizes.dequeue()!);
        }
        pushQueue.clear();
        bufferedLedger.clear();
        cleanup();
        finishReaders();
        if (onReturn) {
          // The consumer explicitly ended iteration, so any failure the
          // onReturn callback triggers (e.g. aborting the stream) is
          // self-inflicted; mark the stream's terminal promise as handled so
          // it does not surface as an unhandled rejection.
          void this.done().catch(() => undefined);
          onReturn();
        }
        return Promise.resolve(doneResult());
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Resolves when the stream ends successfully or rejects when it fails or is aborted. */
  async done(): Promise<void> {
    this.#catchingPromiseCreated = true;
    await this.#endPromise;
  }

  #handleError(this: EventStream<EventTypes>, error: unknown) {
    this.#errored = true;
    if (error instanceof Error && error.name === 'AbortError') {
      error = new APIUserAbortError();
    }
    if (error instanceof APIUserAbortError) {
      this.#aborted = true;
      return this._emit('abort', error);
    }
    if (error instanceof OpenAIError) {
      return this._emit('error', error);
    }
    if (error instanceof Error) {
      const openAIError: OpenAIError = new OpenAIError(error.message);
      // @ts-ignore
      openAIError.cause = error;
      return this._emit('error', openAIError);
    }
    return this._emit('error', new OpenAIError(String(error)));
  }

  /** Returns whether an event currently has one or more registered listeners. */
  protected _hasListeners<Event extends keyof EventTypes>(event: Event): boolean {
    return Boolean(this.#listeners[event]?.some((listener) => !listener.removed));
  }

  /** Dispatches a connection, failure, cancellation, or completion lifecycle event. */
  _emit<Event extends keyof BaseEvents>(event: Event, ...args: EventParameters<BaseEvents, Event>): void;
  /** Dispatches a typed stream event to all listeners registered for that event. */
  _emit<Event extends keyof EventTypes>(event: Event, ...args: EventParameters<EventTypes, Event>): void;
  /** Dispatches a stream event and performs the associated lifecycle transitions. */
  _emit<Event extends keyof EventTypes>(
    this: EventStream<EventTypes>,
    event: Event,
    ...args: EventParameters<EventTypes, Event>
  ) {
    // make sure we don't emit any events after end
    if (this.#ended) {
      return;
    }

    if (event === 'end') {
      this.#removeAbortListeners();
      this.#ended = true;
      this.#resolveEndPromise();
    }

    const listeners: EventListeners<EventTypes, Event> | undefined = this.#listeners[event];
    if (listeners) {
      this.#listeners[event] = listeners.filter((listener) => {
        if (listener.once) {
          listener.detached = true;
        }
        return !listener.once && !listener.removed;
      }) as any;
      this.#listenerDispatchDepth += 1;
      try {
        for (const registration of listeners as any) {
          if (!registration.removed) {
            registration.listener(...(args as any));
          }
        }
      } finally {
        this.#listenerDispatchDepth -= 1;
        if (this.#listenerDispatchDepth === 0) {
          this.#cleanupEmittedListeners();
          for (const check of this.#pendingBufferedEventChecks) {
            this.#pendingBufferedEventChecks.delete(check);
            if (!this.#ended) {
              check();
            }
          }
        }
      }
    }

    if (event === 'abort') {
      const error = args[0] as APIUserAbortError;
      if (!this.#catchingPromiseCreated && !listeners?.length) {
        Promise.reject(error);
      }
      this.#rejectConnectedPromise(error);
      this.#rejectEndPromise(error);
      this._emit('end');
      return;
    }

    if (event === 'error') {
      // NOTE: _emit('error', error) should only be called from #handleError().

      const error = args[0] as OpenAIError;
      if (!this.#catchingPromiseCreated && !listeners?.length) {
        // Trigger an unhandled rejection if the user hasn't registered any error handlers.
        // If you are seeing stack traces here, make sure to handle errors via either:
        // - runner.on('error', () => ...)
        // - await runner.done()
        // - await runner.finalChatCompletion()
        // - etc.
        Promise.reject(error);
      }
      this.#rejectConnectedPromise(error);
      this.#rejectEndPromise(error);
      this._emit('end');
    }
  }

  // oxlint-disable-next-line class-methods-use-this -- Subclasses override this instance hook.
  protected _emitFinal(): void {
    // Hook for subclasses.
  }
}

/** The listener callback associated with one event name in a stream event map. */
type EventListener<Events, EventType extends keyof Events> = Events[EventType];

type EventListeners<Events, EventType extends keyof Events> = {
  listener: EventListener<Events, EventType>;
  once?: boolean;
  removed?: boolean;
  detached?: boolean;
}[];

/** The positional listener arguments associated with a named event. */
export type EventParameters<Events, EventType extends keyof Events> = Record<
  EventType,
  EventListener<Events, EventType> extends (...args: infer P) => any ? P : never
>[EventType];

/** Lifecycle events shared by all SDK streaming helpers. */
export interface BaseEvents {
  /** Called when the underlying request or readable stream is ready to produce events. */
  connect: () => void;
  /** Called when the stream fails for a reason other than user cancellation. */
  error: (error: OpenAIError) => void;
  /** Called when the underlying request is cancelled. */
  abort: (error: APIUserAbortError) => void;
  /** Called after a successful completion, failure, or cancellation. */
  end: () => void;
}
