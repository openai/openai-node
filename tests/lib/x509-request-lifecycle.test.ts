import { expect, vi } from 'vitest';

import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';

const x509Identity = {
  type: 'x509' as const,
  identityProviderId: 'idp_test',
  serviceAccountId: 'svc_acct_test',
};

function tokenResponse(token: string): Response {
  return Response.json({ access_token: token, expires_in: 3600 });
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolveResponse!: (response: Response) => void;
  // oxlint-disable-next-line promise/avoid-new -- This fixture needs a manually controlled fetch response.
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return { promise, resolve: resolveResponse };
}

describe('X.509 request lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('a canceled API request does not cancel the exchange shared by another request', async () => {
    const exchange = deferredResponse();
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        return await exchange.promise;
      }
      apiCount += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });
    const controller = new AbortController();

    const canceled = client.models.list({ signal: controller.signal });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const winner = client.models.list();
    controller.abort('caller stopped waiting');

    await expect(canceled).rejects.toBeInstanceOf(APIUserAbortError);
    exchange.resolve(tokenResponse('shared-token'));
    await expect(winner).resolves.toMatchObject({ data: [] });
    expect(apiCount).toBe(1);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  test('a request timeout bounds its exchange wait without canceling another request', async () => {
    vi.useFakeTimers();
    const exchange = deferredResponse();
    let apiCount = 0;
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      if (url.toString().includes('/oauth/token')) {
        return await exchange.promise;
      }
      apiCount += 1;
      return Response.json({ data: [] });
    });
    const client = new OpenAI({ apiKey: null, workloadIdentity: x509Identity, fetch: customFetch });

    const timedOut = client.models.list({ timeout: 1000 });
    const winner = client.models.list({ timeout: 5000 });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const timeoutAssertion = expect(timedOut).rejects.toBeInstanceOf(APIConnectionTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    await timeoutAssertion;
    exchange.resolve(tokenResponse('shared-token'));

    await expect(winner).resolves.toMatchObject({ data: [] });
    expect(apiCount).toBe(1);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });
});
