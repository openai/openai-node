/* oxlint-disable eslint/max-classes-per-file -- Separate subclass fixtures cover independent compatibility paths. */
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

  expect(guard).toHaveBeenCalledTimes(1);
  expect(guard).toHaveBeenCalledWith(baseURL, url);
  expect(new URL(url).origin).toBe(new URL(baseURL).origin);
  expect(new URL(url).searchParams.get('cursor')).toBe('synthetic cursor');
  expect(readCursor).toHaveBeenCalledTimes(1);
  expect(req.headers.get('authorization')).toBe('Bearer synthetic-direct');
  expect(provider).toHaveBeenCalledTimes(1);
});

test('releases credential preparation after a subclass API-key getter failure', async () => {
  class AlternatingCredentials extends BedrockOpenAI {
    preparations = 0;

    protected override async prepareOptions() {
      this.preparations += 1;
      this.apiKey = this.preparations === 1 ? 'synthetic\ninvalid' : 'synthetic-valid';
    }
  }
  const client = new AlternatingCredentials({
    baseURL,
    apiKey: 'synthetic-configured',
    fetch: async () => Response.json({ ok: true }),
  });
  const options = { method: 'get' as const, path: '/items' };

  await expect(client.request(options)).rejects.toThrow('invalid HTTP header value');
  await expect(client.request(options)).resolves.toEqual({ ok: true });

  expect(client.preparations).toBe(2);
});
