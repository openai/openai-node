/* oxlint-disable eslint/max-classes-per-file -- Separate subclass fixtures cover credential fallback and final URL validation. */
import { vi } from 'vitest';

import { BedrockOpenAI } from 'openai';
import * as bedrockInternal from 'openai/internal/bedrock';

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
  const guard = vi.spyOn(bedrockInternal, 'assertBedrockRequestOrigin');
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

  expect(guard).toHaveBeenCalledTimes(2);
  expect(guard).toHaveBeenCalledWith(baseURL, url);
  expect(new URL(url).origin).toBe(new URL(baseURL).origin);
  expect(new URL(url).searchParams.get('cursor')).toBe('synthetic cursor');
  expect(readCursor).toHaveBeenCalledTimes(1);
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
  expect(provider).toHaveBeenCalledTimes(1);
});
