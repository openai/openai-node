import { once } from 'node:events';
import { vi } from 'vitest';

import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import {
  buildAzureAuthenticationHeaders,
  buildHeaders,
  protectAzureRequestHeaders,
} from 'openai/internal/headers';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const BASE_URL = 'https://azure-resource.example.com/openai';
const API_VERSION = '2024-02-15-preview';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';
const PRIVATE_CREDENTIAL = 'private-azure-credential-85d3';
const MISSING_AUTHENTICATION = 'Could not resolve authentication method.';

type Authentication = 'static-api-key' | 'rotating-entra-token';

class ObservedAzure extends AzureOpenAI {
  readonly authenticationOptions: FinalRequestOptions[] = [];
  readonly preparedOptions: FinalRequestOptions[] = [];
  readonly requestOptions: FinalRequestOptions[] = [];
  awaitAuthentication: (() => Promise<void>) | undefined;
  clearPreparedCredential = false;
  preparedCredential: null | undefined;

  protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    await super.prepareOptions(options);
    this.preparedOptions.push(options);
    if (this.clearPreparedCredential) {
      Reflect.set(this, 'apiKey', this.preparedCredential);
    }
  }

  protected override async prepareRequest(
    request: RequestInit,
    context: { url: string; options: FinalRequestOptions },
  ): Promise<void> {
    this.requestOptions.push(context.options);
    await super.prepareRequest(request, context);
  }

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    this.authenticationOptions.push(options);
    if (this.awaitAuthentication) {
      await this.awaitAuthentication();
    }
    return super.authHeaders(options, schemes);
  }
}

function createClient(authentication: Authentication = 'static-api-key') {
  const provider = vi.fn(async () => 'safe-rotating-token');
  const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
    globalThis.Response.json({ ok: true }),
  );
  const client = new ObservedAzure({
    baseURL: BASE_URL,
    apiVersion: API_VERSION,
    ...(authentication === 'static-api-key'
      ? { apiKey: 'safe-configured-token' }
      : { azureADTokenProvider: provider }),
    fetch,
    maxRetries: 0,
  });
  return { client, fetch, provider };
}

async function expectSanitizedFailure(operation: Promise<unknown>): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(TypeError);
  if (!(failure instanceof TypeError)) {
    throw new Error('Expected a sanitized Azure credential error.');
  }
  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();
  expect(failure.stack).not.toContain(PRIVATE_CREDENTIAL);
}

function withDeepHeaderPrototype(
  options: FinalRequestOptions,
  owner: object,
  depth: number,
): FinalRequestOptions {
  let prototype = owner;
  for (let index = 0; index < depth; index += 1) {
    prototype = Object.create(prototype) as object;
  }
  Object.setPrototypeOf(options, prototype);
  return options;
}

describe('Azure immutable request-header accessors', () => {
  const requests = [
    { description: 'a bodyless GET', method: 'get', body: false },
    { description: 'a JSON POST', method: 'post', body: true },
    { description: 'an explicitly bodyless POST', method: 'post', body: undefined },
  ] as const;

  test.each(
    (['static-api-key', 'rotating-entra-token'] as const).flatMap((authentication) =>
      requests.flatMap((request) =>
        ([true, false] as const).flatMap((enumerable) =>
          (['api-key', 'Authorization'] as const).map((header) => ({
            authentication,
            enumerable,
            header,
            request,
          })),
        ),
      ),
    ),
  )(
    '$authentication reads an immutable enumerable=$enumerable $header accessor once for $request.description',
    async ({ authentication, enumerable, header, request }) => {
      const { client, fetch, provider } = createClient(authentication);
      const options: FinalRequestOptions = {
        method: request.method,
        path: '/models',
        ...(request.body === false ? {} : { body: request.body === true ? { safe: true } : undefined }),
      };
      const headers = { [header]: 'safe-request-token', 'x-custom': 'preserved' };
      let reads = 0;
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable,
        get() {
          reads += 1;
          return headers;
        },
      });
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');

      await client.request(options);

      expect(reads).toBe(1);
      expect(client.authenticationOptions).toEqual([options]);
      expect(client.preparedOptions).toEqual([options]);
      expect(client.requestOptions).toEqual([options]);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(header)).toBe('safe-request-token');
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-custom')).toBe('preserved');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
    },
  );

  test.each(['get', 'post'] as const)(
    'never invokes a stateful immutable $method accessor a second time',
    async (method) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = {
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
      };
      const first = { 'api-key': 'safe-first-token' };
      let reads = 0;
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable: true,
        get() {
          reads += 1;
          if (reads !== 1) {
            throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
          }
          return first;
        },
      });

      await client.request(options);

      expect(reads).toBe(1);
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('safe-first-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['throws', 'returns an invalid credential'] as const)(
    'sanitizes an immutable accessor that %s after reading it once',
    async (behavior) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      let reads = 0;
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable: true,
        get() {
          reads += 1;
          if (behavior === 'throws') {
            throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
          }
          return { Authorization: `${PRIVATE_CREDENTIAL}\nprivate-suffix` };
        },
      });
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');

      await expectSanitizedFailure(client.request(options));

      expect(reads).toBe(1);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['immutable own', 'nonextensible inherited'] as const)(
    'keeps public buildRequest hooks on the original options with %s accessors',
    async (representation) => {
      const { client } = createClient();
      const owner = representation === 'immutable own' ? {} : Object.create(null);
      let reads = 0;
      Object.defineProperty(owner, 'headers', {
        configurable: false,
        enumerable: true,
        get() {
          reads += 1;
          return { 'api-key': 'safe-request-token' };
        },
      });
      const options =
        representation === 'immutable own'
          ? Object.assign(owner as FinalRequestOptions, { method: 'get' as const, path: '/models' })
          : Object.preventExtensions(
              Object.assign(Object.create(owner) as FinalRequestOptions, {
                method: 'get' as const,
                path: '/models',
              }),
            );
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');

      const built = await client.buildRequest(options);

      expect(reads).toBe(1);
      expect(client.authenticationOptions).toEqual([options]);
      expect(built.req.headers.get('api-key')).toBe('safe-request-token');
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
    },
  );

  test('does not invoke mutation traps for a safe immutable proxy-backed accessor', async () => {
    const { client, fetch } = createClient();
    const target: FinalRequestOptions = { method: 'get', path: '/models' };
    const read = vi.fn(() => ({ 'api-key': 'safe-proxy-token' }));
    const mutate = vi.fn(() => {
      throw new Error(PRIVATE_CREDENTIAL);
    });
    Object.defineProperty(target, 'headers', { configurable: false, enumerable: true, get: read });
    const options = new Proxy(target, { defineProperty: mutate, deleteProperty: mutate });

    await client.request(options);

    expect(read).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
    expect(client.authenticationOptions).toEqual([options]);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('safe-proxy-token');
  });

  test('isolates simultaneous immutable snapshots while keeping protected-hook identity', async () => {
    const { client } = createClient();
    const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
    const records = [{ 'api-key': 'first-tenant-token' }, { 'api-key': 'second-tenant-token' }];
    let reads = 0;
    Object.defineProperty(options, 'headers', {
      configurable: false,
      enumerable: true,
      get() {
        const result = records[reads];
        reads += 1;
        return result;
      },
    });
    const releases: (() => void)[] = [];
    client.awaitAuthentication = async () => {
      const gate = new AbortController();
      releases.push(() => gate.abort());
      await once(gate.signal, 'abort');
    };

    const first = client.buildRequest(options);
    const second = client.buildRequest(options);
    expect(client.authenticationOptions).toEqual([options, options]);
    expect(reads).toBe(2);

    releases[0]?.();
    const firstBuilt = await first;
    releases[1]?.();
    const secondBuilt = await second;

    expect(firstBuilt.req.headers.get('api-key')).toBe('first-tenant-token');
    expect(secondBuilt.req.headers.get('api-key')).toBe('second-tenant-token');
    expect(reads).toBe(2);
  });

  test.each(
    (['nonextensible', 'sealed', 'frozen'] as const).flatMap((immutability) =>
      (['static-api-key', 'rotating-entra-token'] as const)
        .filter((authentication) => immutability !== 'frozen' || authentication === 'static-api-key')
        .map((authentication) => ({ authentication, immutability })),
    ),
  )(
    '$authentication keeps concurrent public requests tenant-local on a $immutability client',
    async ({ authentication, immutability }) => {
      const { client, fetch } = createClient(authentication);
      const header = authentication === 'static-api-key' ? 'api-key' : 'Authorization';
      const records = [
        { [header]: 'first-tenant-token', 'x-tenant': 'first' },
        { [header]: 'second-tenant-token', 'x-tenant': 'second' },
      ];
      let reads = 0;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { safe: true },
        get headers() {
          const record = records[reads];
          reads += 1;
          return record;
        },
      };
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const releases: (() => void)[] = [];
      client.awaitAuthentication = async () => {
        const gate = new AbortController();
        releases.push(() => gate.abort());
        await once(gate.signal, 'abort');
      };
      if (immutability === 'frozen') {
        Object.freeze(client);
      } else if (immutability === 'sealed') {
        Object.seal(client);
      } else {
        Object.preventExtensions(client);
      }

      const first = client.request(options);
      const second = client.request(options);
      await vi.waitFor(() => expect(releases).toHaveLength(2), { interval: 1 });
      expect(client.authenticationOptions).toEqual([options, options]);
      expect(reads).toBe(2);

      releases[0]?.();
      await first;
      releases[1]?.();
      await second;

      const firstHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      const secondHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
      expect(firstHeaders.get(header)).toBe('first-tenant-token');
      expect(firstHeaders.get('x-tenant')).toBe('first');
      expect(secondHeaders.get(header)).toBe('second-tenant-token');
      expect(secondHeaders.get('x-tenant')).toBe('second');
      expect(Object.getOwnPropertyDescriptor(client, 'authHeaders')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each(
    (['api-key', 'Authorization'] as const).flatMap((header) =>
      (['object', 'proxy'] as const).map((representation) => ({ header, representation })),
    ),
  )(
    'snapshots an effective $representation $header before a later caller getter mutates it',
    async ({ header, representation }) => {
      let effectiveCredential = 'first-tenant-token';
      let coercions = 0;
      const source = {
        toString(): string {
          coercions += 1;
          return effectiveCredential;
        },
      };
      const credential = representation === 'proxy' ? new Proxy(source, {}) : source;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, { enumerable: true, value: credential });
      const requestHeaders: Record<string, string> = {};
      Object.defineProperty(requestHeaders, 'x-request-metadata', {
        enumerable: true,
        get(): string {
          effectiveCredential = 'second-tenant-token';
          return 'preserved';
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        globalThis.Response.json({ ok: true }),
      );
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: requestHeaders });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(header)).toBe('first-tenant-token');
      expect(sent.get('x-request-metadata')).toBe('preserved');
      expect(coercions).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'snapshots an effective $header before a later getter in the same source mutates it',
    async (header) => {
      let effectiveCredential = 'first-tenant-token';
      let coercions = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            return effectiveCredential;
          },
        },
      });
      Object.defineProperty(defaults, 'x-default-metadata', {
        enumerable: true,
        get(): string {
          effectiveCredential = 'second-tenant-token';
          return 'preserved';
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        globalThis.Response.json({ ok: true }),
      );
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models' });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(header)).toBe('first-tenant-token');
      expect(sent.get('x-default-metadata')).toBe('preserved');
      expect(coercions).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'never coerces a shadowed object-backed $header while a later getter replaces it',
    async (header) => {
      let coercions = 0;
      const shadowed = {
        toString(): string {
          coercions += 1;
          throw new Error(PRIVATE_CREDENTIAL);
        },
      };
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, { enumerable: true, value: shadowed });
      const requestHeaders: Record<string, string> = {};
      Object.defineProperty(requestHeaders, header, {
        enumerable: true,
        get(): string {
          return 'request-tenant-token';
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        globalThis.Response.json({ ok: true }),
      );
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', headers: requestHeaders });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(header)).toBe('request-tenant-token');
      expect(coercions).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'never coerces an ineffective $header before a later case-insensitive same-source override',
    async (header) => {
      let coercions = 0;
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            throw new Error(PRIVATE_CREDENTIAL);
          },
        },
      });
      Object.defineProperty(defaults, header.toUpperCase(), {
        enumerable: true,
        get(): string {
          return 'effective-default-token';
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        globalThis.Response.json({ ok: true }),
      );
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models' });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(header)).toBe('effective-default-token');
      expect(coercions).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'fails closed when a later $header getter mutates a credential without replacing it',
    async (header) => {
      let effectiveCredential = 'first-tenant-token';
      const defaults: Record<string, string> = {};
      Object.defineProperty(defaults, header, {
        enumerable: true,
        value: { toString: () => effectiveCredential },
      });
      const requestHeaders: Record<string, string> = {};
      Object.defineProperty(requestHeaders, header, {
        enumerable: true,
        get(): undefined {
          effectiveCredential = 'second-tenant-token';
          return undefined;
        },
      });
      const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
        globalThis.Response.json({ ok: true }),
      );
      const client = new AzureOpenAI({
        baseURL: BASE_URL,
        apiVersion: API_VERSION,
        apiKey: 'safe-configured-token',
        defaultHeaders: defaults,
        fetch,
        maxRetries: 0,
      });

      await expectSanitizedFailure(
        client.request({ method: 'get', path: '/models', headers: requestHeaders }),
      );

      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('rejects an unbound authentication carrier instead of guessing its request registration', () => {
    const headers = { 'api-key': 'tenant-token' };
    const protection = protectAzureRequestHeaders(headers);
    try {
      expect(() => buildHeaders([buildAzureAuthenticationHeaders(), headers])).toThrow(SAFE_ERROR);
    } finally {
      protection?.release();
    }
  });

  test('refreshes rotating bearer credentials across repeated immutable-header requests', async () => {
    const { client, fetch, provider } = createClient('rotating-entra-token');
    provider.mockImplementation(async () => `rotating-token-${provider.mock.calls.length}`);
    const options: FinalRequestOptions = { method: 'get', path: '/models' };
    const read = vi.fn(() => ({ 'x-custom': 'preserved' }));
    Object.defineProperty(options, 'headers', { configurable: false, enumerable: true, get: read });

    await client.request(options);
    await client.request(options);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer rotating-token-1',
    );
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer rotating-token-2',
    );
  });

  test('preserves unrelated body-serialization errors after copying immutable headers', async () => {
    const { client, fetch } = createClient();
    const failure = new Error('unrelated custom body serialization failed');
    const options: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: {
        toJSON() {
          throw failure;
        },
      },
    };
    const read = vi.fn(() => ({ 'api-key': 'safe-request-token' }));
    Object.defineProperty(options, 'headers', { configurable: false, enumerable: true, get: read });

    await expect(client.request(options)).rejects.toBe(failure);

    expect(read).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Azure deep request-header prototype discovery', () => {
  test.each([40, 128] as const)(
    'snapshots a safe inherited accessor at prototype depth %s exactly once',
    async (depth) => {
      const { client } = createClient();
      let reads = 0;
      const owner = Object.create(null) as object;
      Object.defineProperty(owner, 'headers', {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          if (reads !== 1) {
            throw new Error(PRIVATE_CREDENTIAL);
          }
          return { 'api-key': 'safe-inherited-token' };
        },
      });
      const options = withDeepHeaderPrototype({ method: 'get', path: '/models' }, owner, depth);

      const built = await client.buildRequest(options);

      expect(reads).toBe(1);
      expect(built.req.headers.get('api-key')).toBe('safe-inherited-token');
      expect(client.authenticationOptions).toEqual([options]);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toBeUndefined();
    },
  );

  test('fails closed before reading an accessor beyond the bounded prototype walk', async () => {
    const { client, fetch } = createClient();
    const owner = Object.create(null) as object;
    const read = vi.fn(() => {
      throw new Error(PRIVATE_CREDENTIAL);
    });
    Object.defineProperty(owner, 'headers', { configurable: true, get: read });
    const options = withDeepHeaderPrototype({ method: 'get', path: '/models' }, owner, 1024);

    await expectSanitizedFailure(client.request(options));

    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['descriptor', 'prototype'] as const)(
    'sanitizes a deep inherited proxy %s trap without invoking the credential accessor',
    async (operation) => {
      const { client, fetch } = createClient();
      const read = vi.fn(() => ({ 'api-key': 'safe-inherited-token' }));
      const owner = Object.create(null) as object;
      Object.defineProperty(owner, 'headers', { configurable: true, get: read });
      const hostile = new Proxy(Object.create(owner) as object, {
        getOwnPropertyDescriptor(target, property) {
          if (operation === 'descriptor' && property === 'headers') {
            throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf(target) {
          if (operation === 'prototype') {
            throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
          }
          return Reflect.getPrototypeOf(target);
        },
      });
      const options = withDeepHeaderPrototype({ method: 'get', path: '/models' }, hostile, 48);

      await expectSanitizedFailure(client.request(options));

      expect(read).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('fails closed on a cyclic proxy prototype without reading hostile headers', async () => {
    const { client, fetch } = createClient();
    const target = Object.create(null) as object;
    let reads = 0;
    const cycle: object = new Proxy(target, {
      get(value, property, receiver) {
        if (property === 'headers') {
          reads += 1;
          throw new Error(PRIVATE_CREDENTIAL);
        }
        return Reflect.get(value, property, receiver);
      },
      getPrototypeOf() {
        return cycle;
      },
    });
    const options = Object.assign(Object.create(cycle) as FinalRequestOptions, {
      method: 'get' as const,
      path: '/models',
    });

    await expectSanitizedFailure(client.request(options));

    expect(reads).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('bounds proxy-generated infinite prototype chains without invoking hostile header getters', async () => {
    const { client, fetch } = createClient();
    let traversals = 0;
    let reads = 0;
    const handler: ProxyHandler<object> = {
      get(target, property, receiver) {
        if (property === 'headers') {
          reads += 1;
          throw new Error(PRIVATE_CREDENTIAL);
        }
        return Reflect.get(target, property, receiver);
      },
      getPrototypeOf() {
        traversals += 1;
        return new Proxy(Object.create(null) as object, handler);
      },
    };
    const root = new Proxy(Object.create(null) as object, handler);
    const options = Object.assign(Object.create(root) as FinalRequestOptions, {
      method: 'get' as const,
      path: '/models',
    });

    await expectSanitizedFailure(client.request(options));

    expect(reads).toBe(0);
    expect(traversals).toBeLessThan(300);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Azure bearer credential absence', () => {
  test.each([null, undefined] as const)(
    'uses normal missing-auth validation for a %s rotating credential in public buildRequest',
    async (credential) => {
      const { client, fetch, provider } = createClient('rotating-entra-token');
      Reflect.set(client, 'apiKey', credential);

      await expect(client.buildRequest({ method: 'get', path: '/models' })).rejects.toThrow(
        MISSING_AUTHENTICATION,
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    },
  );

  test.each([null, undefined] as const)(
    'never dispatches a Bearer %s credential cleared by prepareOptions',
    async (credential) => {
      const { client, fetch, provider } = createClient('rotating-entra-token');
      client.clearPreparedCredential = true;
      client.preparedCredential = credential;

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
        MISSING_AUTHENTICATION,
      );

      expect(provider).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([null, undefined] as const)(
    'preserves valid request authentication overrides for an absent %s rotating credential',
    async (credential) => {
      const { client } = createClient('rotating-entra-token');
      Reflect.set(client, 'apiKey', credential);

      const built = await client.buildRequest({
        method: 'get',
        path: '/models',
        headers: { Authorization: 'Bearer safe-request-token' },
      });

      expect(built.req.headers.get('authorization')).toBe('Bearer safe-request-token');
    },
  );

  test.each([null, undefined] as const)(
    'retains explicit authorization omission for an absent %s rotating credential',
    async (credential) => {
      const { client } = createClient('rotating-entra-token');
      Reflect.set(client, 'apiKey', credential);

      const built = await client.buildRequest({
        method: 'get',
        path: '/models',
        headers: { Authorization: null },
      });

      expect(built.req.headers.has('authorization')).toBe(false);
      expect(built.req.headers.has('api-key')).toBe(false);
    },
  );

  test('keeps explicit static null omission distinct from an undefined static credential', async () => {
    const omitted = createClient();
    omitted.client.apiKey = null;
    await omitted.client.request({ method: 'get', path: '/models' });
    expect(new Headers(omitted.fetch.mock.calls[0]?.[1]?.headers).has('api-key')).toBe(false);

    const missing = createClient();
    Reflect.set(missing.client, 'apiKey', undefined);
    await expect(missing.client.buildRequest({ method: 'get', path: '/models' })).rejects.toThrow(
      MISSING_AUTHENTICATION,
    );
    expect(missing.fetch).not.toHaveBeenCalled();
  });
});
