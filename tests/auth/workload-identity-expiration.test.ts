import { setTimeout as delay } from 'node:timers/promises';
import { expect, vi } from 'vitest';

import OpenAI, { OpenAIError } from 'openai';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import type { WorkloadIdentity } from 'openai/auth/types';

const INITIAL_TIME = 1_700_000_000_000;
const MAXIMUM_SAFE_DURATION = Math.floor((Number.MAX_SAFE_INTEGER - INITIAL_TIME) / 1000);

const workloadIdentity: WorkloadIdentity = {
  identityProviderId: 'test-identity-provider-id',
  serviceAccountId: 'test-service-account-id',
  refreshBufferSeconds: 0,
  provider: {
    tokenType: 'jwt',
    getToken: async () => 'subject-token',
  },
};

function tokenExchangeResponse(expiresIn: unknown, accessToken: string): Response {
  const body = {
    access_token: accessToken,
    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
  };

  if (typeof expiresIn === 'number' && !Number.isFinite(expiresIn)) {
    const response = Response.json({ access_token: accessToken });
    vi.spyOn(response, 'json').mockResolvedValue(body);
    return response;
  }

  return Response.json(body);
}

describe('workload-identity access-token expiration', () => {
  let currentTime = INITIAL_TIME;

  beforeEach(() => {
    currentTime = INITIAL_TIME;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    ['a nonnumeric string', 'invalid'],
    ['a numeric string', '3600'],
    ['an object', {}],
    ['an empty array', []],
    ['a numeric array', [3600]],
    ['a boolean', true],
    ['zero', 0],
    ['a negative duration', -1],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
    ['finite multiplication overflow', 1e308],
    ['an unsafe expiration timestamp', MAXIMUM_SAFE_DURATION + 1],
    ['a duration that rounds down to the current time', Number.MIN_VALUE],
  ])('rejects %s before caching or returning the access token', async (_description, expiresIn) => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse(expiresIn, 'unsafe-token'))
      .mockResolvedValueOnce(tokenExchangeResponse(3600, 'replacement-token'));
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);
    const firstAttempt = auth.getToken();

    await expect(firstAttempt).rejects.toBeInstanceOf(OpenAIError);
    await expect(firstAttempt).rejects.toThrow("invalid 'expires_in'");
    await expect(auth.getToken()).resolves.toBe('replacement-token');
    await expect(auth.getToken()).resolves.toBe('replacement-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('rejects a JSON numeric literal that parses to Infinity', async () => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"access_token":"unsafe-token","expires_in":1e309}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(tokenExchangeResponse(3600, 'replacement-token'));
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);

    await expect(auth.getToken()).rejects.toThrow("invalid 'expires_in'");
    await expect(auth.getToken()).resolves.toBe('replacement-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['one millisecond', 0.001],
    ['one second', 1],
    ['fractional seconds', 1.5],
    ['one hour', 3600],
    ['the largest safe whole-second duration', MAXIMUM_SAFE_DURATION],
  ])('preserves a valid positive duration: %s', async (_description, expiresIn) => {
    const customFetch = vi.fn().mockResolvedValue(tokenExchangeResponse(expiresIn, 'valid-token'));
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);

    await expect(auth.getToken()).resolves.toBe('valid-token');
    await expect(auth.getToken()).resolves.toBe('valid-token');
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing', undefined],
    ['null', null],
  ])('preserves the one-hour fallback when expires_in is %s', async (_description, expiresIn) => {
    let exchangeCount = 0;
    const customFetch = vi.fn(async () => {
      exchangeCount += 1;
      return tokenExchangeResponse(expiresIn, `token-${exchangeCount}`);
    });
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);

    await expect(auth.getToken()).resolves.toBe('token-1');
    currentTime += 3_599_999;
    await expect(auth.getToken()).resolves.toBe('token-1');
    currentTime += 1;
    await expect(auth.getToken()).resolves.toBe('token-2');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('shares a rejected refresh and resets it for the next exchange', async () => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse('invalid', 'unsafe-token'))
      .mockResolvedValueOnce(tokenExchangeResponse(3600, 'replacement-token'));
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);
    const attempts = [auth.getToken(), auth.getToken(), auth.getToken()];

    for (const result of await Promise.allSettled(attempts)) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(OpenAIError);
        expect(result.reason.message).toContain("invalid 'expires_in'");
      }
    }

    expect(customFetch).toHaveBeenCalledTimes(1);

    await expect(auth.getToken()).resolves.toBe('replacement-token');
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('retains a usable cached token when a background refresh has an invalid expiration', async () => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse(60, 'cached-token'))
      .mockResolvedValueOnce(tokenExchangeResponse('invalid', 'unsafe-token'))
      .mockResolvedValueOnce(tokenExchangeResponse(3600, 'replacement-token'));
    const auth = new WorkloadIdentityAuth({ ...workloadIdentity, refreshBufferSeconds: 1200 }, customFetch);

    await expect(auth.getToken()).resolves.toBe('cached-token');
    await expect(auth.getToken()).resolves.toBe('cached-token');
    await delay(0);
    expect(customFetch).toHaveBeenCalledTimes(2);

    await expect(auth.getToken()).resolves.toBe('cached-token');
    await delay(0);

    await expect(auth.getToken()).resolves.toBe('replacement-token');
    expect(customFetch).toHaveBeenCalledTimes(3);
  });

  test('never returns a stale token when an expired-token refresh is malformed', async () => {
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenExchangeResponse(1, 'expired-token'))
      .mockResolvedValueOnce(tokenExchangeResponse(0, 'unsafe-token'))
      .mockResolvedValueOnce(tokenExchangeResponse(3600, 'replacement-token'));
    const auth = new WorkloadIdentityAuth(workloadIdentity, customFetch);

    await expect(auth.getToken()).resolves.toBe('expired-token');
    currentTime += 1000;
    await expect(auth.getToken()).rejects.toThrow("invalid 'expires_in'");
    await expect(auth.getToken()).resolves.toBe('replacement-token');
    expect(customFetch).toHaveBeenCalledTimes(3);
  });

  test.each([
    ['a nonnumeric duration', 'invalid'],
    ['a zero duration', 0],
    ['an overflowing duration', 1e308],
  ])('prevents the public OpenAI client from using %s', async (_description, expiresIn) => {
    let exchangeCount = 0;
    let apiRequestCount = 0;
    const clientFetch = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenExchangeResponse(expiresIn, `unsafe-token-${exchangeCount}`);
      }

      apiRequestCount += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity, fetch: clientFetch });

    await expect(client.models.list()).rejects.toThrow("invalid 'expires_in'");
    currentTime += 30 * 24 * 60 * 60 * 1000;
    await expect(client.models.list()).rejects.toThrow("invalid 'expires_in'");

    expect(exchangeCount).toBe(2);
    expect(apiRequestCount).toBe(0);
  });

  test('refreshes a valid workload-identity token through the public OpenAI client', async () => {
    let exchangeCount = 0;
    const authorizations: (string | null)[] = [];
    const clientFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (url.toString().includes('/oauth/token')) {
        exchangeCount += 1;
        return tokenExchangeResponse(3600, `valid-token-${exchangeCount}`);
      }

      authorizations.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity, fetch: clientFetch });

    await client.models.list();
    currentTime += 30 * 24 * 60 * 60 * 1000;
    await client.models.list();

    expect(exchangeCount).toBe(2);
    expect(authorizations).toEqual(['Bearer valid-token-1', 'Bearer valid-token-2']);
  });
});
