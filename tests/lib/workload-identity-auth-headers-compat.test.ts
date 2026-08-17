import { inspect } from 'node:util';
import { expect, vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError } from 'openai';
import type { HeadersInit, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

const subjectTokenIdentity = {
  identityProviderId: 'idp_subject',
  serviceAccountId: 'svc_subject',
  provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

class AuthHeadersCompatibilityOpenAI extends OpenAI {
  authOptionsMutation?: (options: FinalRequestOptions) => void;
  authHeadersMutation?: (headers: NullableHeaders | undefined) => void;
  authHeadersReplacement?: NullableHeaders;
  authHeadersDelayMs = 0;
  hookInputInspection?: (input: object) => void;
  cloneAuthOptions = false;
  cloneFetchInit = false;
  omitAuthHeaders = false;

  protected override async authHeaders(
    opts: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    this.hookInputInspection?.(opts);
    if (this.authHeadersDelayMs) {
      // oxlint-disable-next-line promise/avoid-new -- This fixture models a slow legacy hook.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.authHeadersDelayMs);
      });
    }
    if (this.authHeadersReplacement) {
      return this.authHeadersReplacement;
    }
    if (this.omitAuthHeaders) {
      return undefined;
    }
    const authOptions = this.cloneAuthOptions ? { ...opts } : opts;
    this.authOptionsMutation?.(authOptions);
    const headers = await super.authHeaders(authOptions, schemes);
    this.authHeadersMutation?.(headers);
    return headers;
  }

  protected override async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    return await super.fetchWithAuth(
      url,
      this.cloneFetchInit ? { ...init } : init,
      timeout,
      controller,
      schemes,
    );
  }

  protected override async prepareRequest(request: RequestInit): Promise<void> {
    this.hookInputInspection?.(request);
  }
}

describe('workload identity authHeaders subclass compatibility', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test.each(['API key', 'subject-token workload identity', 'X.509 workload identity'] as const)(
    'accepts frozen low-level request options with $s authentication',
    async (authentication) => {
      const customFetch = vi.fn(async (url: string | URL | Request) =>
        url.toString().includes('/oauth/token')
          ? tokenResponse('workload-token')
          : Response.json({ data: [] }),
      );
      let workloadIdentity: typeof subjectTokenIdentity | typeof x509Identity | undefined;
      if (authentication === 'subject-token workload identity') {
        workloadIdentity = subjectTokenIdentity;
      } else if (authentication === 'X.509 workload identity') {
        workloadIdentity = x509Identity;
      }
      const client = new AuthHeadersCompatibilityOpenAI({
        apiKey: authentication === 'API key' ? 'api-key' : null,
        ...(workloadIdentity ? { workloadIdentity } : {}),
        fetch: customFetch,
      });
      const options = Object.freeze({ method: 'get' as const, path: '/models' });
      const hookInputs: object[] = [];
      client.hookInputInspection = (input) => hookInputs.push(input);

      await expect(client.request(options)).resolves.toMatchObject({ data: [] });

      expect(hookInputs[0]).toBe(options);
      expect(Object.getOwnPropertySymbols(options)).toEqual([]);
    },
  );

  test.each([false, true])(
    'preserves workload-token provenance through a legacy authHeaders override (clone: %s)',
    async (cloneAuthOptions) => {
      let exchangeCount = 0;
      let apiCount = 0;
      const apiAuthorizations: (string | null)[] = [];
      const client = new AuthHeadersCompatibilityOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchangeCount += 1;
            return tokenResponse(`token-${exchangeCount}`);
          }
          apiCount += 1;
          apiAuthorizations.push(new Headers(init?.headers).get('Authorization'));
          return apiCount === 1
            ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
            : Response.json({ data: [] });
        }),
        maxRetries: 0,
      });
      client.cloneAuthOptions = cloneAuthOptions;

      await expect(client.models.list()).resolves.toMatchObject({ data: [] });

      expect(exchangeCount).toBe(2);
      expect(apiCount).toBe(2);
      expect(apiAuthorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
    },
  );

  test('preserves headers contributed by mutating options in a legacy authHeaders override', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse('workload-token');
        }
        apiCount += 1;
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer legacy-custom-token');
        expect(new Headers(init?.headers).get('X-Legacy-Auth-Hook')).toBe('present');
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }),
    });
    client.authOptionsMutation = (options) => {
      options.headers = {
        Authorization: 'Bearer legacy-custom-token',
        'X-Legacy-Auth-Hook': 'present',
      };
    };

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(exchangeCount).toBe(0);
    expect(apiCount).toBe(1);
  });

  test('drops workload provenance when a legacy authHeaders override replaces the credential', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse('workload-token');
        }
        apiCount += 1;
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer legacy-custom-token');
        return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
      }),
    });
    client.authHeadersMutation = (headers) => {
      headers?.values.set('Authorization', 'Bearer legacy-custom-token');
    };

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(exchangeCount).toBe(1);
    expect(apiCount).toBe(1);
  });

  test.each([
    { name: 'empty', value: '' },
    { name: 'null', value: null },
  ])('honors an explicit $name Authorization from an authHeaders override', async ({ value }) => {
    let exchangeCount = 0;
    let apiCount = 0;
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse('unexpected-workload-token');
        }
        apiCount += 1;
        expect(new Headers(init?.headers).get('Authorization')).toBe(value);
        return Response.json({ data: [] });
      }),
    });
    client.authHeadersReplacement = buildHeaders([{ Authorization: value }]);

    await client.models.list();

    expect(exchangeCount).toBe(0);
    expect(apiCount).toBe(1);
  });

  test('keeps X.509 transport secrets behind opaque protected-hook carriers', async () => {
    const hookSnapshots: string[] = [];
    const originalDispatcher = {
      cert: 'private-certificate-material',
      key: 'private-key-material',
    };
    const attackerDispatcher = { name: 'attacker-dispatcher' };
    const requestDispatchers: unknown[] = [];
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetchOptions: { dispatcher: originalDispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requestDispatchers.push((init as { dispatcher?: unknown } | undefined)?.dispatcher);
        return url.toString().includes('/oauth/token')
          ? tokenResponse('workload-token')
          : Response.json({ data: [] });
      }),
    });
    client.hookInputInspection = (input) => {
      hookSnapshots.push(inspect(input, { depth: 8, showHidden: true }));
      const contextSymbol = Object.getOwnPropertySymbols(input).find(
        (symbol) => symbol.description === 'workloadIdentityRequestContext',
      );
      expect(contextSymbol).toBeDefined();
      if (contextSymbol) {
        const contextKey = (input as Record<symbol, unknown>)[contextSymbol];
        expect(typeof contextKey).toBe('object');
        expect(contextKey).not.toBeNull();
        expect(Object.isFrozen(contextKey)).toBe(true);
        expect(Reflect.set(contextKey as object, 'fetchOptions', { dispatcher: attackerDispatcher })).toBe(
          false,
        );
        expect(Reflect.set(contextKey as object, 'workloadIdentityTokenSuppressed', true)).toBe(false);
      }
    };

    await client.models.list();

    expect(hookSnapshots).toHaveLength(2);
    expect(hookSnapshots.join('\n')).not.toContain('private-certificate-material');
    expect(hookSnapshots.join('\n')).not.toContain('private-key-material');
    expect(requestDispatchers).toEqual([originalDispatcher, originalDispatcher]);
  });

  test.each(['request', 'default'] as const)(
    'preserves companion authHeaders from a subclass with a $source Authorization override',
    async (source) => {
      let exchangeCount = 0;
      let apiCount = 0;
      const client = new AuthHeadersCompatibilityOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        ...(source === 'default' ? { defaultHeaders: { Authorization: 'Bearer caller-token' } } : {}),
        fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          if (url.toString().includes('/oauth/token')) {
            exchangeCount += 1;
            return tokenResponse('workload-token');
          }
          apiCount += 1;
          const headers = new Headers(init?.headers);
          expect(headers.get('Authorization')).toBe('Bearer caller-token');
          expect(headers.get('X-Companion-Signature')).toBe('signed');
          return Response.json({ data: [] });
        }),
      });
      client.authHeadersMutation = (headers) => {
        headers?.values.set('X-Companion-Signature', 'signed');
      };

      await client.models.list(
        source === 'request' ? { headers: { Authorization: 'Bearer caller-token' } } : undefined,
      );

      expect(exchangeCount).toBe(0);
      expect(apiCount).toBe(1);
    },
  );

  test('regenerates workload auth before a legacy authHeaders hook signs a removed caller credential', async () => {
    let exchangeCount = 0;
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse('workload-token');
        }
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe('Bearer workload-token');
        expect(headers.get('X-Companion-Signature')).toBe('signed:Bearer workload-token');
        return Response.json({ data: [] });
      }),
    });
    client.authOptionsMutation = (options) => {
      const headers = new Headers(options.headers as HeadersInit);
      headers.delete('Authorization');
      options.headers = headers;
    };
    client.authHeadersMutation = (headers) => {
      const authorization = headers?.values.get('authorization');
      expect(authorization).toBe('Bearer workload-token');
      headers?.values.set('X-Companion-Signature', `signed:${authorization}`);
    };

    await client.models.list({ headers: { Authorization: 'Bearer stale-caller-token' } });

    expect(exchangeCount).toBe(1);
  });

  test.each([false, true])(
    'preserves a request retry budget through a five-argument fetchWithAuth override (clone: %s)',
    async (cloneFetchInit) => {
      let exchangeCount = 0;
      const client = new AuthHeadersCompatibilityOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        maxRetries: 2,
        fetch: vi.fn(async (url: string | URL | Request) => {
          if (url.toString().includes('/oauth/token')) {
            exchangeCount += 1;
            return new Response(null, { status: 503, headers: { 'Retry-After': '0' } });
          }
          throw new Error('The API request must not run after a failed token exchange.');
        }),
      });
      client.omitAuthHeaders = true;
      client.cloneFetchInit = cloneFetchInit;

      await expect(client.models.list({ maxRetries: 0 })).rejects.toMatchObject({ status: 503 });
      expect(exchangeCount).toBe(1);
    },
  );

  test('preserves the authentication deadline through an omitted legacy authHeaders result', async () => {
    vi.useFakeTimers();
    let exchangeCount = 0;
    let apiCount = 0;
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      maxRetries: 0,
      fetch: vi.fn(async (url: string | URL | Request) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          // oxlint-disable-next-line promise/avoid-new -- This fixture deliberately stalls fallback authentication.
          return await new Promise<Response>(() => {});
        }
        apiCount += 1;
        return Response.json({ data: [] });
      }),
    });
    client.authHeadersDelayMs = 900;
    client.omitAuthHeaders = true;

    let settled = false;
    const request = client.models.list({ timeout: 1000, maxRetries: 0 });
    const result = (async () => {
      try {
        await request;
      } catch (error) {
        return error;
      } finally {
        settled = true;
      }
    })();

    await vi.advanceTimersByTimeAsync(900);
    expect(exchangeCount).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    const settledWithinOriginalBudget = settled;

    // Let the old behavior's fresh fallback timeout settle so the failing regression cleans up deterministically.
    await vi.advanceTimersByTimeAsync(900);

    await expect(result).resolves.toBeInstanceOf(APIConnectionTimeoutError);
    expect(settledWithinOriginalBudget).toBe(true);
    expect(exchangeCount).toBe(1);
    expect(apiCount).toBe(0);
  });

  test('preserves workload-token provenance through a cloned fetchWithAuth init', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const apiAuthorizations: (string | null)[] = [];
    const client = new AuthHeadersCompatibilityOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(Object.getOwnPropertySymbols(init ?? {})).toEqual([]);
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse(`token-${exchangeCount}`);
        }
        apiCount += 1;
        apiAuthorizations.push(new Headers(init?.headers).get('Authorization'));
        return apiCount === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      }),
      maxRetries: 0,
    });
    client.cloneFetchInit = true;
    client.omitAuthHeaders = true;

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });

    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
    expect(apiAuthorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  });
});
