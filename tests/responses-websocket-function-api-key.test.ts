import { vi } from 'vitest';

import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import type { ClientOptions } from 'ws';

const { handshake } = vi.hoisted(() => ({ handshake: vi.fn() }));

// oxlint-disable-next-line anti-slop/no-module-mocking -- Capture the public adapter handshake to verify resolved credentials reach the socket constructor.
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- ws requires Node EventEmitter semantics.
    WebSocket: class MockWebSocket extends EventEmitter {
      readyState = 1;
      close = vi.fn();

      constructor(url: URL, options: ClientOptions) {
        super();
        // HTTP header names are case-insensitive across both adapters.
        handshake(url, {
          ...options,
          headers: Object.fromEntries(
            Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
          ),
        });
      }
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket function api keys', ({ Responses }) => {
  test.each([
    {},
    { organization: 'org-synthetic' },
    { project: 'project-synthetic' },
    { defaultHeaders: { 'OpenAI-Organization': 'org-synthetic', 'openai-project': 'project-synthetic' } },
  ])('rejects an unresolved function api key with client routing options %j', (options) => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey, ...options });

    expect(() => new Responses(client)).toThrow(/unresolved function-based apiKey/u);
    expect(apiKey).not.toHaveBeenCalled();
    expect(handshake).not.toHaveBeenCalled();
  });

  test.each(['Authorization', 'authorization'])(
    'allows caller-supplied %s with an unresolved function api key',
    (headerName) => {
      const apiKey = vi.fn(async () => 'sk-refreshed');
      const client = new OpenAI({ apiKey });
      const responses = new Responses(client, {
        headers: { [headerName]: 'Bearer caller-managed-token' },
      });
      try {
        expect(apiKey).not.toHaveBeenCalled();
        expect(handshake).toHaveBeenCalledTimes(1);
        expect(handshake).toHaveBeenCalledWith(
          expect.any(URL),
          expect.objectContaining({
            headers: expect.objectContaining({ authorization: 'Bearer caller-managed-token' }),
          }),
        );
      } finally {
        responses.close();
      }
    },
  );

  test.each([
    { name: 'Basic auth', options: { auth: 'user:pass' } },
    { name: 'proxy authorization', options: { headers: { 'Proxy-Authorization': 'Basic proxy' } } },
    { name: 'cookie', options: { headers: { Cookie: 'session=secret' } } },
    { name: 'X-API-Key', options: { headers: { 'X-API-Key': 'key-secret' } } },
    {
      name: 'distinct custom header spellings',
      options: { headers: { X_Auth_Token: 'synthetic-token', 'X-Auth-Token': '' } },
    },
  ])('allows caller-supplied $name with an unresolved function api key', ({ options }) => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });
    const responses = new Responses(client, options);
    try {
      expect(apiKey).not.toHaveBeenCalled();
      expect(handshake).toHaveBeenCalledTimes(1);
    } finally {
      responses.close();
    }
  });

  test('validates the same accessor-backed authorization snapshot sent to ws', () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });
    let reads = 0;
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, 'Authorization', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? '' : 'Bearer later-value';
      },
    });

    expect(() => new Responses(client, { headers })).toThrow(/unresolved function-based apiKey/u);
    expect(reads).toBe(1);
    expect(handshake).not.toHaveBeenCalled();
  });

  test.each([
    { headers: { 'OpenAI-Beta': 'responses_websockets=2026-02-06', 'X-Trace-Id': 'trace' } },
    { headers: { 'X-Auth-Token': '   ' } },
    { headers: { OpenAI_Organization: 'org-synthetic' } },
    { headers: { OpenAI_Project: 'project-synthetic' } },
    { headers: { Authorization: 'Bearer overwritten', authorization: '' } },
    { auth: 'user:pass', headers: { Authorization: '' } },
  ])('rejects socket options without a usable final credential: %j', (options) => {
    const client = new OpenAI({ apiKey: async () => 'SYNTHETIC_KEY' });

    expect(() => new Responses(client, options)).toThrow(/unresolved function-based apiKey/u);
    expect(handshake).not.toHaveBeenCalled();
  });

  test('validates the captured API key without reading a changing accessor again', () => {
    const client = new OpenAI({ apiKey: async () => 'SYNTHETIC_KEY' });
    let reads = 0;
    Object.defineProperty(client, 'apiKey', {
      get() {
        reads += 1;
        return reads === 1 ? null : 'SYNTHETIC_LATER_KEY';
      },
    });

    expect(() => new Responses(client)).toThrow(/unresolved function-based apiKey/u);
    expect(reads).toBe(1);
    expect(handshake).not.toHaveBeenCalled();
  });

  test('accepts a function api key after it has been resolved', async () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey, organization: 'org-synthetic', project: 'project-synthetic' });
    expect(await client._callApiKey()).toBe(true);

    const responses = new Responses(client);
    try {
      expect(handshake).toHaveBeenCalledTimes(1);
      expect(handshake).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer sk-refreshed',
            'openai-organization': 'org-synthetic',
            'openai-project': 'project-synthetic',
          }),
        }),
      );
      expect(apiKey).toHaveBeenCalledTimes(1);
    } finally {
      responses.close();
    }
  });

  test('allows caller-supplied authorization when the client has no api key', () => {
    const client = new OpenAI({ adminAPIKey: 'admin-key' });
    const responses = new Responses(client, {
      headers: { Authorization: 'Bearer caller-managed-token' },
    });
    try {
      expect(handshake).toHaveBeenCalledTimes(1);
      expect(handshake).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: 'Bearer caller-managed-token' }),
        }),
      );
    } finally {
      responses.close();
    }
  });

  test('preserves explicit header overrides after a function key is resolved', async () => {
    const client = new OpenAI({ apiKey: async () => 'SYNTHETIC_KEY' });
    await client._callApiKey();

    const responses = new Responses(client, { headers: { Authorization: '' } });
    try {
      expect(handshake).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ headers: expect.objectContaining({ authorization: '' }) }),
      );
    } finally {
      responses.close();
    }
  });
});
