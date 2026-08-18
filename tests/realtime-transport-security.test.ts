import { vi } from 'vitest';
import type { Mock } from 'vitest';

import OpenAI, { AzureOpenAI, OpenAIError } from 'openai';
import { OpenAIRealtimeWebSocket as StableNativeRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWebSocket as BetaNativeRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import * as WS from 'ws';

type NativeSocketOptions =
  | string[]
  | {
      protocols: string[];
      headers: Record<string, string>;
    };

class CapturingNativeSocket {
  static instances: CapturingNativeSocket[] = [];

  readonly url: string;
  readonly options: NativeSocketOptions;
  readonly addEventListener = vi.fn();
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor(url: string, options: NativeSocketOptions) {
    this.url = url;
    this.options = options;
    CapturingNativeSocket.instances.push(this);
  }
}

function createNodeSocket(url: URL, options: WS.ClientOptions) {
  return { url, options, on: vi.fn(), send: vi.fn(), close: vi.fn() };
}

vi.mock('ws', () => ({
  WebSocket: vi.fn(createNodeSocket),
}));

const nodeSocketConstructor = WS.WebSocket as unknown as Mock;
const nativeRealtimeSurfaces = [
  { name: 'stable', Realtime: StableNativeRealtime, beta: false },
  { name: 'beta', Realtime: BetaNativeRealtime, beta: true },
] as const;

function createClient(apiKey = 'permanent-secret', dangerouslyAllowBrowser?: boolean): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: 'https://trusted.example.com/v1/',
    ...(dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser }),
  });
}

function createAzureClient(tokenProvider = false, dangerouslyAllowBrowser?: boolean): AzureOpenAI {
  return new AzureOpenAI({
    apiVersion: '2024-10-01-preview',
    baseURL: 'https://azure.example.com/openai/',
    deployment: 'chat',
    ...(tokenProvider
      ? { azureADTokenProvider: async () => 'azure-bearer-secret' }
      : { apiKey: 'azure-api-key-secret' }),
    ...(dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser }),
  });
}

function lastNativeSocket(): CapturingNativeSocket {
  const [socket] = CapturingNativeSocket.instances.slice(-1);
  if (!socket) {
    throw new Error('Expected a native WebSocket instance');
  }
  return socket;
}

function withBrowserWorker<T>(
  workerType: 'DedicatedWorkerGlobalScope' | 'SharedWorkerGlobalScope' | 'ServiceWorkerGlobalScope',
  run: () => T,
  options: { runtime?: Record<string, unknown>; userAgent?: string } = {},
): T {
  const navigator = { userAgent: options.userAgent ?? 'Mozilla/5.0' };
  const browserWorkerGlobalScope = Object.defineProperty(() => null, Symbol.hasInstance, {
    value: (value: unknown) => value === globalThis,
  });
  const browserWorkerNavigator = Object.defineProperty(() => null, Symbol.hasInstance, {
    value: (value: unknown) => value === navigator,
  });

  const globals: Record<string, unknown> = {
    WorkerGlobalScope: browserWorkerGlobalScope,
    WorkerNavigator: browserWorkerNavigator,
    [workerType]: browserWorkerGlobalScope,
    navigator,
    window: undefined,
    process: undefined,
    Deno: undefined,
    Bun: undefined,
    EdgeRuntime: undefined,
    WebSocketPair: undefined,
    ...options.runtime,
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  try {
    for (const [name, value] of Object.entries(globals)) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      if (value === undefined) {
        Reflect.deleteProperty(globalThis, name);
      } else {
        Object.defineProperty(globalThis, name, { configurable: true, value });
      }
    }

    return run();
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  }
}

beforeEach(() => {
  CapturingNativeSocket.instances = [];
  nodeSocketConstructor.mockClear();
  vi.stubGlobal('WebSocket', CapturingNativeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(nativeRealtimeSurfaces)('$name native realtime browser-worker security', ({ Realtime }) => {
  test.each(['DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope', 'ServiceWorkerGlobalScope'] as const)(
    'rejects permanent credentials in a %s before opening a socket',
    (workerType) => {
      const client = createClient();

      withBrowserWorker(workerType, () => {
        expect(() => new Realtime({ model: 'gpt-realtime' }, client)).toThrow(OpenAIError);
        expect(CapturingNativeSocket.instances).toHaveLength(0);
      });
    },
  );

  test.each([
    { setting: 'an ephemeral key', key: 'ek_temporary', clientOptIn: undefined, connectionOptIn: undefined },
    { setting: 'connection opt-in', key: 'permanent-secret', clientOptIn: undefined, connectionOptIn: true },
    { setting: 'client opt-in', key: 'permanent-secret', clientOptIn: true, connectionOptIn: undefined },
  ])('preserves $setting inside a browser worker', ({ key, clientOptIn, connectionOptIn }) => {
    const client = createClient(key, clientOptIn);

    withBrowserWorker('DedicatedWorkerGlobalScope', () => {
      const realtime = new Realtime(
        {
          model: 'gpt-realtime',
          ...(connectionOptIn === undefined ? {} : { dangerouslyAllowBrowser: true }),
        },
        client,
      );

      expect(realtime.socket).toBe(lastNativeSocket());
    });
  });

  test.each([
    { runtime: 'Cloudflare Workers', options: { userAgent: 'Cloudflare-Workers' } },
    { runtime: 'Node.js', options: { runtime: { process } } },
    { runtime: 'Deno', options: { runtime: { Deno: {} } } },
    { runtime: 'Bun', options: { runtime: { Bun: {} } } },
    { runtime: 'Edge Runtime', options: { runtime: { EdgeRuntime: 'edge' } } },
    { runtime: 'WebSocketPair runtimes', options: { runtime: { WebSocketPair: Object } } },
  ])('does not mistake $runtime for an untrusted browser worker', ({ options }) => {
    const client = createClient();

    withBrowserWorker(
      'DedicatedWorkerGlobalScope',
      () => {
        expect(new Realtime({ model: 'gpt-realtime' }, client).socket).toBe(lastNativeSocket());
      },
      options,
    );
  });
});

describe('beta realtime WebSocket destination security', () => {
  test.each([
    { name: 'native', Realtime: BetaNativeRealtime },
    { name: 'Node', Realtime: BetaNodeRealtime },
  ])('$name ignores the previously exposed destination override', ({ Realtime }) => {
    const client = createClient();

    for (const destination of [
      'ws://trusted.example.com/v1/realtime',
      'wss://attacker.example.com/collect',
      'wss://trusted.example.com:444/collect',
    ]) {
      const realtime = new Realtime(
        { model: 'gpt-realtime', __url: new URL(destination) } as { model: string },
        client,
      );

      expect(realtime.url.toString()).toBe('wss://trusted.example.com/v1/realtime?model=gpt-realtime');
    }
  });

  test.each([
    { name: 'native', Realtime: BetaNativeRealtime },
    { name: 'Node', Realtime: BetaNodeRealtime },
  ])('$name validates the connection target even when an override is injected', ({ Realtime }) => {
    expect(
      () =>
        new Realtime(
          { __url: new URL('wss://trusted.example.com/v1/realtime') } as unknown as { model: string },
          createClient(),
        ),
    ).toThrow(/exactly one/iu);

    expect(CapturingNativeSocket.instances).toHaveLength(0);
    expect(nodeSocketConstructor).not.toHaveBeenCalled();
  });

  test.each([
    { mutation: 'insecure protocol', mutate: (url: URL) => (url.protocol = 'ws:') },
    { mutation: 'untrusted host', mutate: (url: URL) => (url.hostname = 'attacker.example.com') },
    { mutation: 'untrusted port', mutate: (url: URL) => (url.port = '444') },
  ])('rejects an $mutation introduced by the URL hook', ({ mutate }) => {
    expect(() => new BetaNativeRealtime({ model: 'gpt-realtime', onURL: mutate }, createClient())).toThrow(
      /wss|origin/iu,
    );

    expect(CapturingNativeSocket.instances).toHaveLength(0);
  });

  test.each([
    { name: 'native', Realtime: BetaNativeRealtime },
    { name: 'Node', Realtime: BetaNodeRealtime },
  ])('$name rejects an origin changed while resolving an asynchronous credential', async ({ Realtime }) => {
    const client: OpenAI = new OpenAI({
      baseURL: 'https://trusted.example.com/v1/',
      apiKey: async () => {
        client.baseURL = 'https://attacker.example.com/v1/';
        return 'rotating-secret';
      },
    });

    await expect(Realtime.create(client, { model: 'gpt-realtime' })).rejects.toThrow(/origin/iu);
    expect(CapturingNativeSocket.instances).toHaveLength(0);
    expect(nodeSocketConstructor).not.toHaveBeenCalled();
  });
});

test('stable native realtime rejects an insecure protocol introduced by its URL hook', () => {
  expect(
    () =>
      new StableNativeRealtime(
        { model: 'gpt-realtime', onURL: (url) => (url.protocol = 'ws:') },
        createClient(),
      ),
  ).toThrow(/wss/iu);

  expect(CapturingNativeSocket.instances).toHaveLength(0);
});

describe.each(nativeRealtimeSurfaces)('$name native Azure credential security', ({ Realtime, beta }) => {
  test.each([
    {
      authentication: 'an API key',
      tokenProvider: false,
      credential: 'azure-api-key-secret',
      headers: { 'api-key': 'azure-api-key-secret' },
    },
    {
      authentication: 'an Entra bearer token',
      tokenProvider: true,
      credential: 'azure-bearer-secret',
      headers: { Authorization: 'Bearer azure-bearer-secret' },
    },
  ])('sends $authentication in handshake headers without exposing it in the socket URL', async (fixture) => {
    const realtime = await Realtime.azure(createAzureClient(fixture.tokenProvider));
    const socket = lastNativeSocket();

    expect(socket.options).toEqual({
      protocols: ['realtime', ...(beta ? ['openai-beta.realtime-v1'] : [])],
      headers: fixture.headers,
    });
    expect(socket.url).not.toContain(fixture.credential);
    expect(new URL(socket.url).searchParams.has('api-key')).toBe(false);
    expect(new URL(socket.url).searchParams.has('Authorization')).toBe(false);
    expect(realtime.url.toString()).not.toContain(fixture.credential);
  });

  test.each([false, true])(
    'refuses unsafe browser header fallback for token provider %s',
    async (tokenProvider) => {
      const client = createAzureClient(tokenProvider, true);
      vi.stubGlobal('window', { document: {} });
      vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });

      await expect(Realtime.azure(client, { dangerouslyAllowBrowser: true })).rejects.toThrow(
        /request headers|authentication proxy/iu,
      );

      expect(CapturingNativeSocket.instances).toHaveLength(0);
    },
  );

  test.each([
    { runtime: 'Cloudflare Workers', options: { userAgent: 'Cloudflare-Workers' }, supported: false },
    { runtime: 'Deno 2.4', options: { runtime: { Deno: { version: { deno: '2.4.9' } } } }, supported: false },
    { runtime: 'Deno 2.5', options: { runtime: { Deno: { version: { deno: '2.5.0' } } } }, supported: true },
    { runtime: 'Deno 3', options: { runtime: { Deno: { version: { deno: '3.0.0' } } } }, supported: true },
    { runtime: 'Bun', options: { runtime: { Bun: { version: '1.1.0' } } }, supported: true },
    { runtime: 'Edge Runtime', options: { runtime: { EdgeRuntime: 'edge' } }, supported: false },
  ])('uses header authentication only when $runtime supports it', ({ options, supported }) => {
    const client = createAzureClient();

    withBrowserWorker(
      'DedicatedWorkerGlobalScope',
      () => {
        if (supported) {
          const realtime = new Realtime({ model: 'chat' }, client);
          expect(realtime.socket).toBe(lastNativeSocket());
          expect(lastNativeSocket().options).toMatchObject({
            headers: { 'api-key': 'azure-api-key-secret' },
          });
        } else {
          expect(() => new Realtime({ model: 'chat' }, client)).toThrow(
            /request headers|authentication proxy/iu,
          );
          expect(CapturingNativeSocket.instances).toHaveLength(0);
        }
      },
      options,
    );
  });
});

test('strips pre-existing Azure credential query parameters before opening a native socket', async () => {
  const client = createAzureClient();

  const realtime = await StableNativeRealtime.azure(client, {
    buildRealtimeURL: () =>
      new URL(
        'wss://azure.example.com/custom/realtime?routing=private&api-key=old-secret&Authorization=Bearer+old-token',
      ),
  });
  const socketURL = new URL(lastNativeSocket().url);

  expect(socketURL.searchParams.get('routing')).toBe('private');
  expect(socketURL.searchParams.has('api-key')).toBe(false);
  expect(socketURL.searchParams.has('Authorization')).toBe(false);
  expect(lastNativeSocket().url).not.toContain('old-secret');
  expect(lastNativeSocket().url).not.toContain('old-token');
  expect(realtime.url.toString()).not.toContain('old-secret');
  expect(realtime.url.toString()).not.toContain('old-token');
});
