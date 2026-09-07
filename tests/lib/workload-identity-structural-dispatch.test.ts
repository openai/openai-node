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
        if (hook === 'buildRequest') {throw new Error('Unverified get must not run during bookkeeping');}
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
        if (hook === 'buildRequest') {built.req.headers = supplied;}
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
