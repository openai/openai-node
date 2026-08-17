import { expect, vi } from 'vitest';

import OpenAI, { APIUserAbortError } from 'openai';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const subjectTokenIdentity = {
  identityProviderId: 'idp_subject',
  serviceAccountId: 'svc_subject',
  provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

class LegacyAuthHeadersOpenAI extends OpenAI {
  cloneAuthOptions = false;
  hookInput?: object;
  optionsMutation?: (options: FinalRequestOptions) => void;

  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    this.hookInput = options;
    const authOptions = this.cloneAuthOptions ? { ...options } : options;
    this.optionsMutation?.(authOptions);
    return await super.authHeaders(authOptions, schemes);
  }
}

describe('legacy authentication hook compatibility', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test.each([
    { name: 'API key', options: { apiKey: 'api-key' } },
    {
      name: 'subject-token workload identity',
      options: { apiKey: null, workloadIdentity: subjectTokenIdentity },
    },
  ])('preserves frozen options and spread delegation for $name authHeaders', async ({ options }) => {
    const customFetch = vi.fn(async (url: string | URL | Request) =>
      url.toString().includes('/oauth/token') ? tokenResponse('workload-token') : Response.json({ data: [] }),
    );
    const client = new LegacyAuthHeadersOpenAI({ ...options, fetch: customFetch });
    const requestOptions = Object.freeze({ method: 'get' as const, path: '/models' });
    client.cloneAuthOptions = true;

    await expect(client.request(requestOptions)).resolves.toMatchObject({ data: [] });

    expect(client.hookInput).toBe(requestOptions);
    expect(Object.getOwnPropertySymbols(requestOptions)).toEqual([]);
  });

  test('preserves subject-token refresh through spread-delegating authHeaders', async () => {
    let exchangeCount = 0;
    let apiCount = 0;
    const authorizations: (string | null)[] = [];
    const client = new LegacyAuthHeadersOpenAI({
      apiKey: null,
      workloadIdentity: subjectTokenIdentity,
      maxRetries: 0,
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (url.toString().includes('/oauth/token')) {
          exchangeCount += 1;
          return tokenResponse(`workload-token-${exchangeCount}`);
        }
        apiCount += 1;
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        return apiCount === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      }),
    });
    client.cloneAuthOptions = true;

    await expect(client.models.list()).resolves.toMatchObject({ data: [] });

    expect(exchangeCount).toBe(2);
    expect(apiCount).toBe(2);
    expect(authorizations).toEqual(['Bearer workload-token-1', 'Bearer workload-token-2']);
  });

  test('honors a caller cancellation signal attached by an API-key authentication hook', async () => {
    const customFetch = vi.fn();
    const client = new LegacyAuthHeadersOpenAI({ apiKey: 'api-key', fetch: customFetch });
    client.optionsMutation = (options) => {
      options.signal = AbortSignal.abort('stop before sending');
    };

    await expect(client.models.list()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(customFetch).not.toHaveBeenCalled();
  });

  test('honors streaming metadata attached by an API-key authentication hook', async () => {
    const customFetch = vi.fn(async () => {
      throw new Error('network failed');
    });
    const client = new LegacyAuthHeadersOpenAI({ apiKey: 'api-key', fetch: customFetch, maxRetries: 2 });
    client.optionsMutation = (options) => {
      options.__metadata = { ...options.__metadata, hasStreamingBody: true };
    };

    await expect(client.post('/upload', { body: 'not replayable' })).rejects.toThrow(/connection/iu);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
