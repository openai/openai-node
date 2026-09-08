import OpenAI from 'openai';
import type { HeadersLike } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

describe.each(['Authorization', 'X-Note'] as const)('%s descriptor verification', (name) => {
  test('checks source evidence before reusing a completed header cursor', async () => {
    const value = name === 'Authorization' ? 'Bearer workload-identity-auth' : 'synthetic initial';
    const cursor = [[name, value]][Symbol.iterator]();
    const HeaderCollection = class Headers {
      private readonly cursor = cursor;

      entries() {
        return this.cursor;
      }
    };
    Object.defineProperties(HeaderCollection.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: HeaderCollection.prototype.entries },
    });
    let unavailable = false;
    let failures = 0;
    const headers = new Proxy(new HeaderCollection(), {
      getOwnPropertyDescriptor(object, key) {
        if (unavailable && key === Symbol.iterator) {
          unavailable = false;
          failures += 1;
          throw new Error('Descriptor temporarily unavailable');
        }
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      unavailable = true;
      return 'subject-token';
    };
    const send = vi.fn(() => Response.json({ ok: true }));
    const transport = createWorkloadIdentityTransport(send);
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const request = client.post('/synthetic', {
      headers: headers as unknown as Headers,
      body: { input: 'synthetic' },
    });
    await (name === 'Authorization'
      ? expect(request).rejects.toThrow(
          'Cannot replay Authorization after header descriptor evidence is lost',
        )
      : expect(request).resolves.toEqual({ ok: true }));

    expect(send).toHaveBeenCalledTimes(name === 'Authorization' ? 0 : 1);
    expect(failures).toBe(1);
  });

  test.each(['source iterator', 'outer slot', 'name', 'value', 'nested slot', 'nested iterator'] as const)(
    'handles lost %s evidence before a retry',
    async (location) => {
      let opaque = false;
      let live: unknown;
      const read = vi.fn(() => {
        if (name === 'X-Note' && read.mock.calls.length > 1) {
          throw new Error('The ordinary header getter was consumed twice');
        }
        return live;
      });
      function expose<T extends object>(target: T, key: PropertyKey, value: unknown): T {
        live = value;
        Object.defineProperty(target, key, { configurable: true, get: read });
        return new Proxy(target, {
          getOwnPropertyDescriptor(object, property) {
            if (opaque && property === key) {
              throw new Error('Descriptor unavailable');
            }
            return Reflect.getOwnPropertyDescriptor(object, property);
          },
        });
      }
      const row = [name, 'synthetic initial'];
      let headers: HeadersLike;
      if (location === 'source iterator') {
        const rows = [row];
        headers = expose(rows, Symbol.iterator, rows[Symbol.iterator]);
      } else if (location === 'outer slot') {
        headers = expose([row], '0', row);
      } else if (location === 'name' || location === 'value') {
        const key = location === 'name' ? '0' : '1';
        headers = [expose(row, key, row[Number(key)])];
      } else {
        const values = ['synthetic initial'];
        headers = {
          [name]:
            location === 'nested slot'
              ? expose(values, '0', values[0])
              : expose(values, Symbol.iterator, values[Symbol.iterator]),
        };
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get(name));
        opaque = true;
        live = 'synthetic replacement';
        return Response.json(
          { ok: true },
          { status: sent.length === 1 ? 500 : 200, headers: { 'retry-after-ms': '0' } },
        );
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 1,
      });

      const request = client.post('/synthetic', { headers, body: { input: 'synthetic' } });
      await (name === 'Authorization'
        ? expect(request).rejects.toThrow(
            'Cannot replay Authorization after header descriptor evidence is lost',
          )
        : expect(request).resolves.toEqual({ ok: true }));

      expect(sent).toEqual(
        name === 'Authorization' ? ['synthetic initial'] : ['synthetic initial', 'synthetic initial'],
      );
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  test('handles lost outer-slot evidence during token acquisition', async () => {
    let opaque = false;
    let live = [name, name === 'Authorization' ? 'Bearer workload-identity-auth' : 'synthetic initial'];
    const read = vi.fn(() => live);
    const rows = [live];
    Object.defineProperty(rows, '0', { configurable: true, get: read });
    const headers = new Proxy(rows, {
      getOwnPropertyDescriptor(object, key) {
        if (opaque && key === '0') {
          throw new Error('Descriptor unavailable');
        }
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      live = [name, 'synthetic replacement'];
      opaque = true;
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get(name));
      return Response.json({ ok: true });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      workloadIdentity: identity,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const request = client.post('/synthetic', { headers, body: { input: 'synthetic' } });
    await (name === 'Authorization'
      ? expect(request).rejects.toThrow(
          'Cannot replay Authorization after header descriptor evidence is lost',
        )
      : expect(request).resolves.toEqual({ ok: true }));

    expect(sent).toEqual(name === 'Authorization' ? [] : ['synthetic initial']);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
