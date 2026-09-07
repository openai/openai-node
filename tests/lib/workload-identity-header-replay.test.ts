/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected header hooks. */
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

beforeEach(() => {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable until unstubAllEnvs restores it.
  vi.stubEnv('OPENAI_API_KEY', undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable until unstubAllEnvs restores it.
  vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

class OneShotHeaders extends Array<[string, string | null]> {
  #iterator: ReturnType<[string, string | null][]['values']> | undefined;

  override [Symbol.iterator]() {
    return (this.#iterator ??= super[Symbol.iterator]());
  }
}

test.each(
  [false, true].flatMap((fresh) =>
    [false, true].flatMap((sentinel) =>
      [null, '', 'Bearer independent'].map((authorization) => ({ fresh, sentinel, authorization })),
    ),
  ),
)(
  'keeps a Headers-shaped one-shot iterator snapshot-only: %j',
  async ({ fresh, sentinel, authorization }) => {
    const SpoofedHeaders = class Headers {
      private iterator = [['Authorization', authorization] as const][Symbol.iterator]();

      entries() {
        const { iterator } = this;
        return fresh
          ? (function* replayEntries() {
              if (sentinel) {
                yield ['X-Custom', 'fixed'];
              }
              yield* iterator;
            })()
          : iterator;
      }
    };
    Object.defineProperties(SpoofedHeaders.prototype, {
      [Symbol.toStringTag]: { value: 'Headers' },
      [Symbol.iterator]: { value: SpoofedHeaders.prototype.entries },
    });
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(authorization);
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await expect(
      client.models.list({ headers: new SpoofedHeaders() as unknown as Headers }),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(transport.exchanges).toBe(0);
  },
);

describe.each(['authHeaders', 'bearerAuth'] as const)('one-shot defaults in %s', (hook) => {
  test.each([false, true])('lets the custom hook consume defaults first with body: %s', async (body) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        if (hook !== 'authHeaders') {
          return super.authHeaders(...args);
        }
        return this.defaultCredential();
      }

      protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
        if (hook !== 'bearerAuth') {
          return super.bearerAuth(...args);
        }
        return this.defaultCredential();
      }

      private defaultCredential() {
        const credential = new Headers(
          this._options.defaultHeaders as ConstructorParameters<typeof Headers>[0],
        ).get('X-Credential');
        return buildHeaders([{ Authorization: `Bearer ${credential ?? 'fallback'}` }]);
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer intended');
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      defaultHeaders: new OneShotHeaders(['X-Credential', 'intended']),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await (body ? client.post('/synthetic', { body: { synthetic: true } }) : client.models.list());
    expect(transport.exchanges).toBe(0);
  });
});

test.each(['Headers', 'array'] as const)(
  'refreshes a mutable %s through its captured native iterator without rereading the getter',
  async (kind) => {
    const headers = kind === 'Headers' ? new Headers({ 'X-Custom': 'before' }) : [['X-Custom', 'before']];
    const nativeIterator = headers[Symbol.iterator];
    const readIterator = vi.fn(() => nativeIterator);
    Object.defineProperty(headers, Symbol.iterator, { get: readIterator });
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      if (headers instanceof Headers) {
        headers.set('Authorization', 'Bearer independent');
      } else {
        headers.push(['Authorization', 'Bearer independent']);
      }
      return 'subject-token';
    };
    let calls = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      calls += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      workloadIdentity: identity,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.models.list({ headers })).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
    expect(transport.exchanges).toBe(1);
    expect(readIterator).toHaveBeenCalledTimes(1);
  },
);
