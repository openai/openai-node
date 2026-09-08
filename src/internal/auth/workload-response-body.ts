const nativeResponseBodyGetter = globalThis.Response
  ? Object.getOwnPropertyDescriptor(globalThis.Response.prototype, 'body')?.get
  : undefined;

const foreignResponseBodyGetter = (response: Response): ((this: Response) => unknown) | undefined => {
  let getter: ((this: Response) => unknown) | undefined;
  const seen = new Set<object>();
  for (
    let prototype: object | null = Object.getPrototypeOf(response);
    prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (seen.has(prototype)) {
      return undefined;
    }
    seen.add(prototype);
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    const body = Object.getOwnPropertyDescriptor(prototype, 'body')?.get;
    if (
      typeof constructor === 'function' &&
      Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Response' &&
      Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
      Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Response' &&
      typeof Object.getOwnPropertyDescriptor(prototype, 'clone')?.value === 'function' &&
      typeof Object.getOwnPropertyDescriptor(prototype, 'status')?.get === 'function' &&
      typeof Object.getOwnPropertyDescriptor(prototype, 'headers')?.get === 'function' &&
      typeof body === 'function'
    ) {
      // Continue past subclasses to use the defining platform's getter, never a caller shadow.
      getter = body;
    }
  }
  return getter;
};

export const responseBodyIdentity = (response: Response): object | undefined => {
  try {
    if (nativeResponseBodyGetter) {
      try {
        const body = nativeResponseBodyGetter.call(response);
        return typeof body === 'object' && body !== null ? body : undefined;
      } catch {
        // A response from another platform has its own branded body reader.
      }
    }
    const body = foreignResponseBodyGetter(response)?.call(response);
    return typeof body === 'object' && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
};
