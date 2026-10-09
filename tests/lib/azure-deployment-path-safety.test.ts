import { vi } from 'vitest';
import { AzureOpenAI, OpenAIError } from 'openai';
import type { RequestInit, RequestInfo, Response as FetchResponse } from 'openai/internal/builtin-types';

const apiVersion = '2024-02-15-preview';
const testFetch = async (url: RequestInfo): Promise<FetchResponse> =>
  Response.json({ url }, { headers: { 'content-type': 'application/json' } });

describe('deployment path safety', () => {
  const endpoint = 'https://azure.example.com';
  const apiKey = 'AZURE_SECRET';
  const deploymentPathCases = [
    ['../../admin/secrets', '..%2F..%2Fadmin%2Fsecrets'],
    ['..\\..\\admin\\secrets', '..%5C..%5Cadmin%5Csecrets'],
    ['%2e', '%252e'],
    ['%2E', '%252E'],
    ['%2e%2e', '%252e%252e'],
    ['%2E%2e/%2e%2E/admin', '%252E%252e%2F%252e%252E%2Fadmin'],
    ['x/y', 'x%2Fy'],
    ['x\\y', 'x%5Cy'],
    ['x?evil=1', 'x%3Fevil=1'],
    ['x#fragment', 'x%23fragment'],
    ['ümlaut name', '%C3%BCmlaut%20name'],
    ['gpt-4o.prod_2024', 'gpt-4o.prod_2024'],
  ] as const;

  // Base URLs `new URL()` cannot parse, paired with the scheme the request URL ends up with.
  const unparseableBaseURLCases = [
    ['https:', 'https'],
    ['https:/', 'https'],
    ['https://', 'https'],
    ['https:///', 'https'],
    ['https:////', 'https'],
    ['https://///', 'https'],
    ['http://', 'http'],
    ['http:///', 'http'],
    ['HTTPS://', 'https'],
    ['HTTPS:///', 'https'],
  ] as const;

  // Base URLs a raw substring test reads as having no `/deployments`, but whose WHATWG
  // normalization — backslash separators, and stripped tab, newline and carriage return
  // characters — exposes a real `deployments` path segment. Paired with the normalized base
  // URL the request is built against.
  const normalizedDeploymentSegmentCases = [
    ['https://azure.example.com/openai\\deployments', 'https://azure.example.com/openai/deployments'],
    [
      'https://azure.example.com/openai\\deployments\\existing-deployment',
      'https://azure.example.com/openai/deployments/existing-deployment',
    ],
    ['https://azure.example.com/openai/deploy\tments', 'https://azure.example.com/openai/deployments'],
    ['https://azure.example.com/openai/deploy\nments', 'https://azure.example.com/openai/deployments'],
    ['https://azure.example.com/openai/deploy\rments', 'https://azure.example.com/openai/deployments'],
  ] as const;

  const requestClient = new AzureOpenAI({ endpoint, apiKey, apiVersion, fetch: testFetch });

  test('keeps authenticated public chat requests inside the deployment route', async () => {
    const authenticatedFetch = vi.fn(async (url: RequestInfo, init?: RequestInit): Promise<FetchResponse> =>
      Response.json(
        { url, apiKey: new Headers(init?.headers).get('api-key') },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, fetch: authenticatedFetch });

    expect(
      await client.chat.completions.create({ model: '../../admin/secrets', messages: [] }),
    ).toMatchObject({
      url: `${endpoint}/openai/deployments/..%2F..%2Fadmin%2Fsecrets/chat/completions?api-version=${apiVersion}`,
      apiKey,
    });
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  });

  test.each(deploymentPathCases)(
    'keeps request model %s within a single deployment path segment',
    async (requestModel, encodedDeployment) => {
      expect(
        await requestClient.chat.completions.create({ model: requestModel, messages: [] }),
      ).toMatchObject({
        url: `${endpoint}/openai/deployments/${encodedDeployment}/chat/completions?api-version=${apiVersion}`,
      });
    },
  );

  test.each(deploymentPathCases)(
    'keeps constructor deployment %s within a single deployment path segment',
    async (configuredDeployment, encodedDeployment) => {
      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion,
        deployment: configuredDeployment,
      });

      const { req, url } = await client.buildRequest({
        method: 'post',
        path: '/chat/completions',
        body: { model: 'ignored-request-model', messages: [] },
      });

      expect(url).toBe(
        `${endpoint}/openai/deployments/${encodedDeployment}/chat/completions?api-version=${apiVersion}`,
      );
      expect(req.headers.get('api-key')).toBe(apiKey);
    },
  );

  test.each(['.', '..'] as const)('rejects traversal request model %s', async (requestModel) => {
    await expect(
      requestClient.chat.completions.create({ model: requestModel, messages: [] }),
    ).rejects.toThrow(OpenAIError);
  });

  test.each(['.', '..'] as const)(
    'rejects traversal constructor deployment %s',
    async (configuredDeployment) => {
      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion,
        deployment: configuredDeployment,
      });

      await expect(
        client.buildRequest({
          method: 'post',
          path: '/chat/completions',
          body: { model: 'ignored-request-model', messages: [] },
        }),
      ).rejects.toThrow(OpenAIError);
    },
  );

  test('keeps metadata deployment models within a single path segment', async () => {
    const { req, url } = await requestClient.buildRequest({
      method: 'post',
      path: '/images/edits',
      body: { prompt: 'edit this image' },
      __metadata: { model: '../../admin/secrets' },
    });

    expect(url).toBe(
      `${endpoint}/openai/deployments/..%2F..%2Fadmin%2Fsecrets/images/edits?api-version=${apiVersion}`,
    );
    expect(req.headers.get('api-key')).toBe(apiKey);
  });

  test('does not replace a deployment that is already included in the base URL', async () => {
    const client = new AzureOpenAI({
      baseURL: `${endpoint}/openai/deployments/existing-deployment`,
      apiKey,
      apiVersion,
      deployment: '../../admin/secrets',
    });

    const { req, url } = await client.buildRequest({
      method: 'post',
      path: '/chat/completions',
      body: { model: 'x/y?evil=1#fragment', messages: [] },
    });

    expect(url).toBe(
      `${endpoint}/openai/deployments/existing-deployment/chat/completions?api-version=${apiVersion}`,
    );
    expect(req.headers.get('api-key')).toBe(apiKey);
  });

  test('does not replace a deployment whose base URL path ends at the deployments segment', async () => {
    const client = new AzureOpenAI({
      baseURL: `${endpoint}/openai/deployments`,
      apiKey,
      apiVersion,
      deployment: 'configured-deployment',
    });

    const { url } = await client.buildRequest({
      method: 'post',
      path: '/chat/completions',
      body: { model: 'ignored-request-model', messages: [] },
    });

    expect(url).toBe(`${endpoint}/openai/deployments/chat/completions?api-version=${apiVersion}`);
  });

  test('inserts a deployment when deployments is only part of a base URL path segment', async () => {
    const client = new AzureOpenAI({
      baseURL: 'https://gateway.example.com/azure/deployments-proxy/openai',
      apiKey,
      apiVersion,
      deployment: 'configured-deployment',
    });

    const { url } = await client.buildRequest({
      method: 'post',
      path: '/chat/completions',
      body: { model: 'ignored-request-model', messages: [] },
    });

    expect(url).toBe(
      `https://gateway.example.com/azure/deployments-proxy/openai/deployments/configured-deployment/chat/completions?api-version=${apiVersion}`,
    );
  });

  test('inserts a deployment when deployments only appears in the base URL host', async () => {
    const client = new AzureOpenAI({
      baseURL: 'https://deployments.example.com/openai',
      apiKey,
      apiVersion,
      deployment: 'configured-deployment',
    });

    const { url } = await client.buildRequest({
      method: 'post',
      path: '/chat/completions',
      body: { model: 'ignored-request-model', messages: [] },
    });

    expect(url).toBe(
      `https://deployments.example.com/openai/deployments/configured-deployment/chat/completions?api-version=${apiVersion}`,
    );
  });

  test.each(unparseableBaseURLCases)(
    'inserts a deployment when the base URL %s is not a parseable absolute URL',
    async (baseURL, scheme) => {
      const client = new AzureOpenAI({
        baseURL,
        apiKey,
        apiVersion,
        deployment: 'configured-deployment',
      });

      const { url } = await client.buildRequest({
        method: 'post',
        path: '/chat/completions',
        body: { model: 'ignored-request-model', messages: [] },
      });

      // Joining the request path supplies the authority these base URLs are missing, so the
      // first joined segment becomes the host. That is what the client built before the
      // segment test, which read the base URL as a substring and never parsed it.
      expect(url).toBe(
        `${scheme}://deployments/configured-deployment/chat/completions?api-version=${apiVersion}`,
      );
    },
  );

  test.each(normalizedDeploymentSegmentCases)(
    'does not replace a deployment that the base URL %j only reveals once normalized',
    async (baseURL, normalizedBaseURL) => {
      expect(baseURL.includes('/deployments')).toBe(false);

      const client = new AzureOpenAI({
        baseURL,
        apiKey,
        apiVersion,
        deployment: 'configured-deployment',
      });

      const { req, url } = await client.buildRequest({
        method: 'post',
        path: '/chat/completions',
        body: { model: 'ignored-request-model', messages: [] },
      });

      expect(url).toBe(`${normalizedBaseURL}/chat/completions?api-version=${apiVersion}`);
      expect(req.headers.get('api-key')).toBe(apiKey);
    },
  );

  test('still rejects a relative base URL once the request path is joined', async () => {
    const client = new AzureOpenAI({
      baseURL: '/openai',
      apiKey,
      apiVersion,
      deployment: 'configured-deployment',
    });

    await expect(
      client.buildRequest({
        method: 'post',
        path: '/chat/completions',
        body: { model: 'ignored-request-model', messages: [] },
      }),
    ).rejects.toThrow(TypeError);
  });

  test('does not insert a deployment into non-POST requests', async () => {
    const { url } = await requestClient.buildRequest({
      method: 'get',
      path: '/chat/completions',
      body: { model: '../../admin/secrets' },
    });

    expect(url).toBe(`${endpoint}/openai/chat/completions?api-version=${apiVersion}`);
  });

  test('does not insert a deployment into non-deployment endpoints', async () => {
    const { url } = await requestClient.buildRequest({
      method: 'post',
      path: '/assistants',
      body: { model: '../../admin/secrets' },
    });

    expect(url).toBe(`${endpoint}/openai/assistants?api-version=${apiVersion}`);
  });
});
