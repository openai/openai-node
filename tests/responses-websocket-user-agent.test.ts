import { vi } from 'vitest';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { VERSION } from 'openai/version';
import type { ClientOptions } from 'ws';

const { handshake } = vi.hoisted(() => ({ handshake: vi.fn() }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- ws requires Node EventEmitter semantics.
    WebSocket: class MockWebSocket extends EventEmitter {
      // Mock handshakes complete immediately without opening a network socket.
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['stable', StableResponsesWS],
  ['beta', BetaResponsesWS],
] as const)('%s Responses WebSocket User-Agent', (_version, ResponsesWS) => {
  test.each([
    { name: 'SDK default', headers: undefined, expected: `OpenAI/JS ${VERSION}` },
    {
      name: 'caller override',
      headers: { 'User-Agent': 'custom-client/1.0.0' },
      expected: 'custom-client/1.0.0',
    },
  ])('preserves the $name on initial connection and reconnect', async ({ headers, expected }) => {
    const client = new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' });
    const responses = new ResponsesWS(client, {
      headers,
      reconnect: { onReconnecting: () => {}, maxRetries: 1, initialDelay: 0, maxDelay: 0 },
    });

    try {
      const expectedOptions = expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expected }),
      });
      expect(handshake).toHaveBeenCalledTimes(1);
      expect(handshake).toHaveBeenNthCalledWith(1, expect.any(URL), expectedOptions);

      responses.socket.platformSocket.emit('close', 1006, Buffer.from('retry'));
      await vi.runAllTimersAsync();

      expect(handshake).toHaveBeenCalledTimes(2);
      expect(handshake).toHaveBeenNthCalledWith(2, expect.any(URL), expectedOptions);
    } finally {
      responses.close();
    }
  });
});
