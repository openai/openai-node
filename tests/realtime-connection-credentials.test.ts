import { vi } from 'vitest';
import OpenAI, { AzureOpenAI } from 'openai';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as StableNativeRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaNativeRealtime } from 'openai/beta/realtime/websocket';

const { MockSocket, sockets } = vi.hoisted(() => {
  const instances: Socket[] = [];
  class Socket {
    readonly url: string | URL;
    declare readonly headers: Record<string, string>;
    readonly protocols: string[];

    constructor(
      url: string | URL,
      options: string[] | { headers: Record<string, string>; protocols?: string[] },
    ) {
      this.url = url;
      // Capture transport options without invoking the inherited setters under test.
      Object.defineProperty(this, 'headers', {
        value: Array.isArray(options) ? {} : options.headers,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.protocols = Array.isArray(options) ? options : (options.protocols ?? []);
      instances.push(this);
    }

    on() {
      return this;
    }
    addEventListener() {
      return this;
    }
  }
  return { MockSocket: Socket, sockets: instances };
});

// oxlint-disable-next-line anti-slop/no-module-mocking -- Capture constructor headers and protocols across public adapters to verify credential precedence before network I/O.
vi.mock('ws', () => ({ WebSocket: MockSocket }));

const surfaces = [
  { name: 'stable ws', Realtime: StableNodeRealtime },
  { name: 'beta ws', Realtime: BetaNodeRealtime },
  { name: 'stable native', Realtime: StableNativeRealtime },
  { name: 'beta native', Realtime: BetaNativeRealtime },
] as const;

function credential(connection: { socket: unknown }): string | undefined {
  // SAFETY: The case selects the matching Azure/client constructor and injected MockSocket; the helper reads only the recorded credential options.
  const socket = connection.socket as InstanceType<typeof MockSocket>;
  return (
    socket.headers['Authorization']?.replace(/^Bearer /u, '') ??
    socket.headers['api-key'] ??
    socket.protocols.find((protocol) => protocol.startsWith('openai-insecure-api-key.'))?.slice(24)
  );
}

function clientFor(azure: boolean, apiKey: string | (() => Promise<string>)) {
  return azure
    ? new AzureOpenAI({
        ...(typeof apiKey === 'function' ? { azureADTokenProvider: apiKey } : { apiKey }),
        apiVersion: '2024-10-01-preview',
        baseURL: 'https://azure.example/openai/',
        deployment: 'synthetic-deployment',
      })
    : new OpenAI({ apiKey, baseURL: 'https://api.example/v1/' });
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal('WebSocket', MockSocket);
  // Explicit undefined removes any inherited Azure credential.
  // oxlint-disable-next-line unicorn/no-useless-undefined
  vi.stubEnv('AZURE_OPENAI_API_KEY', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function withInheritedSetter<T>(property: string, action: () => T) {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, property);
  const setter = vi.fn();
  try {
    // oxlint-disable-next-line no-extend-native, accessor-pairs -- Simulate a setter-only polluted prototype at the public SDK boundary, then restore it in finally.
    Object.defineProperty(Object.prototype, property, { configurable: true, set: setter });
    return { result: await action(), setter };
  } finally {
    if (original) {
      // oxlint-disable-next-line no-extend-native -- Restore the exact prototype descriptor after the isolated pollution fixture.
      Object.defineProperty(Object.prototype, property, original);
    } else {
      Reflect.deleteProperty(Object.prototype, property);
    }
  }
}

describe.each([
  { name: 'stable', Realtime: StableNodeRealtime },
  { name: 'beta', Realtime: BetaNodeRealtime },
])('$name Node own credential headers', ({ Realtime }) => {
  test.each(['public key', 'Azure key', 'Azure token'] as const)(
    'bypasses inherited setters for a %s',
    async (source) => {
      const apiKey = 'synthetic-own-header-key';
      const header = source === 'Azure key' ? 'api-key' : 'Authorization';
      const client =
        source === 'public key'
          ? new OpenAI({ apiKey })
          : new AzureOpenAI({
              ...(source === 'Azure token' ? { azureADTokenProvider: async () => apiKey } : { apiKey }),
              apiVersion: '2024-10-01-preview',
              baseURL: 'https://azure.example/openai/',
              deployment: 'synthetic-deployment',
            });

      const { setter } = await withInheritedSetter(header, () =>
        client instanceof AzureOpenAI
          ? Realtime.azure(client)
          : Realtime.create(client, { model: 'gpt-realtime' }),
      );

      expect(setter).not.toHaveBeenCalled();
      const [socket] = sockets;
      if (!socket) {
        throw new Error('Expected a Realtime connection');
      }
      expect(Object.getOwnPropertyDescriptor(socket.headers, header)).toEqual({
        value: source === 'Azure key' ? apiKey : `Bearer ${apiKey}`,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    },
  );

  test('bypasses inherited setters for Azure header options', async () => {
    const client = new AzureOpenAI({
      apiKey: 'synthetic-own-options-key',
      apiVersion: '2024-10-01-preview',
      baseURL: 'https://azure.example/openai/',
      deployment: 'synthetic-deployment',
    });

    const { result: connection, setter } = await withInheritedSetter('headers', () => Realtime.azure(client));

    expect(setter).not.toHaveBeenCalled();
    expect(credential(connection)).toBe('synthetic-own-options-key');
  });
});

test('bypasses inherited setters for the beta protocol header', async () => {
  const client = new OpenAI({ apiKey: 'synthetic-beta-protocol-key' });

  const { setter } = await withInheritedSetter('OpenAI-Beta', () =>
    BetaNodeRealtime.create(client, { model: 'gpt-realtime' }),
  );

  expect(setter).not.toHaveBeenCalled();
  expect(sockets[0]?.headers['OpenAI-Beta']).toBe('realtime=v1');
});

describe.each([
  { name: 'stable', Realtime: StableNativeRealtime },
  { name: 'beta', Realtime: BetaNativeRealtime },
])('$name native Azure browser consent', ({ Realtime }) => {
  test.each([false, true])('preserves explicit %s under an inherited setter', async (allowBrowser) => {
    const client = new AzureOpenAI({
      apiKey: 'synthetic-browser-consent-key',
      apiVersion: '2024-10-01-preview',
      baseURL: 'https://azure.example/openai/',
      deployment: 'synthetic-deployment',
      dangerouslyAllowBrowser: !allowBrowser,
    });
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', {});

    const { result, setter } = await withInheritedSetter('dangerouslyAllowBrowser', () =>
      Promise.allSettled([Realtime.azure(client, { dangerouslyAllowBrowser: allowBrowser })]),
    );

    expect(setter).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining(
          allowBrowser ? 'credentials require a WebSocket transport' : 'browser-like environment',
        ),
      }),
    });
    expect(sockets).toHaveLength(0);
  });
});

describe.each(surfaces)('$name connection credentials', ({ Realtime }) => {
  describe.each([false, true])('Azure: %s', (azure) => {
    const connect = (client: OpenAI) =>
      // SAFETY: The case selects the matching Azure/client constructor and injected MockSocket; the helper reads only the recorded credential options.
      azure ? Realtime.azure(client as AzureOpenAI) : Realtime.create(client, { model: 'gpt-realtime' });

    test('keeps simultaneously resolved provider credentials with their initiating connections', async () => {
      let calls = 0;
      const client = clientFor(azure, async () => {
        calls += 1;
        return `synthetic-token-${calls}`;
      });

      const connections = await Promise.all([connect(client), connect(client)]);

      expect(connections.map(credential)).toEqual(['synthetic-token-1', 'synthetic-token-2']);
      expect(calls).toBe(2);
      expect(client.apiKey).toBe('synthetic-token-2');
    });

    test('keeps credentials associated when pending providers settle in reverse order', async () => {
      const providers: ((token: string) => void)[] = [];
      const client = clientFor(
        azure,
        () =>
          // eslint-disable-next-line promise/avoid-new -- Control provider settlement order to reproduce the race.
          new Promise<string>((resolve) => {
            providers.push(resolve);
          }),
      );
      const first = connect(client);
      const second = connect(client);
      expect(providers).toHaveLength(2);

      const [resolveFirst, resolveSecond] = providers;
      if (!resolveFirst || !resolveSecond) {
        throw new Error('Expected both credential providers to start');
      }
      resolveSecond('synthetic-token-2');
      resolveFirst('synthetic-token-1');
      const connections = await Promise.all([first, second]);

      expect(connections.map(credential)).toEqual(['synthetic-token-1', 'synthetic-token-2']);
    });

    test('preserves static credential authentication', async () => {
      const connection = await connect(clientFor(azure, 'synthetic-static-key'));

      expect(credential(connection)).toBe('synthetic-static-key');
      if (azure) {
        expect(sockets[0]?.headers).toHaveProperty('api-key', 'synthetic-static-key');
        expect(sockets[0]?.headers).not.toHaveProperty('Authorization');
      }
    });

    test('opens no socket for a failed provider while another provider succeeds', async () => {
      let calls = 0;
      const client = clientFor(azure, async () => {
        calls += 1;
        return calls === 1 ? '' : 'synthetic-valid-token';
      });

      const results = await Promise.allSettled([connect(client), connect(client)]);

      expect(results[0]?.status).toBe('rejected');
      expect(results[1]?.status).toBe('fulfilled');
      expect(sockets).toHaveLength(1);
      if (results[1]?.status === 'fulfilled') {
        expect(credential(results[1].value)).toBe('synthetic-valid-token');
      }
    });

    test('preserves a legacy no-argument credential hook', async () => {
      const client = clientFor(azure, 'synthetic-static-key');
      const hook = vi.spyOn(client, '_callApiKey').mockImplementation(async () => {
        client.apiKey = 'synthetic-legacy-key';
        return true;
      });

      expect(credential(await connect(client))).toBe('synthetic-legacy-key');
      expect(hook).toHaveBeenCalledTimes(1);
    });

    test('preserves per-connection credentials through a forwarding hook override', async () => {
      let calls = 0;
      const client = clientFor(azure, async () => {
        calls += 1;
        return `synthetic-token-${calls}`;
      });
      const original = client._callApiKey.bind(client);
      const hook = vi.spyOn(client, '_callApiKey').mockImplementation((capture) => original(capture));

      const connections = await Promise.all([connect(client), connect(client)]);

      expect(connections.map(credential)).toEqual(['synthetic-token-1', 'synthetic-token-2']);
      expect(hook).toHaveBeenCalledTimes(2);
    });
  });
});

test.each([false, true])('preserves the no-argument credential-hook contract (Azure: %s)', async (azure) => {
  const staticClient = clientFor(azure, 'synthetic-static-key');
  const providerClient = clientFor(azure, async () => 'synthetic-provider-key');

  await expect(staticClient._callApiKey()).resolves.toBe(false);
  await expect(providerClient._callApiKey()).resolves.toBe(true);
  expect(staticClient.apiKey).toBe('synthetic-static-key');
  expect(providerClient.apiKey).toBe('synthetic-provider-key');
});

describe.each([
  { name: 'stable', Realtime: StableNativeRealtime },
  { name: 'beta', Realtime: BetaNativeRealtime },
])('$name native browser credentials', ({ Realtime }) => {
  test('checks each resolved credential before permitting browser authentication', async () => {
    let calls = 0;
    const client = clientFor(false, async () => {
      calls += 1;
      return calls === 1 ? 'synthetic-permanent-key' : 'ek_synthetic';
    });
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', {});

    const results = await Promise.allSettled([
      Realtime.create(client, { model: 'gpt-realtime' }),
      Realtime.create(client, { model: 'gpt-realtime' }),
    ]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    expect(sockets).toHaveLength(1);
    if (results[1]?.status === 'fulfilled') {
      expect(credential(results[1].value)).toBe('ek_synthetic');
    }
  });
});

describe.each([
  { name: 'ws', Realtime: StableNodeRealtime },
  { name: 'native', Realtime: StableNativeRealtime },
])('stable $name custom URL callbacks', ({ Realtime }) => {
  test('keeps the resolved key while passing the actual client to the URL callback', async () => {
    const client = clientFor(false, async () => 'synthetic-resolved-key');
    const buildRealtimeURL = vi.fn((receivedClient: Pick<OpenAI, 'apiKey' | 'baseURL'>) => {
      expect(receivedClient).toBe(client);
      client.apiKey = 'synthetic-callback-key';
      return new URL('wss://api.example/custom');
    });

    const connection = await Realtime.create(client, { model: 'gpt-realtime', buildRealtimeURL });

    expect(credential(connection)).toBe('synthetic-resolved-key');
    expect(buildRealtimeURL).toHaveBeenCalledTimes(1);
  });
});
