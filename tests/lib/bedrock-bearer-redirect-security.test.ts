import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { vi } from 'vitest';

import OpenAI, { APIError, BedrockOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import type { Provider } from 'openai/internal/provider';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock as awsBedrock } from 'openai/providers/bedrock/aws';

type Endpoint = 'mantle' | 'runtime';
type Authentication = 'static' | 'rotating';
type TokenProvider = () => Promise<string>;

interface ProviderOptions {
  endpoint: Endpoint;
  region: string;
  baseURL: string;
  apiKey?: string;
  tokenProvider?: TokenProvider;
}

interface ProviderCase {
  entrypoint: string;
  endpoint: Endpoint;
  authentication: Authentication;
  create: (options: ProviderOptions) => Provider;
}

interface CapturedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const providerFactories = [
  { entrypoint: 'dependency-free', create: bearerBedrock },
  { entrypoint: 'AWS', create: awsBedrock },
] as const;
const endpoints: readonly Endpoint[] = ['mantle', 'runtime'];
const authentications: readonly Authentication[] = ['static', 'rotating'];
const providerCases: ProviderCase[] = providerFactories.flatMap(({ entrypoint, create }) =>
  endpoints.flatMap((endpoint) =>
    authentications.map((authentication) => ({ entrypoint, endpoint, authentication, create })),
  ),
);
const redirectCases = providerCases.flatMap((provider) =>
  [302, 307, 308].map((status) => ({ ...provider, status })),
);
const legacyRedirectCases = authentications.flatMap((authentication) =>
  [302, 307, 308].map((status) => ({ authentication, status })),
);
const sensitiveHeaders = {
  'api-key': 'gateway-primary-secret',
  'x-api-key': 'gateway-secondary-secret',
  'x-amz-security-token': 'aws-session-secret',
} as const;
const confidentialPrompt = 'CONFIDENTIAL_CUSTOMER_PROMPT';

function createProvider(provider: ProviderCase, baseURL: string, tokenProvider: TokenProvider): Provider {
  const authentication =
    provider.authentication === 'static' ? { apiKey: 'static-bedrock-secret' } : { tokenProvider };

  return provider.create({
    endpoint: provider.endpoint,
    region: 'us-east-1',
    baseURL,
    ...authentication,
  });
}

function captureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: CapturedRequest[],
  respond: (response: ServerResponse) => void,
): void {
  const chunks: Buffer[] = [];

  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    requests.push({
      method: request.method ?? '',
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf-8'),
    });
    respond(response);
  });
}

function serverURL(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the redirect test server to bind an ephemeral TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServers(servers: readonly Server[]): Promise<void> {
  await Promise.all(
    servers.map(async (server) => {
      if (!server.listening) {
        return;
      }
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }),
  );
}

describe('Bedrock bearer redirect security', () => {
  test.each(redirectCases)(
    'contains $entrypoint $endpoint $authentication credentials and POST bodies on HTTP $status',
    async (provider) => {
      const originRequests: CapturedRequest[] = [];
      const attackerRequests: CapturedRequest[] = [];
      let attackerURL = '';

      const attacker = createServer((request, response) => {
        captureRequest(request, response, attackerRequests, (capturedResponse) => {
          capturedResponse.writeHead(200, { 'content-type': 'application/json' });
          capturedResponse.end(JSON.stringify({ id: 'attacker', object: 'chat.completion', choices: [] }));
        });
      });
      const origin = createServer((request, response) => {
        captureRequest(request, response, originRequests, (capturedResponse) => {
          capturedResponse.writeHead(provider.status, { location: attackerURL });
          capturedResponse.end();
        });
      });

      try {
        await Promise.all([
          once(attacker.listen(0, '127.0.0.1'), 'listening'),
          once(origin.listen(0, '127.0.0.1'), 'listening'),
        ]);
        attackerURL = `${serverURL(attacker)}/capture`;

        const tokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
        const client = new OpenAI({
          provider: createProvider(provider, `${serverURL(origin)}/openai/v1`, tokenProvider),
          defaultHeaders: sensitiveHeaders,
          fetchOptions: { redirect: 'follow' },
          maxRetries: 0,
        });
        const completion = client.chat.completions.create(
          {
            model: 'us.openai.gpt-5.6-sol',
            messages: [{ role: 'user', content: confidentialPrompt }],
          },
          { fetchOptions: { redirect: 'follow' } },
        );

        await expect(completion).rejects.toBeInstanceOf(APIError);
        await expect(completion).rejects.toMatchObject({ status: provider.status });

        expect(originRequests).toHaveLength(1);
        expect(originRequests[0]?.headers).toMatchObject({
          ...sensitiveHeaders,
          authorization: `Bearer ${provider.authentication}-bedrock-secret`,
        });
        expect(originRequests[0]?.body).toContain(confidentialPrompt);
        expect(attackerRequests).toEqual([]);
        expect(tokenProvider).toHaveBeenCalledTimes(provider.authentication === 'rotating' ? 1 : 0);
      } finally {
        await closeServers([origin, attacker]);
      }
    },
  );

  test.each(legacyRedirectCases)(
    'contains legacy BedrockOpenAI $authentication credentials and POST bodies on HTTP $status',
    async ({ authentication, status }) => {
      const originRequests: CapturedRequest[] = [];
      const attackerRequests: CapturedRequest[] = [];
      let attackerURL = '';

      const attacker = createServer((request, response) => {
        captureRequest(request, response, attackerRequests, (capturedResponse) => {
          capturedResponse.writeHead(200, { 'content-type': 'application/json' });
          capturedResponse.end(JSON.stringify({ id: 'attacker', object: 'chat.completion', choices: [] }));
        });
      });
      const origin = createServer((request, response) => {
        captureRequest(request, response, originRequests, (capturedResponse) => {
          capturedResponse.writeHead(status, { location: attackerURL });
          capturedResponse.end();
        });
      });

      try {
        await Promise.all([
          once(attacker.listen(0, '127.0.0.1'), 'listening'),
          once(origin.listen(0, '127.0.0.1'), 'listening'),
        ]);
        attackerURL = `${serverURL(attacker)}/capture`;

        const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
        const client = new BedrockOpenAI({
          baseURL: `${serverURL(origin)}/openai/v1`,
          ...(authentication === 'static' ? { apiKey: 'static-bedrock-secret' } : { bedrockTokenProvider }),
          defaultHeaders: sensitiveHeaders,
          fetchOptions: { redirect: 'follow' },
          maxRetries: 0,
        });
        const outcome = await client.chat.completions
          .create(
            {
              model: 'us.openai.gpt-5.6-sol',
              messages: [{ role: 'user', content: confidentialPrompt }],
            },
            { fetchOptions: { redirect: 'follow' } },
          )
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(originRequests).toHaveLength(1);
        expect(originRequests[0]?.headers).toMatchObject({
          ...sensitiveHeaders,
          authorization: `Bearer ${authentication}-bedrock-secret`,
        });
        expect(originRequests[0]?.body).toContain(confidentialPrompt);
        expect(attackerRequests).toEqual([]);
        expect(outcome).toBeInstanceOf(APIError);
        expect(outcome).toMatchObject({ status });
        expect(bedrockTokenProvider).toHaveBeenCalledTimes(authentication === 'rotating' ? 1 : 0);
      } finally {
        await closeServers([origin, attacker]);
      }
    },
  );

  test.each(authentications)(
    'preserves successful legacy BedrockOpenAI requests using %s authentication',
    async (authentication) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        expect(Object.fromEntries(new Headers(init?.headers))).toMatchObject({
          ...sensitiveHeaders,
          authorization: `Bearer ${authentication}-bedrock-secret`,
        });
        return Response.json({ ok: true });
      });
      const client = new BedrockOpenAI({
        baseURL: 'https://bedrock.example.com/openai/v1',
        ...(authentication === 'static' ? { apiKey: 'static-bedrock-secret' } : { bedrockTokenProvider }),
        defaultHeaders: sensitiveHeaders,
        fetch,
        fetchOptions: { redirect: 'follow' },
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', fetchOptions: { redirect: 'follow' } });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(bedrockTokenProvider).toHaveBeenCalledTimes(authentication === 'rotating' ? 1 : 0);
    },
  );

  test.each([
    {
      scenario: 'an empty legacy bearer credential',
      bedrockTokenProvider: async () => '',
    },
    {
      scenario: 'a rejected legacy bearer credential',
      bedrockTokenProvider: async () => {
        throw new Error('credential provider failed');
      },
    },
    {
      scenario: 'an invalid legacy bearer header value',
      bedrockTokenProvider: async () => 'unsafe\ncredential',
    },
  ])('leaves legacy caller request state unchanged for $scenario', async ({ bedrockTokenProvider }) => {
    const headers = new Headers(sensitiveHeaders);
    const initialHeaders = [...headers.entries()];
    const request = {
      method: 'get' as const,
      path: '/models',
      headers,
      fetchOptions: { redirect: 'follow' as const },
    };
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new BedrockOpenAI({
      baseURL: 'https://bedrock.example.com/openai/v1',
      bedrockTokenProvider,
      fetch,
      fetchOptions: { redirect: 'follow' },
      maxRetries: 0,
    });

    await expect(client.request(request)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(request.fetchOptions.redirect).toBe('follow');
    expect([...headers.entries()]).toEqual(initialHeaders);
  });

  test.each(providerCases)(
    'preserves $entrypoint $endpoint $authentication headers for successful requests',
    async (provider) => {
      const tokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        expect(Object.fromEntries(new Headers(init?.headers))).toMatchObject({
          ...sensitiveHeaders,
          authorization: `Bearer ${provider.authentication}-bedrock-secret`,
        });
        return Response.json({ ok: true });
      });
      const client = new OpenAI({
        provider: createProvider(provider, 'https://bedrock.example.com/openai/v1', tokenProvider),
        defaultHeaders: sensitiveHeaders,
        fetch,
        fetchOptions: { redirect: 'follow' },
        maxRetries: 0,
      });

      await client.request({ method: 'get', path: '/models', fetchOptions: { redirect: 'follow' } });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(tokenProvider).toHaveBeenCalledTimes(provider.authentication === 'rotating' ? 1 : 0);
    },
  );

  test.each(providerFactories.flatMap((factory) => endpoints.map((endpoint) => ({ ...factory, endpoint }))))(
    'rejects cross-origin $entrypoint $endpoint requests before resolving bearer credentials',
    async ({ create, endpoint }) => {
      const tokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const fetch = vi.fn(async () => Response.json({ ok: true }));
      const client = new OpenAI({
        provider: create({
          endpoint,
          region: 'us-east-1',
          baseURL: 'https://bedrock.example.com/openai/v1',
          tokenProvider,
        }),
        fetch,
        fetchOptions: { redirect: 'follow' },
        maxRetries: 0,
      });

      await expect(
        client.request({ method: 'get', path: 'https://attacker.example/capture' }),
      ).rejects.toThrow('Bedrock request origin');
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      scenario: 'an empty bearer credential',
      tokenProvider: async () => '',
    },
    {
      scenario: 'a rejected bearer credential',
      tokenProvider: async () => {
        throw new Error('credential provider failed');
      },
    },
    {
      scenario: 'an invalid bearer header value',
      tokenProvider: async () => 'unsafe\ncredential',
    },
  ])('leaves request headers and redirect policy unchanged for $scenario', async ({ tokenProvider }) => {
    const baseURL = 'https://bedrock.example.com/openai/v1';
    const provider = configureProvider(
      bearerBedrock({ endpoint: 'runtime', region: 'us-east-1', baseURL, tokenProvider }),
    );
    if (!provider.prepareRequest) {
      throw new Error('Expected the Bedrock provider to prepare requests');
    }
    const headers = new Headers(sensitiveHeaders);
    const initialHeaders = [...headers.entries()];
    const request = { method: 'get', headers, redirect: 'follow' as const };

    await expect(
      provider.prepareRequest(request, {
        url: `${baseURL}/models`,
        options: {} as never,
      }),
    ).rejects.toThrow();

    expect(request.headers).toBe(headers);
    expect([...headers.entries()]).toEqual(initialHeaders);
    expect(request.redirect).toBe('follow');
  });
});
