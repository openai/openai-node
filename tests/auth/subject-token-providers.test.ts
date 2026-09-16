import { vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  k8sServiceAccountTokenProvider,
  azureManagedIdentityTokenProvider,
  gcpIDTokenProvider,
} from 'openai/auth/subject-token-providers';
import { SubjectTokenProviderError } from 'openai';

const originalFetch = global.fetch;

describe('Kubernetes Service Account Token Provider', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openai-k8s-token-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('reads token from file', async () => {
    const tokenPath = path.join(directory, 'token');
    await writeFile(tokenPath, '  my-k8s-token  \n');

    const provider = k8sServiceAccountTokenProvider(tokenPath);
    expect(provider.tokenType).toBe('jwt');
    const token = await provider.getToken();

    expect(token).toBe('my-k8s-token');
  });

  test('uses default path when none provided', async () => {
    const provider = k8sServiceAccountTokenProvider();
    expect(provider).toBeDefined();
  });

  test('throws SubjectTokenProviderError on file read failure', async () => {
    const provider = k8sServiceAccountTokenProvider(path.join(directory, 'missing-token'));
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to read Kubernetes service account token');
  });
});

describe('Azure IMDS Token Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches token from Azure IMDS with default resource', async () => {
    // SAFETY: The token provider calls this fixture with a URL string; the mock returns a native Response for that request.
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlObj = new URL(url);
      expect(url).toContain('169.254.169.254');
      expect(urlObj.searchParams.get('api-version')).toBe('2018-02-01');
      expect(urlObj.searchParams.get('resource')).toBe('https://management.azure.com/');

      const headers = new Headers(init?.headers);
      expect(headers.get('Metadata')).toBe('true');

      return Response.json(
        {
          access_token: 'azure-token',
          expires_in: '3600',
        },
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider();
    expect(provider.tokenType).toBe('jwt');
    const token = await provider.getToken();

    expect(token).toBe('azure-token');
  });

  test('fetches token from Azure IMDS with custom resource', async () => {
    // SAFETY: The token provider calls this fixture with a URL string; the mock returns a native Response for that request.
    global.fetch = vi.fn(async (url: string) => {
      const urlObj = new URL(url);
      expect(urlObj.searchParams.get('resource')).toBe('https://cognitiveservices.azure.com/');

      return Response.json({ access_token: 'azure-token' }, { status: 200 });
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider('https://cognitiveservices.azure.com/');
    const token = await provider.getToken();

    expect(token).toBe('azure-token');
  });

  test('uses custom api version', async () => {
    // SAFETY: The token provider calls this fixture with a URL string; the mock returns a native Response for that request.
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toContain('api-version=2019-08-01');

      return Response.json(
        {
          access_token: 'azure-token',
        },
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider(undefined, {
      apiVersion: '2019-08-01',
    });
    await provider.getToken();

    expect(fetch).toHaveBeenCalled();
  });

  test('uses the configured fetch implementation', async () => {
    const customFetch = vi.fn(async () =>
      Response.json(
        {
          access_token: 'azure-token',
        },
        { status: 200 },
      ),
    );

    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: customFetch,
    });
    await provider.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('honors an explicit zero-millisecond metadata timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    try {
      const provider = azureManagedIdentityTokenProvider(undefined, {
        timeout: 0,
        fetch: async () => Response.json({ access_token: 'azure-token' }, { status: 200 }),
      });

      await expect(provider.getToken()).resolves.toBe('azure-token');
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('throws SubjectTokenProviderError on failed request', async () => {
    global.fetch = vi.fn(async () => new Response('Not found', { status: 404 }));

    const provider = azureManagedIdentityTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to fetch token from Azure IMDS');
  });

  test('throws SubjectTokenProviderError when access_token missing', async () => {
    global.fetch = vi.fn(async () => Response.json({ expires_in: '3600' }, { status: 200 }));

    const provider = azureManagedIdentityTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('access_token');
  });
});

describe('GCP Metadata Server Token Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches token from GCP metadata server', async () => {
    // SAFETY: The token provider calls this fixture with a URL string; the mock returns a native Response for that request.
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const urlObj = new URL(url);
      expect(url).toContain('metadata.google.internal');
      expect(url).toContain('service-accounts/default/identity');
      expect(urlObj.searchParams.get('audience')).toBe('https://api.openai.com/v1');

      const headers = new Headers(init?.headers);
      expect(headers.get('Metadata-Flavor')).toBe('Google');

      return new Response('gcp-id-token', { status: 200 });
    }) as typeof fetch;

    const provider = gcpIDTokenProvider();
    expect(provider.tokenType).toBe('id');
    const token = await provider.getToken();

    expect(token).toBe('gcp-id-token');
  });

  test('uses the configured fetch implementation', async () => {
    const customFetch = vi.fn(async () => new Response('gcp-id-token', { status: 200 }));

    const provider = gcpIDTokenProvider('https://api.openai.com', {
      fetch: customFetch,
    });
    await provider.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('honors an explicit zero-millisecond metadata timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    try {
      const provider = gcpIDTokenProvider(undefined, {
        timeout: 0,
        fetch: async () => new Response('gcp-id-token', { status: 200 }),
      });

      await expect(provider.getToken()).resolves.toBe('gcp-id-token');
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('throws SubjectTokenProviderError on failed request', async () => {
    global.fetch = vi.fn(async () => new Response('Unauthorized', { status: 401 }));

    const provider = gcpIDTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to fetch token from GCP Metadata Server');
  });
});
