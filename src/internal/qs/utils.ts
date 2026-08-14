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

export function merge(
  target: any,
  source: any,
  options: { plainObjects?: boolean; allowPrototypes?: boolean } = {},
) {
  if (!source) {
    return target;
  }

  if (typeof source !== 'object') {
    if (isArray(target)) {
      target.push(source);
    } else if (target && typeof target === 'object') {
      if ((options && (options.plainObjects || options.allowPrototypes)) || !has(Object.prototype, source)) {
        target[source] = true;
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
          const targetItem = target[i];
          if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
            target[i] = merge(targetItem, item, options);
          } else {
            target.push(item);
          }
        } else {
          target[i] = item;
        }
      }
    }
    return target;
  }

  for (const key of Object.keys(source)) {
    const value = source[key];

    mergeTarget[key] = has(mergeTarget, key) ? merge(mergeTarget[key], value, options) : value;
  }
  return mergeTarget;
}

export function assign_single_source(target: any, source: any) {
  for (const key of Object.keys(source)) {
    target[key] = source[key];
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
