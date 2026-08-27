import { once } from 'node:events';
import { vi } from 'vitest';

import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildAzureAuthenticationHeaders } from 'openai/internal/headers';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const BASE_URL = 'https://azure-resource.example.com/openai';
const API_VERSION = '2024-02-15-preview';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';
const PRIVATE_CREDENTIAL = 'private-pr2421-carrier-credential-4b9a';
const intrinsicSetDelete = Set.prototype.delete;

class CarrierReviewAzure extends AzureOpenAI {
  suppliedAuthenticationCarrier: NullableHeaders | undefined;
  observeAuthentication:
    | ((options: FinalRequestOptions, carrier: NullableHeaders) => Promise<void> | void)
    | undefined;

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    const carrier = this.suppliedAuthenticationCarrier ?? (await super.authHeaders(options, schemes));
    if (carrier !== undefined) {
      await this.observeAuthentication?.(options, carrier);
    }
    return carrier;
  }
}

function createClient() {
  const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
    globalThis.Response.json({ ok: true }),
  );
  const client = new CarrierReviewAzure({
    baseURL: BASE_URL,
    apiVersion: API_VERSION,
    apiKey: 'configured-tenant-token',
    fetch,
    maxRetries: 0,
  });
  return { client, fetch };
}

describe('Azure request-local authentication carrier review regressions', () => {
  test.each(['get', 'post'] as const)(
    'enumerates a stateful %s request-header proxy exactly once before dispatch',
    async (method) => {
      const { client, fetch } = createClient();
      let enumerations = 0;
      const headers = new Proxy(
        { 'api-key': 'request-tenant-token', 'x-request-metadata': 'preserved' },
        {
          ownKeys(target) {
            enumerations += 1;
            if (enumerations !== 1) {
              throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
            }
            return Reflect.ownKeys(target);
          },
        },
      );

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('request-tenant-token');
      expect(sent.get('x-request-metadata')).toBe('preserved');
      expect(enumerations).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'sanitizes a credential-bearing request proxy %s failure',
    async (operation) => {
      const { client, fetch } = createClient();
      const fail = () => {
        throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
      };
      const headers = new Proxy(
        { 'api-key': 'request-tenant-token' },
        {
          ownKeys(target) {
            return operation === 'ownKeys' ? fail() : Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, name) {
            return operation === 'getOwnPropertyDescriptor' && name === 'api-key'
              ? fail()
              : Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      );

      let failure: unknown;
      try {
        await client.request({ method: 'get', path: '/models', headers });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TypeError);
      if (!(failure instanceof TypeError)) {
        throw new Error('Expected a sanitized Azure credential failure.');
      }
      expect(failure.message).toBe(SAFE_ERROR);
      expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();
      expect(failure.stack).not.toContain(PRIVATE_CREDENTIAL);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('enumerates a shared stateful proxy once for each isolated overlapping request', async () => {
    const { client, fetch } = createClient();
    let enumerations = 0;
    const source = { 'api-key': 'first-tenant-token', 'x-request-metadata': 'first' };
    const headers = new Proxy(source, {
      ownKeys(target) {
        enumerations += 1;
        if (enumerations > 2) {
          throw new Error(PRIVATE_CREDENTIAL);
        }
        return Reflect.ownKeys(target);
      },
    });
    const gates: AbortController[] = [];
    client.observeAuthentication = async () => {
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
    };

    const first = client.request({ method: 'get', path: '/models', headers });
    await vi.waitFor(() => expect(gates).toHaveLength(1), { interval: 1 });
    source['api-key'] = 'second-tenant-token';
    source['x-request-metadata'] = 'second';
    const second = client.request({ method: 'get', path: '/models', headers });
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });

    gates[1]?.abort();
    await second;
    gates[0]?.abort();
    await first;

    expect(enumerations).toBe(2);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('second-tenant-token');
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('api-key')).toBe('first-tenant-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each(['api-key', 'authorization'] as const)(
    'exposes inherited %s tombstones immediately to a captured native Set.delete',
    async (name) => {
      const { client, fetch } = createClient();
      client.suppliedAuthenticationCarrier = buildAzureAuthenticationHeaders({ [name]: null });
      client.observeAuthentication = (_options, carrier) => {
        expect(intrinsicSetDelete.call(carrier.nulls, name)).toBe(true);
        carrier.values.set(name, name === 'authorization' ? 'Bearer restored-token' : 'restored-token');
      };

      await client.request({ method: 'get', path: '/models' });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe(
        name === 'authorization' ? 'Bearer restored-token' : 'restored-token',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['delete', 'clear'] as const)(
    'never replays an inherited tombstone removed first by captured native Set.%s',
    async (operation) => {
      const { client, fetch } = createClient();
      client.apiKey = null;
      client.observeAuthentication = (_options, carrier) => {
        if (operation === 'delete') {
          expect(intrinsicSetDelete.call(carrier.nulls, 'api-key')).toBe(true);
        } else {
          Set.prototype.clear.call(carrier.nulls);
        }
      };

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
        'Could not resolve authentication method.',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['get', 'post'] as const)(
    'keeps ordinary %s request headers live while isolating the credential snapshot',
    async (method) => {
      const { client, fetch } = createClient();
      const headers = { 'api-key': 'original-tenant-token', 'x-request-metadata': 'before-authentication' };
      client.observeAuthentication = (options) => {
        expect(options.headers).toBe(headers);
        headers['api-key'] = 'different-tenant-token';
        headers['x-request-metadata'] = 'updated-during-authentication';
      };

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('original-tenant-token');
      expect(sent.get('x-request-metadata')).toBe('updated-during-authentication');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['native Headers', 'tuple row mutation', 'tuple row replacement', 'tuple value array'] as const).map(
        (representation) => ({ method, representation }),
      ),
    ),
  )(
    'refreshes complete ordinary $method $representation entries without changing its pinned credential',
    async ({ method, representation }) => {
      const { client, fetch } = createClient();
      const tuples: [string, string | string[]][] = [
        ['api-key', 'original-tenant-token'],
        [
          'x-request-metadata',
          representation === 'tuple value array' ? ['before-first', 'before-second'] : 'before',
        ],
        ['x-removed', 'discarded'],
        ['x-duplicate', 'before-first'],
        ['x-duplicate', 'before-second'],
      ];
      const headers =
        representation === 'native Headers'
          ? new Headers(
              tuples.map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
            )
          : tuples;

      client.observeAuthentication = () => {
        if (headers instanceof Headers) {
          headers.set('api-key', 'different-tenant-token');
          headers.set('x-request-metadata', 'after');
          headers.delete('x-removed');
          headers.delete('x-duplicate');
          headers.append('x-duplicate', 'after-first');
          headers.append('x-duplicate', 'after-second');
          headers.set('x-added', 'new metadata');
          return;
        }
        const [credential, metadata] = headers;
        if (credential === undefined || metadata === undefined) {
          throw new Error('Expected request credential and metadata tuples.');
        }
        credential[1] = 'different-tenant-token';
        if (representation === 'tuple row replacement') {
          headers[1] = ['x-request-metadata', 'after'];
        } else if (representation === 'tuple value array') {
          const [, values] = metadata;
          if (Array.isArray(values)) {
            values.splice(0, values.length, 'after-first', 'after-second');
          }
        } else {
          metadata[1] = 'after';
        }
        headers.splice(2, 1);
        const [firstDuplicate, secondDuplicate] = headers.slice(2);
        if (firstDuplicate === undefined || secondDuplicate === undefined) {
          throw new Error('Expected duplicate metadata tuples.');
        }
        firstDuplicate[1] = 'after-first';
        secondDuplicate[1] = 'after-second';
        headers.push(['x-added', 'new metadata']);
      };

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers: headers as FinalRequestOptions['headers'],
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('original-tenant-token');
      expect(sent.get('x-request-metadata')).toBe(
        representation === 'tuple value array' ? 'after-first, after-second' : 'after',
      );
      expect(sent.has('x-removed')).toBe(false);
      expect(sent.get('x-duplicate')).toBe('after-first, after-second');
      expect(sent.get('x-added')).toBe('new metadata');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['api-key', 'Authorization'] as const).map((name) => ({ method, name })),
    ),
  )(
    'pins the earlier $method $name default before a request proxy can switch tenants',
    async ({ method, name }) => {
      let effective = 'tenant-a-token';
      let coercions = 0;
      let enumerations = 0;
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
      const headers = new Proxy(
        { 'x-request-metadata': 'preserved' },
        {
          ownKeys(target) {
            enumerations += 1;
            effective = 'tenant-b-token';
            return Reflect.ownKeys(target);
          },
        },
      );
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new CarrierReviewAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(name)).toBe('tenant-a-token');
      expect(sent.get('x-request-metadata')).toBe('preserved');
      expect(coercions).toBe(1);
      expect(enumerations).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['api-key', 'Authorization'] as const).map((name) => ({ method, name })),
    ),
  )(
    'never lets a nonenumerable $method $name request property hide an effective default',
    async ({ method, name }) => {
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
      const target: Record<string, string> = { 'x-request-metadata': 'preserved' };
      Object.defineProperty(target, name, { value: 'ignored-nonenumerable-token' });
      const headers = new Proxy(target, {
        ownKeys(source) {
          effective = 'tenant-b-token';
          return Reflect.ownKeys(source);
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new CarrierReviewAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('tenant-a-token');
      expect(coercions).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['api-key', 'Authorization'] as const).map((name) => ({ method, name })),
    ),
  )(
    'never coerces a shadowed earlier $method $name credential while capturing a request proxy',
    async ({ method, name }) => {
      let coercions = 0;
      let enumerations = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, name, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            throw new Error('private-shadowed-proxy-tenant-token');
          },
        },
      });
      const headers = new Proxy(
        { [name]: 'request-tenant-token', 'x-request-metadata': 'preserved' },
        {
          ownKeys(target) {
            enumerations += 1;
            return Reflect.ownKeys(target);
          },
        },
      );
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
      const client = new CarrierReviewAzure({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'configured-tenant-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe('request-tenant-token');
      expect(coercions).toBe(0);
      expect(enumerations).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['get', 'post'] as const)(
    'sanitizes a hostile tuple-name prototype introduced by the protected %s authentication hook',
    async (method) => {
      const { client, fetch } = createClient();
      const privateCredential = 'private-post-authentication-prototype-token';
      const row: [string, string] = ['x-request-metadata', 'preserved'];
      const headers: [string, string][] = [['api-key', 'original-tenant-token'], row];
      client.observeAuthentication = () => {
        Reflect.deleteProperty(row, 0);
        Object.setPrototypeOf(
          row,
          new Proxy(Object.create(Array.prototype) as object, {
            getPrototypeOf() {
              throw new Error(privateCredential);
            },
          }),
        );
      };

      let failure: unknown;
      try {
        await client.request({
          method,
          path: '/models',
          ...(method === 'post' ? { body: { safe: true } } : {}),
          headers,
        });
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

  test.each(['get', 'post'] as const)(
    'preserves a captured native Set.add %s credential tombstone before lazy initialization',
    async (method) => {
      const { client, fetch } = createClient();
      client.observeAuthentication = (_options, carrier) => {
        Set.prototype.add.call(carrier.nulls, 'api-key');
        carrier.values.set('authorization', 'Bearer replacement-tenant-token');
      };

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.has('api-key')).toBe(false);
      expect(sent.get('authorization')).toBe('Bearer replacement-tenant-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    {
      description: 'array-to-array replacement',
      initial: ['before-first', 'before-second'],
      updated: ['after-first', 'after-second'],
      expected: 'after-first, after-second',
    },
    {
      description: 'array-to-scalar replacement',
      initial: ['before-first', 'before-second'],
      updated: 'after-scalar',
      expected: 'after-scalar',
    },
    {
      description: 'scalar-to-array replacement',
      initial: 'before-scalar',
      updated: ['after-first', 'after-second'],
      expected: 'after-first, after-second',
    },
  ])(
    'keeps ordinary request header $description live during protected authentication',
    async ({ initial, updated, expected }) => {
      const { client, fetch } = createClient();
      const headers: Record<string, string | readonly string[]> = {
        'api-key': 'original-tenant-token',
        'x-request-metadata': initial,
      };
      client.observeAuthentication = () => {
        headers['x-request-metadata'] = updated;
      };

      await client.request({ method: 'get', path: '/models', headers });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('original-tenant-token');
      expect(sent.get('x-request-metadata')).toBe(expected);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('preserves the original error from an unrelated ordinary request-header getter', async () => {
    const { client, fetch } = createClient();
    const failure = new Error('ordinary request metadata failed');
    const headers: Record<string, string> = { 'api-key': 'request-tenant-token' };
    Object.defineProperty(headers, 'x-request-metadata', {
      enumerable: true,
      get() {
        throw failure;
      },
    });

    await expect(client.request({ method: 'get', path: '/models', headers })).rejects.toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
  });
});
