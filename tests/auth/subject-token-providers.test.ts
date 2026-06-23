import {
  k8sServiceAccountTokenProvider,
  azureManagedIdentityTokenProvider,
  gcpIDTokenProvider,
} from 'openai/auth/subject-token-providers';
import { SubjectTokenProviderError } from 'openai';

jest.mock('fs/promises');

const originalFetch = global.fetch;

describe('Kubernetes Service Account Token Provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads token from file', async () => {
    const fsPromises = await import('fs/promises');
    (fsPromises.readFile as jest.Mock).mockResolvedValue('  my-k8s-token  \n');

    const provider = k8sServiceAccountTokenProvider('/custom/path/token');
    expect(provider.tokenType).toBe('jwt');
    const token = await provider.getToken();

    expect(token).toBe('my-k8s-token');
    expect(fsPromises.readFile).toHaveBeenCalledWith('/custom/path/token', 'utf8');
  });

  test('uses default path when none provided', async () => {
    const provider = k8sServiceAccountTokenProvider();
    expect(provider).toBeDefined();
  });

  test('throws SubjectTokenProviderError on file read failure', async () => {
    const fsPromises = await import('fs/promises');
    (fsPromises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const provider = k8sServiceAccountTokenProvider('/nonexistent/path');
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to read Kubernetes service account token');
  });
});

describe('Azure IMDS Token Provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches token from Azure IMDS with default resource', async () => {
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const urlObj = new URL(url);
      expect(url).toContain('169.254.169.254');
      expect(urlObj.searchParams.get('api-version')).toBe('2018-02-01');
      expect(urlObj.searchParams.get('resource')).toBe('https://management.azure.com/');

      const headers = new Headers(init?.headers);
      expect(headers.get('Metadata')).toBe('true');

      return new Response(
        JSON.stringify({
          access_token: 'azure-token',
          expires_in: '3600',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider();
    expect(provider.tokenType).toBe('jwt');
    const token = await provider.getToken();

    expect(token).toBe('azure-token');
  });

  test('fetches token from Azure IMDS with custom resource', async () => {
    global.fetch = jest.fn(async (url: string) => {
      const urlObj = new URL(url);
      expect(urlObj.searchParams.get('resource')).toBe('https://cognitiveservices.azure.com/');

      return new Response(JSON.stringify({ access_token: 'azure-token' }), { status: 200 });
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider('https://cognitiveservices.azure.com/');
    const token = await provider.getToken();

    expect(token).toBe('azure-token');
  });

  test('uses custom api version', async () => {
    global.fetch = jest.fn(async (url: string) => {
      expect(url).toContain('api-version=2019-08-01');

      return new Response(
        JSON.stringify({
          access_token: 'azure-token',
        }),
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
    const customFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'azure-token',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider(undefined, {
      fetch: customFetch,
    });
    await provider.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('throws SubjectTokenProviderError on failed request', async () => {
    global.fetch = jest.fn(async () => {
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to fetch token from Azure IMDS');
  });

  test('throws SubjectTokenProviderError when access_token missing', async () => {
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ expires_in: '3600' }), { status: 200 });
    }) as typeof fetch;

    const provider = azureManagedIdentityTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('access_token');
  });
});

describe('GCP Metadata Server Token Provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches token from GCP metadata server', async () => {
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
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
    const customFetch = jest.fn(async () => {
      return new Response('gcp-id-token', { status: 200 });
    }) as typeof fetch;

    const provider = gcpIDTokenProvider('https://api.openai.com', {
      fetch: customFetch,
    });
    await provider.getToken();

    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  test('throws SubjectTokenProviderError on failed request', async () => {
    global.fetch = jest.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    const provider = gcpIDTokenProvider();
    await expect(provider.getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(provider.getToken()).rejects.toThrow('Failed to fetch token from GCP Metadata Server');
  });
});
