import { vi } from 'vitest';
import { AzureOpenAI } from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

class RotatingAzureOpenAI extends AzureOpenAI {
  protected override async authHeaders(
    options: Parameters<AzureOpenAI['buildRequest']>[0],
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ) {
    const headers = await super.authHeaders(options, schemes);
    if (headers?.values.has('api-key')) {
      const apiKey = process.env['AZURE_OPENAI_API_KEY'];
      if (!apiKey) {
        throw new Error('Missing AZURE_OPENAI_API_KEY');
      }
      headers.values.set('api-key', apiKey);
    }
    return headers;
  }
}

function mockFetch() {
  return vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
}

function clientFor(fetch: ReturnType<typeof mockFetch>) {
  return new RotatingAzureOpenAI({
    apiKey: 'synthetic-initial',
    adminAPIKey: 'synthetic-admin',
    baseURL: 'https://azure.example/openai',
    apiVersion: '2024-10-01-preview',
    maxRetries: 0,
    fetch,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test('uses the documented Azure subclass hook to rotate api-key headers', async () => {
  const fetch = mockFetch();
  const client = clientFor(fetch);

  vi.stubEnv('AZURE_OPENAI_API_KEY', 'synthetic-first');
  await client.get('/items');
  vi.stubEnv('AZURE_OPENAI_API_KEY', 'synthetic-second');
  await client.get('/items');

  const headers = fetch.mock.calls.map(([, init]) => new Headers(init?.headers));
  expect(headers.map((value) => value.get('api-key'))).toEqual(['synthetic-first', 'synthetic-second']);
  expect(headers.map((value) => value.get('authorization'))).toEqual([null, null]);
  expect(fetch.mock.calls.map(([, init]) => init?.redirect)).toEqual(['manual', 'manual']);
  expect(client.apiKey).toBe('synthetic-initial');
});

test('preserves default, request, and explicit null Azure api-key header precedence', async () => {
  vi.stubEnv('AZURE_OPENAI_API_KEY', 'synthetic-provider');
  const fetch = mockFetch();
  const client = clientFor(fetch).withOptions({ defaultHeaders: { 'api-key': 'synthetic-default' } });

  await client.get('/items');
  await client.get('/items', { headers: { 'api-key': 'synthetic-request' } });
  await client.get('/items', { headers: { 'api-key': null } });

  expect(fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('api-key'))).toEqual([
    'synthetic-default',
    'synthetic-request',
    null,
  ]);
});

test('delegates admin-only authentication without resolving an Azure API key', async () => {
  vi.stubEnv('AZURE_OPENAI_API_KEY', '');
  const fetch = mockFetch();
  const client = clientFor(fetch);

  await client.get('/organization/projects', { __security: { adminAPIKeyAuth: true } });

  const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(headers.get('authorization')).toBe('Bearer synthetic-admin');
  expect(headers.has('api-key')).toBe(false);
});
