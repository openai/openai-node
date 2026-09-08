import type { RequestInit } from '../builtin-types';
import { isNativeHeadersIterator } from '../platform-headers';

type HeaderInput = NonNullable<RequestInit['headers']>;

const getIteratorDescriptor = (
  source: HeaderInput,
): { descriptor: PropertyDescriptor; owner: object } | undefined => {
  const seen = new Set<object>();
  for (let current: object | null = source; current; current = Object.getPrototypeOf(current)) {
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, Symbol.iterator);
    if (descriptor) {
      return { descriptor, owner: current };
    }
  }
  return undefined;
};

const materializeRecord = (source: HeaderInput): Headers | undefined =>
  // Record conversion cannot distinguish an ownKeys failure from a failure after a field was
  // consumed. Fail closed instead of delegating an ambiguously observed record to transport.
  new Headers(source);

const materializeSelectedRecord = (source: HeaderInput, iterator: null | undefined): Headers =>
  new Headers(
    new Proxy(source, {
      get(target, key) {
        return key === Symbol.iterator ? iterator : Reflect.get(target, key, target);
      },
    }),
  );

/**
 * Materializes headers for workload-credential attribution without forwarding an input whose
 * one-shot protocol was already partially consumed by a failed parse.
 */
export const materializeWorkloadHeaders = (source: HeaderInput): Headers | undefined => {
  // Descriptor discovery itself can observe an unreadable record. Delegation becomes safe only
  // after a callable iterator factory has been selected without consuming a row.
  let advanced = true;
  try {
    const selected = getIteratorDescriptor(source);
    if (!selected) {
      return materializeRecord(source);
    }
    const { descriptor, owner } = selected;
    if (!('value' in descriptor)) {
      // Let the platform select an accessor-backed protocol exactly once. If it fails, the
      // accessor may already have advanced state, so the input cannot safely reach transport.
      advanced = true;
      return new Headers(source);
    }
    if (owner !== source || descriptor.value === undefined || descriptor.value === null) {
      // Inherited and already-nullish data protocols have not been selected yet. Let the platform
      // perform their only observable Get and fail closed if conversion cannot complete.
      return new Headers(source);
    }
    const iterator = Reflect.get(source, Symbol.iterator) as unknown;
    if (iterator === undefined || iterator === null) {
      // A Proxy can return a nullish selection despite a callable data descriptor. Preserve that
      // single selection while retaining the source's Proxy record-conversion semantics.
      return materializeSelectedRecord(source, iterator as null | undefined);
    }
    const nativeIterator = isNativeHeadersIterator(iterator);
    let input: HeaderInput;
    if (typeof iterator === 'function') {
      advanced = false;
      input = {
        [Symbol.iterator]() {
          const iteration = Reflect.apply(iterator, source, []) as Iterator<unknown>;
          // The factory itself may fail before exposing an iterator and can still be delegated.
          // A recognized native protocol can also fail its first lazy brand check without reading
          // a row. Custom protocols become observed as soon as their iterator object is exposed.
          if (!nativeIterator) {
            advanced = true;
          }
          const next = Reflect.get(iteration, 'next') as unknown;
          return {
            next(...args: unknown[]) {
              // Starting a step may consume or close a one-shot iterator even when it throws.
              const result = Reflect.apply(
                next as (...args: unknown[]) => IteratorResult<unknown>,
                iteration,
                args,
              );
              advanced = true;
              return result;
            },
            get return() {
              const close = Reflect.get(iteration, 'return') as unknown;
              return typeof close === 'function'
                ? (...args: unknown[]) => Reflect.apply(close, iteration, args)
                : close;
            },
          };
        },
      } as HeaderInput;
    } else {
      // Reject the already-selected invalid protocol without giving a stateful Proxy a second read.
      throw new TypeError('Header iterator must be callable');
    }
    return new Headers(input);
  } catch (error) {
    if (advanced) {
      throw error;
    }
    // Inputs unreadable without consuming a row may require validation or unwrapping by the configured transport.
    return undefined;
  }
};
