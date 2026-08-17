import { inspect } from 'node:util';
import { expect, vi } from 'vitest';

import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

class FetchHookOpenAI extends OpenAI {
  cloneFetchInit = false;
  hookInputInspection?: (input: RequestInit) => void;

  protected override async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<Response> {
    this.hookInputInspection?.(init);
    return await super.fetchWithAuth(
      url,
      this.cloneFetchInit ? { ...init } : init,
      timeout,
      controller,
      schemes,
    );
  }
}

describe('workload identity fetch hook compatibility', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test.each([false, true])(
    'preserves X.509 workload provenance through a fetchWithAuth clone (clone: %s)',
    async (cloneFetchInit) => {
      let exchangeCount = 0;
      let apiCount = 0;
      const apiAuthorizations: (string | null)[] = [];
      const client = new FetchHookOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        maxRetries: 0,
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
      });
      client.cloneFetchInit = cloneFetchInit;

      await expect(client.models.list()).resolves.toMatchObject({ data: [] });

      expect(exchangeCount).toBe(2);
      expect(apiCount).toBe(2);
      expect(apiAuthorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
    },
  );

  test('keeps the SDK-owned X.509 request carrier opaque to fetch hooks', async () => {
    const carrierSnapshots: string[] = [];
    const dispatcher = {
      cert: 'private-certificate-material',
      key: 'private-key-material',
    };
    const requestDispatchers: unknown[] = [];
    const client = new FetchHookOpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetchOptions: { dispatcher: dispatcher as never },
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requestDispatchers.push((init as { dispatcher?: unknown } | undefined)?.dispatcher);
        return url.toString().includes('/oauth/token')
          ? tokenResponse('workload-token')
          : Response.json({ data: [] });
      }),
    });
    client.hookInputInspection = (input) => {
      const contextSymbol = Object.getOwnPropertySymbols(input).find(
        (symbol) => symbol.description === 'workloadIdentityRequestContext',
      );
      expect(contextSymbol).toBeDefined();
      if (contextSymbol) {
        const contextKey = (input as Record<symbol, unknown>)[contextSymbol];
        carrierSnapshots.push(inspect(contextKey, { depth: 8, showHidden: true }));
        expect(typeof contextKey).toBe('object');
        expect(contextKey).not.toBeNull();
        expect(Object.isFrozen(contextKey)).toBe(true);
        expect(Reflect.set(contextKey as object, 'workloadIdentityTokenSuppressed', true)).toBe(false);
      }
    };

    await client.models.list();

    expect(carrierSnapshots).toEqual(['{}']);
    expect(requestDispatchers).toEqual([dispatcher, dispatcher]);
  });
});
