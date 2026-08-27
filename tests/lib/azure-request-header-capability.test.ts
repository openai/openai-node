import { once } from 'node:events';
import { vi } from 'vitest';

import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const BASE_URL = 'https://azure-resource.example.com/openai';
const API_VERSION = '2024-02-15-preview';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';
const PRIVATE_CREDENTIAL = 'private-azure-capability-credential-8a91';

const intrinsicAppend = Headers.prototype.append;
const intrinsicDelete = Headers.prototype.delete;
const intrinsicGet = Headers.prototype.get;
const intrinsicHas = Headers.prototype.has;
const intrinsicSet = Headers.prototype.set;

type Authentication = 'static-api-key' | 'rotating-entra-token';
type AuthenticationObserver = (
  options: FinalRequestOptions,
  carrier: NullableHeaders,
  invocation: number,
) => Promise<void> | void;

class CapabilityAzure extends AzureOpenAI {
  observeAuthentication: AuthenticationObserver | undefined;
  readonly authenticationOptions: FinalRequestOptions[] = [];

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    const invocation = this.authenticationOptions.length;
    this.authenticationOptions.push(options);
    const carrier = await super.authHeaders(options, schemes);
    if (carrier) {
      await this.observeAuthentication?.(options, carrier, invocation);
    }
    return carrier;
  }
}

function createClient(authentication: Authentication = 'static-api-key') {
  const provider = vi.fn(async () => 'configured-tenant-token');
  const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
    globalThis.Response.json({ ok: true }),
  );
  const client = new CapabilityAzure({
    baseURL: BASE_URL,
    apiVersion: API_VERSION,
    ...(authentication === 'static-api-key'
      ? { apiKey: 'configured-tenant-token' }
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
    throw new Error('Expected a sanitized Azure credential failure.');
  }
  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as TypeError & { cause?: unknown }).cause).toBeUndefined();
  expect(failure.stack).not.toContain(PRIVATE_CREDENTIAL);
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('Azure request-local authentication header capabilities', () => {
  test.each(
    (['static-api-key', 'rotating-entra-token'] as const).flatMap((authentication) =>
      (['append', 'delete', 'set'] as const).map((operation) => ({ authentication, operation })),
    ),
  )(
    '$authentication exposes its effective credential to captured Headers.prototype.$operation',
    async ({ authentication, operation }) => {
      const { client, fetch, provider } = createClient(authentication);
      const name = authentication === 'static-api-key' ? 'api-key' : 'authorization';
      const configured =
        authentication === 'static-api-key' ? 'configured-tenant-token' : 'Bearer configured-tenant-token';
      client.observeAuthentication = (_options, carrier) => {
        expect(intrinsicHas.call(carrier.values, name)).toBe(true);
        expect(intrinsicGet.call(carrier.values, name)).toBe(configured);
        if (operation === 'append') {
          intrinsicAppend.call(carrier.values, name.toUpperCase(), 'appended-tenant-token');
        } else if (operation === 'delete') {
          intrinsicDelete.call(carrier.values, name.toUpperCase());
          intrinsicSet.call(
            carrier.values,
            name === 'api-key' ? 'authorization' : 'api-key',
            name === 'api-key' ? 'Bearer replacement-tenant-token' : 'replacement-tenant-token',
          );
        } else {
          intrinsicSet.call(carrier.values, name.toUpperCase(), 'replacement-tenant-token');
        }
      };

      await client.request({ method: 'get', path: '/models' });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      if (operation === 'append') {
        expect(sent.get(name)).toBe(`${configured}, appended-tenant-token`);
      } else if (operation === 'delete') {
        expect(sent.has(name)).toBe(false);
        expect(sent.get(name === 'api-key' ? 'authorization' : 'api-key')).toBe(
          name === 'api-key' ? 'Bearer replacement-tenant-token' : 'replacement-tenant-token',
        );
      } else {
        expect(sent.get(name)).toBe('replacement-tenant-token');
      }
      expect(provider).toHaveBeenCalledTimes(authentication === 'rotating-entra-token' ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['static-api-key', 'rotating-entra-token'] as const)(
    '$authentication keeps captured and overridden credential mutations in native order',
    async (authentication) => {
      const { client, fetch } = createClient(authentication);
      const name = authentication === 'static-api-key' ? 'api-key' : 'authorization';
      client.observeAuthentication = (_options, carrier) => {
        carrier.values.append(name, 'discarded-wrapper-token');
        intrinsicSet.call(carrier.values, name.toUpperCase(), 'native-replacement-token');
        carrier.values.append(name, 'final-wrapper-token');
      };

      await client.request({ method: 'get', path: '/models' });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(name)).toBe(
        'native-replacement-token, final-wrapper-token',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('keeps captured intrinsic mutations local to overlapping protected authentication invocations', async () => {
    const { client, fetch } = createClient();
    const gates: AbortController[] = [];
    client.observeAuthentication = async (_options, carrier, invocation) => {
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
      intrinsicAppend.call(carrier.values, 'API-KEY', `tenant-${invocation}-suffix`);
    };

    const first = client.request({
      method: 'post',
      path: '/models',
      body: { tenant: 'first' },
      headers: { 'x-tenant': 'first' },
    });
    const second = client.request({
      method: 'post',
      path: '/models',
      body: { tenant: 'second' },
      headers: { 'x-tenant': 'second' },
    });
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });

    gates[1]?.abort();
    await second;
    gates[0]?.abort();
    await first;

    const secondHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    const firstHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('api-key')).toBe('configured-tenant-token, tenant-1-suffix');
    expect(secondHeaders.get('x-tenant')).toBe('second');
    expect(firstHeaders.get('api-key')).toBe('configured-tenant-token, tenant-0-suffix');
    expect(firstHeaders.get('x-tenant')).toBe('first');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('fails closed when a captured intrinsic appends to an unmaterializable malformed credential', async () => {
    const malformed = `${PRIVATE_CREDENTIAL}\nprivate-suffix`;
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
      globalThis.Response.json({ ok: true }),
    );
    const client = new CapabilityAzure({
      baseURL: BASE_URL,
      apiVersion: API_VERSION,
      apiKey: malformed,
      fetch,
      maxRetries: 0,
    });
    client.observeAuthentication = (_options, carrier) => {
      intrinsicAppend.call(carrier.values, 'api-key', 'safe-suffix');
    };

    await expectSanitizedFailure(client.request({ method: 'get', path: '/models' }));

    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(
    (['immutable own', 'sealed own', 'frozen own', 'nonextensible inherited'] as const).flatMap(
      (representation) =>
        (['api-key', 'Authorization'] as const).map((header) => ({ header, representation })),
    ),
  )(
    'dispatches the normalized protected-hook $header replacement from a $representation setter',
    async ({ header, representation }) => {
      const { client, fetch } = createClient();
      let effective: Record<string, string> = { [header]: 'initial-tenant-token' };
      let reads = 0;
      let writes = 0;
      const owner = Object.create(null) as object;
      Object.defineProperty(owner, 'headers', {
        configurable: representation === 'nonextensible inherited',
        enumerable: true,
        get() {
          reads += 1;
          return effective;
        },
        set(value: Record<string, string>) {
          writes += 1;
          effective = {
            [header]: String(value[header]).toLowerCase(),
            'x-setter': 'normalized',
          };
        },
      });
      const options = Object.assign(
        representation === 'nonextensible inherited' ? Object.create(owner) : owner,
        { method: 'post' as const, path: '/models', body: { safe: true } },
      ) as FinalRequestOptions;
      if (representation === 'sealed own') {
        Object.seal(options);
      } else if (representation === 'frozen own') {
        Object.freeze(options);
      } else if (representation === 'nonextensible inherited') {
        Object.preventExtensions(options);
      }
      const descriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const prototype = Object.getPrototypeOf(options) as object | null;
      client.observeAuthentication = (received) => {
        expect(received).toBe(options);
        received.headers = { [header]: 'NORMALIZED-TENANT-TOKEN' };
      };

      await client.request(options);

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(header)).toBe('normalized-tenant-token');
      expect(sent.get('x-setter')).toBe('normalized');
      expect(reads).toBe(2);
      expect(writes).toBe(1);
      expect(client.authenticationOptions).toEqual([options]);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(descriptor);
      expect(Object.getPrototypeOf(options)).toBe(prototype);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['throws', 'returns an invalid credential'] as const)(
    'sanitizes an immutable getter that %s after its protected setter runs',
    async (behavior) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      let writes = 0;
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable: true,
        get() {
          if (writes === 0) {
            return { 'api-key': 'initial-tenant-token' };
          }
          if (behavior === 'throws') {
            throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
          }
          return { 'api-key': `${PRIVATE_CREDENTIAL}\nprivate-suffix` };
        },
        set() {
          writes += 1;
        },
      });
      client.observeAuthentication = (received) => {
        received.headers = { 'api-key': 'safe-supplied-token' };
      };

      await expectSanitizedFailure(client.request(options));

      expect(writes).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([null, undefined] as const)(
    'preserves an immutable setter replacement of %s without reviving the original request credential',
    async (replacement) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      let effective: FinalRequestOptions['headers'] = { 'api-key': 'initial-tenant-token' };
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable: true,
        get() {
          return effective;
        },
        set(value: FinalRequestOptions['headers']) {
          effective = value;
        },
      });
      client.observeAuthentication = (received) => {
        received.headers = replacement;
      };

      await client.request(options);

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('configured-tenant-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('fails both overlapping immutable setter requests before either tenant can be dispatched', async () => {
    const { client, fetch } = createClient();
    const records = [{ 'api-key': 'first-tenant-token' }, { 'api-key': 'second-tenant-token' }];
    const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
    let reads = 0;
    let writes = 0;
    Object.defineProperty(options, 'headers', {
      configurable: false,
      enumerable: true,
      get() {
        const record = records[reads];
        reads += 1;
        return record;
      },
      set() {
        writes += 1;
      },
    });
    const gates: AbortController[] = [];
    client.observeAuthentication = async (received, _carrier, invocation) => {
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
      received.headers = { 'api-key': `replacement-tenant-${invocation}` };
    };

    const first = captureFailure(client.request(options));
    const second = captureFailure(client.request(options));
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });
    expect(reads).toBe(2);

    gates[0]?.abort();
    const firstFailure = await first;
    gates[1]?.abort();
    const secondFailure = await second;

    for (const failure of [firstFailure, secondFailure]) {
      expect(failure).toBeInstanceOf(TypeError);
      expect((failure as Error).message).toBe(SAFE_ERROR);
    }
    expect(writes).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['same client', 'different clients'] as const)(
    'fails closed before a concurrent configurable setter can bind request A to request B on %s',
    async (representation) => {
      const first = createClient();
      const second = representation === 'same client' ? first : createClient();
      const snapshots = [
        { 'api-key': 'first-tenant-token', 'x-tenant': 'first' },
        { 'api-key': 'second-tenant-token', 'x-tenant': 'second' },
      ];
      let reads = 0;
      let writes = 0;
      let replacement: Record<string, string> | undefined;
      const options: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { safe: true },
        get headers() {
          if (replacement) {
            reads += 1;
            return replacement;
          }
          const snapshot = snapshots[reads];
          reads += 1;
          return snapshot;
        },
        set headers(value) {
          writes += 1;
          const supplied = value as Record<string, string>;
          replacement = {
            'api-key': String(supplied['api-key']).toLowerCase(),
            'x-tenant': supplied['x-tenant'] ?? 'unknown',
          };
        },
      };
      const originalDescriptor = Object.getOwnPropertyDescriptor(options, 'headers');
      const gates: AbortController[] = [];
      const observe: AuthenticationObserver = async (received, _carrier, invocation) => {
        const index = representation === 'same client' ? invocation : gates.length;
        const gate = new AbortController();
        gates.push(gate);
        await once(gate.signal, 'abort');
        received.headers = {
          'api-key': index === 0 ? 'FIRST-HOOK-TOKEN' : 'SECOND-HOOK-TOKEN',
          'x-tenant': index === 0 ? 'first' : 'second',
        };
      };
      first.client.observeAuthentication = observe;
      second.client.observeAuthentication = observe;

      const firstRequest = first.client.request(options);
      const observedFirst = captureFailure(firstRequest);
      const secondRequest = second.client.request(options);
      await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });
      expect(reads).toBe(2);

      gates[0]?.abort();
      const firstFailure = await observedFirst;
      expect(firstFailure).toBeInstanceOf(TypeError);
      expect((firstFailure as Error).message).toBe(SAFE_ERROR);
      expect(writes).toBe(0);
      expect(first.fetch).not.toHaveBeenCalled();

      gates[1]?.abort();
      await secondRequest;

      const sent = new Headers(second.fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('second-hook-token');
      expect(sent.get('x-tenant')).toBe('second');
      expect(writes).toBe(1);
      expect(Object.getOwnPropertyDescriptor(options, 'headers')).toEqual(originalDescriptor);
      expect(second.fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['conflicting tenant', 'malformed credential', 'throwing coercion'] as const).map((behavior) => ({
        behavior,
        method,
      })),
    ),
  )(
    'reads virtualized configurable data headers once for a $method with a $behavior on later reads',
    async ({ behavior, method }) => {
      const { client, fetch } = createClient();
      const first = { 'api-key': 'first-tenant-token', 'x-tenant': 'first' };
      let coercions = 0;
      let unsafe: object;
      if (behavior === 'conflicting tenant') {
        unsafe = { 'api-key': 'second-tenant-token', 'x-tenant': 'second' };
      } else if (behavior === 'malformed credential') {
        unsafe = { 'api-key': `${PRIVATE_CREDENTIAL}\nprivate-suffix` };
      } else {
        unsafe = {
          'api-key': {
            toString(): string {
              coercions += 1;
              throw new Error(PRIVATE_CREDENTIAL);
            },
          },
        };
      }
      const target: FinalRequestOptions = {
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers: first,
      };
      let reads = 0;
      const options = new Proxy(target, {
        get(value, property, receiver) {
          if (property === 'headers') {
            reads += 1;
            return reads === 1 ? first : unsafe;
          }
          return Reflect.get(value, property, receiver);
        },
      });
      const descriptor = Object.getOwnPropertyDescriptor(target, 'headers');
      client.observeAuthentication = (received) => {
        expect(received).toBe(options);
      };

      await client.request(options);

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('first-tenant-token');
      expect(sent.get('x-tenant')).toBe('first');
      expect(reads).toBe(1);
      expect(coercions).toBe(0);
      expect(client.authenticationOptions).toEqual([options]);
      expect(Object.getOwnPropertyDescriptor(target, 'headers')).toEqual(descriptor);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('isolates concurrent public requests sharing virtualized configurable data options', async () => {
    const { client, fetch } = createClient();
    const tenants = [
      { 'api-key': 'first-tenant-token', 'x-tenant': 'first' },
      { 'api-key': 'second-tenant-token', 'x-tenant': 'second' },
    ];
    const target: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { safe: true },
      headers: tenants[0],
    };
    let reads = 0;
    const options = new Proxy(target, {
      get(value, property, receiver) {
        if (property === 'headers') {
          const result = tenants[reads];
          reads += 1;
          if (!result) {
            throw new Error(PRIVATE_CREDENTIAL);
          }
          return result;
        }
        return Reflect.get(value, property, receiver);
      },
    });
    const gates: AbortController[] = [];
    client.observeAuthentication = async () => {
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
    };

    const first = client.request(options);
    const second = client.request(options);
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });
    expect(reads).toBe(2);

    gates[1]?.abort();
    await second;
    gates[0]?.abort();
    await first;

    const secondHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    const firstHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('api-key')).toBe('second-tenant-token');
    expect(secondHeaders.get('x-tenant')).toBe('second');
    expect(firstHeaders.get('api-key')).toBe('first-tenant-token');
    expect(firstHeaders.get('x-tenant')).toBe('first');
    expect(reads).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('snapshots conflicting shared GET credentials before asynchronous authentication interleaves', async () => {
    const { client, fetch } = createClient();
    const shared = { 'api-key': 'first-tenant-token' };
    const gates: AbortController[] = [];
    client.observeAuthentication = async () => {
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
    };

    const first = client.request({ method: 'get', path: '/models', headers: shared });
    await vi.waitFor(() => expect(gates).toHaveLength(1), { interval: 1 });
    shared['api-key'] = 'second-tenant-token';
    const second = client.request({ method: 'get', path: '/models', headers: shared });
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });

    gates[1]?.abort();
    await second;
    gates[0]?.abort();
    await first;

    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('second-tenant-token');
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('api-key')).toBe('first-tenant-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each(['get', 'post'] as const)(
    'snapshots effective object-backed $method credentials before asynchronous tenant changes',
    async (method) => {
      const { client, fetch } = createClient();
      let effective = 'first-tenant-token';
      let coercions = 0;
      const shared = {
        'api-key': {
          toString(): string {
            coercions += 1;
            return effective;
          },
        },
      } as unknown as Record<string, string>;
      const gates: AbortController[] = [];
      client.observeAuthentication = async () => {
        const gate = new AbortController();
        gates.push(gate);
        await once(gate.signal, 'abort');
      };

      const first = client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers: shared,
      });
      await vi.waitFor(() => expect(gates).toHaveLength(1), { interval: 1 });
      effective = 'second-tenant-token';
      const second = client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers: shared,
      });
      await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });

      gates[1]?.abort();
      await second;
      gates[0]?.abort();
      await first;

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('second-tenant-token');
      expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('api-key')).toBe('first-tenant-token');
      expect(coercions).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each(['get', 'post'] as const)(
    'never coerces an object-backed $method credential shadowed in the same request record',
    async (method) => {
      const { client, fetch } = createClient();
      let coercions = 0;
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, 'api-key', {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            throw new Error(PRIVATE_CREDENTIAL);
          },
        },
      });
      Object.defineProperty(headers, 'API-KEY', {
        enumerable: true,
        get: () => 'effective-tenant-token',
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('effective-tenant-token');
      expect(coercions).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['get', 'post'] as const)(
    'snapshots an effective object-backed $method credential before a later metadata getter',
    async (method) => {
      const { client, fetch } = createClient();
      let effective = 'first-tenant-token';
      let coercions = 0;
      const headers: Record<string, string> = {};
      Object.defineProperty(headers, 'api-key', {
        enumerable: true,
        value: {
          toString(): string {
            coercions += 1;
            return effective;
          },
        },
      });
      Object.defineProperty(headers, 'x-tenant', {
        enumerable: true,
        get() {
          effective = 'second-tenant-token';
          return 'preserved';
        },
      });

      await client.request({
        method,
        path: '/models',
        ...(method === 'post' ? { body: { safe: true } } : {}),
        headers,
      });

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('api-key')).toBe('first-tenant-token');
      expect(sent.get('x-tenant')).toBe('preserved');
      expect(coercions).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('sanitizes a throwing virtualized data getter before authentication or transport', async () => {
    const { client, fetch } = createClient();
    const target: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { safe: true },
      headers: { 'api-key': 'safe-target-token' },
    };
    const options = new Proxy(target, {
      get(value, property, receiver) {
        if (property === 'headers') {
          throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
        }
        return Reflect.get(value, property, receiver);
      },
    });

    await expectSanitizedFailure(client.request(options));

    expect(client.authenticationOptions).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
