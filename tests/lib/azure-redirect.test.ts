import { once } from 'node:events';
import { createServer } from 'node:http';
import { AzureOpenAI, APIError } from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';

class RedirectFollowingAzureOpenAI extends AzureOpenAI {
  // oxlint-disable-next-line class-methods-use-this -- This fixture exercises an overridable instance hook.
  protected override async prepareRequest(request: RequestInit): Promise<void> {
    request.redirect = 'follow';
  }
}

describe('azure redirect safety', () => {
  const apiVersion = '2024-02-15-preview';
  const apiKey = 'AZURE_OPENAI_TEST_SECRET';
  const baseURL = 'http://127.0.0.1';

  test.each([
    ['default fetch behavior', undefined, undefined],
    ['client-level redirect override', 'follow', undefined],
    ['request-level redirect override', undefined, 'follow'],
    ['client-level and request-level redirect overrides', 'follow', 'follow'],
  ] as const)(
    'disables automatic redirects for static API keys despite %s',
    async (_configuration, clientRedirect, requestRedirect) => {
      const client = new AzureOpenAI({
        baseURL,
        apiKey,
        apiVersion,
        ...(clientRedirect ? { fetchOptions: { redirect: clientRedirect } } : {}),
      });

      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'get',
        ...(requestRedirect ? { fetchOptions: { redirect: requestRedirect } } : {}),
      });

      expect(req.headers.get('api-key')).toBe(apiKey);
      expect(req.redirect).toBe('manual');
    },
  );

  test('disables automatic redirects after a subclass opts into following redirects', async () => {
    let requestedInit: RequestInit | undefined;
    const client = new RedirectFollowingAzureOpenAI({
      baseURL,
      apiKey,
      apiVersion,
      fetch: async (_url, init) => {
        requestedInit = init;
        return globalThis.Response.json({ ok: true });
      },
    });

    await client.get('/foo');

    expect(new Headers(requestedInit?.headers).get('api-key')).toBe(apiKey);
    expect(requestedInit?.redirect).toBe('manual');
  });

  test('preserves subclass redirect preferences for bearer-only authentication', async () => {
    let requestedInit: RequestInit | undefined;
    const client = new RedirectFollowingAzureOpenAI({
      baseURL,
      azureADTokenProvider: async () => 'azure-ad-token',
      apiVersion,
      fetch: async (_url, init) => {
        requestedInit = init;
        return globalThis.Response.json({ ok: true });
      },
    });

    await client.get('/foo');

    const requestedHeaders = new Headers(requestedInit?.headers);
    expect(requestedHeaders.get('authorization')).toBe('Bearer azure-ad-token');
    expect(requestedHeaders.has('api-key')).toBe(false);
    expect(requestedInit?.redirect).toBe('follow');
  });

  test('preserves subclass redirect preferences when the API key header is explicitly removed', async () => {
    let requestedInit: RequestInit | undefined;
    const client = new RedirectFollowingAzureOpenAI({
      baseURL,
      apiKey,
      apiVersion,
      fetch: async (_url, init) => {
        requestedInit = init;
        return globalThis.Response.json({ ok: true });
      },
    });

    await client.get('/foo', { headers: { 'api-key': null } });

    expect(new Headers(requestedInit?.headers).has('api-key')).toBe(false);
    expect(requestedInit?.redirect).toBe('follow');
  });

  test.each([
    ['default redirect behavior', undefined, undefined, undefined],
    ['client-level redirect preference', 'follow', undefined, 'follow'],
    ['request-level redirect preference', 'error', 'follow', 'follow'],
  ] as const)(
    'preserves %s for bearer-only authentication',
    async (_configuration, clientRedirect, requestRedirect, expectedRedirect) => {
      let requestedInit: RequestInit | undefined;
      const client = new AzureOpenAI({
        baseURL,
        azureADTokenProvider: async () => 'azure-ad-token',
        apiVersion,
        fetch: async (_url, init) => {
          requestedInit = init;
          return globalThis.Response.json({ ok: true });
        },
        ...(clientRedirect ? { fetchOptions: { redirect: clientRedirect } } : {}),
      });

      await client.get('/foo', requestRedirect ? { fetchOptions: { redirect: requestRedirect } } : undefined);

      const requestedHeaders = new Headers(requestedInit?.headers);
      expect(requestedHeaders.get('authorization')).toBe('Bearer azure-ad-token');
      expect(requestedHeaders.has('api-key')).toBe(false);
      expect(requestedInit?.redirect).toBe(expectedRedirect);
    },
  );

  test.each([
    ['default redirect behavior', undefined, undefined, undefined],
    ['client-level redirect preference', 'follow', undefined, 'follow'],
    ['request-level redirect preference', 'error', 'follow', 'follow'],
  ] as const)(
    'preserves %s when the API key header is explicitly removed',
    async (_configuration, clientRedirect, requestRedirect, expectedRedirect) => {
      const client = new AzureOpenAI({
        baseURL,
        apiKey,
        apiVersion,
        ...(clientRedirect ? { fetchOptions: { redirect: clientRedirect } } : {}),
      });

      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'get',
        headers: { 'api-key': null },
        ...(requestRedirect ? { fetchOptions: { redirect: requestRedirect } } : {}),
      });

      expect(req.headers.has('api-key')).toBe(false);
      expect(req.redirect).toBe(expectedRedirect);
    },
  );

  test.each([301, 302, 303, 307, 308])(
    'does not disclose static API keys after subclass preparation on an HTTP %i redirect',
    async (status) => {
      const disclosedAPIKeys: (string | string[] | undefined)[] = [];
      let redirectURL = '';

      const destination = createServer((request, response) => {
        request.resume();
        disclosedAPIKeys.push(request.headers['api-key']);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ leakedApiKey: request.headers['api-key'] }));
      });

      const source = createServer((request, response) => {
        request.resume();
        response.writeHead(status, { location: redirectURL });
        response.end();
      });

      try {
        await Promise.all([
          once(destination.listen(0, '127.0.0.1'), 'listening'),
          once(source.listen(0, '127.0.0.1'), 'listening'),
        ]);

        const destinationAddress = destination.address();
        const sourceAddress = source.address();

        if (
          !destinationAddress ||
          typeof destinationAddress === 'string' ||
          !sourceAddress ||
          typeof sourceAddress === 'string'
        ) {
          throw new Error('Expected both redirect test servers to bind ephemeral TCP ports');
        }

        redirectURL = `http://127.0.0.1:${destinationAddress.port}/attacker`;

        const client = new RedirectFollowingAzureOpenAI({
          baseURL: `http://127.0.0.1:${sourceAddress.port}`,
          apiKey,
          apiVersion,
          maxRetries: 0,
          fetchOptions: { redirect: 'follow' },
        });

        const request = client.get('/redirect', { fetchOptions: { redirect: 'follow' } });

        await expect(request).rejects.toBeInstanceOf(APIError);
        await expect(request).rejects.toMatchObject({ status });
        expect(disclosedAPIKeys).toEqual([]);
      } finally {
        await Promise.all(
          [source, destination].map(async (server) => {
            const closed = once(server, 'close');
            server.close();
            server.closeAllConnections();
            await closed;
          }),
        );
      }
    },
  );
});
