import { vi } from 'vitest';

import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import type { ClientOptions } from 'ws';

const { handshake } = vi.hoisted(() => ({ handshake: vi.fn() }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- ws requires Node EventEmitter semantics.
    WebSocket: class MockWebSocket extends EventEmitter {
      readyState = 1;
      close = vi.fn();

      constructor(url: URL, options: ClientOptions) {
        super();
        handshake(url, options);
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
  test('rejects an unresolved function api key instead of opening an unauthenticated socket', () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });

    expect(() => new Responses(client)).toThrow(/unresolved function-based apiKey/);
    expect(apiKey).not.toHaveBeenCalled();
    expect(handshake).not.toHaveBeenCalled();
  });

  test('accepts a function api key after it has been resolved', async () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });
    expect(await client._callApiKey()).toBe(true);

    const responses = new Responses(client);
    try {
      expect(handshake).toHaveBeenCalledTimes(1);
      expect(handshake).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer sk-refreshed' }),
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
          headers: expect.objectContaining({ Authorization: 'Bearer caller-managed-token' }),
        }),
      );
    } finally {
      responses.close();
    }
  });
});
