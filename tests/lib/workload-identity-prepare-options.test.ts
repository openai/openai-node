/* oxlint-disable max-classes-per-file -- Independent fixtures exercise preparation boundaries. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

class OneShotHeaders extends Array<[string, string]> {
  #iterator: ReturnType<[string, string][]['values']> | undefined;

  override [Symbol.iterator]() {
    return (this.#iterator ??= super[Symbol.iterator]());
  }
}

test.each(['native', 'direct'] as const)(
  'preserves one-shot input for %s preparation inspection',
  async (inspection) => {
    const headers = new OneShotHeaders(
      ['Authorization', 'Bearer independent'],
      ['X-Credential', 'preserved'],
    );
    const options: FinalRequestOptions = { method: 'get', path: '/models', headers };
    class PreparingClient extends OpenAI {
      protected override async prepareOptions(received: FinalRequestOptions) {
        expect(received).toBe(options);
        expect(received.headers).toBe(headers);
        const parsed = new Headers(inspection === 'native' ? headers : [...headers]);
        expect(parsed.get('X-Credential')).toBe('preserved');
        received.headers = parsed;
        await super.prepareOptions(received);
      }
    }
    let dispatches = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      dispatches += 1;
      const sent = new Headers(init?.headers);
      expect(sent.get('Authorization')).toBe('Bearer independent');
      expect(sent.get('X-Credential')).toBe('preserved');
      return Response.json({ data: [] });
    });
    const client = new PreparingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.request(options);

    expect(dispatches).toBe(1);
    expect(transport.exchanges).toBe(0);
  },
);

test.each(['native', 'direct'] as const)(
  'preserves one-shot input for %s bodyless authentication inspection',
  async (inspection) => {
    const headers = new OneShotHeaders(['X-Credential', 'independent']);
    const options: FinalRequestOptions = { method: 'get', path: '/models', headers };
    class AuthenticatingClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- This protected hook resolves caller-supplied credentials.
      protected override async authHeaders(received: FinalRequestOptions) {
        expect(received).toBe(options);
        expect(received.headers).toBe(headers);
        const parsed = new Headers(inspection === 'native' ? headers : [...headers]);
        expect(parsed.get('X-Credential')).toBe('independent');
        return buildHeaders([{ Authorization: `Bearer ${parsed.get('X-Credential')}` }]);
      }
    }
    let dispatches = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      dispatches += 1;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer independent');
      return Response.json({ data: [] });
    });
    const client = new AuthenticatingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.request(options);

    expect(dispatches).toBe(1);
    expect(transport.exchanges).toBe(0);
  },
);

test('allows preparation to sanitize headers before serialization', async () => {
  const headers: Record<string, string> = { 'invalid name': 'remove', 'X-Custom': 'preserved' };
  const options: FinalRequestOptions = { method: 'get', path: '/models', headers };
  class PreparingClient extends OpenAI {
    protected override async prepareOptions(received: FinalRequestOptions) {
      expect(received).toBe(options);
      delete headers['invalid name'];
      await super.prepareOptions(received);
    }
  }
  let dispatches = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    dispatches += 1;
    expect(new Headers(init?.headers).get('X-Custom')).toBe('preserved');
    return Response.json({ data: [] });
  });
  const client = new PreparingClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    maxRetries: 0,
    fetch: transport.fetch,
  });

  await client.request(options);

  expect(dispatches).toBe(1);
  expect(transport.exchanges).toBe(1);
});

test('evaluates default headers before accessor-backed request headers', async () => {
  let defaultsRead = false;
  const order: string[] = [];
  const defaultHeaders = {
    get 'X-Default'() {
      order.push('default');
      defaultsRead = true;
      return 'preserved';
    },
  };
  const headers = {
    get Authorization() {
      order.push('request');
      return defaultsRead ? null : undefined;
    },
  };
  let dispatches = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    dispatches += 1;
    const sent = new Headers(init?.headers);
    expect(sent.has('Authorization')).toBe(false);
    expect(sent.get('X-Default')).toBe('preserved');
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    maxRetries: 0,
    defaultHeaders,
    fetch: transport.fetch,
  });

  await client.models.list({ headers });

  expect(order).toEqual(['default', 'request']);
  expect(dispatches).toBe(1);
  expect(transport.exchanges).toBe(0);
});

test.each(['default', 'request'] as const)(
  'keeps concurrent accessor-backed %s credentials request-owned',
  async (location) => {
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Hold both preparation scopes open to expose shared snapshots.
    const bothPreparing = new Promise<void>((resolve) => {
      release = resolve;
    });
    let preparations = 0;
    let reads = 0;
    const headers = {
      get Authorization() {
        reads += 1;
        return `Bearer independent-${reads}`;
      },
    };
    class PreparingClient extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        preparations += 1;
        if (preparations === 2) {
          release();
        }
        await bothPreparing;
        await super.prepareOptions(options);
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ data: [] });
    });
    const client = new PreparingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      defaultHeaders: location === 'default' ? headers : undefined,
      fetch: transport.fetch,
    });
    const requestHeaders = location === 'request' ? headers : undefined;

    await Promise.all([
      client.get('/request-a', { headers: requestHeaders }),
      client.get('/request-b', { headers: requestHeaders }),
    ]);

    expect(reads).toBe(2);
    expect(authorizations).toHaveLength(2);
    expect(authorizations).toEqual(expect.arrayContaining(['Bearer independent-1', 'Bearer independent-2']));
    expect(transport.exchanges).toBe(0);
  },
);
