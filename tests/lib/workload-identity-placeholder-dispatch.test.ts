/* oxlint-disable max-classes-per-file -- Independent fixtures exercise separate delegation contracts. */
import OpenAI from 'openai';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

function deferred() {
  let resolveGate!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The gate controls a pending authentication or dispatch.
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return { promise, resolve: resolveGate };
}

test.each(['success', 'refresh', 'independent-replacement'] as const)(
  'retains workload authorization when a frozen native init is reused: %s',
  async (mode) => {
    class ReusingClient extends OpenAI {
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const [url, init, timeout, controller, , context] = args;
        const { headers } = init;
        if (!(headers instanceof Headers)) {
          throw new Error('Expected native request headers');
        }
        Object.freeze(init);
        const first = await super.fetchWithAuth(...args);
        await first.body?.cancel();
        expect(init.headers).toBe(headers);
        if (mode === 'independent-replacement') {
          headers.set('Authorization', 'Bearer access-token-1');
        }
        return super.fetchWithTimeout(url, init, timeout, controller, context);
      }
    }

    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return mode !== 'success' && sent.length === 2
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new ReusingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const request = client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });
    await (mode === 'independent-replacement'
      ? expect(request).rejects.toMatchObject({ status: 401 })
      : request);
    expect(sent).toEqual(
      mode === 'refresh'
        ? ['Bearer access-token-1', 'Bearer access-token-1', 'Bearer access-token-2', 'Bearer access-token-2']
        : ['Bearer access-token-1', 'Bearer access-token-1'],
    );
    expect(transport.exchanges).toBe(mode === 'refresh' ? 2 : 1);
  },
);

test.each([false, true])('honors disabled bearer auth with a legacy timeout wrapper: %s', async (legacy) => {
  class NoBearerClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- The fixture defers authentication to the transport hook.
    protected override bearerAuth() {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The hook requires Promise<undefined>, not Promise<void>.
      return Promise.resolve<undefined>(undefined);
    }

    protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
      const [url, init, timeout, controller, schemes, context] = args;
      return super.fetchWithAuth(url, init, timeout, controller, { ...schemes, bearerAuth: false }, context);
    }

    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, controller] = args;
      return legacy
        ? super.fetchWithTimeout(url, init, timeout, controller)
        : super.fetchWithTimeout(...args);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ data: [] });
  });
  const client = new NoBearerClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });

  expect(sent).toEqual(['Bearer workload-identity-auth']);
  expect(transport.exchanges).toBe(0);
});

test.each(['record', 'iterable'] as const)(
  'resolves an opaque placeholder when a legacy wrapper replaces both dispatch identities: %s',
  async (kind) => {
    class ReplacingClient extends OpenAI {
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const headers = new Headers(args[1].headers);
        args[1].headers =
          kind === 'record' ? Object.fromEntries(headers) : (headers.entries() as unknown as Headers);
        return super.fetchWithAuth(...args);
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout] = args;
        return super.fetchWithTimeout(url, { ...init }, timeout, new AbortController());
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ data: [] });
    });
    const client = new ReplacingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });

    expect(sent).toEqual(['Bearer access-token-1']);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(
  [false, true].flatMap((legacy) => [false, true].map((sharedController) => ({ legacy, sharedController }))),
)(
  'keeps concurrent bearer schemes separate with a legacy wrapper: $legacy, shared controller: $sharedController',
  async ({ legacy, sharedController }) => {
    const enabledSent = deferred();
    class ConcurrentClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- The fixture defers authentication to the transport hook.
      protected override bearerAuth() {
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The hook requires Promise<undefined>, not Promise<void>.
        return Promise.resolve<undefined>(undefined);
      }

      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        const [url, init, timeout, controller, schemes, context] = args;
        const calls = [false, true].map((bearerAuth) => {
          const headers = new Headers(init.headers);
          headers.set('X-Bearer-Enabled', String(bearerAuth));
          return super.fetchWithAuth(
            url,
            { ...init, headers },
            timeout,
            sharedController ? controller : new AbortController(),
            { ...schemes, bearerAuth },
            context,
          );
        });
        const [disabled, enabled] = await Promise.all(calls);
        await enabled?.body?.cancel();
        if (!disabled) {
          throw new Error('Expected the disabled bearer dispatch');
        }
        return disabled;
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, controller] = args;
        const enabled = new Headers(init?.headers).get('X-Bearer-Enabled') === 'true';
        if (!enabled) {
          await enabledSent.promise;
        }
        try {
          return await (legacy
            ? super.fetchWithTimeout(url, init, timeout, controller)
            : super.fetchWithTimeout(...args));
        } finally {
          if (enabled) {
            enabledSent.resolve();
          }
        }
      }
    }
    const sent = new Map<string | null, string | null>();
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const headers = new Headers(init?.headers);
      sent.set(headers.get('X-Bearer-Enabled'), headers.get('Authorization'));
      return Response.json({ data: [] });
    });
    const client = new ConcurrentClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });

    expect(sent.get('false')).toBe('Bearer workload-identity-auth');
    expect(sent.get('true')).toBe('Bearer access-token-1');
    expect(sent.size).toBe(2);
    expect(transport.exchanges).toBe(1);
  },
);

test('logs effective headers when dispatching a native Request', async () => {
  class RequestClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, controller, context] = args;
      return super.fetchWithTimeout(new Request(String(url), init), undefined, timeout, controller, context);
    }
  }
  const records: unknown[] = [];
  const logger = {
    debug(...args: unknown[]) {
      records.push(args);
    },
    info() {},
    warn() {},
    error() {},
  };
  const transport = createWorkloadIdentityTransport((url, init) => {
    expect(new Request(url as Request, init).headers.get('X-Debug-Marker')).toBe('present');
    return Response.json({ data: [] });
  });
  const client = new RequestClient({
    ...createTestClientOptions(),
    apiKey: null,
    fetch: transport.fetch,
    logger,
    logLevel: 'debug',
    maxRetries: 0,
  });

  await client.models.list({ headers: { 'X-Debug-Marker': 'present' } });

  expect(JSON.stringify(records)).toContain('x-debug-marker');
});

test('preserves an independent replacement while placeholder token acquisition is pending', async () => {
  const started = deferred();
  const release = deferred();
  let preparedHeaders: Headers | undefined;
  class PendingClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- The fixture defers authentication to the transport hook.
    protected override bearerAuth() {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The hook requires Promise<undefined>, not Promise<void>.
      return Promise.resolve<undefined>(undefined);
    }

    // oxlint-disable-next-line class-methods-use-this -- The fixture records the public prepareRequest boundary.
    protected override async prepareRequest(...args: Parameters<OpenAI['prepareRequest']>) {
      const [init] = args;
      const { headers } = init;
      if (!(headers instanceof Headers)) {
        throw new Error('Expected native request headers');
      }
      preparedHeaders = headers;
      Object.freeze(init);
    }
  }
  const options = createTestClientOptions();
  options.workloadIdentity.provider.getToken = async () => {
    started.resolve();
    await release.promise;
    return 'subject-token';
  };
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
  });
  const client = new PendingClient({
    ...options,
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  const request = client.models.list({ headers: { Authorization: 'Bearer workload-identity-auth' } });
  const result = (async () => {
    try {
      await request;
      return null;
    } catch (error) {
      return error;
    }
  })();
  await started.promise;
  if (!preparedHeaders) {
    throw new Error('Expected prepared headers before token acquisition');
  }
  preparedHeaders.set('Authorization', 'Bearer independent');
  release.resolve();
  expect(await result).toMatchObject({ status: 401 });

  expect(sent).toEqual(['Bearer independent']);
  expect(transport.exchanges).toBe(1);
});
