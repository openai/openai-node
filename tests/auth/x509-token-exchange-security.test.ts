import { expect, vi } from 'vitest';

import { OAuthError } from 'openai';
import type { X509WorkloadIdentity } from 'openai/auth';
import { X509WorkloadIdentityAuth as WorkloadIdentityAuth } from 'openai/internal/auth/x509-workload-identity-auth';

const identity: X509WorkloadIdentity = {
  type: 'x509',
  identityProviderId: 'idp_security',
  serviceAccountId: 'svc_acct_security',
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

describe('X.509 token exchange security boundaries', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test.each(['Basic', 'MAC', 'DPoP', 'Bearer another-scheme', null, 42])(
    'rejects an explicitly incompatible OAuth token_type: %s',
    async (tokenType) => {
      const auth = new WorkloadIdentityAuth(
        identity,
        vi.fn(async () =>
          Response.json({ access_token: 'unsafe-token', expires_in: 3600, token_type: tokenType }),
        ),
        { maxRetries: 0 },
      );

      await expect(auth.getToken()).rejects.toThrow(/token.type/iu);
    },
  );

  test.each(['Bearer', 'bearer', 'BEARER'])(
    'accepts case-insensitive OAuth bearer token_type %s',
    async (tokenType) => {
      const auth = new WorkloadIdentityAuth(
        identity,
        vi.fn(async () =>
          Response.json({ access_token: 'valid-token', expires_in: 3600, token_type: tokenType }),
        ),
        { maxRetries: 0 },
      );

      await expect(auth.getToken()).resolves.toBe('valid-token');
    },
  );

  test.each([
    ['access_token', 'inherited-token', { expires_in: 3600 }, /access.token/iu],
    ['expires_in', 3600, { access_token: 'own-token' }, /expires.in/iu],
  ] as const)(
    'rejects an inherited %s field from a polluted Object prototype',
    async (field, inheritedValue, response, error) => {
      Reflect.defineProperty(Object.prototype, field, { configurable: true, value: inheritedValue });
      try {
        const auth = new WorkloadIdentityAuth(
          identity,
          vi.fn(async () => Response.json(response)),
          { maxRetries: 0 },
        );

        await expect(auth.getToken()).rejects.toThrow(error);
      } finally {
        Reflect.deleteProperty(Object.prototype, field);
      }
    },
  );

  test('ignores an inherited optional token_type field', async () => {
    Reflect.defineProperty(Object.prototype, 'token_type', { configurable: true, value: 'Basic' });
    try {
      const auth = new WorkloadIdentityAuth(
        identity,
        vi.fn(async () => tokenResponse('own-token')),
        {
          maxRetries: 0,
        },
      );

      await expect(auth.getToken()).resolves.toBe('own-token');
    } finally {
      Reflect.deleteProperty(Object.prototype, 'token_type');
    }
  });

  test.each([
    'token\r\nInjected: private',
    'token\nprivate',
    'token\u0000private',
    'token\tprivate',
    'token private',
    'token:private',
    'tokén',
  ])('rejects an access_token containing unsafe HTTP header characters', async (accessToken) => {
    const auth = new WorkloadIdentityAuth(
      identity,
      vi.fn(async () => Response.json({ access_token: accessToken, expires_in: 3600 })),
      { maxRetries: 0 },
    );

    await expect(auth.getToken()).rejects.toThrow(/access.token/iu);
  });

  test.each([
    ['Retry-After', 'Fri, 31 Dec 9999 23:59:59 GMT'],
    ['Retry-After', 'Infinity'],
    ['Retry-After', 'NaN'],
    ['Retry-After', '-1'],
    ['Retry-After', '999999999999999999999999999999'],
    ['Retry-After-Ms', 'Infinity'],
    ['Retry-After-Ms', '1e309'],
    ['Retry-After-Ms', '-5'],
    ['Retry-After-Ms', '999999999999999999999999999999'],
  ])('bounds hostile %s value %s without overflowing a retry timer', async (header, value) => {
    vi.useFakeTimers();
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { [header]: value } }))
      .mockResolvedValueOnce(tokenResponse('bounded-retry-token'));
    const auth = new WorkloadIdentityAuth(identity, customFetch, { maxRetries: 1 });

    const token = auth.getToken();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(token).resolves.toBe('bounded-retry-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('bounds a successful token exchange response before accepting attacker-controlled data', async () => {
    const customFetch = vi.fn(
      async () =>
        new Response('x'.repeat(1024 * 1024 + 1), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const auth = new WorkloadIdentityAuth(identity, customFetch, { maxRetries: 0 });

    await expect(auth.getToken()).rejects.toThrow(/response.*(?:size|large|exceed)/iu);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('rejects an oversized declared token exchange response without consuming its body', async () => {
    const customFetch = vi.fn(async () =>
      Response.json(
        { access_token: 'must-not-be-accepted', expires_in: 3600 },
        { status: 200, headers: { 'Content-Length': String(1024 * 1024 + 1) } },
      ),
    );
    const auth = new WorkloadIdentityAuth(identity, customFetch, { maxRetries: 0 });

    await expect(auth.getToken()).rejects.toThrow(/response.*(?:size|large|exceed)/iu);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('bounds and redacts an oversized OAuth error response', async () => {
    const customFetch = vi.fn(
      async () =>
        new Response('s'.repeat(1024 * 1024 + 1), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const auth = new WorkloadIdentityAuth(identity, customFetch, { maxRetries: 0 });

    const caughtError = await auth.getToken().catch((error: unknown) => error);
    expect(caughtError).toBeInstanceOf(OAuthError);
    expect(String(caughtError)).not.toContain('ssss');
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
