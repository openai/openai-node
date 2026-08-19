import { RFC1738 } from './formats';
import type { DefaultEncoder, Format } from './types';
import { isArray } from '../utils/values';

let cachedHas: ((obj: object, key: PropertyKey) => boolean) | undefined;

export const has = (obj: object, key: PropertyKey): boolean => {
  const resolvedHas: (obj: object, key: PropertyKey) => boolean =
    cachedHas ?? (Object as any).hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  cachedHas = resolvedHas;
  return resolvedHas(obj, key);
};

function isUnsafePropertyKey(key: unknown): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

interface AdoptedRecord {
  value: object;
  descriptors: PropertyDescriptorMap;
  keys: PropertyKey[];
  prototype: object | null;
  parents: Set<AdoptedRecord>;
  ordinary: boolean;
  array: boolean;
  detached: boolean;
  unsafe: boolean;
  extensible: boolean;
}

interface MergeState {
  adopted: { target: object; key: PropertyKey }[];
  preparedTargets: WeakMap<object, Map<PropertyKey, any>>;
  preparedSources: WeakMap<object, WeakMap<object, object>>;
  inspectedSources: number;
  inspectedSourceProperties: number;
}

const maxAdoptedRecords = 10_000;

function isIntrinsicFunctionPrototype(
  value: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): boolean {
  return (
    typeof value === 'function' && key === 'prototype' && !descriptor.enumerable && !descriptor.configurable
  );
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function rememberAdoption(state: MergeState, target: object, key: PropertyKey, value: any): void {
  if (!isObjectLike(value)) {
    return;
  }
  if (state.adopted.length >= maxAdoptedRecords) {
    throw new Error('Adopted record traversal exceeds the supported safety limit.');
  }
  state.adopted.push({ target, key });
}

function sanitizeAdoptions(state: MergeState): void {
  if (state.adopted.length === 0) {
    return;
  }

  const records = new WeakMap<object, AdoptedRecord>();
  const visited: AdoptedRecord[] = [];
  const locations: {
    target: object;
    key: PropertyKey;
    descriptor: PropertyDescriptor;
    record: AdoptedRecord;
  }[] = [];
  let inspectedProperties = 0;

  function inspect(value: object): AdoptedRecord {
    const known = records.get(value);
    if (known) {
      return known;
    }
    if (visited.length >= maxAdoptedRecords) {
      throw new Error('Adopted record traversal exceeds the supported safety limit.');
    }

    const keys = Reflect.ownKeys(value);
    if (keys.length > maxAdoptedRecords - inspectedProperties) {
      throw new Error('Adopted record traversal exceeds the supported safety limit.');
    }
    inspectedProperties += keys.length;
    const descriptors: PropertyDescriptorMap = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor) {
        Reflect.set(descriptors, key, descriptor);
      }
    }
    const prototype = Object.getPrototypeOf(value);
    const array = isArray(value);
    const extensible = Object.isExtensible(value);
    const ordinary =
      typeof value !== 'function' &&
      (array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
    const record: AdoptedRecord = {
      value,
      descriptors,
      keys,
      prototype,
      parents: new Set(),
      ordinary,
      array,
      detached: ordinary && (extensible || !Object.isFrozen(value)),
      unsafe: false,
      extensible,
    };
    records.set(value, record);
    visited.push(record);
    return record;
  }

  for (const { target, key } of state.adopted) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && 'value' in descriptor && isObjectLike(descriptor.value)) {
      locations.push({ target, key, descriptor, record: inspect(descriptor.value) });
    }
  }

  const detached: AdoptedRecord[] = [];
  for (const record of visited) {
    for (const key of record.keys) {
      const descriptor = Reflect.get(record.descriptors, key) as PropertyDescriptor | undefined;
      if (!descriptor) {
        continue;
      }
      if (isUnsafePropertyKey(key)) {
        if (record.ordinary) {
          record.detached = true;
          record.unsafe = true;
        } else if (!isIntrinsicFunctionPrototype(record.value, key, descriptor)) {
          throw new TypeError('Cannot safely sanitize an adopted callable or unsupported prototype.');
        }
        continue;
      }
      if (!record.ordinary && !descriptor.enumerable) {
        continue;
      }
      if ('value' in descriptor && isObjectLike(descriptor.value)) {
        inspect(descriptor.value).parents.add(record);
      }
    }
    if (record.detached) {
      detached.push(record);
    }
  }

  for (let index = visited.length - 1; index >= 0; index -= 1) {
    const record = visited[index]!;
    if (record.ordinary) {
      continue;
    }
    for (const key of ['__proto__', 'constructor', 'prototype'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(record.value, key);
      if (descriptor && !isIntrinsicFunctionPrototype(record.value, key, descriptor)) {
        throw new TypeError('Cannot safely sanitize an adopted callable or unsupported prototype.');
      }
    }
  }

  const unsafe = visited.filter((record) => record.unsafe);
  for (const record of unsafe) {
    for (const parent of record.parents) {
      if (!parent.ordinary) {
        throw new TypeError('Cannot safely sanitize an adopted callable or unsupported prototype.');
      }
      if (!parent.unsafe) {
        parent.unsafe = true;
        unsafe.push(parent);
      }
    }
  }

  for (const record of detached) {
    for (const parent of record.parents) {
      if (!parent.ordinary) {
        continue;
      }
      if (!parent.detached) {
        parent.detached = true;
        detached.push(parent);
      }
    }
  }

  const copies = new WeakMap<object, any>();
  for (const record of detached) {
    copies.set(record.value, record.array ? [] : Object.create(record.prototype));
  }
  for (const record of detached) {
    const copy = copies.get(record.value);
    for (const key of record.keys) {
      if (isUnsafePropertyKey(key)) {
        continue;
      }
      const descriptor = Reflect.get(record.descriptors, key) as PropertyDescriptor | undefined;
      if (!descriptor) {
        continue;
      }
      if ('value' in descriptor && isObjectLike(descriptor.value) && copies.has(descriptor.value)) {
        descriptor.value = copies.get(descriptor.value);
      }
      Object.defineProperty(copy, key, descriptor);
    }
  }

  for (const { target, key, descriptor, record } of locations) {
    const value = copies.get(record.value) ?? record.value;
    if (value !== descriptor.value) {
      Object.defineProperty(copies.get(target) ?? target, key, { ...descriptor, value });
    }
  }

  for (const record of detached) {
    if (!record.extensible) {
      Object.preventExtensions(copies.get(record.value));
    }
  }
}

function readPreparedTarget(state: MergeState, target: any, key: PropertyKey): any {
  const prepared = state.preparedTargets.get(target);
  if (prepared?.has(key)) {
    const value = prepared.get(key);
    prepared.delete(key);
    return value;
  }
  return target[key];
}

function previewTarget(state: MergeState, target: object, key: PropertyKey): any {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && 'value' in descriptor) {
    return descriptor.value;
  }

  const value = Reflect.get(target, key, target);
  let prepared = state.preparedTargets.get(target);
  if (!prepared) {
    prepared = new Map();
    state.preparedTargets.set(target, prepared);
  }
  prepared.set(key, value);
  return value;
}

function prepareMergeSource(target: any, source: any, state: MergeState, assign = false): any {
  if (!source || typeof source !== 'object' || !target || typeof target !== 'object') {
    return source;
  }

  let preparedTargets = state.preparedSources.get(source);
  if (!preparedTargets) {
    preparedTargets = new WeakMap();
    state.preparedSources.set(source, preparedTargets);
  }
  const existing = preparedTargets.get(target);
  if (existing) {
    return existing;
  }
  state.inspectedSources += 1;
  if (state.inspectedSources > maxAdoptedRecords) {
    throw new Error('Adopted record traversal exceeds the supported safety limit.');
  }

  const sourceKeys = Reflect.ownKeys(source);
  if (sourceKeys.length > maxAdoptedRecords - state.inspectedSourceProperties) {
    throw new Error('Adopted record traversal exceeds the supported safety limit.');
  }
  state.inspectedSourceProperties += sourceKeys.length;
  const sourceIsArray = isArray(source);
  const prepared: Record<string, any> = sourceIsArray ? [] : Object.create(null);
  preparedTargets.set(target, prepared);

  if (isArray(target) && sourceIsArray && !assign) {
    const sourceLength = source.length;
    (prepared as any[]).length = sourceLength;
    for (let index = 0; index < sourceLength; index += 1) {
      if (!(index in source)) {
        continue;
      }
      const value = source[index];
      if (has(target, index)) {
        const targetValue = previewTarget(state, target, index);
        prepared[index] =
          targetValue && typeof targetValue === 'object' && value && typeof value === 'object'
            ? prepareMergeSource(targetValue, value, state)
            : value;
      } else {
        prepared[index] = value;
      }
    }
    return prepared;
  }

  const enumerableKeys: string[] = [];
  for (const key of sourceKeys) {
    if (typeof key === 'string' && Object.getOwnPropertyDescriptor(source, key)?.enumerable) {
      enumerableKeys.push(key);
    }
  }
  for (const key of enumerableKeys) {
    if (isUnsafePropertyKey(key)) {
      continue;
    }
    const value = source[key];
    prepared[key] =
      !assign && has(target, key) && value && typeof value === 'object'
        ? prepareMergeSource(previewTarget(state, target, key), value, state)
        : value;
  }
  return prepared;
}

function prepareSource(target: any, source: any, state: MergeState, assign = false): any {
  const holder = { value: prepareMergeSource(target, source, state, assign) };
  rememberAdoption(state, holder, 'value', holder.value);
  sanitizeAdoptions(state);
  return holder.value;
}

const hex_table = /* @__PURE__ */ (() => {
  const array = [];
  for (let i = 0; i < 256; ++i) {
    array.push('%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase());
  }

  return array;
})();

function compact_queue<T extends Record<string, any>>(queue: { obj: T; prop: string }[]) {
  while (queue.length > 1) {
    const item = queue.pop();
    if (!item) {
      continue;
    }

    const obj = item.obj[item.prop];

    if (isArray(obj)) {
      const compacted: unknown[] = [];

      for (const value of obj) {
        if (value !== undefined) {
          compacted.push(value);
        }
      }

      // @ts-ignore
      item.obj[item.prop] = compacted;
    }
  }
}

function array_to_object(source: any[], options: { plainObjects: boolean }) {
  const obj = options && options.plainObjects ? Object.create(null) : {};
  for (let i = 0; i < source.length; ++i) {
    if (source[i] !== undefined) {
      obj[i] = source[i];
    }
  }

  return obj;
}

function mergeWithState(
  target: any,
  source: any,
  options: { plainObjects?: boolean; allowPrototypes?: boolean },
  state: MergeState,
): any {
  if (!source) {
    return target;
  }

  if (typeof source !== 'object') {
    if (isArray(target)) {
      target.push(source);
    } else if (target && typeof target === 'object') {
      const propertyKey =
        typeof source === 'string' || typeof source === 'symbol'
          ? source
          : Reflect.ownKeys({ [source]: true })[0]!;
      if (
        !isUnsafePropertyKey(propertyKey) &&
        ((options && (options.plainObjects || options.allowPrototypes)) ||
          !has(Object.prototype, propertyKey))
      ) {
        target[propertyKey] = true;
      }
    } else {
      return [target, source];
    }

    return target;
  }

  if (!target || typeof target !== 'object') {
    // oxlint-disable-next-line unicorn/prefer-spread -- concat intentionally preserves one-level flattening and sparse-array behavior.
    return [target].concat(source);
  }

  let mergeTarget = target;
  if (isArray(target) && !isArray(source)) {
    // @ts-ignore
    mergeTarget = array_to_object(target, options);
  }

  if (isArray(target) && isArray(source)) {
    const sourceLength = source.length;
    for (let i = 0; i < sourceLength; i += 1) {
      if (i in source) {
        const item = source[i];
        if (has(target, i)) {
          const targetItem = readPreparedTarget(state, target, i);
          if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
            const merged = mergeWithState(targetItem, item, options, state);
            target[i] = merged;
          } else {
            const adopted = item;
            target.push(adopted);
          }
        } else {
          const adopted = item;
          target[i] = adopted;
        }
      }
    }
    return target;
  }

  for (const key of Object.keys(source)) {
    if (isUnsafePropertyKey(key)) {
      continue;
    }
    const value = source[key];
    const adopted = has(mergeTarget, key)
      ? mergeWithState(readPreparedTarget(state, mergeTarget, key), value, options, state)
      : value;
    mergeTarget[key] = adopted;
  }
  return mergeTarget;
}

export function merge(
  target: any,
  source: any,
  options: { plainObjects?: boolean; allowPrototypes?: boolean } = {},
) {
  const state: MergeState = {
    adopted: [],
    preparedTargets: new WeakMap(),
    preparedSources: new WeakMap(),
    inspectedSources: 0,
    inspectedSourceProperties: 0,
  };
  return mergeWithState(target, prepareSource(target, source, state), options, state);
}

export function assign_single_source(target: any, source: any) {
  const state: MergeState = {
    adopted: [],
    preparedTargets: new WeakMap(),
    preparedSources: new WeakMap(),
    inspectedSources: 0,
    inspectedSourceProperties: 0,
  };
  const prepared = prepareSource(target, source, state, true);
  for (const key of Object.keys(prepared)) {
    if (isUnsafePropertyKey(key)) {
      continue;
    }
    target[key] = prepared[key];
  }
  return target;
}

export function decode(str: string, _: any, charset: string) {
  const strWithoutPlus = str.replace(/\+/g, ' ');
  if (charset === 'iso-8859-1') {
    // unescape never throws, no try...catch needed:
    return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
  }
  // utf-8
  try {
    return decodeURIComponent(strWithoutPlus);
  } catch {
    return strWithoutPlus;
  }
}

const limit = 1024;

export const encode: (
  str: any,
  defaultEncoder: DefaultEncoder,
  charset: string,
  type: 'key' | 'value',
  format: Format,
) => string = (str, _defaultEncoder, charset, _kind, format: Format) => {
  // This code was originally written by Brian White for the io.js core querystring library.
  // It has been adapted here for stricter adherence to RFC 3986
  if (str.length === 0) {
    return str;
  }

  let string = str;
  if (typeof str === 'symbol') {
    string = Symbol.prototype.toString.call(str);
  } else if (typeof str !== 'string') {
    string = String(str);
  }

  if (charset === 'iso-8859-1') {
    return escape(string).replace(
      /%u[0-9a-f]{4}/gi,
      ($0) => '%26%23' + Number.parseInt($0.slice(2), 16) + '%3B',
    );
  }

  let out = '';
  for (let j = 0; j < string.length;) {
    let segmentEnd = Math.min((Math.floor(j / limit) + 1) * limit, string.length);

    if (segmentEnd < string.length && string.codePointAt(segmentEnd - 1)! > 0xff_ff) {
      segmentEnd += 1;
    }

    const segment = string.length >= limit ? string.slice(j, segmentEnd) : string;
    const arr = [];

    for (let i = 0; i < segment.length; ++i) {
      // oxlint-disable-next-line unicorn/prefer-code-point -- combine UTF-16 surrogate code units below
      let c = segment.charCodeAt(i);
      if (
        c === 0x2d || // -
        c === 0x2e || // .
        c === 0x5f || // _
        c === 0x7e || // ~
        (c >= 0x30 && c <= 0x39) || // 0-9
        (c >= 0x41 && c <= 0x5a) || // a-z
        (c >= 0x61 && c <= 0x7a) || // A-Z
        (format === RFC1738 && (c === 0x28 || c === 0x29)) // ( )
      ) {
        arr[arr.length] = segment.charAt(i);
        continue;
      }

      if (c < 0x80) {
        arr[arr.length] = hex_table[c];
        continue;
      }

      if (c < 0x8_00) {
        arr[arr.length] = hex_table[0xc0 | (c >> 6)]! + hex_table[0x80 | (c & 0x3f)];
        continue;
      }

      if (c < 0xd8_00 || c >= 0xe0_00) {
        arr[arr.length] =
          hex_table[0xe0 | (c >> 12)]! + hex_table[0x80 | ((c >> 6) & 0x3f)] + hex_table[0x80 | (c & 0x3f)];
        continue;
      }

      i += 1;
      // oxlint-disable-next-line unicorn/prefer-code-point -- combine UTF-16 surrogate code units manually
      c = 0x1_00_00 + (((c & 0x3_ff) << 10) | (segment.charCodeAt(i) & 0x3_ff));

      arr[arr.length] =
        hex_table[0xf0 | (c >> 18)]! +
        hex_table[0x80 | ((c >> 12) & 0x3f)] +
        hex_table[0x80 | ((c >> 6) & 0x3f)] +
        hex_table[0x80 | (c & 0x3f)];
    }

    out += arr.join('');
    j = segmentEnd;
  }

  return out;
};

export function compact(value: any) {
  const queue = [{ obj: { o: value }, prop: 'o' }];
  const refs: object[] = [];

  for (const item of queue) {
    // @ts-ignore
    const obj = item.obj[item.prop];

    const keys = Object.keys(obj);
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'object' && val !== null && !refs.includes(val)) {
        queue.push({ obj, prop: key });
        refs.push(val);
      }
    }
  }

  compact_queue(queue);

  return value;
}

export function is_regexp(obj: any) {
  return Object.prototype.toString.call(obj) === '[object RegExp]';
}

export function is_buffer(obj: any) {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}

export function combine(a: any, b: any) {
  // oxlint-disable-next-line unicorn/prefer-spread -- concat intentionally preserves one-level flattening and sparse-array behavior.
  return [].concat(a, b);
}

export function maybe_map<T>(val: T[], fn: (v: T) => T) {
  if (isArray(val)) {
    const mapped = [];
    for (const item of val) {
      mapped.push(fn(item));
    }
    return mapped;
  }
  return fn(val);
}
