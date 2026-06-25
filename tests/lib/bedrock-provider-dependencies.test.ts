import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

const originalEnv = process.env;
const optionalDependencies = [
  '@aws-sdk/credential-provider-node',
  '@smithy/hash-node',
  '@smithy/signature-v4',
] as const;

beforeEach(() => {
  jest.resetModules();
  for (const dependency of optionalDependencies) jest.dontMock(dependency);

  process.env = { ...originalEnv };
  delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
  delete process.env['AWS_ACCESS_KEY_ID'];
  delete process.env['AWS_SECRET_ACCESS_KEY'];
  delete process.env['AWS_SESSION_TOKEN'];
  delete process.env['AWS_BEDROCK_BASE_URL'];
  delete process.env['AWS_REGION'];
  delete process.env['AWS_DEFAULT_REGION'];
  delete process.env['AWS_PROFILE'];
  delete process.env['AWS_SHARED_CREDENTIALS_FILE'];
  delete process.env['AWS_CONFIG_FILE'];
});

afterEach(() => {
  process.env = originalEnv;
});

function jsonResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadBedrockModules(): Promise<{
  OpenAI: typeof import('openai').default;
  bedrock: typeof import('openai/providers/bedrock/aws').bedrock;
}> {
  const openai = require('openai') as typeof import('openai');
  const bedrockProvider =
    require('openai/providers/bedrock/aws') as typeof import('openai/providers/bedrock/aws');
  return { OpenAI: openai.default, bedrock: bedrockProvider.bedrock };
}

describe('Bedrock provider optional dependencies', () => {
  test('keeps the root and bearer entrypoints independent from AWS packages', async () => {
    for (const dependency of optionalDependencies) {
      jest.doMock(dependency, () => {
        throw new Error(`unexpected AWS import: ${dependency}`);
      });
    }

    await jest.isolateModulesAsync(async () => {
      const openai = require('openai') as typeof import('openai');
      const bearerProvider = require('openai/providers/bedrock') as typeof import('openai/providers/bedrock');
      const fetch = jest.fn(async () => jsonResponse());
      const client = new openai.default({
        provider: bearerProvider.bedrock({ region: 'us-east-1', apiKey: 'bearer-token' }),
        fetch,
      });

      await client.request({ method: 'get', path: '/models' });

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  test('resolves temporary environment credentials through the real AWS default chain', async () => {
    process.env['AWS_ACCESS_KEY_ID'] = 'environment-access-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'environment-secret-key';
    process.env['AWS_SESSION_TOKEN'] = 'environment-session-token';

    await jest.isolateModulesAsync(async () => {
      const { OpenAI, bedrock } = await loadBedrockModules();
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: bedrock({ region: 'us-west-2', apiKey: null }),
        maxRetries: 0,
        fetch: async (_url: RequestInfo, init?: RequestInit) => {
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: '/models' });

      const headers = new Headers(requestedInit?.headers);
      expect(headers.get('authorization')).toContain('Credential=environment-access-key/');
      expect(headers.get('x-amz-security-token')).toBe('environment-session-token');
    });
  });

  test('forwards a named profile to the AWS default provider and signs the request', async () => {
    const credentialsProvider = jest.fn(async () => ({
      accessKeyId: 'profile-access-key',
      secretAccessKey: 'profile-secret-key',
      sessionToken: 'profile-session-token',
    }));
    const defaultProvider = jest.fn(() => credentialsProvider);
    jest.doMock('@aws-sdk/credential-provider-node', () => ({ defaultProvider }));

    await jest.isolateModulesAsync(async () => {
      const { OpenAI, bedrock } = await loadBedrockModules();
      let requestedInit: RequestInit | undefined;
      const client = new OpenAI({
        provider: bedrock({ region: 'us-west-2', profile: 'engineering' }),
        maxRetries: 0,
        fetch: async (_url: RequestInfo, init?: RequestInit) => {
          requestedInit = init;
          return jsonResponse();
        },
      });

      await client.request({ method: 'get', path: '/models' });

      expect(defaultProvider).toHaveBeenCalledTimes(1);
      expect(defaultProvider).toHaveBeenCalledWith({ profile: 'engineering' });
      expect(credentialsProvider).toHaveBeenCalled();
      const headers = new Headers(requestedInit?.headers);
      expect(headers.get('authorization')).toContain('Credential=profile-access-key/');
      expect(headers.get('authorization')).toContain('/us-west-2/bedrock-mantle/aws4_request');
      expect(headers.get('x-amz-security-token')).toBe('profile-session-token');
    });
  });

  test('initializes the default AWS credential chain with empty options', async () => {
    const credentialsProvider = jest.fn(async () => ({
      accessKeyId: 'default-access-key',
      secretAccessKey: 'default-secret-key',
    }));
    const defaultProvider = jest.fn(() => credentialsProvider);
    jest.doMock('@aws-sdk/credential-provider-node', () => ({ defaultProvider }));

    await jest.isolateModulesAsync(async () => {
      const { OpenAI, bedrock } = await loadBedrockModules();
      const fetch = jest.fn(async () => jsonResponse());
      const client = new OpenAI({
        provider: bedrock({ region: 'us-east-1', apiKey: null }),
        maxRetries: 0,
        fetch,
      });

      await client.request({ method: 'get', path: '/models' });

      expect(defaultProvider).toHaveBeenCalledTimes(1);
      expect(defaultProvider).toHaveBeenCalledWith({});
      expect(credentialsProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  test('rejects an invalid identity resolved by the default AWS provider', async () => {
    const identity = { secretAccessKey: 'secret-key' };
    const credentialsProvider = jest.fn(async () => identity);
    const defaultProvider = jest.fn(() => credentialsProvider);
    jest.doMock('@aws-sdk/credential-provider-node', () => ({ defaultProvider }));

    await jest.isolateModulesAsync(async () => {
      const { OpenAI, bedrock } = await loadBedrockModules();
      const fetch = jest.fn(async () => jsonResponse());
      const client = new OpenAI({
        provider: bedrock({ region: 'us-east-1', profile: 'invalid-profile' }),
        maxRetries: 0,
        fetch,
      });

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
        'Failed to resolve AWS credentials for Bedrock',
      );
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  test('surfaces the runtime module error when an AWS dependency is missing', async () => {
    const missingDependency = new Error('Cannot find module @aws-sdk/credential-provider-node');
    jest.doMock('@aws-sdk/credential-provider-node', () => {
      throw missingDependency;
    });

    await jest.isolateModulesAsync(async () => {
      await expect(loadBedrockModules()).rejects.toBe(missingDependency);
    });
  });

  test('preserves the default credential chain failure and its cause', async () => {
    const cause = new Error('no AWS credentials available');
    const defaultProvider = jest.fn(() => async () => {
      throw cause;
    });
    jest.doMock('@aws-sdk/credential-provider-node', () => ({ defaultProvider }));

    await jest.isolateModulesAsync(async () => {
      const { OpenAI, bedrock } = await loadBedrockModules();
      const fetch = jest.fn(async () => jsonResponse());
      const client = new OpenAI({
        provider: bedrock({ region: 'us-east-1', apiKey: null }),
        maxRetries: 0,
        fetch,
      });

      await expect(client.request({ method: 'get', path: '/models' })).rejects.toMatchObject({
        message: expect.stringContaining('Could not find credentials for Bedrock'),
        cause,
      });
      expect(defaultProvider).toHaveBeenCalledWith({});
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
