import { vi } from 'vitest';
import type { Mock } from 'vitest';

import OpenAI, { BedrockOpenAI } from 'openai';
import { assertBedrockWebSocketOrigin, brand_privateBedrockClient } from 'openai/internal/bedrock';
import { OpenAIRealtimeWebSocket as StableBrowserRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaBrowserRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import * as WS from 'ws';

type Listener = (event: any) => void;

interface FakeNodeSocket {
  url: URL;
  options: WS.ClientOptions;
  on: Mock;
  send: Mock;
  close: Mock;
}

function CapturingWebSocket(url: URL, options: FakeNodeSocket['options']): FakeNodeSocket {
  return {
    url,
    options,
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
}

vi.mock('ws', () => ({ WebSocket: vi.fn(CapturingWebSocket) }));

class FakeBrowserSocket {
  static instances: FakeBrowserSocket[] = [];

  readonly listeners = new Map<string, Listener>();
  readonly send = vi.fn();
  readonly close = vi.fn();
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeBrowserSocket.instances.push(this);
  }

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, listener);
  }
}

const originalWebSocket = globalThis.WebSocket;
const nodeSocketConstructor = WS.WebSocket as unknown as Mock;

function lastBrowserSocket(): FakeBrowserSocket {
  const [socket] = FakeBrowserSocket.instances.slice(-1);
  if (!socket) {
    throw new Error('Expected a browser WebSocket instance');
  }
  return socket;
}

function lastNodeSocket(): FakeNodeSocket {
  const [result] = nodeSocketConstructor.mock.results.slice(-1);
  const socket = result?.value as FakeNodeSocket | undefined;
  if (!socket) {
    throw new Error('Expected a Node WebSocket instance');
  }
  return socket;
}

function createUnauthenticatedClient(): OpenAI {
  return new OpenAI({ apiKey: null, adminAPIKey: 'admin-only', baseURL: 'https://example.com/v1/' });
}

beforeEach(() => {
  FakeBrowserSocket.instances = [];
  nodeSocketConstructor.mockClear();
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeBrowserSocket,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: originalWebSocket,
    writable: true,
  });
});

describe('Bedrock WebSocket origin containment', () => {
  const configuredBaseURL = 'https://bedrock.example.com/openai/v1';
  const attackerBaseURL = 'https://attacker.example/openai/v1';

  test('recognizes the Bedrock client brand from another SDK module copy', () => {
    expect(Symbol.keyFor(brand_privateBedrockClient)).toBe('openai.privateBedrockClient');
    const foreignCopyBrand = Symbol.for('openai.privateBedrockClient');
    const foreignClient = { baseURL: configuredBaseURL, [foreignCopyBrand]: true };

    expect(() =>
      assertBedrockWebSocketOrigin(foreignClient, new URL('wss://attacker.example/realtime')),
    ).toThrow(/origin/iu);
  });

  const websocketSurfaces = [
    {
      name: 'stable Responses',
      kind: 'node',
      path: 'responses',
      open: (client: BedrockOpenAI) => new StableResponsesWS(client),
    },
    {
      name: 'beta Responses',
      kind: 'node',
      path: 'responses',
      open: (client: BedrockOpenAI) => new BetaResponsesWS(client),
    },
    {
      name: 'stable Node Realtime',
      kind: 'node',
      path: 'realtime',
      open: (client: BedrockOpenAI) => new StableNodeRealtime({ model: 'gpt-realtime' }, client),
    },
    {
      name: 'beta Node Realtime',
      kind: 'node',
      path: 'realtime',
      open: (client: BedrockOpenAI) => new BetaNodeRealtime({ model: 'gpt-realtime' }, client),
    },
    {
      name: 'stable native Realtime',
      kind: 'native',
      path: 'realtime',
      open: (client: BedrockOpenAI) => new StableBrowserRealtime({ model: 'gpt-realtime' }, client),
    },
    {
      name: 'beta native Realtime',
      kind: 'native',
      path: 'realtime',
      open: (client: BedrockOpenAI) => new BetaBrowserRealtime({ model: 'gpt-realtime' }, client),
    },
  ] as const;
  const realtimeSurfaces = [
    {
      name: 'stable Node Realtime',
      open: (client: BedrockOpenAI) =>
        new StableNodeRealtime(
          { model: 'gpt-realtime', buildRealtimeURL: () => new URL('wss://attacker.example/exfiltrate') },
          client,
        ),
    },
    {
      name: 'stable native Realtime',
      open: (client: BedrockOpenAI) =>
        new StableBrowserRealtime(
          { model: 'gpt-realtime', buildRealtimeURL: () => new URL('wss://attacker.example/exfiltrate') },
          client,
        ),
    },
  ] as const;
  const realtimeFactories = [
    {
      name: 'stable Node Realtime',
      kind: 'node',
      create: (client: BedrockOpenAI) => StableNodeRealtime.create(client, { model: 'gpt-realtime' }),
    },
    {
      name: 'beta Node Realtime',
      kind: 'node',
      create: (client: BedrockOpenAI) => BetaNodeRealtime.create(client, { model: 'gpt-realtime' }),
    },
    {
      name: 'stable native Realtime',
      kind: 'native',
      create: (client: BedrockOpenAI) => StableBrowserRealtime.create(client, { model: 'gpt-realtime' }),
    },
    {
      name: 'beta native Realtime',
      kind: 'native',
      create: (client: BedrockOpenAI) => BetaBrowserRealtime.create(client, { model: 'gpt-realtime' }),
    },
  ] as const;
  const stableRealtimeFactories = [
    {
      name: 'stable Node Realtime',
      create: (client: BedrockOpenAI) =>
        StableNodeRealtime.create(client, {
          model: 'gpt-realtime',
          buildRealtimeURL: (urlClient) => {
            expect(urlClient.apiKey).toBe('rotating-bedrock-secret');
            return new URL('wss://attacker.example/exfiltrate');
          },
        }),
    },
    {
      name: 'stable native Realtime',
      create: (client: BedrockOpenAI) =>
        StableBrowserRealtime.create(client, {
          model: 'gpt-realtime',
          buildRealtimeURL: (urlClient) => {
            expect(urlClient.apiKey).toBe('rotating-bedrock-secret');
            return new URL('wss://attacker.example/exfiltrate');
          },
        }),
    },
  ] as const;

  test.each(realtimeSurfaces)(
    '$name rejects a final cross-origin URL before attaching static credentials',
    ({ open }) => {
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, apiKey: 'static-bedrock-secret' });

      expect(() => open(client)).toThrow(/request origin/iu);
      expect(nodeSocketConstructor).not.toHaveBeenCalled();
      expect(FakeBrowserSocket.instances).toHaveLength(0);
    },
  );

  test.each(websocketSurfaces)(
    '$name rejects a cross-origin base URL before opening a socket with static credentials',
    ({ open }) => {
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, apiKey: 'static-bedrock-secret' });

      expect(() => {
        client.baseURL = attackerBaseURL;
        open(client);
      }).toThrow(/request origin/iu);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(nodeSocketConstructor).not.toHaveBeenCalled();
      expect(FakeBrowserSocket.instances).toHaveLength(0);
    },
  );

  test.each(websocketSurfaces)(
    '$name accepts normalized same-origin base URL changes',
    ({ open, kind, path }) => {
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, apiKey: 'static-bedrock-secret' });
      client.baseURL = 'https://BEDROCK.EXAMPLE.COM:443/custom/v2';

      const socket = open(client);

      expect(socket.url.toString()).toBe(
        `wss://bedrock.example.com/custom/v2/${path}${path === 'realtime' ? '?model=gpt-realtime' : ''}`,
      );
      if (kind === 'node') {
        expect(lastNodeSocket().options.headers).toMatchObject({
          Authorization: 'Bearer static-bedrock-secret',
        });
      } else {
        expect(lastBrowserSocket().protocols).toContain('openai-insecure-api-key.static-bedrock-secret');
      }
    },
  );

  test.each(stableRealtimeFactories)(
    '$name resolves rotating credentials before building and rejecting a cross-origin URL',
    async ({ create }) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider });

      await expect(create(client)).rejects.toThrow(/request origin/iu);

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      expect(nodeSocketConstructor).not.toHaveBeenCalled();
      expect(FakeBrowserSocket.instances).toHaveLength(0);
    },
  );

  test.each(realtimeFactories)(
    '$name rejects a cross-origin base URL before resolving rotating credentials',
    async ({ create, kind }) => {
      const bedrockTokenProvider = vi.fn(async () => 'rotating-bedrock-secret');
      const client = new BedrockOpenAI({ baseURL: configuredBaseURL, bedrockTokenProvider });

      await expect(
        (async () => {
          client.baseURL = attackerBaseURL;
          return create(client);
        })(),
      ).rejects.toThrow(/request origin/iu);

      expect(client.baseURL).toBe(configuredBaseURL);
      expect(bedrockTokenProvider).not.toHaveBeenCalled();
      expect(nodeSocketConstructor).not.toHaveBeenCalled();
      expect(FakeBrowserSocket.instances).toHaveLength(0);

      await create(client);

      expect(bedrockTokenProvider).toHaveBeenCalledTimes(1);
      if (kind === 'node') {
        expect(lastNodeSocket().url.toString()).toBe(
          'wss://bedrock.example.com/openai/v1/realtime?model=gpt-realtime',
        );
        expect(lastNodeSocket().options.headers).toMatchObject({
          Authorization: 'Bearer rotating-bedrock-secret',
        });
      } else {
        expect(lastBrowserSocket().url).toBe(
          'wss://bedrock.example.com/openai/v1/realtime?model=gpt-realtime',
        );
        expect(lastBrowserSocket().protocols).toContain('openai-insecure-api-key.rotating-bedrock-secret');
      }
    },
  );
});

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket redirect options', ({ Responses }) => {
  test('preserves explicitly enabled redirects without sensitive headers', () => {
    const websocket = new Responses(createUnauthenticatedClient(), {
      followRedirects: true,
      headers: { 'X-Custom': 'value' },
    });

    expect(websocket.socket.platformSocket).toBe(lastNodeSocket());
    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: true,
      headers: { 'X-Custom': 'value' },
    });
    expect(lastNodeSocket().options.headers).not.toHaveProperty('Authorization');
  });
});
