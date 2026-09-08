import type { RequestInit } from './builtin-types';

/** Replaces transport headers while preserving the request's property owners. */
export function replaceRequestHeaders<T extends RequestInit>(request: T, headers: RequestInit['headers']): T {
  const headerDescriptor = Object.getOwnPropertyDescriptor(request, 'headers');
  if (headerDescriptor && 'value' in headerDescriptor && headerDescriptor.writable) {
    try {
      if (Reflect.defineProperty(request, 'headers', { value: headers }) && request.headers === headers) {
        return request;
      }
    } catch {
      // Proxy hooks can decline a property update or prevent verification of the installed value.
    }
  }
  const originalRequest = request;
  const normalizedRequest = Object.create(Object.getPrototypeOf(request), {
    ...Object.getOwnPropertyDescriptors(request),
    headers: { value: headers, enumerable: true, configurable: true, writable: true },
  }) as T;
  // Only headers have separate state. Other properties and their accessor receivers
  // belong to the original request, including mutations made by later hooks.
  const owner = (property: PropertyKey) => (property === 'headers' ? normalizedRequest : originalRequest);
  const sync = (property: PropertyKey) => {
    if (property === 'headers') {
      return;
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(originalRequest, property);
    if (descriptor) {
      Reflect.defineProperty(normalizedRequest, property, descriptor);
    } else {
      Reflect.deleteProperty(normalizedRequest, property);
    }
  };
  const syncKeys = () => {
    Reflect.setPrototypeOf(normalizedRequest, Reflect.getPrototypeOf(originalRequest));
    for (const property of new Set([
      ...Reflect.ownKeys(originalRequest),
      ...Reflect.ownKeys(normalizedRequest),
    ])) {
      sync(property);
    }
  };
  return new Proxy(normalizedRequest, {
    get(_target, property) {
      sync(property);
      return Reflect.get(owner(property), property);
    },
    set(_target, property, value) {
      const changed = Reflect.set(owner(property), property, value);
      sync(property);
      return changed;
    },
    defineProperty(_target, property, descriptor) {
      const changed = Reflect.defineProperty(owner(property), property, descriptor);
      sync(property);
      return changed;
    },
    deleteProperty(_target, property) {
      const changed = Reflect.deleteProperty(owner(property), property);
      sync(property);
      return changed;
    },
    has(_target, property) {
      return Reflect.has(owner(property), property);
    },
    getOwnPropertyDescriptor(target, property) {
      sync(property);
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    ownKeys(target) {
      syncKeys();
      return Reflect.ownKeys(target);
    },
    getPrototypeOf(target) {
      const prototype = Reflect.getPrototypeOf(originalRequest);
      Reflect.setPrototypeOf(target, prototype);
      return prototype;
    },
    setPrototypeOf(target, prototype) {
      return Reflect.setPrototypeOf(originalRequest, prototype) && Reflect.setPrototypeOf(target, prototype);
    },
    preventExtensions(target) {
      if (!Reflect.preventExtensions(originalRequest)) {
        return false;
      }
      syncKeys();
      return Reflect.preventExtensions(target);
    },
  });
}
