import { getHeadersIterator } from './platform-headers';
import { HeaderDescriptorRead, observeHeaderDescriptor } from './header-descriptor-evidence';
import type { HeaderDescriptorHistory } from './header-descriptor-evidence';

/** Reads the defining array iterator without evaluating intervening accessors. */
export const getArrayIterator = <T>(headers: readonly T[]) => {
  try {
    let platformIterator: (() => Iterator<T>) | undefined;
    let prototype: object | null = headers;
    const seen = new Set<object>();
    while (prototype) {
      if (seen.has(prototype)) {
        return;
      }
      seen.add(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (descriptor && Array.isArray(prototype)) {
        // Array.prototype is itself an array, including in another realm. Match
        // the captured function without evaluating an intervening iterator getter.
        if (typeof descriptor.value !== 'function') {
          prototype = Object.getPrototypeOf(prototype);
          continue;
        }
        const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
        if (
          typeof constructor !== 'function' ||
          Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value !== prototype
        ) {
          prototype = Object.getPrototypeOf(prototype);
          continue;
        }
        if (platformIterator) {
          return;
        }
        platformIterator = descriptor.value as () => Iterator<T>;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return platformIterator;
  } catch {
    // An opaque prototype chain does not identify a native array iterator.
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined satisfies noImplicitReturns for a fallible probe.
  return undefined;
};

/** Checks whether native Headers methods accept this receiver. */
export const hasNativeHeadersBrand = (headers: object): boolean => {
  try {
    Headers.prototype.has.call(headers, 'authorization');
    return true;
  } catch {
    return false;
  }
};

type IteratorFactory<T> = () => Iterator<T>;

type SourceProtocolState<T> =
  | { readonly kind: 'unobserved' }
  | { readonly kind: 'record'; readonly history: HeaderDescriptorHistory }
  | {
      readonly kind: 'iterable';
      readonly iterator: IteratorFactory<T>;
      readonly iterations: WeakSet<object>;
    };

type SourceProtocolCapture<T> = {
  readonly native: boolean;
  readonly refreshable: boolean;
  readonly unverifiedHeaders: boolean;
  /** Commits descriptor evidence only after all canonical rows have completed successfully. */
  finish: () => void;
} & (
  | { readonly kind: 'record' }
  | {
      readonly kind: 'iterable';
      /** Native arrays may supply occurrence-aware iteration; other sources use their captured factory. */
      iterate: (array?: IteratorFactory<T>) => { iteration: Iterator<T>; reused: boolean };
    }
);

/** Owns source protocol selection, read completion and retained iterator identity for one header layer. */
export class HeaderSourceProtocol<T> {
  private readonly retain: boolean;
  private state: SourceProtocolState<T>;

  constructor(retain = true, state?: SourceProtocolState<T>) {
    this.retain = retain;
    this.state = state ?? { kind: 'unobserved' };
  }

  /** Selects the current protocol without rereading an unchanged or self-removing iterator accessor. */
  capture(source: object, onIterator?: (native: boolean) => void): SourceProtocolCapture<T> {
    const previous = this.state;
    const record =
      this.retain && previous.kind !== 'iterable'
        ? new HeaderDescriptorRead(
            observeHeaderDescriptor(source, Symbol.iterator),
            previous.kind === 'record' ? previous.history : undefined,
          )
        : undefined;
    let iterator: IteratorFactory<T> | undefined;
    if (previous.kind === 'iterable') {
      ({ iterator } = previous);
    } else if (!record?.retained && Symbol.iterator in source) {
      const candidate = Reflect.get(source, Symbol.iterator);
      if (typeof candidate === 'function') {
        iterator = candidate as IteratorFactory<T>;
        // A newly selected custom factory is not retained as a replayable native protocol.
        this.state = { kind: 'unobserved' };
      }
    }
    const nativeIterator =
      (this.retain || onIterator) && typeof iterator === 'function' && !Array.isArray(source)
        ? getHeadersIterator(source)
        : undefined;
    const native = typeof iterator === 'function' && iterator === nativeIterator;
    onIterator?.(native);
    const facts = {
      native,
      unverifiedHeaders: this.retain && native && !hasNativeHeadersBrand(source),
    };
    if (typeof iterator !== 'function') {
      return {
        ...facts,
        kind: 'record',
        refreshable: true,
        finish: () => {
          if (record) {
            // Getter and coercion side effects belong to this read; later protocol changes do not.
            this.state = {
              kind: 'record',
              history: record.complete(observeHeaderDescriptor(source, Symbol.iterator)),
            };
          }
        },
      };
    }
    const refreshable =
      this.retain && (Array.isArray(source) ? iterator === getArrayIterator(source) : native);
    return {
      ...facts,
      kind: 'iterable',
      refreshable,
      iterate: (array) => {
        const iteration = this.retain && refreshable && array ? array() : iterator.call(source);
        if (!refreshable) {
          return { iteration, reused: false };
        }
        const iterations = previous.kind === 'iterable' ? previous.iterations : new WeakSet<object>();
        this.state = { kind: 'iterable', iterator, iterations };
        if (iterations.has(iteration)) {
          return { iteration, reused: true };
        }
        iterations.add(iteration);
        return { iteration, reused: false };
      },
      finish: () => {
        // Iterable state is committed when its cursor is acquired, before row processing.
      },
    };
  }

  /** Copies lifecycle state while sharing immutable evidence and previously consumed iterator identities. */
  fork(): HeaderSourceProtocol<T> {
    return new HeaderSourceProtocol(this.retain, this.state);
  }
}
