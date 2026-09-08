import type { RequestInit } from '../builtin-types';
import { getHeadersIterator, hasNativeHeadersBrand } from '../platform-headers';

type HeaderInput = NonNullable<RequestInit['headers']>;

const hasIteratorDescriptor = (source: HeaderInput): boolean => {
  const seen = new Set<object>();
  for (let current: object | null = source; current; current = Object.getPrototypeOf(current)) {
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    if (Object.getOwnPropertyDescriptor(current, Symbol.iterator)) {
      return true;
    }
  }
  return false;
};

const defineRecordHeader = (
  record: Record<PropertyKey, unknown>,
  source: HeaderInput,
  key: string,
  markAdvanced: () => void,
) =>
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    get() {
      markAdvanced();
      return Reflect.get(source, key, source);
    },
  });

/**
 * Materializes headers for workload-credential attribution without forwarding an input whose
 * one-shot protocol was already partially consumed by a failed parse.
 */
export const materializeWorkloadHeaders = (source: HeaderInput): Headers | undefined => {
  let advanced = false;
  try {
    if (!hasIteratorDescriptor(source)) {
      try {
        return new Headers(source);
      } catch (error) {
        try {
          Reflect.ownKeys(source);
        } catch {
          // A persistently opaque record may require its configured transport to unwrap it.
          return undefined;
        }
        // Validation or a field read failed after the record shape became observable.
        advanced = true;
        throw error;
      }
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
      // Preserve the single selected protocol while record conversion observes every original
      // string key, including non-enumerable fields, with the original getter receiver.
      const record = Object.create(null) as Record<PropertyKey, unknown>;
      if (iterator !== undefined && iterator !== null) {
        Object.defineProperty(record, Symbol.iterator, { value: iterator });
        advanced = true;
      }
      const markAdvanced = () => {
        advanced = true;
      };
      for (const key of Reflect.ownKeys(source)) {
        if (key === Symbol.iterator) {
          continue;
        }
        if (typeof key !== 'string') {
          advanced = true;
          throw new TypeError('Header record keys must be strings');
        }
        if (!Object.getOwnPropertyDescriptor(source, key)) {
          continue;
        }
        defineRecordHeader(record, source, key, markAdvanced);
      }
      input = record as HeaderInput;
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
