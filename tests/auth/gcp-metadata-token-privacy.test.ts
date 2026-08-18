import { once } from 'node:events';
import { vi } from 'vitest';

import OpenAI, { SubjectTokenProviderError } from 'openai';
import { gcpIDTokenProvider } from 'openai/auth/subject-token-providers';

const METADATA_CREDENTIAL = 'sk-test-gcp-metadata-secret-7f3e';
const CUSTOMER_DATA = 'private-customer-record-9a41';
const SUCCESSFUL_TOKEN = 'successful-gcp-identity-token';

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
    format: 'plain-text',
    status: 401,
    contentType: 'text/plain',
    body: `Authorization: Bearer ${METADATA_CREDENTIAL}\ncustomer=${CUSTOMER_DATA}`,
  },
] as const;

type MetadataFailure = (typeof metadataFailures)[number];

function createMetadataFailureResponse(failure: MetadataFailure) {
  const response = new Response(failure.body, {
    status: failure.status,
    headers: { 'content-type': failure.contentType },
  });

  return { response, readBody: vi.spyOn(response, 'text') };
}

async function expectPrivateMetadataFailure(
  operation: () => Promise<unknown>,
  status: number,
): Promise<void> {
  let failure: unknown;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(SubjectTokenProviderError);

  if (!(failure instanceof SubjectTokenProviderError)) {
    throw new Error('The metadata provider did not reject with SubjectTokenProviderError.');
  }

  expect(failure.provider).toBe('gcp-metadata');
  expect(failure.message).toBe(
    `Failed to fetch token from GCP Metadata Server: GCP Metadata Server returned ${status}`,
  );
  expect(failure.cause).toBeInstanceOf(Error);

  if (!(failure.cause instanceof Error)) {
    throw new Error('The metadata provider did not preserve its original error.');
  }

  for (const value of [
    failure.message,
    failure.stack ?? '',
    failure.cause.message,
    failure.cause.stack ?? '',
  ]) {
    expect(value).not.toContain(METADATA_CREDENTIAL);
    expect(value).not.toContain(CUSTOMER_DATA);
  }
}

describe('GCP metadata token HTTP error privacy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(metadataFailures)(
    'does not read or expose a $format HTTP $status error through the public provider',
    async (failure) => {
      const { response, readBody } = createMetadataFailureResponse(failure);
      const metadataFetch = vi.fn(async () => response);
      const provider = gcpIDTokenProvider(undefined, { fetch: metadataFetch });

      await expectPrivateMetadataFailure(() => provider.getToken(), failure.status);

      expect(metadataFetch).toHaveBeenCalledTimes(1);
      expect(readBody).not.toHaveBeenCalled();
    },
  );

  it.each(metadataFailures)(
    'does not expose a $format HTTP $status error through an actual OpenAI API request',
    async (failure) => {
      const { response, readBody } = createMetadataFailureResponse(failure);
      const metadataFetch = vi.fn(async () => response);
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = new OpenAI({
        apiKey: null,
        maxRetries: 0,
        fetch: apiFetch,
        workloadIdentity: {
          identityProviderId: 'test-identity-provider',
          serviceAccountId: 'test-service-account',
          provider: gcpIDTokenProvider(undefined, { fetch: metadataFetch }),
        },
      });

      await expectPrivateMetadataFailure(() => client.models.list(), failure.status);

      expect(metadataFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
      expect(readBody).not.toHaveBeenCalled();
    },
  );

  it('cancels an indefinitely streaming rejected metadata body without reading it', async () => {
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
    const readBody = vi.spyOn(response, 'text');
    const provider = gcpIDTokenProvider(undefined, { fetch: async () => response });

    await expectPrivateMetadataFailure(() => provider.getToken(), 503);

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(readBody).not.toHaveBeenCalled();
  });

  it('preserves the sanitized metadata status when body cancellation rejects', async () => {
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
    const provider = gcpIDTokenProvider(undefined, {
      fetch: async (_input, options) => {
        requestSignal = options?.signal;
        return response;
      },
    });

    await expectPrivateMetadataFailure(() => provider.getToken(), 502);

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });

  it('keeps the request timeout armed while an error-body cancellation is pending', async () => {
    vi.useFakeTimers();

    let requestSignal: AbortSignal | null | undefined;
    const cancelBody = vi.fn(async () => {
      if (!requestSignal) {
        throw new Error('The metadata request did not supply an abort signal.');
      }

      await once(requestSignal, 'abort');
      throw new Error(`cancel failed with ${METADATA_CREDENTIAL}`);
    });
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
      status: 503,
    });
    const provider = gcpIDTokenProvider(undefined, {
      timeout: 25,
      fetch: async (_input, options) => {
        requestSignal = options?.signal;
        return response;
      },
    });

    const operation = expectPrivateMetadataFailure(() => provider.getToken(), 503);
    await vi.advanceTimersByTimeAsync(25);
    await operation;

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds never-settling metadata cancellation during public workload authentication', async () => {
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
        provider: gcpIDTokenProvider(undefined, { fetch: metadataFetch, timeout: 25 }),
      },
    });
    const completed = vi.fn();
    const operation = expectPrivateMetadataFailure(() => client.models.list(), 504).then(completed);

    await vi.advanceTimersByTimeAsync(25);

    expect(completed).toHaveBeenCalledTimes(1);
    await operation;
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'safely observes a cancellation that later %ss after the request deadline',
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
      const provider = gcpIDTokenProvider(undefined, {
        timeout: 25,
        fetch: async () => response,
      });
      const completed = vi.fn();
      const operation = expectPrivateMetadataFailure(() => provider.getToken(), 503).then(completed);

      await vi.advanceTimersByTimeAsync(25);

      expect(completed).toHaveBeenCalledTimes(1);
      await operation;
      releaseCancellation.dispatchEvent(new Event('release'));
      await vi.advanceTimersByTimeAsync(0);

      expect(cancelBody).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('closes each rejected metadata stream across public authentication retries', async () => {
    const cancelBody = vi.fn();
    const metadataFetch = vi.fn(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
          status: 503,
        }),
    );
    const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new OpenAI({
      apiKey: null,
      maxRetries: 0,
      fetch: apiFetch,
      workloadIdentity: {
        identityProviderId: 'test-identity-provider',
        serviceAccountId: 'test-service-account',
        provider: gcpIDTokenProvider(undefined, { fetch: metadataFetch }),
      },
    });

    await expectPrivateMetadataFailure(() => client.models.list(), 503);
    await expectPrivateMetadataFailure(() => client.models.list(), 503);

    expect(metadataFetch).toHaveBeenCalledTimes(2);
    expect(cancelBody).toHaveBeenCalledTimes(2);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('continues to consume and trim successful metadata identity tokens', async () => {
    const response = new Response(`  ${SUCCESSFUL_TOKEN}\n`, { status: 200 });
    const readBody = vi.spyOn(response, 'text');
    const metadataFetch = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => response);
    const provider = gcpIDTokenProvider('https://example.com/audience', { fetch: metadataFetch });

    await expect(provider.getToken()).resolves.toBe(SUCCESSFUL_TOKEN);

    expect(provider.tokenType).toBe('id');
    expect(metadataFetch).toHaveBeenCalledTimes(1);
    expect(readBody).toHaveBeenCalledTimes(1);

    const [url, options] = metadataFetch.mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams.get('audience')).toBe('https://example.com/audience');
    expect(new Headers(options?.headers).get('Metadata-Flavor')).toBe('Google');
  });

  it('clears the metadata request timeout after an HTTP failure', async () => {
    vi.useFakeTimers();

    const [failure] = metadataFailures;
    const { response, readBody } = createMetadataFailureResponse(failure);
    const metadataFetch = vi.fn(async () => response);
    const provider = gcpIDTokenProvider(undefined, { fetch: metadataFetch, timeout: 1234 });

    await expectPrivateMetadataFailure(() => provider.getToken(), failure.status);

    expect(vi.getTimerCount()).toBe(0);
    expect(readBody).not.toHaveBeenCalled();
  });
});
