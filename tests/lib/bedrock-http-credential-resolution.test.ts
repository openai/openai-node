/* oxlint-disable eslint/max-classes-per-file -- Separate subclass fixtures cover credential fallback and final URL validation. */
import { vi } from 'vitest';

import { BedrockOpenAI } from 'openai';
import * as bedrockInternal from 'openai/internal/bedrock';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { buildHeaders } from 'openai/internal/headers';

const baseURL = 'https://bedrock.example/openai/v1';
const schemes = [
  { bearerAuth: true },
  { adminAPIKeyAuth: true },
  { bearerAuth: true, adminAPIKeyAuth: true },
];

afterEach(() => {
  vi.restoreAllMocks();
});

test.each(schemes)('treats a null Bedrock _callApiKey result as final with %j', async (__security) => {
  class MissingCredentials extends BedrockOpenAI {
    resolutions = 0;

    override async _callApiKey(capture?: (apiKey: string | null) => void) {
      this.resolutions += 1;
      capture?.(this.resolutions === 1 ? null : 'synthetic');
      return true;
    }
  }
  const client = new MissingCredentials({ baseURL, apiKey: 'synthetic-configured' });

  await expect(client.buildRequest({ method: 'get', path: '/items', __security })).rejects.toThrow(
    'Could not resolve authentication method.',
  );

  expect(client.resolutions).toBe(1);
});

test.each([
  { mode: 'request', delegates: false, __security: { bearerAuth: true } },
  { mode: 'request', delegates: false, __security: { bearerAuth: true, adminAPIKeyAuth: true } },
  { mode: 'request', delegates: true, __security: { bearerAuth: true } },
  { mode: 'request', delegates: true, __security: { bearerAuth: true, adminAPIKeyAuth: true } },
  { mode: 'direct', delegates: false, __security: { bearerAuth: true } },
  { mode: 'direct', delegates: false, __security: { bearerAuth: true, adminAPIKeyAuth: true } },
  { mode: 'direct', delegates: true, __security: { bearerAuth: true } },
  { mode: 'direct', delegates: true, __security: { bearerAuth: true, adminAPIKeyAuth: true } },
] as const)(
  'uses a custom Bedrock bearer fallback after one null resolution: %j',
  async ({ mode, delegates, __security }) => {
    class FallbackCredentials extends BedrockOpenAI {
      resolutions = 0;
      bearerCalls = 0;

      override async _callApiKey(capture?: (apiKey: string | null) => void) {
        this.resolutions += 1;
        this.apiKey = null;
        capture?.(null);
        return true;
      }

      protected override async bearerAuth(options: Parameters<BedrockOpenAI['buildRequest']>[0]) {
        this.bearerCalls += 1;
        const inherited = delegates ? await super.bearerAuth(options) : undefined;
        return inherited ?? buildHeaders([{ Authorization: 'Bearer synthetic-fallback' }]);
      }
    }
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new FallbackCredentials({ baseURL, apiKey: 'synthetic-configured', fetch });
    if (mode === 'direct') {
      client.apiKey = null;
    }

    let headers: Headers;
    if (mode === 'request') {
      await client.get('/items', { __security });
      headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    } else {
      const { req } = await client.buildRequest({ method: 'get', path: '/items', __security });
      ({ headers } = req);
    }

    expect(headers.get('authorization')).toBe('Bearer synthetic-fallback');
    expect(client.resolutions).toBe(1);
    expect(client.bearerCalls).toBe(1);
  },
);

test('does not use a custom Bedrock bearer fallback for an admin-only request', async () => {
  class FallbackCredentials extends BedrockOpenAI {
    resolutions = 0;
    bearerCalls = 0;

    override async _callApiKey(capture?: (apiKey: string | null) => void) {
      this.resolutions += 1;
      this.apiKey = null;
      capture?.(null);
      return true;
    }

    protected override async bearerAuth(options: Parameters<BedrockOpenAI['buildRequest']>[0]) {
      this.bearerCalls += 1;
      return super.bearerAuth(options);
    }
  }
  const client = new FallbackCredentials({ baseURL, apiKey: 'synthetic-configured' });
  client.apiKey = null;

  await expect(
    client.buildRequest({ method: 'get', path: '/items', __security: { adminAPIKeyAuth: true } }),
  ).rejects.toThrow('Could not resolve authentication method.');

  expect(client.resolutions).toBe(1);
  expect(client.bearerCalls).toBe(0);
});

test('validates a replaced buildURL result before direct-build body or credential effects', async () => {
  class ReplacedURL extends BedrockOpenAI {
    override buildURL(
      path: string,
      query: Record<string, unknown> | null | undefined,
      defaultBaseURL?: string,
    ) {
      super.buildURL(path, query, defaultBaseURL);
      return 'https://other.example/openai/v1/items';
    }
  }
  const provider = vi.fn(async () => 'synthetic-direct');
  const serializeBody = vi.fn(() => ({ synthetic: true }));
  const client = new ReplacedURL({ baseURL, bedrockTokenProvider: provider });

  await expect(
    client.buildRequest({ method: 'post', path: '/items', body: { toJSON: serializeBody } }),
  ).rejects.toThrow('origin');

  expect(provider).not.toHaveBeenCalled();
  expect(serializeBody).not.toHaveBeenCalled();
});

test('validates direct-build origins despite a nondelegating validateRequestURL method', async () => {
  class CustomValidation extends BedrockOpenAI {
    // oxlint-disable-next-line eslint/class-methods-use-this -- This instance hook intentionally bypasses inherited validation.
    protected validateRequestURL(_url: string): void {}

    // oxlint-disable-next-line eslint/class-methods-use-this -- This instance routing override intentionally skips the base builder.
    override buildURL(path: string): string {
      return path;
    }
  }
  const provider = vi.fn(async () => 'synthetic-direct');
  const serializeBody = vi.fn(() => ({ synthetic: true }));
  const client = new CustomValidation({ baseURL, bedrockTokenProvider: provider });

  await expect(
    client.buildRequest({
      method: 'post',
      path: 'https://other.example/openai/v1/items',
      body: { toJSON: serializeBody },
    }),
  ).rejects.toThrow('origin');

  expect(provider).not.toHaveBeenCalled();
  expect(serializeBody).not.toHaveBeenCalled();
});

test('validates the constructed URL before resolving credentials in a direct Bedrock build', async () => {
  const provider = vi.fn(async () => 'synthetic-direct');
  const client = new BedrockOpenAI({ baseURL, bedrockTokenProvider: provider });
  const guardFailure = new Error('synthetic origin validation failure');
  vi.spyOn(bedrockInternal, 'assertBedrockRequestOrigin').mockImplementation(() => {
    throw guardFailure;
  });

  await expect(client.buildRequest({ method: 'get', path: '/items' })).rejects.toBe(guardFailure);

  expect(provider).not.toHaveBeenCalled();
});

test('validates the exact direct-build URL without resolving query values again', async () => {
  const provider = vi.fn(async () => 'synthetic-direct');
  const client = new BedrockOpenAI({ baseURL, bedrockTokenProvider: provider });
  const guard = vi.spyOn(bedrockInternal, 'assertBedrockClientRequestOrigin');
  const readCursor = vi.fn(() => 'synthetic cursor');
  const query = {
    get cursor() {
      return readCursor();
    },
  };

  const { req, url } = await client.buildRequest({
    method: 'get',
    path: '/items',
    query,
    defaultBaseURL: 'https://default.example/v1',
  });

  expect(guard).toHaveBeenCalledTimes(1);
  expect(guard).toHaveBeenCalledWith(client, url);
  expect(new URL(url).origin).toBe(new URL(baseURL).origin);
  expect(new URL(url).searchParams.get('cursor')).toBe('synthetic cursor');
  expect(readCursor).toHaveBeenCalledTimes(1);
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
  expect(provider).toHaveBeenCalledTimes(1);
});

test.each(['default', 'client', 'request', 'both'] as const)(
  'uses manual redirects for a direct Bedrock build with %s fetch options',
  async (configuration) => {
    const provider = vi.fn(async () => 'synthetic-direct');
    const fetch = vi.fn(async (_url: RequestInfo, _init?: RequestInit) => Response.json({ ok: true }));
    const client = new BedrockOpenAI({
      baseURL,
      bedrockTokenProvider: provider,
      fetch,
      ...(configuration === 'client' || configuration === 'both'
        ? { fetchOptions: { redirect: 'follow' as const } }
        : {}),
    });

    const { req, url } = await client.buildRequest({
      method: 'get',
      path: '/items',
      ...(configuration === 'request' || configuration === 'both'
        ? { fetchOptions: { redirect: 'follow' as const } }
        : {}),
    });

    expect(req.redirect).toBe('manual');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    await client.fetchWithTimeout(url, req, 1000, new AbortController());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer synthetic-direct',
    );
  },
);
