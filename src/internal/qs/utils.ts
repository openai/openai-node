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
  prototype: object | null;
  parents: Set<AdoptedRecord>;
  ordinary: boolean;
  array: boolean;
  detached: boolean;
}

interface MergeState {
  adopted: { target: object; key: PropertyKey }[];
}

const maxAdoptedRecords = 10_000;

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

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const prototype = Object.getPrototypeOf(value);
    const array = isArray(value);
    const ordinary =
      typeof value !== 'function' &&
      (array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
    const record: AdoptedRecord = {
      value,
      descriptors,
      prototype,
      parents: new Set(),
      ordinary,
      array,
      detached: ordinary && !Object.isFrozen(value),
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
    for (const key of Reflect.ownKeys(record.descriptors)) {
      inspectedProperties += 1;
      if (inspectedProperties > maxAdoptedRecords) {
        throw new Error('Adopted record traversal exceeds the supported safety limit.');
      }
      const descriptor = Reflect.get(record.descriptors, key) as PropertyDescriptor;
      if (isUnsafePropertyKey(key)) {
        if (record.ordinary) {
          record.detached = true;
        } else if (descriptor.enumerable) {
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

  for (const record of detached) {
    for (const parent of record.parents) {
      if (!parent.ordinary) {
        throw new TypeError('Cannot safely sanitize an adopted callable or unsupported prototype.');
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
    for (const key of Reflect.ownKeys(record.descriptors)) {
      if (isUnsafePropertyKey(key)) {
        continue;
      }
      const descriptor = Reflect.get(record.descriptors, key) as PropertyDescriptor;
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
      if (
        !isUnsafePropertyKey(source) &&
        ((options && (options.plainObjects || options.allowPrototypes)) || !has(Object.prototype, source))
      ) {
        target[source] = true;
      }
    } else {
      return [target, source];
    }

    return target;
  }

  if (!target || typeof target !== 'object') {
    // oxlint-disable-next-line unicorn/prefer-spread -- concat intentionally preserves one-level flattening and sparse-array behavior.
    const combined = [target].concat(source);
    for (const [index, item] of combined.entries()) {
      rememberAdoption(state, combined, index, item);
    }
    return combined;
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
          const targetItem = target[i];
          if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
            const merged = mergeWithState(targetItem, item, options, state);
            target[i] = merged;
            rememberAdoption(state, target, i, merged);
          } else {
            const adopted = item;
            target.push(adopted);
            rememberAdoption(state, target, target.length - 1, adopted);
          }
        } else {
          const adopted = item;
          target[i] = adopted;
          rememberAdoption(state, target, i, adopted);
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
    const adopted = has(mergeTarget, key) ? mergeWithState(mergeTarget[key], value, options, state) : value;
    mergeTarget[key] = adopted;
    rememberAdoption(state, mergeTarget, key, adopted);
  }
  return mergeTarget;
}

export function merge(
  target: any,
  source: any,
  options: { plainObjects?: boolean; allowPrototypes?: boolean } = {},
) {
  const state: MergeState = { adopted: [] };
  const result = mergeWithState(target, source, options, state);
  sanitizeAdoptions(state);
  return result;
}

export function assign_single_source(target: any, source: any) {
  const state: MergeState = { adopted: [] };
  for (const key of Object.keys(source)) {
    if (isUnsafePropertyKey(key)) {
      continue;
    }
    const value = source[key];
    target[key] = value;
    rememberAdoption(state, target, key, value);
  }
  sanitizeAdoptions(state);
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
