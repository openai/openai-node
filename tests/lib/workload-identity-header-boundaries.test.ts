/* oxlint-disable max-classes-per-file -- Focused fixtures exercise protected header boundaries. */
import OpenAI from 'openai';
import { vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

beforeEach(() => {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable.
  vi.stubEnv('OPENAI_API_KEY', undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined unsets the variable.
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

test.each(['array index accessor', 'one-shot array value'] as const)(
  'snapshots nested one-shot header state: %s',
  async (kind) => {
    let reads = 0;
    let headers: string[][] | Record<string, string[]>;
    if (kind === 'array index accessor') {
      headers = [];
      Object.defineProperty(headers, 0, {
        enumerable: true,
        get() {
          reads += 1;
          return ['Authorization', reads === 1 ? 'Bearer independent' : undefined];
        },
      });
    } else {
      const values = ['Bearer independent'];
      const iterator = values.values();
      values[Symbol.iterator] = () => {
        reads += 1;
        return iterator;
      };
      headers = { Authorization: values };
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

    await client.models.list({ headers });

    expect(reads).toBe(1);
    expect(transport.exchanges).toBe(0);
  },
);

test('keeps request and default snapshot state independent when their source starts shared', async () => {
  let reads = 0;
  const sharedHeaders = {
    get 'X-Custom'() {
      reads += 1;
      return reads === 1 ? 'preserved' : undefined;
    },
  };
  class DefaultHeaderClient extends OpenAI {
    replaceDefaults() {
      this._options.defaultHeaders = { 'X-Default': 'replacement' };
    }
  }
  const identity = createTestWorkloadIdentity();
  // oxlint-disable-next-line prefer-const -- The provider captures the client before construction snapshots it.
  let client: DefaultHeaderClient;
  identity.provider.getToken = async () => {
    client.replaceDefaults();
    return 'subject-token';
  };
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
    return Response.json({ data: [] });
  });
  client = new DefaultHeaderClient({
    ...createTestClientOptions(),
    defaultHeaders: sharedHeaders,
    workloadIdentity: identity,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers: sharedHeaders });

  expect(reads).toBe(1);
});

test('preserves an inspected one-shot removal without requiring prepareOptions to replace it', async () => {
  class InspectingClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture inspects caller headers in preparation.
    protected override async prepareOptions(options: FinalRequestOptions) {
      expect(buildHeaders([options.headers]).nulls.has('authorization')).toBe(true);
    }
  }
  const transport = createWorkloadIdentityTransport((_url, init) => {
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    return Response.json({ data: [] });
  });
  const client = new InspectingClient({
    ...createTestClientOptions(),
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers: new OneShotHeaders(['Authorization', null]) });

  expect(transport.exchanges).toBe(0);
});
