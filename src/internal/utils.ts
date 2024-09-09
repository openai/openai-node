// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { OpenAIError } from '../error';

declare const Deno: any;

/** Returns an object if the given value isn't an object, otherwise returns as-is */
export function maybeObj(x: unknown): object {
  if (typeof x !== 'object') {
    return {};
  }

  return x ?? {};
}

// https://stackoverflow.com/a/34491287
export function isEmptyObj(obj: Object | null | undefined): boolean {
  if (!obj) return true;
  for (const _k in obj) return false;
  return true;
}

// https://eslint.org/docs/latest/rules/no-prototype-builtins
export function hasOwn(obj: Object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function debug(action: string, ...args: any[]) {
  if (typeof process !== 'undefined' && process?.env?.['DEBUG'] === 'true') {
    console.log(`OpenAI:DEBUG:${action}`, ...args);
  }
}

/**
 * https://stackoverflow.com/a/2117523
 */
export const uuid4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Encodes a string to Base64 format.
 */
export const toBase64 = (str: string | null | undefined): string => {
  if (!str) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }

  if (typeof btoa !== 'undefined') {
    return btoa(str);
  }

  throw new OpenAIError('Cannot generate b64 string; Expected `Buffer` or `btoa` to be defined');
};

export function isObj(obj: unknown): obj is Record<string, unknown> {
  return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const castToError = (err: any): Error => {
  if (err instanceof Error) return err;
  if (typeof err === 'object' && err !== null) {
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(err);
};

export const ensurePresent = <T>(value: T | null | undefined): T => {
  if (value == null) {
    throw new OpenAIError(`Expected a value to be given but received ${value} instead.`);
  }

  return value;
};

/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
export const readEnv = (env: string): string | undefined => {
  if (typeof process !== 'undefined') {
    return process.env?.[env]?.trim() ?? undefined;
  }
  if (typeof Deno !== 'undefined') {
    return Deno.env?.get?.(env)?.trim();
  }
  return undefined;
};

export const safeJSON = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
};

// https://stackoverflow.com/a/19709846
const startsWithSchemeRegexp = new RegExp('^(?:[a-z]+:)?//', 'i');

export const isAbsoluteURL = (url: string): boolean => {
  return startsWithSchemeRegexp.test(url);
};

// ---- parsers ----

export const validatePositiveInteger = (name: string, n: unknown): number => {
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new OpenAIError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new OpenAIError(`${name} must be a positive integer`);
  }
  return n;
};

export const coerceInteger = (value: unknown): number => {
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') return parseInt(value, 10);

  throw new OpenAIError(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};

export const coerceFloat = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);

  throw new OpenAIError(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};

export const coerceBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return Boolean(value);
};

export const maybeCoerceInteger = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return coerceInteger(value);
};

export const maybeCoerceFloat = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return coerceFloat(value);
};

export const maybeCoerceBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return coerceBoolean(value);
};
