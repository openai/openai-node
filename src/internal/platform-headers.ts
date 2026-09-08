const nativeHeadersPrototype = globalThis.Headers?.prototype;
const nativeHeadersGet = nativeHeadersPrototype?.get;
const nativeHeadersProtocol = nativeHeadersPrototype
  ? {
      has: nativeHeadersPrototype.has,
      iterator: nativeHeadersPrototype[Symbol.iterator],
      prototype: nativeHeadersPrototype,
    }
  : undefined;

const hasNativeHeadersBrand = (headers: object): boolean => {
  if (!nativeHeadersProtocol) {
    return false;
  }
  try {
    Reflect.apply(nativeHeadersProtocol.has, headers, ['authorization']);
    return true;
  } catch {
    return false;
  }
};

const getHeadersProtocol = (
  headers: object,
): { iterator: () => Iterator<unknown>; prototype: object } | undefined => {
  let protocol: { iterator: () => Iterator<unknown>; prototype: object } | undefined;
  const native = hasNativeHeadersBrand(headers);
  try {
    const seen = new Set<object>();
    for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (seen.has(prototype)) {
        break;
      }
      seen.add(prototype);
      const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (!iterator) {
        continue;
      }
      const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      const entries = Object.getOwnPropertyDescriptor(prototype, 'entries')?.value;
      if (
        typeof constructor === 'function' &&
        Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Headers' &&
        Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
        Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Headers' &&
        typeof iterator.value === 'function' &&
        iterator.value === entries
      ) {
        protocol = { iterator: iterator.value as () => Iterator<unknown>, prototype };
        // A branded native subclass can forge the structural protocol at an outer prototype. Keep
        // walking to select its realm's intrinsic Headers prototype; structural inputs retain the
        // original nearest-protocol behavior.
        if (!native) {
          break;
        }
      }
    }
  } catch {
    // Caller-controlled descriptors can leave a collection's protocol unknown.
  }
  return protocol ?? (native ? nativeHeadersProtocol : undefined);
};

export const getHeadersIterator = (headers: object) => getHeadersProtocol(headers)?.iterator;

const readPlatformHeader = (
  headers: object | null | undefined,
  name: string,
  verify: boolean,
): { value: string | null; prototype: object } | undefined => {
  try {
    if (!headers) {
      return undefined;
    }
    const platform = getHeadersProtocol(headers);
    if (!platform) {
      return undefined;
    }
    const seen = new Set<object>();
    let actualIterator: PropertyDescriptor | undefined;
    for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (seen.has(prototype)) {
        return undefined;
      }
      seen.add(prototype);
      actualIterator ??= Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (actualIterator && actualIterator.value !== platform.iterator) {
        return undefined;
      }
      if (prototype !== platform.prototype) {
        continue;
      }
      if (verify && prototype !== nativeHeadersPrototype) {
        const has = Object.getOwnPropertyDescriptor(prototype, 'has')?.value;
        if (typeof has !== 'function') {
          return undefined;
        }
        // A foreign platform reader must reject unbranded receivers. Merely matching the
        // Headers-shaped iterable protocol does not prove that its source can be replayed.
        try {
          Reflect.apply(has, {}, [name]);
          return undefined;
        } catch {
          if (typeof Reflect.apply(has, headers, [name]) !== 'boolean') {
            return undefined;
          }
        }
      }
      const getter =
        prototype === nativeHeadersPrototype
          ? nativeHeadersGet
          : Object.getOwnPropertyDescriptor(prototype, 'get')?.value;
      if (typeof getter === 'function') {
        return { value: Reflect.apply(getter, headers, [name]), prototype };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Reads platform collections without consuming the iterable later handed to custom fetch. */
export const getPlatformHeader = (headers: object | null | undefined, name: string) =>
  readPlatformHeader(headers, name, false);

/** Reads recognized native collections after validating their defining realm's receiver brand. */
export const getVerifiedPlatformHeader = (headers: object | null | undefined, name: string) =>
  readPlatformHeader(headers, name, true);
