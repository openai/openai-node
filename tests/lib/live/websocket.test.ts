import { expectTypeOf, vi } from 'vitest';
import type { ClientOptions } from 'ws';

import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import type { LiveWSClientOptions } from 'openai/resources/live/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import type { SidebandWSClientOptions, SidebandWSParameters } from 'openai/resources/live/sideband/ws';
import type { ResponsesWSClientOptions } from 'openai/resources/responses/ws';
import { VERSION } from 'openai/version';

// SDK-owned input-contract tests. No network connections are opened.
const { handshake } = vi.hoisted(() => ({ handshake: vi.fn() }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- ws requires Node EventEmitter semantics.
    WebSocket: class MockWebSocket extends EventEmitter {
      readyState = 1;
      send = vi.fn();
      close = vi.fn();

      constructor(url: URL, options: ClientOptions) {
        super();
        handshake(url, options);
      }
    },
  };
});

type LiveOptions = LiveWSClientOptions & SidebandWSClientOptions;
const variants = [
  {
    name: 'primary',
    path: '/v1/live/sessions',
    query: {},
    connect: (client: OpenAI, options?: LiveOptions) => new LiveWS(client, options),
  },
  {
    name: 'sideband',
    path: '/v1/live/sessions/sess%20%2F%3F%23%25/attach',
    query: {},
    connect: (client: OpenAI, options?: LiveOptions) =>
      new SidebandWS(client, { session_id: 'sess /?#%' }, options),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('requires the correct identifier and only allows disabled redirects for Live', () => {
  expectTypeOf<SidebandWSParameters>().toMatchTypeOf<{ session_id: string }>();
  expectTypeOf<LiveWSClientOptions['followRedirects']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<SidebandWSClientOptions['followRedirects']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<ResponsesWSClientOptions['followRedirects']>().toEqualTypeOf<boolean | undefined>();
});

describe.each(variants)('Live $name WebSocket inputs', ({ connect, path, query }) => {
  test.each(['https:', 'http:'])(
    'maps the endpoint and preserves custom headers/options (%s)',
    (protocol) => {
      const client = new OpenAI({ apiKey: 'fake-live-key', baseURL: `${protocol}//example.test/v1/` });
      const live = connect(client, {
        headers: { 'X-Test': 'custom', 'X-Optional': 'custom' },
        handshakeTimeout: 1234,
        followRedirects: false,
      });
      try {
        expect(live.url.protocol).toBe(protocol === 'https:' ? 'wss:' : 'ws:');
        expect(live.url.pathname).toBe(path);
        // The sideband session_id and omitted flags must not become query parameters.
        expect(Object.fromEntries(live.url.searchParams)).toEqual(query);
        expect(handshake).toHaveBeenCalledTimes(1);
        expect(handshake).toHaveBeenCalledWith(
          live.url,
          expect.objectContaining({
            handshakeTimeout: 1234,
            followRedirects: false,
            headers: {
              Authorization: 'Bearer fake-live-key',

              'User-Agent': `OpenAI/JS ${VERSION}`,
              'X-Test': 'custom',
              'X-Optional': 'custom',
            },
          }),
        );
        live.send({ type: 'session.update', session: { delegation: null } });
        expect(live.socket.platformSocket.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'session.update', session: { delegation: null } }),
        );
      } finally {
        live.close();
      }
    },
  );

  test.each([undefined, false, true])(
    'forces redirects off on initial connection and reconnect (%s)',
    async (followRedirects) => {
      const client = new OpenAI({ apiKey: 'fake-live-key', baseURL: 'https://example.test/v1/' });
      const onReconnecting = vi.fn();
      // Untyped JavaScript can bypass the interface; runtime enforcement must still win.
      const live = connect(client, {
        followRedirects,
        headers: { 'X-Test': 'custom', 'User-Agent': 'custom-client/1', 'X-Optional': 'custom' },
        reconnect: { onReconnecting, maxRetries: 1, initialDelay: 0, maxDelay: 0 },
      } as unknown as LiveOptions);
      try {
        const expected = expect.objectContaining({
          followRedirects: false,
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-live-key',

            'User-Agent': 'custom-client/1',
            'X-Test': 'custom',
            'X-Optional': 'custom',
          }),
        });
        expect(handshake).toHaveBeenNthCalledWith(1, live.url, expected);
        live.socket.platformSocket.emit('close', 1006, Buffer.from('retry'));
        await vi.runAllTimersAsync();
        expect(onReconnecting).toHaveBeenCalledTimes(1);
        expect(handshake).toHaveBeenCalledTimes(2);
        expect(handshake).toHaveBeenNthCalledWith(2, live.url, expected);
        expect(live.url.pathname).toBe(path);
        expect(Object.fromEntries(live.url.searchParams)).toEqual(query);
      } finally {
        live.close();
      }
    },
  );
});
