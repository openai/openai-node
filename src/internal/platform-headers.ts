const getHeadersProtocol = (
  headers: object,
): { iterator: () => Iterator<unknown>; prototype: object } | undefined => {
  let protocol: { iterator: () => Iterator<unknown>; prototype: object } | undefined;
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
        break;
      }
    }
  } catch {
    // Caller-controlled descriptors can leave a collection's protocol unknown.
  }
  return protocol;
};

export const getHeadersIterator = (headers: object) => getHeadersProtocol(headers)?.iterator;

/** Reads platform collections without consuming the iterable later handed to custom fetch. */
export const getPlatformHeader = (
  headers: object | null | undefined,
  name: string,
): { value: string | null; prototype: object } | undefined => {
  try {
    if (!headers) {
      return undefined;
    }
    let platform: ReturnType<typeof getHeadersProtocol>;
    try {
      // Native storage is authoritative even when a subclass forges the platform descriptors.
      Headers.prototype.has.call(headers, name);
      platform = { iterator: Headers.prototype[Symbol.iterator], prototype: Headers.prototype };
    } catch {
      platform = getHeadersProtocol(headers);
    }
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
      const getter = Object.getOwnPropertyDescriptor(prototype, 'get')?.value;
      if (typeof getter === 'function') {
        return { value: Reflect.apply(getter, headers, [name]), prototype };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};
