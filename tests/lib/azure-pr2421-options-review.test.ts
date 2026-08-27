import { once } from 'node:events';
import { vi } from 'vitest';

import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';
const PRIVATE_CREDENTIAL = 'private-azure-review-credential-82fe';

class ReviewAzure extends AzureOpenAI {
  observeAuthentication: ((options: FinalRequestOptions) => Promise<void> | void) | undefined;

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    await this.observeAuthentication?.(options);
    return super.authHeaders(options, schemes);
  }
}

function createClient() {
  const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
  const client = new ReviewAzure({
    baseURL: 'https://azure-resource.example.com/openai',
    apiVersion: '2024-02-15-preview',
    apiKey: 'configured-tenant-token',
    fetch,
    maxRetries: 0,
  });
  return { client, fetch };
}

describe('Azure request-options review regressions', () => {
  test.each([40, 128] as const)(
    'never invokes an inherited body getter at prototype depth %s when the base option spread ignores it',
    async (depth) => {
      const { client, fetch } = createClient();
      const read = vi.fn(() => {
        throw Object.assign(new Error(PRIVATE_CREDENTIAL), { cause: new Error(PRIVATE_CREDENTIAL) });
      });
      const owner = Object.create(null) as object;
      Object.defineProperty(owner, 'body', { configurable: true, enumerable: true, get: read });
      let prototype = owner;
      for (let index = 0; index < depth; index += 1) {
        prototype = Object.create(prototype) as object;
      }
      const options = Object.assign(Object.create(prototype) as FinalRequestOptions, {
        method: 'get' as const,
        path: '/models',
        headers: { 'api-key': 'request-tenant-token' },
      });

      await client.request(options);

      expect(read).not.toHaveBeenCalled();
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('api-key')).toBe('request-tenant-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'honors an unambiguous configurable %s accessor redefined by the protected authentication hook',
    async (header) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      Object.defineProperty(options, 'headers', {
        configurable: true,
        enumerable: true,
        get: () => ({ [header]: 'initial-tenant-token' }),
      });
      const replacement = { [header]: 'protected-hook-tenant-token', 'x-hook': 'preserved' };
      client.observeAuthentication = (received) => {
        expect(received).toBe(options);
        Object.defineProperty(received, 'headers', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: replacement,
        });
      };

      await client.request(options);

      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get(header)).toBe('protected-hook-tenant-token');
      expect(sent.get('x-hook')).toBe('preserved');
      expect(Object.getOwnPropertyDescriptor(options, 'headers')?.value).toBe(replacement);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['api-key', 'Authorization'] as const)(
    'sanitizes a malformed %s effective credential when a configurable accessor is redefined',
    async (header) => {
      const { client, fetch } = createClient();
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      Object.defineProperty(options, 'headers', {
        configurable: true,
        enumerable: true,
        get: () => ({ [header]: 'initial-tenant-token' }),
      });
      client.observeAuthentication = (received) => {
        Object.defineProperty(received, 'headers', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: { [header]: `${PRIVATE_CREDENTIAL}\nprivate-suffix` },
        });
      };

      let failure: unknown;
      try {
        await client.request(options);
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
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test('fails closed when the authentication hook deletes a configurable request-header snapshot', async () => {
    const { client, fetch } = createClient();
    const inherited = { headers: { 'api-key': 'different-inherited-tenant-token' } };
    const options = Object.assign(Object.create(inherited) as FinalRequestOptions, {
      method: 'post' as const,
      path: '/models',
      body: { safe: true },
    });
    Object.defineProperty(options, 'headers', {
      configurable: true,
      enumerable: true,
      get: () => ({ 'api-key': 'initial-tenant-token' }),
    });
    client.observeAuthentication = (received) => {
      expect(received).toBe(options);
      Reflect.deleteProperty(received, 'headers');
    };

    await expect(client.request(options)).rejects.toThrow(SAFE_ERROR);

    expect(Object.getOwnPropertyDescriptor(options, 'headers')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('fails both concurrent configurable snapshots when one hook redefines their shared accessor', async () => {
    const { client, fetch } = createClient();
    const snapshots = [{ 'api-key': 'first-tenant-token' }, { 'api-key': 'second-tenant-token' }];
    const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
    let reads = 0;
    Object.defineProperty(options, 'headers', {
      configurable: true,
      enumerable: true,
      get() {
        const snapshot = snapshots[reads];
        reads += 1;
        return snapshot;
      },
    });
    const gates: AbortController[] = [];
    client.observeAuthentication = async (received) => {
      const index = gates.length;
      const gate = new AbortController();
      gates.push(gate);
      await once(gate.signal, 'abort');
      if (index === 0) {
        Object.defineProperty(received, 'headers', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: { 'api-key': 'first-hook-tenant-token' },
        });
      }
    };

    const first = client.request(options);
    const second = client.request(options);
    await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });
    gates[0]?.abort();
    await expect(first).rejects.toThrow(SAFE_ERROR);
    gates[1]?.abort();
    await expect(second).rejects.toThrow(SAFE_ERROR);

    expect(reads).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['the same client', 'different clients'] as const)(
    'allows stable immutable getter/setter snapshots to overlap on %s without ambiguous writes',
    async (representation) => {
      const firstClient = createClient();
      const secondClient = representation === 'the same client' ? firstClient : createClient();
      const headers = { 'api-key': 'stable-tenant-token', 'x-tenant': 'stable' };
      const options: FinalRequestOptions = { method: 'post', path: '/models', body: { safe: true } };
      const setter = vi.fn();
      Object.defineProperty(options, 'headers', {
        configurable: false,
        enumerable: true,
        get: () => headers,
        set: setter,
      });
      const gates: AbortController[] = [];
      const observe = async (received: FinalRequestOptions) => {
        expect(received).toBe(options);
        const gate = new AbortController();
        gates.push(gate);
        await once(gate.signal, 'abort');
      };
      firstClient.client.observeAuthentication = observe;
      secondClient.client.observeAuthentication = observe;

      const first = firstClient.client.request(options);
      const second = secondClient.client.request(options);
      await vi.waitFor(() => expect(gates).toHaveLength(2), { interval: 1 });
      gates[1]?.abort();
      await second;
      gates[0]?.abort();
      await first;

      const requests = [
        ...firstClient.fetch.mock.calls,
        ...(secondClient === firstClient ? [] : secondClient.fetch.mock.calls),
      ];
      for (const [, init] of requests) {
        const sent = new Headers(init?.headers);
        expect(sent.get('api-key')).toBe('stable-tenant-token');
        expect(sent.get('x-tenant')).toBe('stable');
      }
      expect(setter).not.toHaveBeenCalled();
      expect(requests).toHaveLength(2);
    },
  );

  test('honors a stable proxy setter that forwards its effective replacement into the data descriptor', async () => {
    const { client, fetch } = createClient();
    const target: FinalRequestOptions = {
      method: 'post',
      path: '/models',
      body: { safe: true },
      headers: { 'api-key': 'initial-tenant-token' },
    };
    let reads = 0;
    let writes = 0;
    const options = new Proxy(target, {
      get(value, property, receiver) {
        if (property === 'headers') {
          reads += 1;
        }
        return Reflect.get(value, property, receiver);
      },
      set(value, property, replacement, receiver) {
        if (property === 'headers') {
          writes += 1;
          const supplied = replacement as Record<string, string>;
          return Reflect.set(value, property, {
            'api-key': String(supplied['api-key']).toLowerCase(),
            'x-setter': 'normalized',
          });
        }
        return Reflect.set(value, property, replacement, receiver);
      },
    });
    client.observeAuthentication = (received) => {
      expect(received).toBe(options);
      received.headers = { 'api-key': 'FORWARDED-TENANT-TOKEN' };
    };

    await client.request(options);

    const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(sent.get('api-key')).toBe('forwarded-tenant-token');
    expect(sent.get('x-setter')).toBe('normalized');
    expect(reads).toBe(1);
    expect(writes).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['a mismatched data descriptor', 'no data descriptor'] as const)(
    'fails closed when a virtualized proxy setter conceals a hook replacement with %s',
    async (representation) => {
      const { client, fetch } = createClient();
      const initial = { 'api-key': 'initial-virtual-tenant-token' };
      let effective = initial;
      let reads = 0;
      let writes = 0;
      const target: FinalRequestOptions = {
        method: 'post',
        path: '/models',
        body: { safe: true },
        ...(representation === 'a mismatched data descriptor'
          ? { headers: { 'api-key': 'unrelated-target-tenant-token' } }
          : {}),
      };
      const options = new Proxy(target, {
        get(value, property, receiver) {
          if (property === 'headers') {
            reads += 1;
            return effective;
          }
          return Reflect.get(value, property, receiver);
        },
        set(value, property, replacement, receiver) {
          if (property === 'headers') {
            writes += 1;
            const supplied = replacement as Record<string, string>;
            effective = { 'api-key': String(supplied['api-key']).toLowerCase() };
            return true;
          }
          return Reflect.set(value, property, replacement, receiver);
        },
      });
      client.observeAuthentication = (received) => {
        expect(received).toBe(options);
        received.headers = { 'api-key': 'REPLACEMENT-VIRTUAL-TENANT-TOKEN' };
      };

      await expect(client.request(options)).rejects.toThrow(SAFE_ERROR);

      expect(reads).toBe(1);
      expect(writes).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
