import { vi } from 'vitest';

import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { HeadersLike } from 'openai/internal/headers';

const BASE_URL = 'https://azure-resource.example.com/openai';
const API_VERSION = '2024-02-15-preview';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';

describe('Azure authentication header occurrence snapshots', () => {
  const repeatedCredentialCases = (['get', 'post'] as const).flatMap((method) =>
    (['api-key', 'Authorization'] as const).flatMap((name) =>
      (['tuple entries', 'record array'] as const).map((representation) => ({
        method,
        name,
        representation,
      })),
    ),
  );

  test.each(repeatedCredentialCases)(
    'snapshots repeated $method $name credentials independently in $representation',
    async ({ method, name, representation }) => {
      let coercions = 0;
      const credential = {
        toString(): string {
          coercions += 1;
          return coercions === 1 ? 'tenant-a-token' : 'tenant-b-token';
        },
      };
      let headers: HeadersLike;
      if (representation === 'tuple entries') {
        const tuples: [string, string][] = [
          [name, 'first-placeholder'],
          [name, 'second-placeholder'],
        ];
        for (const tuple of tuples) {
          Object.defineProperty(tuple, 1, { value: credential });
        }
        headers = tuples;
      } else {
        const record: Record<string, readonly string[]> = {};
        Object.defineProperty(record, name, {
          enumerable: true,
          value: [credential, credential],
        });
        headers = record;
      }

      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('tenant-a-token, tenant-b-token');
      expect(coercions).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'snapshots the effective %s credential before probing a later tuple metadata value',
    async (name) => {
      let effective = 'tenant-a-token';
      let coercions = 0;
      let metadataReads = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, name, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            return effective;
          },
        },
      });

      const metadata: [string, string] = ['x-metadata', 'placeholder'];
      Object.defineProperty(metadata, 1, {
        configurable: true,
        enumerable: true,
        get(): string {
          metadataReads += 1;
          effective = 'tenant-b-token';
          return 'preserved';
        },
      });

      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method: 'get',
        path: '/models',
        headers: [metadata],
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(name)).toBe('tenant-a-token');
      expect(sent.get('x-metadata')).toBe('preserved');
      expect(coercions).toBe(1);
      expect(metadataReads).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'does not coerce a %s credential shadowed by a case-insensitive tuple accessor',
    async (name) => {
      let coercions = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, name, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            throw new Error('private-shadowed-tenant-token');
          },
        },
      });

      const replacement: [string, string] = [name.toUpperCase(), 'placeholder'];
      Object.defineProperty(replacement, 1, {
        configurable: true,
        enumerable: true,
        get: () => 'effective-tenant-token',
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: [replacement] });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('effective-tenant-token');
      expect(coercions).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'ignores undefined values and array holes when probing later %s tuple overrides',
    async (name) => {
      let effective = 'tenant-a-token';
      let coercions = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, name, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            return effective;
          },
        },
      });

      const emptyValues = [undefined, undefined, undefined];
      Reflect.deleteProperty(emptyValues, 1);
      const ignoredOverride: [string, string] = [name.toUpperCase(), 'placeholder'];
      Object.defineProperty(ignoredOverride, 1, { value: emptyValues });
      const metadata: [string, string] = ['x-metadata', 'placeholder'];
      Object.defineProperty(metadata, 1, {
        configurable: true,
        enumerable: true,
        get(): string {
          effective = 'tenant-b-token';
          return 'preserved';
        },
      });

      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: [ignoredOverride, metadata] });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('tenant-a-token');
      expect(coercions).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'recognizes an inherited %s tuple-array accessor without coercing its shadowed credential',
    async (name) => {
      let coercions = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, name, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            throw new Error('private-shadowed-tenant-token');
          },
        },
      });

      const values = ['placeholder'];
      Reflect.deleteProperty(values, 0);
      const inherited = Object.create(Array.prototype) as object;
      Object.defineProperty(inherited, 0, {
        configurable: true,
        get: () => 'effective-tenant-token',
      });
      Object.setPrototypeOf(values, inherited);
      const replacement: [string, string] = [name.toUpperCase(), 'placeholder'];
      Object.defineProperty(replacement, 1, { value: values });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: [replacement] });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('effective-tenant-token');
      expect(coercions).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['tuple value', 'array element'] as const)(
    'sanitizes an untrusted %s descriptor that prevents proving credential precedence',
    async (representation) => {
      const privateCredential = 'private-proxy-descriptor-tenant-token';
      const values = new Proxy(['safe-tenant-token'], {
        getOwnPropertyDescriptor(target, property) {
          if (representation === 'array element' && property === '0') {
            throw new Error(privateCredential);
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      const target: [string, string] = ['api-key', 'placeholder'];
      Object.defineProperty(target, 1, { value: values });
      const entry = new Proxy(target, {
        getOwnPropertyDescriptor(tuple, property) {
          if (representation === 'tuple value' && property === '1') {
            throw new Error(privateCredential);
          }
          return Reflect.getOwnPropertyDescriptor(tuple, property);
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        fetch,
        maxRetries: 0,
      });

      let failure: unknown;
      try {
        await client.request({ method: 'get', path: '/models', headers: [entry] });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TypeError);
      if (!(failure instanceof TypeError)) {
        throw new Error('Expected a sanitized Azure credential failure.');
      }
      expect(failure.message).toBe(SAFE_ERROR);
      expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();
      expect(failure.stack).not.toContain(privateCredential);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
