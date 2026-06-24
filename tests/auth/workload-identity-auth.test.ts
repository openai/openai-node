import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import { OAuthError } from 'openai';
import type { WorkloadIdentity } from 'openai/auth/types';

const originalFetch = global.fetch;

describe('WorkloadIdentityAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('caches tokens', async () => {
    let providerCallCount = 0;
    let fetchCallCount = 0;

    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => {
          providerCallCount++;
          return 'subject-token';
        },
      },
    };

    global.fetch = jest.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const token1 = await auth.getToken();
    const token2 = await auth.getToken();

    expect(token1).toBe('access-token');
    expect(token2).toBe('access-token');
    expect(providerCallCount).toBe(1);
    expect(fetchCallCount).toBe(1);
  });

  test('refreshes expired tokens', async () => {
    let providerCallCount = 0;
    let fetchCallCount = 0;

    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => {
          providerCallCount++;
          return `subject-token-${providerCallCount}`;
        },
      },
    };

    global.fetch = jest.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          access_token: `access-token-${fetchCallCount}`,
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 1,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const token1 = await auth.getToken();
    expect(token1).toBe('access-token-1');

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const token2 = await auth.getToken();
    expect(token2).toBe('access-token-2');
    expect(providerCallCount).toBe(2);
    expect(fetchCallCount).toBe(2);
  });

  test('deduplicates concurrent refresh requests', async () => {
    let providerCallCount = 0;
    let fetchCallCount = 0;

    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => {
          providerCallCount++;
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'subject-token';
        },
      },
    };

    global.fetch = jest.fn(async () => {
      fetchCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const [token1, token2, token3] = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);

    expect(token1).toBe('access-token');
    expect(token2).toBe('access-token');
    expect(token3).toBe('access-token');
    expect(providerCallCount).toBe(1);
    expect(fetchCallCount).toBe(1);
  });

  test('sends correct OAuth2 token exchange request', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    let capturedRequest: { url: string; body: string; headers: Headers } | null = null;

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body?.toString() || '';
      const headers = new Headers(init?.headers);

      capturedRequest = { url, body, headers };

      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);
    await auth.getToken();

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe('https://auth.openai.com/oauth/token');
    expect(capturedRequest!.headers.get('Content-Type')).toBe('application/json');

    const body = JSON.parse(capturedRequest!.body);
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body).not.toHaveProperty('client_id');
    expect(body.subject_token).toBe('subject-token');
    expect(body.subject_token_type).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(body.identity_provider_id).toBe('test-identity-provider-id');
    expect(body.service_account_id).toBe('test-service-account-id');
  });

  test('includes all required fields in token exchange', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    let capturedBody: string | null = null;

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || '';

      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);
    await auth.getToken();

    const body = JSON.parse(capturedBody!);
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.subject_token_type).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(body).not.toHaveProperty('client_id');
    expect(body.identity_provider_id).toBe('test-identity-provider-id');
    expect(body.service_account_id).toBe('test-service-account-id');
  });

  test('includes client_id when clientId is provided', async () => {
    const config: WorkloadIdentity = {
      clientId: 'test-client-id',
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    let capturedBody: string | null = null;

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || '';

      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);
    await auth.getToken();

    const body = JSON.parse(capturedBody!);
    expect(body.client_id).toBe('test-client-id');
  });

  test('throws OAuthError on failed token exchange', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    global.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'The subject token is invalid',
        }),
        { status: 400 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    await expect(auth.getToken()).rejects.toThrow(OAuthError);
    await expect(auth.getToken()).rejects.toThrow('The subject token is invalid');
  });

  test('defaults to 3600 seconds when expires_in is missing', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    global.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const token = await auth.getToken();
    expect(token).toBe('access-token');
  });

  test('invalidateToken clears cache', async () => {
    let fetchCallCount = 0;

    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    global.fetch = jest.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          access_token: `access-token-${fetchCallCount}`,
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const token1 = await auth.getToken();
    expect(token1).toBe('access-token-1');

    auth.invalidateToken();

    const token2 = await auth.getToken();
    expect(token2).toBe('access-token-2');
    expect(fetchCallCount).toBe(2);
  });

  test('uses the configured fetch implementation for token exchange', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    const customFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config, customFetch);
    await auth.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toBe(originalFetch);
  });
});
