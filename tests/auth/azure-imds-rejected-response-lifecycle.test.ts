import { once } from 'node:events';
import { createServer } from 'node:http';
import { vi } from 'vitest';

import OpenAI, { SubjectTokenProviderError } from 'openai';
import { azureManagedIdentityTokenProvider } from 'openai/auth/subject-token-providers';

const METADATA_CREDENTIAL = 'sk-test-azure-imds-secret-7f3e';
const CUSTOMER_DATA = 'private-azure-customer-record-9a41';
const SUCCESSFUL_TOKEN = 'successful-azure-managed-identity-token';

const metadataFailures = [
  {
    format: 'JSON',
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: METADATA_CREDENTIAL,
      customer: CUSTOMER_DATA,
      authorization: `Bearer ${METADATA_CREDENTIAL}`,
    }),
  },
  {
    format: 'HTML',
    status: 500,
    contentType: 'text/html',
    body: `<html><title>${METADATA_CREDENTIAL}</title><p>${CUSTOMER_DATA}</p></html>`,
  },
  {
    format: 'plain text',
    status: 401,
    contentType: 'text/plain',
    body: `Authorization: Bearer ${METADATA_CREDENTIAL}\\ncustomer=${CUSTOMER_DATA}`,
  },
] as const;

async function expectPrivateAzureFailure(operation: () => Promise<unknown>, status: number): Promise<void> {
  let failure: unknown;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(SubjectTokenProviderError);

  if (!(failure instanceof SubjectTokenProviderError)) {
    throw new Error('The Azure metadata provider did not reject with SubjectTokenProviderError.');
  }

  expect(failure.provider).toBe('azure-imds');
  expect(failure.message).toBe(`Failed to fetch token from Azure IMDS: status ${status}`);
  expect(failure.cause).toBeUndefined();

  for (const value of [failure.message, failure.stack ?? '']) {
    expect(value).not.toContain(METADATA_CREDENTIAL);
    expect(value).not.toContain(CUSTOMER_DATA);
  }
}

describe('Azure IMDS rejected-response lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(metadataFailures)(
    'preserves a private $format HTTP $status failure without reading its body',
    async ({ body, contentType, status }) => {
      const response = new Response(body, {
        status,
        headers: { 'content-type': contentType },
      });
      const readText = vi.spyOn(response, 'text');
      const readJSON = vi.spyOn(response, 'json');
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

      await expectPrivateAzureFailure(() => provider.getToken(), status);

      expect(readText).not.toHaveBeenCalled();
      expect(readJSON).not.toHaveBeenCalled();
    },
  );

  it('cancels an indefinitely streaming rejected Azure metadata body without reading it', async () => {
    const cancelBody = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(METADATA_CREDENTIAL));
        },
        cancel: cancelBody,
      }),
      { status: 503 },
    );
    const readText = vi.spyOn(response, 'text');
    const readJSON = vi.spyOn(response, 'json');
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

    await expectPrivateAzureFailure(() => provider.getToken(), 503);

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(readJSON).not.toHaveBeenCalled();
  });

  it('aborts cancellation failures while preserving the original private status without a cause', async () => {
    const cancellationFailure = new Error(
      `stream cancellation disclosed ${METADATA_CREDENTIAL} ${CUSTOMER_DATA}`,
    );
    const cancelBody = vi.fn(async () => {
      throw cancellationFailure;
    });
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 502,
    });
    let requestSignal: AbortSignal | null | undefined;
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async (_input, options) => {
        requestSignal = options?.signal;
        return response;
      },
    });

    await expectPrivateAzureFailure(() => provider.getToken(), 502);

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });

  it('keeps its request deadline armed while rejected-body cancellation is pending', async () => {
    vi.useFakeTimers();

    let requestSignal: AbortSignal | null | undefined;
    const cancelBody = vi.fn(async () => {
      if (!requestSignal) {
        throw new Error('The Azure metadata request did not supply an abort signal.');
      }

      await once(requestSignal, 'abort');
      throw new Error(`cancel failed with ${METADATA_CREDENTIAL}`);
    });
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 503,
    });
    const provider = azureManagedIdentityTokenProvider(undefined, {
      timeout: 25,
      fetch: async (_input, options) => {
        requestSignal = options?.signal;
        return response;
      },
    });

    const operation = expectPrivateAzureFailure(() => provider.getToken(), 503);
    await vi.advanceTimersByTimeAsync(25);
    await operation;

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds never-settling cancellation during actual public workload authentication', async () => {
    vi.useFakeTimers();

    const neverReleased = new EventTarget();
    const cancelBody = vi.fn(async () => {
      await once(neverReleased, 'release');
    });
    let requestSignal: AbortSignal | null | undefined;
    const metadataFetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      requestSignal = options?.signal;
      return new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 504,
      });
    });
    const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new OpenAI({
      apiKey: null,
      maxRetries: 0,
      fetch: apiFetch,
      workloadIdentity: {
        identityProviderId: 'test-identity-provider',
        serviceAccountId: 'test-service-account',
        provider: azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch, timeout: 25 }),
      },
    });
    const completed = vi.fn();
    const operation = expectPrivateAzureFailure(() => client.models.list(), 504).then(completed);

    await vi.advanceTimersByTimeAsync(25);

    expect(completed).toHaveBeenCalledTimes(1);
    await operation;
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'safely observes cancellation that later %ss after the Azure request deadline',
    async (settlement) => {
      vi.useFakeTimers();

      const releaseCancellation = new EventTarget();
      const cancelBody = vi.fn(async () => {
        await once(releaseCancellation, 'release');
        if (settlement === 'reject') {
          throw new Error(`late cancellation leaked ${METADATA_CREDENTIAL} ${CUSTOMER_DATA}`);
        }
      });
      const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 503,
      });
      const provider = azureManagedIdentityTokenProvider(undefined, {
        timeout: 25,
        fetch: async () => response,
      });
      const completed = vi.fn();
      const operation = expectPrivateAzureFailure(() => provider.getToken(), 503).then(completed);

      await vi.advanceTimersByTimeAsync(25);

      expect(completed).toHaveBeenCalledTimes(1);
      await operation;
      releaseCancellation.dispatchEvent(new Event('release'));
      await vi.advanceTimersByTimeAsync(0);

      expect(cancelBody).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('removes its rejected-body abort listener and clears the request timer', async () => {
    vi.useFakeTimers();

    let requestSignal: AbortSignal | null | undefined;
    let removeListener: ReturnType<typeof vi.spyOn> | undefined;
    const response = new Response(new ReadableStream<Uint8Array>(), { status: 503 });
    const provider = azureManagedIdentityTokenProvider(undefined, {
      timeout: 1234,
      fetch: async (_input, options) => {
        requestSignal = options?.signal;
        if (requestSignal) {
          removeListener = vi.spyOn(requestSignal, 'removeEventListener');
        }
        return response;
      },
    });

    await expectPrivateAzureFailure(() => provider.getToken(), 503);

    expect(requestSignal?.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, undefined])('preserves the original failure when the rejected body is %s', async (body) => {
    vi.useFakeTimers();

    const response = { ok: false, status: 503, body } as Response;
    const provider = azureManagedIdentityTokenProvider(undefined, {
      timeout: 1234,
      fetch: async () => response,
    });

    await expectPrivateAzureFailure(() => provider.getToken(), 503);

    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['provider', 'workload'] as const)(
    'closes real infinite HTTP response streams for repeated public %s attempts',
    async (boundary) => {
      let closedResponses = 0;
      const metadata = createServer((request, response) => {
        request.resume();
        response.once('close', () => {
          closedResponses += 1;
        });
        response.writeHead(503, { 'content-type': 'application/json' });
        response.write(`{"access_token":"${METADATA_CREDENTIAL}`);
      });

      try {
        await once(metadata.listen(0, '127.0.0.1'), 'listening');
        const address = metadata.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected the Azure metadata server to bind an ephemeral TCP port.');
        }

        const metadataURL = `http://127.0.0.1:${address.port}/metadata`;
        const metadataFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
          globalThis.fetch(metadataURL, init),
        );
        const provider = azureManagedIdentityTokenProvider(undefined, {
          fetch: metadataFetch,
          timeout: 1000,
        });
        const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
        const client = new OpenAI({
          apiKey: null,
          maxRetries: 0,
          fetch: apiFetch,
          workloadIdentity: {
            identityProviderId: 'test-identity-provider',
            serviceAccountId: 'test-service-account',
            provider,
          },
        });
        const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

        await expectPrivateAzureFailure(operation, 503);
        await expectPrivateAzureFailure(operation, 503);

        await vi.waitFor(
          () => {
            expect(closedResponses).toBe(2);
          },
          { timeout: 500, interval: 10 },
        );
        expect(metadataFetch).toHaveBeenCalledTimes(2);
        expect(apiFetch).not.toHaveBeenCalled();
      } finally {
        const closed = once(metadata, 'close');
        metadata.closeAllConnections();
        metadata.close();
        await closed;
      }
    },
  );

  it('preserves successful managed-identity tokens, query settings, and metadata headers', async () => {
    const response = Response.json({ access_token: SUCCESSFUL_TOKEN, expires_in: '3600' });
    const readJSON = vi.spyOn(response, 'json');
    const metadataFetch = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => response);
    const provider = azureManagedIdentityTokenProvider('https://cognitiveservices.azure.com/', {
      fetch: metadataFetch,
      apiVersion: '2019-08-01',
      clientId: 'azure-managed-client',
    });

    await expect(provider.getToken()).resolves.toBe(SUCCESSFUL_TOKEN);

    expect(provider.tokenType).toBe('jwt');
    expect(readJSON).toHaveBeenCalledTimes(1);
    expect(metadataFetch).toHaveBeenCalledTimes(1);

    const [url, options] = metadataFetch.mock.calls[0] ?? [];
    const parsedURL = new URL(String(url));
    expect(parsedURL.searchParams.get('resource')).toBe('https://cognitiveservices.azure.com/');
    expect(parsedURL.searchParams.get('api-version')).toBe('2019-08-01');
    expect(parsedURL.searchParams.get('client_id')).toBe('azure-managed-client');
    expect(new Headers(options?.headers).get('Metadata')).toBe('true');
  });
});
