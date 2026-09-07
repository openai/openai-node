/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct transport hooks. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

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

test.each(['native-independent', 'native-workload', 'subclass-divergent', 'subclass-throwing'] as const)(
  'uses native header storage for %s transport attribution',
  async (kind) => {
    let getCalls = 0;
    let issuedAuthorization: string | null = null;
    const independent = kind === 'native-independent' || kind === 'subclass-divergent';
    const NativeBrandedHeaders = class Headers extends globalThis.Headers {};
    Object.defineProperties(NativeBrandedHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: Headers.prototype[Symbol.iterator] },
      entries: { value: Headers.prototype.entries },
      get: {
        configurable: true,
        writable: true,
        value(this: globalThis.Headers, name: string) {
          getCalls += 1;
          if (name.toLowerCase() === 'authorization') {
            if (kind === 'subclass-throwing') {
              throw new Error('Subclass get must not run during attribution');
            }
            return issuedAuthorization;
          }
          return globalThis.Headers.prototype.get.call(this, name);
        },
      },
    });
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, request] = args;
        if (!request) {
          throw new Error('Expected a request');
        }
        issuedAuthorization = new Headers(request.headers).get('Authorization');
        if (issuedAuthorization === null) {
          throw new Error('Expected workload authorization');
        }
        const values = {
          Authorization: independent ? 'Bearer independent' : issuedAuthorization,
          'X-Custom': 'synthetic-extension',
        };
        request.headers =
          kind === 'subclass-divergent' || kind === 'subclass-throwing'
            ? new NativeBrandedHeaders(values)
            : new Headers(values);
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const serialized = new Headers(init?.headers);
      sent.push(serialized.get('Authorization'));
      expect(serialized.get('X-Custom')).toBe('synthetic-extension');
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const request = client.models.list();
    await (independent ? expect(request).rejects.toMatchObject({ status: 401 }) : request);

    expect(sent).toEqual(
      independent ? ['Bearer independent'] : ['Bearer access-token-1', 'Bearer access-token-2'],
    );
    expect(getCalls).toBe(0);
    expect(transport.exchanges).toBe(independent ? 1 : 2);
  },
);
