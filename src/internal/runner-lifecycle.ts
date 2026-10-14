import { hasOwn } from './utils/values';
import type { RequestOptions } from './request-options';
import type { OpenAI } from '../client';
import { buildHeaders } from './headers';
import { uuid4 } from './utils/uuid';

export function overlayRequestOptions(
  original: RequestOptions | undefined,
  changes: Pick<RequestOptions, 'signal' | 'idempotencyKey' | 'headers' | 'maxRetries'>,
): RequestOptions {
  if (!original) {
    return changes;
  }
  // Keep untouched caller fields live while dispatch wrappers own their local writes and deletions.
  // SAFETY: The extensible target keeps the original prototype while traps expose current own fields.
  const shadow = Object.create(Object.getPrototypeOf(original)) as RequestOptions;
  const deleted = new Set<PropertyKey>();
  return new Proxy(shadow, {
    ownKeys(target) {
      if (!Reflect.isExtensible(target)) {
        return Reflect.ownKeys(target);
      }
      const virtual = [...Reflect.ownKeys(original), ...Reflect.ownKeys(changes)].filter(
        (key) => !deleted.has(key),
      );
      return [...new Set([...virtual, ...Reflect.ownKeys(target)])];
    },
    getOwnPropertyDescriptor(target, key) {
      const local = Object.getOwnPropertyDescriptor(target, key);
      if (local || deleted.has(key) || !Reflect.isExtensible(target)) {
        return local;
      }
      const descriptor = Object.getOwnPropertyDescriptor(hasOwn(changes, key) ? changes : original, key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    get(target, key, receiver) {
      if (hasOwn(target, key)) {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- Wrapper-owned getters must see the complete request view.
        return Reflect.get(target, key, receiver);
      }
      if (deleted.has(key) || !Reflect.isExtensible(target)) {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- A removed own field can still expose an inherited native getter.
        return Reflect.get(target, key, original);
      }
      // oxlint-disable-next-line anti-slop/no-reflect-get -- Keep native getter receivers and defer their reads until native create.
      return hasOwn(changes, key) ? Reflect.get(changes, key, changes) : Reflect.get(original, key, original);
    },
    set(target, key, value, receiver) {
      if (hasOwn(target, key)) {
        return Reflect.set(target, key, value, receiver);
      }
      return Reflect.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    deleteProperty(target, key) {
      if (!Reflect.deleteProperty(target, key)) {
        return false;
      }
      deleted.add(key);
      return true;
    },
    has(target, key) {
      return (
        Reflect.has(target, key) ||
        (Reflect.isExtensible(target) &&
          !deleted.has(key) &&
          (hasOwn(changes, key) || Reflect.has(original, key)))
      );
    },
    preventExtensions(target) {
      if (!Reflect.isExtensible(target)) {
        return true;
      }
      const keys = new Set([...Reflect.ownKeys(original), ...Reflect.ownKeys(changes)]);
      for (const key of keys) {
        if (deleted.has(key) || hasOwn(target, key)) {
          continue;
        }
        const source = hasOwn(changes, key) ? changes : original;
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor) {
          continue;
        }
        if ('value' in descriptor) {
          Object.defineProperty(target, key, { ...descriptor, configurable: true });
        } else {
          const getter = descriptor.get;
          let replaced = false;
          let replacement: unknown;
          const bound: PropertyDescriptor = { ...descriptor, configurable: true };
          if (getter) {
            bound.get = () => (replaced ? replacement : getter.call(source));
          }
          // Wrapper writes remain local even when the source has an accessor setter.
          if (descriptor.set) {
            bound.set = (value) => {
              replaced = true;
              replacement = value;
            };
          }
          Object.defineProperty(target, key, bound);
        }
      }
      return Reflect.preventExtensions(target);
    },
  });
}

/** One active owner per helper. Closing admission never waits on caller callbacks. */
export class RunnerLifecycle {
  private state: 'open' | 'busy' | 'draining' | 'closed' = 'open';

  enter(): void {
    if (this.state !== 'open') {
      throw new TypeError(this.state === 'busy' ? 'Helper is busy.' : 'Helper is closed.');
    }
    this.state = 'busy';
  }

  leave(): void {
    this.state = this.state === 'draining' ? 'closed' : 'open';
  }

  close() {
    this.state = this.state === 'busy' || this.state === 'draining' ? 'draining' : 'closed';
    return { status: this.state };
  }
}

/** Recognize local Object.prototype and foreign bases with intact native constructor metadata. */
// oxlint-disable-next-line anti-slop/no-object-parameters -- This boundary inspects arbitrary prototype owners before reading configured fields.
export function isObjectPrototype(value: object): boolean {
  if (value === Object.prototype) {
    return true;
  }
  if (Object.getPrototypeOf(value) !== null) {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'constructor');
  if (!descriptor || !hasOwn(descriptor, 'value')) {
    return false;
  }
  const constructor: unknown = descriptor.value;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A prototype descriptor is untrusted until its constructor is callable and matches the native Object contract.
  if (typeof constructor !== 'function') {
    return false;
  }
  const prototype = Object.getOwnPropertyDescriptor(constructor, 'prototype');
  return (
    prototype !== undefined &&
    hasOwn(prototype, 'value') &&
    prototype.value === value &&
    Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
  );
}

/** Read configured fields before recognized native base prototypes; reuse captured own getters. */
export function configuredOption<T extends object, K extends keyof T>(
  options: T,
  key: K,
  copied?: T,
): T[K] | undefined {
  let owner: object | null = options;
  while (owner !== null && !isObjectPrototype(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      return owner === options && descriptor.enumerable && copied ? copied[key] : options[key];
    }
    // SAFETY: Object.getPrototypeOf returns the object's prototype or null.
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

export function continuationRequestOptions(
  client: OpenAI,
  options: RequestOptions | undefined,
  signal: AbortSignal | undefined,
) {
  const headers = buildHeaders([
    options && Object.getOwnPropertyDescriptor(options, 'headers')?.enumerable ? options.headers : undefined,
  ]);
  const effectiveHeaders = buildHeaders([client['_options'].defaultHeaders, headers]);
  const idempotencyKey =
    options && Object.getOwnPropertyDescriptor(options, 'idempotencyKey')?.enumerable
      ? options.idempotencyKey
      : undefined;
  if (!idempotencyKey && !effectiveHeaders.values.has('idempotency-key')) {
    if (options === undefined && signal === undefined) {
      return;
    }
    const captured = { signal };
    // Preserve the fields that native create would omit when spreading the caller's options.
    for (const [key, value] of [
      ['headers', headers],
      ['idempotencyKey', idempotencyKey],
    ] as const) {
      Object.defineProperty(captured, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: options ? Boolean(Object.getOwnPropertyDescriptor(options, key)?.enumerable) : false,
      });
    }
    return overlayRequestOptions(options, captured);
  }
  const key = `stainless-node-retry-${uuid4()}`;
  return overlayRequestOptions(options, {
    signal,
    idempotencyKey: key,
    headers: buildHeaders([
      headers,
      ...(effectiveHeaders.values.has('idempotency-key') ? [{ 'idempotency-key': key }] : []),
    ]),
  });
}

// Walk only captured or parsed helper-owned replay and projected continuation data.
// oxlint-disable-next-line anti-slop/no-object-parameters -- Native JSON here contains heterogeneous helper-owned records and arrays.
export function protectRunnerJSON(value: object): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  for (const record of pending) {
    const prototype: object | null = Object.getPrototypeOf(record);
    if (
      seen.has(record) ||
      (!Array.isArray(record) && prototype !== Object.prototype && prototype !== null)
    ) {
      continue;
    }
    // Keep built-in JSON conversion (for example Date) and let the native encoder reject any cycle.
    seen.add(record);
    if (!hasOwn(record, 'toJSON')) {
      Object.defineProperty(record, 'toJSON', { value: undefined, writable: true, configurable: true });
    }
    const entries: unknown[] = Object.values(record);
    for (const entry of entries) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Traverse only object-valued native JSON fields; the encoder validates the remaining values.
      if (entry !== null && typeof entry === 'object') {
        pending.push(entry);
      }
    }
  }
}
