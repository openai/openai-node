import {
  k8sServiceAccountTokenProvider,
  azureManagedIdentityTokenProvider,
  gcpIDTokenProvider,
  awsBedrockTokenProvider,
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

function makeMockAwsSdk(opts?: {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  noCredentials?: boolean;
}) {
  const credentials =
    opts?.noCredentials ? null : (
      {
        accessKeyId: opts?.accessKeyId ?? 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: opts?.secretAccessKey ?? 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: opts?.sessionToken,
      }
    );

  const mockPresign = jest.fn(async (request: any, options: any) => {
    return {
      ...request,
      query: {
        ...request.query,
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${credentials?.accessKeyId}/20260428/us-east-1/bedrock/aws4_request`,
        'X-Amz-Date': '20260428T000000Z',
        'X-Amz-Expires': String(options?.expiresIn ?? 43200),
        'X-Amz-SignedHeaders': 'host',
        'X-Amz-Signature': 'fakesignature1234567890',
      },
    };
  });

  const mockCredentialProvider = jest.fn(async () => {
    if (!credentials) {
      throw new Error('No AWS credentials found');
    }
    return credentials;
  });

  const mockFromNodeProviderChain = jest.fn(() => mockCredentialProvider);
  const mockFromIni = jest.fn((_opts: any) => mockCredentialProvider);

  const mockSignatureV4 = jest.fn().mockImplementation(() => ({
    presign: mockPresign,
  }));

  const mockSha256 = jest.fn();

  return {
    credProviders: {
      fromNodeProviderChain: mockFromNodeProviderChain,
      fromIni: mockFromIni,
    },
    sigV4: {
      SignatureV4: mockSignatureV4,
    },
    sha256: {
      Sha256: mockSha256,
    },
    mocks: {
      presign: mockPresign,
      credentialProvider: mockCredentialProvider,
      fromNodeProviderChain: mockFromNodeProviderChain,
      fromIni: mockFromIni,
      SignatureV4: mockSignatureV4,
    },
  };
}

describe('AWS Bedrock Token Provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('generates a valid bedrock token', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    const getToken = awsBedrockTokenProvider({ region: 'us-east-1' });
    const token = await getToken();

    expect(token.startsWith('bedrock-api-key-')).toBe(true);

    const encodedPart = token.slice('bedrock-api-key-'.length);
    const decodedUrl = Buffer.from(encodedPart, 'base64').toString('utf-8');

    expect(decodedUrl).toContain('bedrock.amazonaws.com');
    expect(decodedUrl).toContain('X-Amz-Signature=');
    expect(decodedUrl).toContain('X-Amz-Credential=');
    expect(decodedUrl).toContain('Action=CallWithBearerToken');
    expect(decodedUrl).toContain('&Version=1');
  });

  test('uses custom region in the signed request', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    const getToken = awsBedrockTokenProvider({ region: 'eu-west-1' });
    await getToken();

    expect(aws.mocks.SignatureV4).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-1', service: 'bedrock' }),
    );
  });

  test('uses profile when provided', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    const getToken = awsBedrockTokenProvider({ region: 'us-east-1', profile: 'my-profile' });
    await getToken();

    expect(aws.mocks.fromIni).toHaveBeenCalledWith({ profile: 'my-profile' });
    expect(aws.mocks.fromNodeProviderChain).not.toHaveBeenCalled();
  });

  test('throws SubjectTokenProviderError when no credentials found', async () => {
    const aws = makeMockAwsSdk({ noCredentials: true });

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    const getToken = awsBedrockTokenProvider({ region: 'us-east-1' });
    await expect(getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(getToken()).rejects.toThrow('Failed to generate AWS Bedrock token');
  });

  test('throws SubjectTokenProviderError when region is not set', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    delete process.env['AWS_REGION'];
    delete process.env['AWS_DEFAULT_REGION'];

    const getToken = awsBedrockTokenProvider();
    await expect(getToken()).rejects.toThrow(SubjectTokenProviderError);
    await expect(getToken()).rejects.toThrow('AWS region must be provided');
  });

  test('resolves region from AWS_REGION env var', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    process.env['AWS_REGION'] = 'ap-southeast-1';

    const getToken = awsBedrockTokenProvider();
    await getToken();

    expect(aws.mocks.SignatureV4).toHaveBeenCalledWith(expect.objectContaining({ region: 'ap-southeast-1' }));
  });

  test('regenerates token on each call (no caching)', async () => {
    const aws = makeMockAwsSdk();

    jest.mock('@aws-sdk/credential-providers', () => aws.credProviders, { virtual: true });
    jest.mock('@smithy/signature-v4', () => aws.sigV4, { virtual: true });
    jest.mock('@aws-crypto/sha256-js', () => aws.sha256, { virtual: true });

    const getToken = awsBedrockTokenProvider({ region: 'us-east-1' });
    await getToken();
    await getToken();

    // presign should be called each time — no token caching
    expect(aws.mocks.presign).toHaveBeenCalledTimes(2);
  });
});
