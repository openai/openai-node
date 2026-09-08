import type { RequestInit } from '../builtin-types';
import { getHeadersIterator, hasNativeHeadersBrand } from '../platform-headers';

type HeaderInput = NonNullable<RequestInit['headers']>;

const getIteratorDescriptor = (source: HeaderInput): PropertyDescriptor | undefined => {
  const seen = new Set<object>();
  for (let current: object | null = source; current; current = Object.getPrototypeOf(current)) {
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, Symbol.iterator);
    if (descriptor) {
      return descriptor;
    }
  }
  return undefined;
};

const errorOrigin = (error: unknown): string | undefined =>
  error instanceof Error && typeof error.stack === 'string'
    ? error.stack.split('\n', 2)[1]?.trim()
    : undefined;

const sameOpaqueFailure = (first: unknown, second: unknown) => {
  if (Object.is(first, second)) {
    return true;
  }
  if (!(first instanceof Error) || !(second instanceof Error)) {
    return false;
  }
  const firstOrigin = errorOrigin(first);
  return (
    first.name === second.name &&
    first.message === second.message &&
    firstOrigin !== undefined &&
    firstOrigin === errorOrigin(second)
  );
};

const materializeRecord = (source: HeaderInput): Headers | undefined => {
  try {
    return new Headers(source);
  } catch (error) {
    try {
      Reflect.ownKeys(source);
    } catch (shapeError) {
      if (sameOpaqueFailure(error, shapeError)) {
        // A record whose shape cannot be inspected may require its configured transport to unwrap it.
        return undefined;
      }
    }
    // Validation or a field read failed after the record shape became observable.
    throw error;
  }
};

/**
 * Materializes headers for workload-credential attribution without forwarding an input whose
 * one-shot protocol was already partially consumed by a failed parse.
 */
export const materializeWorkloadHeaders = (source: HeaderInput): Headers | undefined => {
  let advanced = false;
  try {
    const descriptor = getIteratorDescriptor(source);
    if (
      !descriptor ||
      ('value' in descriptor && (descriptor.value === undefined || descriptor.value === null))
    ) {
      advanced = true;
      return materializeRecord(source);
    }
    if (!('value' in descriptor)) {
      // Let the platform select an accessor-backed protocol exactly once. If it fails, the
      // accessor may already have advanced state, so the input cannot safely reach transport.
      advanced = true;
      return new Headers(source);
    }
    const iterator = Reflect.get(source, Symbol.iterator) as unknown;
    const branded = hasNativeHeadersBrand(source);
    const opaqueHeadersProtocol =
      typeof iterator === 'function' &&
      !branded &&
      (source instanceof Headers || iterator === getHeadersIterator(source));
    let input: HeaderInput;
    if (typeof iterator === 'function' && !opaqueHeadersProtocol) {
      input = {
        [Symbol.iterator]() {
          const iteration = Reflect.apply(iterator, source, []) as Iterator<unknown>;
          const next = Reflect.get(iteration, 'next') as unknown;
          return {
            next(...args: unknown[]) {
              // Starting a step may consume or close a one-shot iterator even when it throws.
              advanced = true;
              return Reflect.apply(next as (...args: unknown[]) => IteratorResult<unknown>, iteration, args);
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
    } else if (opaqueHeadersProtocol) {
      // Native-protocol membranes may need their configured transport to unwrap the receiver.
      input = source;
    } else {
      // Match the platform's invalid-iterator diagnostic without retrying the selected protocol.
      advanced = true;
      input = source;
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
