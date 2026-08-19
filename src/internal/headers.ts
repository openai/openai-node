import { assertAzureCredentialHeaderValue, isAzureAuthenticationHeader } from './azure';
import { isReadonlyArray } from './utils/values';

type HeaderValue = string | undefined | null;
export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');
const httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * @internal
 * Users can pass explicit nulls to unset default headers. When we parse them
 * into a standard headers type we need to preserve that information.
 */
export type NullableHeaders = {
  /** Brand check, prevent users from creating a NullableHeaders. */
  [brand_privateNullableHeaders]: true;
  /** Parsed headers. */
  values: Headers;
  /** Set of lowercase header names explicitly set to null. */
  nulls: Set<string>;
};

type AzureAuthenticationValues = ReadonlyArray<HeadersLike>;

// Object-identity branding cannot be forged by caller-provided header records.
const azureAuthenticationHeaders = new WeakMap<NullableHeaders, AzureAuthenticationValues>();

/**
 * Creates an authenticated Azure header carrier without first appending a raw
 * credential to native Headers, where rejected values appear in diagnostics.
 */
export const buildAzureAuthenticationHeaders = (...headers: AzureAuthenticationValues): NullableHeaders => {
  const carrier: NullableHeaders = {
    [brand_privateNullableHeaders]: true,
    values: new Headers(),
    nulls: new Set<string>(),
  };
  azureAuthenticationHeaders.set(carrier, headers);
  return carrier;
};

function* iterateHeaders(headers: HeadersLike): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    const visibleNames = new Set([...values.keys(), ...nulls].map((name) => name.toLowerCase()));
    const azureHeaders = azureAuthenticationHeaders.get(headers);
    if (azureHeaders !== undefined) {
      for (const layer of azureHeaders) {
        const seen = new Set<string>();
        for (const [name, value] of iterateHeaders(layer)) {
          const normalized = name.toLowerCase();
          if (visibleNames.has(normalized)) continue;
          if (!seen.has(normalized)) {
            seen.add(normalized);
            yield [name, null];
          }
          yield [name, value];
        }
      }
    }
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<readonly (HeaderValue | readonly HeaderValue[])[]>;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === undefined) continue;

      // Objects keys always overwrite older headers, they never append.
      // Yield a null to clear the header before adding the new values.
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}

/** Validates only the final authentication values without native construction. */
export const assertAzureAuthenticationHeaders = (headers: HeadersLike): void => {
  for (const [name, value] of iterateHeaders(headers)) {
    if (value !== null && isAzureAuthenticationHeader(name)) {
      assertAzureCredentialHeaderValue(value);
    }
  }
};

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  const protectsAzureCredentials = newHeaders.some(
    (headers) =>
      typeof headers === 'object' &&
      headers !== null &&
      azureAuthenticationHeaders.has(headers as NullableHeaders),
  );
  const pendingAuthenticationHeaders = new Map<string, string[]>();

  for (const headers of newHeaders) {
    const seenHeaders = new Set<string>();
    for (const [name, value] of iterateHeaders(headers)) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      const deferAuthenticationHeader = protectsAzureCredentials && isAzureAuthenticationHeader(lowerName);
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        nullHeaders.add(lowerName);
      } else {
        if (deferAuthenticationHeader) {
          const pending = pendingAuthenticationHeaders.get(lowerName);
          if (pending) {
            pending.push(value);
          } else {
            pendingAuthenticationHeaders.set(lowerName, [value]);
          }
        } else {
          targetHeaders.append(lowerName, value);
        }
        nullHeaders.delete(lowerName);
      }
    }
  }
  for (const values of pendingAuthenticationHeaders.values()) {
    for (const value of values) {
      assertAzureCredentialHeaderValue(value);
    }
  }
  for (const [name, values] of pendingAuthenticationHeaders) {
    for (const value of values) {
      targetHeaders.append(name, value);
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};
