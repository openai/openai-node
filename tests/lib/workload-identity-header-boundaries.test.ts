/* oxlint-disable max-classes-per-file -- Focused fixtures exercise protected header boundaries. */
import OpenAI from 'openai';
import { vi } from 'vitest';
import { buildHeaders } from 'openai/internal/headers';
import type { HeadersInit } from 'openai/internal/builtin-types';
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

function* emptyIterator() {}

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

test('does not let an unrelated standalone build overwrite an active request snapshot', async () => {
  let entered!: () => void;
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- Controlled request interleaving requires a gate.
  const enteredBuild = new Promise<void>((resolve) => {
    entered = resolve;
  });
  // oxlint-disable-next-line promise/avoid-new -- Controlled request interleaving requires a gate.
  const resumeBuild = new Promise<void>((resolve) => {
    release = resolve;
  });
  class PausingClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      if (args[0].path === '/held') {
        entered();
        await resumeBuild;
      }
      return super.buildRequest(...args);
    }
  }
  let sent: string | null | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers).get('Authorization');
    return Response.json({ data: [] });
  });
  const client = new PausingClient({
    ...createTestClientOptions(),
    defaultHeaders: {},
    fetch: transport.fetch,
    maxRetries: 0,
  });
  const headers: [string, string | null][] = [['Authorization', null]];
  const iterator = headers.values();
  headers[Symbol.iterator] = () => iterator;

  const pending = client.get('/held', { headers });
  await enteredBuild;
  await client.buildRequest({
    method: 'get',
    path: '/standalone',
    headers: { Authorization: 'Bearer synthetic-independent' },
  });
  release();
  await pending;

  expect(sent).toBeNull();
  expect(transport.exchanges).toBe(0);
});

test.each(
  ['prepare-request', 'prepare-default', 'auth-request', 'auth-default'].flatMap((stage) =>
    [null, 'Bearer synthetic-replacement'].map((authorization) => ({ stage, authorization })),
  ),
)(
  'honors mutable headers after a canonical $stage read to $authorization',
  async ({ stage, authorization }) => {
    const headers: Record<string, string | null> = { Authorization: 'Bearer synthetic-original' };
    class ReadingClient extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        if (stage.startsWith('prepare')) {
          buildHeaders([stage.endsWith('default') ? this._options.defaultHeaders : options.headers]);
          headers['Authorization'] = authorization;
        }
      }

      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        if (stage.startsWith('auth')) {
          buildHeaders([stage.endsWith('default') ? this._options.defaultHeaders : args[0].headers]);
          headers['Authorization'] = authorization;
        }
        return super.authHeaders(...args);
      }
    }
    let sent: string | null | undefined;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent = new Headers(init?.headers).get('Authorization');
      return Response.json({ data: [] });
    });
    const client = new ReadingClient({
      ...createTestClientOptions(),
      defaultHeaders: stage.endsWith('default') ? headers : undefined,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers: stage.endsWith('default') ? undefined : headers });

    expect(sent).toBe(authorization);
  },
);

test('preserves nested value iterator accessor results', async () => {
  let reads = 0;
  const values = ['Bearer synthetic-independent'];
  Object.defineProperty(values, Symbol.iterator, {
    get() {
      reads += 1;
      return reads === 1 ? Array.prototype.values : emptyIterator;
    },
  });
  let sent: string | null | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers).get('Authorization');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

  await client.models.list({ headers: { Authorization: values } });

  expect(sent).toBe('Bearer synthetic-independent');
  expect(reads).toBe(1);
  expect(transport.exchanges).toBe(0);
});

test('preserves custom auth first access to shared default and request headers', async () => {
  class CustomAuthClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This fixture models a custom authentication hook.
    protected override async authHeaders(options: FinalRequestOptions) {
      const input = new Headers(options.headers as HeadersInit);
      return buildHeaders([{ Authorization: `Bearer ${input.get('X-Credential') ?? 'fallback'}` }]);
    }
  }
  const rows = [['X-Credential', 'synthetic-independent']];
  const cursor = rows.values();
  rows[Symbol.iterator] = () => cursor;
  let sent: string | null | undefined;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent = new Headers(init?.headers).get('Authorization');
    return Response.json({ data: [] });
  });
  const client = new CustomAuthClient({
    ...createTestClientOptions(),
    defaultHeaders: rows,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers: rows });

  expect(sent).toBe('Bearer synthetic-independent');
});

test('reads a shared native iterator accessor only once', async () => {
  const headers = new Headers({ Authorization: 'Bearer synthetic-independent' });
  const iterator = headers[Symbol.iterator];
  let reads = 0;
  Object.defineProperty(headers, Symbol.iterator, {
    get() {
      reads += 1;
      if (reads > 1) {
        throw new Error('iterator accessor read twice');
      }
      return iterator;
    },
  });
  const transport = createWorkloadIdentityTransport(() => Response.json({ data: [] }));
  const client = new OpenAI({
    ...createTestClientOptions(),
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers });

  expect(reads).toBe(1);
});
