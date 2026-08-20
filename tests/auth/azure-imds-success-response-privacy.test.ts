import { once } from 'node:events';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { vi } from 'vitest';

import OpenAI, { SubjectTokenProviderError } from 'openai';
import { azureManagedIdentityTokenProvider } from 'openai/auth/subject-token-providers';

const PRIVATE_VALUES = ['sk-priv-7a', 'cust-prv01'] as const;
const VALID_SUBJECT_TOKEN = 'valid-azure-managed-identity-token';
const SAFE_PARSE_FAILURE = 'IMDS response contains invalid JSON';

type AzureProvider = ReturnType<typeof azureManagedIdentityTokenProvider>;

function createWorkloadClient(provider: AzureProvider, apiFetch: typeof fetch): OpenAI {
  return new OpenAI({
    apiKey: null,
    maxRetries: 0,
    fetch: apiFetch,
    workloadIdentity: {
      identityProviderId: 'test-identity-provider',
      serviceAccountId: 'test-service-account',
      provider,
    },
  });
}

async function expectPrivateParseFailure(
  operation: () => Promise<unknown>,
  privateValue: string,
): Promise<void> {
  let failure: unknown;

  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(SubjectTokenProviderError);
  if (!(failure instanceof SubjectTokenProviderError)) {
    throw new Error('Azure metadata authentication did not preserve its public provider error.');
  }

  expect(failure.provider).toBe('azure-imds');
  expect(failure.message).toBe('failed to fetch token from IMDS');
  expect(failure.cause).toBeInstanceOf(SyntaxError);
  if (!(failure.cause instanceof SyntaxError)) {
    throw new Error('Azure metadata authentication did not preserve its JSON syntax error cause.');
  }

  for (const diagnostic of [
    failure.message,
    failure.stack ?? '',
    failure.cause.message,
    failure.cause.stack ?? '',
    inspect(failure, { depth: null }),
  ]) {
    expect(diagnostic).not.toContain(privateValue);
  }

  expect(failure.cause.message).toBe(SAFE_PARSE_FAILURE);
  expect('cause' in failure.cause).toBe(false);
}

describe('Azure IMDS successful-response JSON privacy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(PRIVATE_VALUES)(
    'keeps malformed successful metadata containing %s out of public provider diagnostics',
    async (privateValue) => {
      const response = new Response(`${privateValue} customer-private-record`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const readJSON = vi.spyOn(response, 'json');
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

      await expectPrivateParseFailure(() => provider.getToken(), privateValue);

      expect(readJSON).toHaveBeenCalledTimes(1);
      expect(response.bodyUsed).toBe(true);
    },
  );

  it.each(PRIVATE_VALUES)(
    'keeps malformed successful metadata containing %s out of public OpenAI workload diagnostics',
    async (privateValue) => {
      const metadataFetch = vi.fn(async () => new Response(`${privateValue} customer-private-record`));
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(
        azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch }),
        apiFetch,
      );

      await expectPrivateParseFailure(() => client.models.list(), privateValue);

      expect(metadataFetch).toHaveBeenCalledTimes(1);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['provider', 'workload'] as const)(
    'sanitizes a native malformed JSON error from an actual HTTP response through the %s boundary',
    async (boundary) => {
      const [privateValue] = PRIVATE_VALUES;
      const metadata = createServer((request, response) => {
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(`${privateValue} customer-private-record`);
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
        const client = createWorkloadClient(provider, apiFetch);
        const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();

        await expectPrivateParseFailure(operation, privateValue);

        expect(metadataFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch).not.toHaveBeenCalled();
      } finally {
        const closed = once(metadata, 'close');
        metadata.closeAllConnections();
        metadata.close();
        await closed;
      }
    },
  );

  it('removes private nested causes from replacement syntax errors', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const original = new SyntaxError(`${privateValue} was returned by the metadata JSON parser`);
    Object.defineProperty(original, 'cause', {
      value: new Error(`${privateValue} nested parser detail`),
    });
    const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
    vi.spyOn(response, 'json').mockRejectedValue(original);
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });

    await expectPrivateParseFailure(() => provider.getToken(), privateValue);
  });

  it.each([new Error('metadata body failed'), new TypeError('metadata body became unusable')])(
    'preserves the exact original non-syntax JSON failure %s',
    async (original) => {
      const response = Response.json({ access_token: VALID_SUBJECT_TOKEN });
      vi.spyOn(response, 'json').mockRejectedValue(original);
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
      let failure: unknown;

      try {
        await provider.getToken();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its error contract.');
      }
      expect(failure.provider).toBe('azure-imds');
      expect(failure.message).toBe('failed to fetch token from IMDS');
      expect(failure.cause).toBe(original);
    },
  );

  it.each(['provider', 'workload'] as const)(
    'preserves an upstream fetch SyntaxError without incorrectly sanitizing its identity through %s',
    async (boundary) => {
      const original = new SyntaxError('upstream fetch failed before the response existed');
      const metadataFetch = vi.fn(async (): Promise<Response> => {
        throw original;
      });
      const provider = azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch });
      const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
      const client = createWorkloadClient(provider, apiFetch);
      const operation = boundary === 'provider' ? () => provider.getToken() : () => client.models.list();
      let failure: unknown;

      try {
        await operation();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SubjectTokenProviderError);
      if (!(failure instanceof SubjectTokenProviderError)) {
        throw new Error('The public provider did not preserve its error contract.');
      }
      expect(failure.provider).toBe('azure-imds');
      expect(failure.message).toBe('failed to fetch token from IMDS');
      expect(failure.cause).toBe(original);
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it('preserves exact original transport failures', async () => {
    const original = new Error('metadata network connection failed');
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async () => {
        throw original;
      },
    });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its transport error.');
    }
    expect(failure.cause).toBe(original);
  });

  it('preserves timeout cancellation, its original abort cause, and timer cleanup', async () => {
    vi.useFakeTimers();

    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const original = new DOMException('metadata request timed out', 'AbortError');
    let requestSignal: AbortSignal | null | undefined;
    const provider = azureManagedIdentityTokenProvider(undefined, {
      timeout: 25,
      fetch: async (_url, options) => {
        requestSignal = options?.signal;
        if (!requestSignal) {
          throw new Error('The metadata request did not provide an abort signal.');
        }
        await once(requestSignal, 'abort');
        throw original;
      },
    });
    const completed = (async () => {
      try {
        await provider.getToken();
      } catch (error) {
        return error;
      }
      return null;
    })();

    await vi.advanceTimersByTimeAsync(25);

    const failure = await completed;
    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its timeout failure.');
    }
    expect(failure.cause).toBe(original);
    expect(requestSignal?.aborted).toBe(true);
    expect(clearTimer).toHaveBeenCalled();
  });

  it('preserves rejected-body cancellation and fixed cause-free HTTP failures', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(privateValue));
        },
        cancel,
      }),
      { status: 403 },
    );
    const readJSON = vi.spyOn(response, 'json');
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch: async () => response });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its rejected HTTP response.');
    }
    expect(failure.message).toBe('Failed to fetch token from Azure IMDS: status 403');
    expect(failure.cause).toBeUndefined();
    expect(inspect(failure, { depth: null })).not.toContain(privateValue);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(readJSON).not.toHaveBeenCalled();
  });

  it('preserves missing-token failures without adding a parser cause', async () => {
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async () => Response.json({ expires_in: 3600 }),
    });
    let failure: unknown;

    try {
      await provider.getToken();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public provider did not preserve its missing-token failure.');
    }
    expect(failure.message).toBe("IMDS response missing 'access_token' field");
    expect(failure.cause).toBeUndefined();
  });

  it('preserves successful Azure subject-token responses', async () => {
    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: async () => Response.json({ access_token: VALID_SUBJECT_TOKEN }),
    });

    await expect(provider.getToken()).resolves.toBe(VALID_SUBJECT_TOKEN);
  });

  it('shares concurrent public failures and allows a subsequent valid workload exchange', async () => {
    const [privateValue] = PRIVATE_VALUES;
    const metadataFetch = vi.fn(async () => new Response(`${privateValue} private customer record`));
    const apiFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createWorkloadClient(
      azureManagedIdentityTokenProvider(undefined, { fetch: metadataFetch }),
      apiFetch,
    );
    const attempts = [client.models.list(), client.models.list(), client.models.list()];

    await Promise.all(attempts.map((operation) => expectPrivateParseFailure(() => operation, privateValue)));

    expect(metadataFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();

    metadataFetch.mockResolvedValueOnce(Response.json({ access_token: VALID_SUBJECT_TOKEN }));
    apiFetch
      .mockResolvedValueOnce(Response.json({ access_token: 'valid-openai-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ object: 'list', data: [] }));

    const result = await client.models.list();

    expect(result.data).toEqual([]);
    expect(metadataFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
