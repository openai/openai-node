import { expect, vi } from 'vitest';

import OpenAI from 'openai';
import type { HeadersInit, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

class AuthHeadersCompatibilityOpenAI extends OpenAI {
  authOptionsMutation?: (options: FinalRequestOptions) => void;
  authHeadersMutation?: (headers: NullableHeaders | undefined) => void;
  omitAuthHeaders = false;

  protected override async authHeaders(
    opts: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    if (this.omitAuthHeaders) {
      return undefined;
    }
    this.authOptionsMutation?.(opts);
    const headers = await super.authHeaders(opts, schemes);
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
    return await super.fetchWithAuth(url, init, timeout, controller, schemes);
  }
}

describe('workload identity authHeaders subclass compatibility', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test('preserves workload-token provenance through a legacy authHeaders override', async () => {
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

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });

    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
    expect(apiAuthorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

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

  test('preserves a request retry budget through a five-argument fetchWithAuth override', async () => {
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

    await expect(client.models.list({ maxRetries: 0 })).rejects.toMatchObject({ status: 503 });
    expect(exchangeCount).toBe(1);
  });
});
