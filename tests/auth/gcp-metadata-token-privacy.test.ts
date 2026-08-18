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
