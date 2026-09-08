/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct transport hooks. */
import OpenAI from 'openai';
import { describe, test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['structural', 'foreign'] as const)('%s early placeholder reader', (realm) => {
  test
    .skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24)
    .each(['independent', 'placeholder'] as const)(
    'uses the emitted %s credential and preserves the caller collection',
    async (emitted) => {
      const foreign = realm === 'foreign' ? await import('undici') : undefined;
      const HeaderBase =
        foreign?.Headers ??
        class {
          #values: Headers;

          constructor(values: Record<string, string>) {
            this.#values = new Headers(values);
          }

          get(name: string) {
            return this.#values.get(name);
          }
          has(name: string) {
            return this.#values.has(name);
          }
          set(name: string, value: string) {
            this.#values.set(name, value);
          }
          append(name: string, value: string) {
            this.#values.append(name, value);
          }
          delete(name: string) {
            this.#values.delete(name);
          }
          entries() {
            return this.#values.entries();
          }
        };
      const SuppliedHeaders = class Headers extends HeaderBase {};
      for (const name of ['entries', 'has', 'set', 'append', 'delete'] as const) {
        Object.defineProperty(SuppliedHeaders.prototype, name, { value: HeaderBase.prototype[name] });
      }
      Object.defineProperties(SuppliedHeaders.prototype, {
        get: {
          configurable: true,
          writable: true,
          value(this: object, name: string) {
            const value: string | null = Reflect.apply(HeaderBase.prototype.get, this, [name]);
            return name.toLowerCase() === 'authorization' ? 'Bearer workload-identity-auth' : value;
          },
        },
        [Symbol.toStringTag]: { value: 'Headers' },
        [Symbol.iterator]: { value: HeaderBase.prototype.entries },
      });
      const original = emitted === 'independent' ? 'Bearer independent' : 'Bearer workload-identity-auth';
      const supplied = new SuppliedHeaders({ Authorization: original });
      class HookClient extends OpenAI {
        protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
          args[1].headers = supplied as unknown as Headers;
          return super.fetchWithAuth(...args);
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        const request = new Request(url, init as globalThis.RequestInit);
        expect(request.method).toBe('POST');
        sent.push(request.headers.get('Authorization'));
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await expect(client.post('/synthetic', { body: { value: 1 } })).rejects.toMatchObject({ status: 401 });

      expect(
        sent.every(
          (authorization, index) =>
            authorization === (emitted === 'independent' ? original : `Bearer access-token-${index + 1}`),
        ),
      ).toBe(true);
      expect(sent).toHaveLength(emitted === 'independent' ? 1 : 2);
      expect(Reflect.apply(HeaderBase.prototype.get, supplied, ['Authorization']) === original).toBe(true);
      expect(transport.exchanges).toBe(emitted === 'independent' ? 1 : 2);
    },
  );
});

test.each(['buildRequest', 'fetchWithAuth', 'fetchWithTimeout'] as const)(
  'dispatches structural header serialization, not its divergent get result, through %s',
  async (hook) => {
    let reads = 0;
    const StructuralHeaders = class Headers {
      // oxlint-disable-next-line class-methods-use-this -- This deliberately disagrees with iterator serialization.
      get() {
        if (hook === 'buildRequest') {
          throw new Error('Unverified get must not run during bookkeeping');
        }
        return 'Bearer access-token-1';
      }

      // oxlint-disable-next-line class-methods-use-this -- The structural fixture shares a counted iterator.
      *entries() {
        reads += 1;
        yield ['Authorization', 'Bearer independent'];
      }
    };
    Object.defineProperties(StructuralHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: StructuralHeaders.prototype.entries },
    });
    const supplied = new StructuralHeaders() as unknown as Headers;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        if (hook === 'buildRequest') {
          built.req.headers = supplied;
        }
        return built;
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (hook === 'fetchWithAuth') {
          args[1].headers = supplied;
        }
        return super.fetchWithAuth(...args);
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (hook === 'fetchWithTimeout' && args[1]) {
          args[1].headers = supplied;
        }
        return super.fetchWithTimeout(...args);
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(init?.headers).toBeInstanceOf(Headers);
      expect(init?.headers).not.toBe(supplied);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(calls).toBe(1);
    expect(reads).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);
