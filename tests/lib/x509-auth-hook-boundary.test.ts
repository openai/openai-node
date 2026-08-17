import { expect, vi } from 'vitest';

import OpenAI from 'openai';
import type { NullableHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_x509',
  serviceAccountId: 'svc_x509',
};

const subjectTokenIdentity = {
  identityProviderId: 'idp_subject',
  serviceAccountId: 'svc_subject',
  provider: { tokenType: 'jwt' as const, getToken: async () => 'subject-token' },
};

class AuthHooksOverrideOpenAI extends OpenAI {
  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    return await super.authHeaders({ ...options }, schemes);
  }

  protected override async bearerAuth(options: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    return await super.bearerAuth({ ...options });
  }
}

function tokenResponse(): Response {
  return Response.json({ access_token: 'workload-token', expires_in: 3600 });
}

describe('X.509 protected authentication hook boundary', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_BASE_URL'];
  });

  test.each([{ frozen: false }, { frozen: true }])(
    'rejects X.509 auth hook overrides before authentication or dispatch (frozen: $frozen)',
    async ({ frozen }) => {
      const customFetch = vi.fn();
      const client = new AuthHooksOverrideOpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        fetch: customFetch,
      });

      const requestOptions = { method: 'get' as const, path: '/models' };
      await expect(client.request(frozen ? Object.freeze(requestOptions) : requestOptions)).rejects.toThrow(
        /X\.509.*authHeaders.*bearerAuth/iu,
      );
      expect(customFetch).not.toHaveBeenCalled();
    },
  );

  test.each(['authHeaders', 'bearerAuth'] as const)(
    'rejects an instance %s replacement before authentication or dispatch',
    async (hook) => {
      const customFetch = vi.fn();
      const client = new OpenAI({
        apiKey: null,
        workloadIdentity: x509Identity,
        fetch: customFetch,
      });
      Object.defineProperty(client, hook, { value: async () => {} });

      await expect(client.models.list()).rejects.toThrow(/X\.509.*authHeaders.*bearerAuth/iu);
      expect(customFetch).not.toHaveBeenCalled();
    },
  );

  test('keeps standard X.509 authentication compatible with frozen request options', async () => {
    const customFetch = vi.fn(async (url: string | URL | Request) =>
      url.toString().includes('/oauth/token') ? tokenResponse() : Response.json({ data: [] }),
    );
    const client = new OpenAI({
      apiKey: null,
      workloadIdentity: x509Identity,
      fetch: customFetch,
    });

    await expect(
      client.request(Object.freeze({ method: 'get' as const, path: '/models' })),
    ).resolves.toMatchObject({ data: [] });
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    { name: 'API key', options: { apiKey: 'api-key' } },
    {
      name: 'subject-token workload identity',
      options: { apiKey: null, workloadIdentity: subjectTokenIdentity },
    },
  ])('preserves spread-delegating authHeaders for $name clients', async ({ options }) => {
    const customFetch = vi.fn(async (url: string | URL | Request) =>
      url.toString().includes('/oauth/token') ? tokenResponse() : Response.json({ data: [] }),
    );
    const client = new AuthHooksOverrideOpenAI({ ...options, fetch: customFetch });

    await expect(
      client.request(Object.freeze({ method: 'get' as const, path: '/models' })),
    ).resolves.toMatchObject({ data: [] });
  });
});
