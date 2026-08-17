import { expect, vi } from 'vitest';

import OpenAI, { APIUserAbortError, AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_certificate_a',
  serviceAccountId: 'svc_certificate_a',
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

function replaceAuthorizationWithBasic(
  url: RequestInfo,
  init: RequestInit,
): { url: RequestInfo; init: RequestInit } {
  (init.headers as Headers).set('Authorization', 'Basic customer-secret');
  return { url, init };
}

class BoundaryMutatingOpenAI extends OpenAI {
  builtRequestMutation?: (built: Awaited<ReturnType<OpenAI['buildRequest']>>) => void;
  fetchMutation?: (url: RequestInfo, init: RequestInit) => { url: RequestInfo; init: RequestInit };
  timeoutMutation?: (url: RequestInfo, init: RequestInit) => { url: RequestInfo; init: RequestInit };
  readonly prepared = new WeakMap<FinalRequestOptions, string>();
  observedIdentity: string | undefined;
  optionsMutation?: (options: FinalRequestOptions) => void;

  override async buildRequest(
    options: FinalRequestOptions,
    requestOptions: { retryCount?: number } = {},
  ): Promise<Awaited<ReturnType<OpenAI['buildRequest']>>> {
    const built = await super.buildRequest(options, requestOptions);
    this.builtRequestMutation?.(built);
    return built;
  }

  protected override async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    const effective = this.fetchMutation?.(url, init) ?? { url, init };
    return await super.fetchWithAuth(effective.url, effective.init, timeout, controller, schemes);
  }

  override async fetchWithTimeout(
    url: RequestInfo,
    init: RequestInit | undefined,
    timeout: number,
    controller: AbortController,
  ): Promise<Response> {
    const effective = init && this.timeoutMutation ? this.timeoutMutation(url, init) : { url, init };
    return await super.fetchWithTimeout(effective.url, effective.init, timeout, controller);
  }

  protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    await super.prepareOptions(options);
    this.prepared.set(options, 'original-request-options');
  }

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    this.observedIdentity = this.prepared.get(options);
    this.optionsMutation?.(options);
    return await super.authHeaders(options, schemes);
  }
}

describe('X.509 final security boundaries', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test.each([
    'http://attacker.invalid/v1',
    'https://mtls.api.openai.com@attacker.invalid/v1',
    'not-an-absolute-url',
  ])('rejects unsafe configured X.509 API base %s before any exchange', (baseURL) => {
    const customFetch = vi.fn();

    expect(
      () => new OpenAI({ apiKey: null, workloadIdentity: identity, baseURL, fetch: customFetch }),
    ).toThrow(/https|origin|user/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('rejects an inherited plaintext API base before any exchange', () => {
    process.env['OPENAI_BASE_URL'] = 'http://attacker.invalid/v1';
    const customFetch = vi.fn();

    expect(() => new OpenAI({ apiKey: null, workloadIdentity: identity, fetch: customFetch })).toThrow(
      /https/iu,
    );
    expect(customFetch).not.toHaveBeenCalled();
  });

  test.each([
    'http://attacker.invalid/v1/models',
    'https://attacker.invalid/v1/models',
    'https://mtls.api.openai.com@attacker.invalid/v1/models',
  ])('rejects an absolute cross-origin request %s before exchanging credentials', async (path) => {
    const customFetch = vi.fn();
    const client = new OpenAI({ apiKey: null, workloadIdentity: identity, fetch: customFetch });

    await expect(client.get(path)).rejects.toThrow(/https|origin|user/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('rejects a runtime plaintext base URL before exchanging credentials', async () => {
    const customFetch = vi.fn();
    const client = new OpenAI({ apiKey: null, workloadIdentity: identity, fetch: customFetch });
    client.baseURL = 'http://attacker.invalid/v1';

    await expect(client.models.list()).rejects.toThrow(/https/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('allows an explicit HTTPS gateway and same-origin absolute request URL', async () => {
    const requests: string[] = [];
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      baseURL: 'https://gateway.example/openai/v1',
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return url.toString().includes('/oauth/token')
          ? tokenResponse('gateway-token')
          : Response.json({ data: [] });
      }),
    });

    await expect(client.get('https://gateway.example/openai/v1/models')).resolves.toMatchObject({
      data: [],
    });
    expect(requests).toEqual([
      'https://mtls.auth.openai.com/oauth/token',
      'https://gateway.example/openai/v1/models',
    ]);
  });

  test('keeps a supported admin API key out of X.509 exchange and ordinary bearer requests', async () => {
    const client = new OpenAI({
      apiKey: null,
      adminAPIKey: 'admin-secret',
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get('Authorization');
        if (url.toString().includes('/oauth/token')) {
          expect(authorization).toBeNull();
          return tokenResponse('certificate-token');
        }
        expect(authorization).toBe('Bearer certificate-token');
        return Response.json({ data: [] });
      }),
    });

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });
  });

  test('preserves the separate admin bearer on an admin-only endpoint without an OAuth exchange', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const client = new OpenAI({
      apiKey: null,
      adminAPIKey: 'expected-admin-secret',
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: url.toString(),
          authorization: new Headers(init?.headers).get('Authorization'),
        });
        return Response.json({ object: 'list', data: [] });
      }),
    });

    await expect(client.admin.organization.adminAPIKeys.list()).resolves.toMatchObject({ data: [] });
    expect(requests).toEqual([
      {
        url: 'https://mtls.api.openai.com/v1/organization/admin_api_keys',
        authorization: 'Bearer expected-admin-secret',
      },
    ]);
  });

  test.each(['fetchWithAuth', 'fetchWithTimeout'] as const)(
    'rejects an admin bearer replaced with Basic auth by %s',
    async (hook) => {
      const customFetch = vi.fn();
      const client = new BoundaryMutatingOpenAI({
        apiKey: null,
        adminAPIKey: 'expected-admin-secret',
        workloadIdentity: identity,
        fetch: customFetch,
      });
      if (hook === 'fetchWithAuth') {
        client.fetchMutation = replaceAuthorizationWithBasic;
      } else {
        client.timeoutMutation = replaceAuthorizationWithBasic;
      }

      await expect(client.admin.organization.adminAPIKeys.list()).rejects.toThrow(
        /authorization|credential/iu,
      );
      expect(customFetch).not.toHaveBeenCalled();
    },
  );

  test('rejects authorization injected into an intentionally headerless X.509 request', async () => {
    const customFetch = vi.fn();
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: customFetch,
    });
    client.fetchMutation = (url, init) => {
      (init.headers as Headers).set('Authorization', 'Basic customer-secret');
      return { url, init };
    };

    await expect(client.models.list({ headers: { Authorization: null } })).rejects.toThrow(
      /authorization|credential/iu,
    );
    expect(customFetch).not.toHaveBeenCalled();
  });

  test.each([
    'api-key',
    'API_KEY',
    'api_key',
    'x-api-key',
    'X_API_KEY',
    'x_api-key',
    'x-api_key',
    'proxy-authorization',
    'PROXY_AUTHORIZATION',
    'proxy_authorization',
  ])('rejects a second %s credential before the token exchange', async (header) => {
    const customFetch = vi.fn();
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      defaultHeaders: { [header]: 'other-provider-secret' },
      fetch: customFetch,
    });

    await expect(client.models.list()).rejects.toThrow(/api.key|credential/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('rejects a request-scoped second API credential before the token exchange', async () => {
    const customFetch = vi.fn();
    const client = new OpenAI({ apiKey: null, workloadIdentity: identity, fetch: customFetch });

    await expect(client.models.list({ headers: { 'api-key': 'other-provider-secret' } })).rejects.toThrow(
      /api.key|credential/iu,
    );
    expect(customFetch).not.toHaveBeenCalled();
  });

  test.each(['api-key', 'entra'] as const)('rejects incompatible Azure %s authentication', (mode) => {
    const customFetch = vi.fn();

    expect(
      () =>
        new AzureOpenAI({
          apiVersion: '2025-01-01-preview',
          endpoint: 'https://example-resource.openai.azure.com',
          ...(mode === 'api-key'
            ? { apiKey: 'azure-secret' }
            : { azureADTokenProvider: async () => 'entra-token' }),
          workloadIdentity: identity,
          fetch: customFetch,
        }),
    ).toThrow(/mutually exclusive|cannot.*combined|api.key/iu);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test.each([
    'api-key',
    'api_key',
    'x-api-key',
    'x_api_key',
    'x_api-key',
    'proxy-authorization',
    'proxy_authorization',
  ])('rejects a second %s credential inserted by a late fetch override', async (header) => {
    const requests: string[] = [];
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('certificate-token');
      }),
    });
    client.fetchMutation = (url, init) => {
      (init.headers as Headers).set(header, 'late-other-provider-secret');
      return { url, init };
    };

    await expect(client.models.list()).rejects.toThrow(/api.key|credential/iu);
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test('rejects a buildRequest override that enables redirects', async () => {
    const requests: string[] = [];
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('certificate-token');
      }),
    });
    client.builtRequestMutation = (built) => {
      built.req.redirect = 'follow';
    };

    await expect(client.models.list()).rejects.toThrow(/redirect/iu);
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test.each([false, true])('rejects late transport and redirect mutation (clone: %s)', async (cloneInit) => {
    const dispatcher = { name: 'certificate-dispatcher' };
    const requests: string[] = [];
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: { dispatcher: dispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('certificate-token');
      }),
    });
    client.fetchMutation = (url, init) => {
      const mutated = cloneInit ? { ...init } : init;
      (mutated as { dispatcher?: unknown }).dispatcher = { name: 'attacker-dispatcher' };
      mutated.redirect = 'follow';
      return { url, init: mutated };
    };

    await expect(client.models.list()).rejects.toThrow(/transport|redirect/iu);
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test('rejects a fetchWithAuth override that redirects the final API origin', async () => {
    const requests: string[] = [];
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('certificate-token');
      }),
    });
    client.fetchMutation = (_url, init) => ({ url: 'https://attacker.invalid/v1/models', init });

    await expect(client.models.list()).rejects.toThrow(/origin/iu);
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test.each([
    {
      name: 'origin',
      mutate: (_url: RequestInfo, init: RequestInit) => ({
        url: 'https://attacker.invalid/v1/models',
        init,
      }),
    },
    {
      name: 'redirect',
      mutate: (url: RequestInfo, init: RequestInit) => ({
        url,
        init: { ...init, redirect: 'follow' as const },
      }),
    },
    {
      name: 'transport',
      mutate: (url: RequestInfo, init: RequestInit) => ({
        url,
        init: { ...init, dispatcher: { name: 'attacker-dispatcher' } as never },
      }),
    },
  ])('rejects final fetchWithTimeout $name mutation', async ({ mutate }) => {
    const dispatcher = { name: 'certificate-dispatcher' };
    const requests: string[] = [];
    const client = new BoundaryMutatingOpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: { dispatcher: dispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request) => {
        requests.push(url.toString());
        return tokenResponse('certificate-token');
      }),
    });
    client.timeoutMutation = mutate;

    await expect(client.models.list()).rejects.toThrow(/origin|redirect|transport/iu);
    expect(requests).toEqual(['https://mtls.auth.openai.com/oauth/token']);
  });

  test.each([false, true])(
    'binds tokens to dispatcher and TLS configuration (derived: %s)',
    async (derived) => {
      const dispatcher = { name: 'shared-dispatcher' };
      const tlsA = { cert: 'certificate-a' };
      const tlsB = { cert: 'certificate-b' };
      const tokens: (string | null)[] = [];
      let exchangeCount = 0;
      const customFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const tls = (init as { tls?: { cert: string } })?.tls;
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse(`token-for-${tls?.cert}`);
        }
        tokens.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        apiKey: null,
        workloadIdentity: identity,
        fetch: customFetch,
        fetchOptions: { dispatcher, tls: tlsA } as never,
      });

      await client.models.list();
      const next = derived
        ? client.withOptions({ fetchOptions: { dispatcher, tls: tlsB } as never })
        : client;
      if (!derived) {
        client.fetchOptions = { dispatcher, tls: tlsB } as never;
      }
      await next.models.list();

      expect(exchangeCount).toBe(2);
      expect(tokens).toEqual(['Bearer token-for-certificate-a', 'Bearer token-for-certificate-b']);
    },
  );

  test('shares a cached token when a derived client wraps the same complete transport tuple', async () => {
    const dispatcher = { name: 'shared-dispatcher' };
    const tls = { cert: 'shared-certificate', key: 'shared-key' };
    let exchanges = 0;
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: { dispatcher, tls } as never,
      fetch: vi.fn(async (url: string | URL | Request) => {
        if (url.toString().includes('/oauth/token')) {
          exchanges += 1;
          return tokenResponse(`shared-token-${exchanges}`);
        }
        return Response.json({ data: [] });
      }),
    });

    await client.models.list();
    await client.withOptions({ fetchOptions: { dispatcher, tls } as never }).models.list();

    expect(exchanges).toBe(1);
  });

  test('scopes primitive-only transport identities to their fetchOptions wrapper', async () => {
    const proxy = 'https://client:certificate-secret@proxy.example';
    let exchanges = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        exchanges += 1;
        return tokenResponse(`primitive-transport-token-${exchanges}`);
      }
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: customFetch,
      fetchOptions: { proxy } as never,
    });

    await client.models.list();
    await client.models.list();
    const derived = client.withOptions({ fetchOptions: { proxy } as never });
    await derived.models.list();
    await derived.models.list();

    expect(exchanges).toBe(2);
  });

  test('does not revive cached credentials after a primitive transport value rotates away and back', async () => {
    const fetchOptions = { proxy: 'https://client:certificate-a@proxy.example' };
    const authorizations: (string | null)[] = [];
    let exchanges = 0;
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: fetchOptions as never,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchanges += 1;
          return tokenResponse(`primitive-transport-token-${exchanges}`);
        }
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      }),
    });

    await client.models.list();
    fetchOptions.proxy = 'https://client:certificate-b@proxy.example';
    await client.models.list();
    fetchOptions.proxy = 'https://client:certificate-a@proxy.example';
    await client.models.list();

    expect(exchanges).toBe(3);
    expect(authorizations).toEqual([
      'Bearer primitive-transport-token-1',
      'Bearer primitive-transport-token-2',
      'Bearer primitive-transport-token-3',
    ]);
  });

  test('invalidates a warm token when certificate material changes inside the same TLS object', async () => {
    const dispatcher = { name: 'shared-dispatcher' };
    const tls = { cert: 'certificate-a' };
    const tokens: (string | null)[] = [];
    let exchanges = 0;
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetchOptions: { dispatcher, tls } as never,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchanges += 1;
          return tokenResponse(`token-for-${(init as { tls: { cert: string } }).tls.cert}`);
        }
        tokens.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ data: [] });
      }),
    });

    await client.models.list();
    tls.cert = 'certificate-b';
    await client.models.list();

    expect(exchanges).toBe(2);
    expect(tokens).toEqual(['Bearer token-for-certificate-a', 'Bearer token-for-certificate-b']);
  });

  test('snapshots caller-owned tenant identity before caching a credential', async () => {
    const mutableIdentity = { ...identity };
    const exchanges: { identity_provider_id: string; service_account_id: string }[] = [];
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: mutableIdentity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchanges.push(
            JSON.parse(String(init?.body)) as { identity_provider_id: string; service_account_id: string },
          );
          return tokenResponse(`token-${exchanges.length}`);
        }
        return Response.json({ data: [] });
      }),
    });

    mutableIdentity.identityProviderId = 'idp_certificate_b';
    mutableIdentity.serviceAccountId = 'svc_certificate_b';
    await client.models.list();
    await client.withOptions({ timeout: 5000 }).models.list();

    expect(exchanges).toEqual([
      expect.objectContaining({
        identity_provider_id: 'idp_certificate_a',
        service_account_id: 'svc_certificate_a',
      }),
    ]);
  });

  test('keeps a cached credential bound to the original tenant after caller identity mutation', async () => {
    const mutableIdentity = { ...identity, refreshBufferMs: 5000 };
    const requests: string[] = [];
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: mutableIdentity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          requests.push(String(init?.body));
          return tokenResponse('tenant-a-token');
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tenant-a-token');
        return Response.json({ data: [] });
      }),
    });

    await client.models.list();
    mutableIdentity.identityProviderId = 'idp_certificate_b';
    mutableIdentity.serviceAccountId = 'svc_certificate_b';
    mutableIdentity.refreshBufferMs = Number.NaN;
    await client.withOptions({ timeout: 5000 }).models.list();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('idp_certificate_a');
    expect(requests[0]).not.toContain('idp_certificate_b');
  });

  test.each([false, true])(
    'does not replay a caller bearer inserted by fetchWithAuth (clone: %s)',
    async (clone) => {
      let exchanges = 0;
      let apiRequests = 0;
      const client = new BoundaryMutatingOpenAI({
        apiKey: null,
        workloadIdentity: identity,
        maxRetries: 0,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchanges += 1;
            return tokenResponse(`workload-token-${exchanges}`);
          }
          apiRequests += 1;
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer caller-custom');
          return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
        }),
      });
      client.fetchMutation = (url, init) => {
        const effective = clone ? { ...init, headers: new Headers(init.headers) } : init;
        (effective.headers as Headers).set('Authorization', 'Bearer caller-custom');
        return { url, init: effective };
      };

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(exchanges).toBe(1);
      expect(apiRequests).toBe(1);
    },
  );

  test.each([false, true])(
    'does not replay a caller bearer inserted by fetchWithTimeout (clone: %s)',
    async (clone) => {
      let exchanges = 0;
      let apiRequests = 0;
      const client = new BoundaryMutatingOpenAI({
        apiKey: null,
        workloadIdentity: identity,
        maxRetries: 0,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchanges += 1;
            return tokenResponse(`workload-token-${exchanges}`);
          }
          apiRequests += 1;
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer caller-custom');
          return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
        }),
      });
      client.timeoutMutation = (url, init) => {
        const effective = clone ? { ...init, headers: new Headers(init.headers) } : init;
        (effective.headers as Headers).set('Authorization', 'Bearer caller-custom');
        return { url, init: effective };
      };

      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(exchanges).toBe(1);
      expect(apiRequests).toBe(1);
    },
  );

  test('removes the private workload context before invoking caller fetch', async () => {
    const observedSymbols: symbol[][] = [];
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          return tokenResponse('workload-token');
        }
        observedSymbols.push(Object.getOwnPropertySymbols(init ?? {}));
        return Response.json({ data: [] });
      }),
    });

    await client.models.list();
    expect(observedSymbols).toEqual([[]]);
  });

  test.each(['api-key', 'subject-token', 'x509'] as const)(
    'passes the original request-options identity to %s authentication hooks',
    async (mode) => {
      const client = new BoundaryMutatingOpenAI({
        ...(mode === 'api-key'
          ? { apiKey: 'api-key' }
          : {
              apiKey: null,
              workloadIdentity:
                mode === 'x509'
                  ? identity
                  : {
                      identityProviderId: 'idp_subject',
                      serviceAccountId: 'svc_subject',
                      provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
                    },
            }),
        fetch: vi.fn(async (url: string | URL | Request) =>
          url.toString().includes('/oauth/token')
            ? tokenResponse('access-token')
            : Response.json({ data: [] }),
        ),
      });

      await client.models.list();
      expect(client.observedIdentity).toBe('original-request-options');
    },
  );

  test('honors a caller cancellation signal attached by the original authentication hook', async () => {
    const customFetch = vi.fn();
    const client = new BoundaryMutatingOpenAI({ apiKey: 'api-key', fetch: customFetch });
    client.optionsMutation = (options) => {
      options.signal = AbortSignal.abort('stop before sending');
    };

    await expect(client.models.list()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('honors streaming metadata attached by the original authentication hook', async () => {
    const customFetch = vi.fn(async () => {
      throw new Error('network failed');
    });
    const client = new BoundaryMutatingOpenAI({ apiKey: 'api-key', fetch: customFetch, maxRetries: 2 });
    client.optionsMutation = (options) => {
      options.__metadata = { ...options.__metadata, hasStreamingBody: true };
    };

    await expect(client.post('/upload', { body: 'not replayable' })).rejects.toThrow(/connection/iu);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
