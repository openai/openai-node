// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { Fetch, Headers } from './types';
import { hasOwn } from './utils';

export const createResponseHeaders = (
  headers: Awaited<ReturnType<Fetch>>['headers'],
): Record<string, string> => {
  return new Proxy(
    Object.fromEntries(
      // @ts-ignore
      headers.entries(),
    ),
    {
      get(target, name) {
        const key = name.toString();
        return target[key.toLowerCase()] || target[key];
      },
    },
  );
};

/**
 * Copies headers from "newHeaders" onto "targetHeaders",
 * using lower-case for all properties,
 * ignoring any keys with undefined values,
 * and deleting any keys with null values.
 */
export function applyHeadersMut(targetHeaders: Headers, newHeaders: Headers): void {
  for (const k in newHeaders) {
    if (!hasOwn(newHeaders, k)) continue;
    const lowerKey = k.toLowerCase();
    if (!lowerKey) continue;

    const val = newHeaders[k];

    if (val === null) {
      delete targetHeaders[lowerKey];
    } else if (val !== undefined) {
      targetHeaders[lowerKey] = val;
    }
  }
}

export interface HeadersProtocol {
  get: (header: string) => string | null | undefined;
}
export type HeadersLike = Record<string, string | string[] | undefined> | HeadersProtocol;

export const isHeadersProtocol = (headers: any): headers is HeadersProtocol => {
  return typeof headers?.get === 'function';
};

export const getRequiredHeader = (headers: HeadersLike, header: string): string => {
  const lowerCasedHeader = header.toLowerCase();
  if (isHeadersProtocol(headers)) {
    // to deal with the case where the header looks like Stainless-Event-Id
    const intercapsHeader =
      header[0]?.toUpperCase() +
      header.substring(1).replace(/([^\w])(\w)/g, (_m, g1, g2) => g1 + g2.toUpperCase());
    for (const key of [header, lowerCasedHeader, header.toUpperCase(), intercapsHeader]) {
      const value = headers.get(key);
      if (value) {
        return value;
      }
    }
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerCasedHeader) {
      if (Array.isArray(value)) {
        if (value.length <= 1) return value[0];
        console.warn(`Received ${value.length} entries for the ${header} header, using the first entry.`);
        return value[0];
      }
      return value;
    }
  }

  throw new Error(`Could not find ${header} header`);
};
