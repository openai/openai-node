import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { expect, vi } from 'vitest';

import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import { APIError, OAuthError, OpenAIError } from 'openai';
import type { WorkloadIdentity } from 'openai/auth/types';

const originalFetch = global.fetch;

async function listenLoopback(server: Server): Promise<string> {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a loopback TCP server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeLoopback(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

function tokenExchangeResponse(accessToken: string, expiresIn: number): Response {
  return Response.json({
    access_token: accessToken,
    issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    token_type: 'Bearer',
    expires_in: expiresIn,
  });
}

function pendingTokenExchange(): {
  response: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  return { response, resolve: resolveResponse };
}

describe('WorkloadIdentityAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    global.fetch = vi.fn(async () => {
      fetchCallCount++;
      return Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

    global.fetch = vi.fn(async () => {
      fetchCallCount++;
      return Response.json(
        {
          access_token: `access-token-${fetchCallCount}`,
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 1,
        },
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

    global.fetch = vi.fn(async () => {
      fetchCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

  test('keeps cached tokens usable after a failed background refresh and retries later', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse('cached-token', 60))
      .mockRejectedValueOnce(new Error('temporary refresh failure'))
      .mockResolvedValueOnce(tokenExchangeResponse('refreshed-token', 3600));
    const auth = new WorkloadIdentityAuth(config, customFetch);

    await expect(auth.getToken()).resolves.toBe('cached-token');
    await expect(auth.getToken()).resolves.toBe('cached-token');
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(auth.getToken()).resolves.toBe('cached-token');
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(auth.getToken()).resolves.toBe('refreshed-token');
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

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body?.toString() || '';
      const headers = new Headers(init?.headers);

      capturedRequest = { url, body, headers };

      return Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

  test.each([307, 308])(
    'does not expose workload credentials through an HTTP %i redirect',
    async (status) => {
      const attackerRequests: string[] = [];
      const attacker = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf-8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () => {
          attackerRequests.push(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ access_token: 'attacker-token', expires_in: 3600 }));
        });
      });
      let attackerUrl = '';
      const tokenEndpoint = createServer((_request, response) => {
        response.writeHead(status, { Location: `${attackerUrl}/stolen-credentials` });
        response.end();
      });

      try {
        attackerUrl = await listenLoopback(attacker);
        const tokenEndpointUrl = await listenLoopback(tokenEndpoint);
        const config: WorkloadIdentity = {
          identityProviderId: 'sensitive-identity-provider-id',
          serviceAccountId: 'sensitive-service-account-id',
          provider: {
            tokenType: 'jwt',
            getToken: async () => 'sensitive-kubernetes-service-account-jwt',
          },
        };
        const auth = new WorkloadIdentityAuth(config, async (url, init) => {
          expect(url).toBe('https://auth.openai.com/oauth/token');
          return await globalThis.fetch(tokenEndpointUrl, init);
        });
        const tokenPromise = auth.getToken();

        await expect.soft(tokenPromise).rejects.toBeInstanceOf(APIError);
        await expect.soft(tokenPromise).rejects.toHaveProperty('status', status);
        expect(attackerRequests).toEqual([]);
      } finally {
        await Promise.all([closeLoopback(tokenEndpoint), closeLoopback(attacker)]);
      }
    },
  );

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

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || '';

      return Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body?.toString() || '';

      return Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

    global.fetch = vi.fn(async () =>
      Response.json(
        {
          error: 'invalid_grant',
          error_description: 'The subject token is invalid',
        },
        { status: 400 },
      ),
    ) as typeof fetch;

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

    global.fetch = vi.fn(async () =>
      Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
        },
        { status: 200 },
      ),
    ) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);

    const token = await auth.getToken();
    expect(token).toBe('access-token');
  });

  test.each([
    [
      'missing field',
      {
        issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    ],
    [
      'empty field',
      {
        access_token: '',
        issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    ],
    [
      'blank field',
      {
        access_token: '   ',
        issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    ],
    ['null body', null],
  ])('throws when successful token exchange response has no access_token: %s', async (_name, body) => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };

    global.fetch = vi.fn(async () => Response.json(body, { status: 200 })) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config);
    const tokenPromise = auth.getToken();

    await expect(tokenPromise).rejects.toThrow(OpenAIError);
    await expect(tokenPromise).rejects.toThrow("missing 'access_token'");
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

    global.fetch = vi.fn(async () => {
      fetchCallCount++;
      return Response.json(
        {
          access_token: `access-token-${fetchCallCount}`,
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
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

  test('keeps a newer foreground exchange shared after an invalidated exchange finishes', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };
    const invalidatedExchange = pendingTokenExchange();
    const freshExchange = pendingTokenExchange();
    const customFetch = vi
      .fn()
      .mockReturnValueOnce(invalidatedExchange.response)
      .mockReturnValueOnce(freshExchange.response);
    const auth = new WorkloadIdentityAuth(config, customFetch);
    const invalidatedToken = auth.getToken();

    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    auth.invalidateToken();

    const firstFreshToken = auth.getToken();
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));

    invalidatedExchange.resolve(tokenExchangeResponse('invalidated-token', 3600));
    await expect(invalidatedToken).resolves.toBe('invalidated-token');

    const secondFreshToken = auth.getToken();
    freshExchange.resolve(tokenExchangeResponse('fresh-token', 3600));

    await expect(Promise.all([firstFreshToken, secondFreshToken])).resolves.toEqual([
      'fresh-token',
      'fresh-token',
    ]);
    await expect(auth.getToken()).resolves.toBe('fresh-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('does not let an invalidated background exchange overwrite a newer cached token', async () => {
    const config: WorkloadIdentity = {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'subject-token',
      },
    };
    const invalidatedExchange = pendingTokenExchange();
    const freshExchange = pendingTokenExchange();
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse('cached-token', 60))
      .mockReturnValueOnce(invalidatedExchange.response)
      .mockReturnValueOnce(freshExchange.response);
    const auth = new WorkloadIdentityAuth(config, customFetch);
    const initialTime = Date.now();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(initialTime);

    try {
      await expect(auth.getToken()).resolves.toBe('cached-token');
      await expect(auth.getToken()).resolves.toBe('cached-token');
      await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));

      dateNow.mockReturnValue(initialTime + 60_000);
      const invalidatedToken = auth.getToken();
      auth.invalidateToken();

      const freshToken = auth.getToken();
      await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(3));
      freshExchange.resolve(tokenExchangeResponse('fresh-token', 3600));
      await expect(freshToken).resolves.toBe('fresh-token');

      invalidatedExchange.resolve(tokenExchangeResponse('invalidated-token', 3600));
      await expect(invalidatedToken).resolves.toBe('invalidated-token');
      await expect(auth.getToken()).resolves.toBe('fresh-token');
      expect(customFetch).toHaveBeenCalledTimes(3);
    } finally {
      dateNow.mockRestore();
    }
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

    const customFetch = vi.fn(async () =>
      Response.json(
        {
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
        { status: 200 },
      ),
    ) as typeof fetch;

    const auth = new WorkloadIdentityAuth(config, customFetch);
    await auth.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toBe(originalFetch);
  });
});
