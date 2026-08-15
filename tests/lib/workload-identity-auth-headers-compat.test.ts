import { expect, vi } from 'vitest';

import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
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

  protected override async authHeaders(
    opts: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    this.authOptionsMutation?.(opts);
    const headers = await super.authHeaders(opts, schemes);
    this.authHeadersMutation?.(headers);
    return headers;
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
    expect(exchangeCount).toBe(1);
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
});
