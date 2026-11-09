// oxlint-disable max-classes-per-file -- The transport fixture and real client subclasses test emitted protocols and inherited header-hook compatibility.
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
    new Headers(socket.headers).get('authorization')?.replace(/^Bearer /u, '') ??
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
      expect(Object.getOwnPropertyDescriptor(socket.headers, header.toLowerCase())).toEqual({
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

test.each(['OpenAI-Beta', 'openai-beta'])('bypasses inherited setters for %s', async (header) => {
  const client = new OpenAI({ apiKey: 'synthetic-beta-protocol-key' });

  const { setter } = await withInheritedSetter(header, () =>
    BetaNodeRealtime.create(client, { model: 'gpt-realtime' }),
  );

  expect(setter).not.toHaveBeenCalled();
  expect(sockets[0]?.headers['openai-beta']).toBe('realtime=v1');
});

describe.each([
  { name: 'stable', Realtime: StableNodeRealtime, beta: false },
  { name: 'beta', Realtime: BetaNodeRealtime, beta: true },
])('$name Node protocol header', ({ Realtime, beta }) => {
  test.each([
    { source: 'default', value: 'assistants=v2' },
    { source: 'default', value: null },
    { source: 'transport', value: 'assistants=v2' },
    { source: 'transport', value: null },
    { source: 'hook', value: 'assistants=v2' },
    { source: 'hook', value: null },
  ])('preserves the protocol contract with $source value $value', ({ source, value }) => {
    class ProtocolClient extends OpenAI {
      override _buildWebSocketHeaders(authHeaders: Record<string, string>) {
        const headers = super._buildWebSocketHeaders(authHeaders);
        if (source === 'hook') {
          delete headers['openai-beta'];
          if (value !== null) {
            headers['OPENAI-BETA'] = value;
          }
        }
        return headers;
      }
    }
    const client = new ProtocolClient({
      apiKey: 'synthetic-key',
      defaultHeaders: source === 'default' ? { 'OpenAI-Beta': value } : {},
    });
    const headers = {
      Authorization: 'Bearer synthetic-override',
      'OpenAI-Project': 'project-override',
      ...(source === 'transport' ? { 'OPENAI-Beta': value } : {}),
    };
    const connection = new Realtime(
      {
        model: 'gpt-realtime',
        options: {
          // @ts-expect-error Verify supported runtime null removals without widening the ws header types.
          headers,
        },
      },
      client,
    );
    expect(connection.socket).toBe(sockets[0]);
    const actual = new Headers(sockets[0]?.headers);
    expect(actual.get('openai-beta')).toBe(beta ? 'realtime=v1' : value);
    expect(
      Object.keys(sockets[0]?.headers ?? {}).filter((name) => name.toLowerCase() === 'openai-beta'),
    ).toEqual(beta || value !== null ? ['openai-beta'] : []);
    expect(actual.get('authorization')).toBe('Bearer synthetic-override');
    expect(actual.get('openai-project')).toBe('project-override');
  });
});

describe.each([
  { name: 'stable', Realtime: StableNodeRealtime, beta: false },
  { name: 'beta', Realtime: BetaNodeRealtime, beta: true },
])('$name Node repeated transport headers', ({ Realtime, beta }) => {
  test.each([false, true])('preserves values and normalized overrides (full client: %s)', (full) => {
    const config = { apiKey: 'synthetic-key', baseURL: 'https://api.example/v1/' };
    const client = full ? new OpenAI(config) : config;
    const transportHeaders = {
      'x-repeated': ['superseded'],
      'X-Repeated': ['first', 'second'],
      'X-Empty': [],
      'X-Remove': ['removed'],
      'x-remove': null,
      Authorization: undefined,
      'OpenAI-Beta': ['alternate=v1', 'extra=v1'],
    };
    const connection = new Realtime(
      {
        model: 'gpt-realtime',
        options: {
          // @ts-expect-error ws supports repeated headers and the SDK honors runtime null removals.
          headers: transportHeaders,
        },
      },
      client,
    );
    expect(connection.socket).toBe(sockets[0]);
    const headers = sockets[0]?.headers;
    expect(headers?.['x-repeated']).toEqual(['first', 'second']);
    expect(headers?.['x-empty']).toEqual([]);
    expect(headers).not.toHaveProperty('x-remove');
    expect(headers?.['authorization']).toBe('Bearer synthetic-key');
    expect(headers?.['openai-beta']).toEqual(beta ? 'realtime=v1' : ['alternate=v1', 'extra=v1']);
    expect(Object.keys(headers ?? {}).every((name) => name === name.toLowerCase())).toBe(true);
  });
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

describe.each([
  { name: 'stable ws', Realtime: StableNodeRealtime, beta: false },
  { name: 'beta ws', Realtime: BetaNodeRealtime, beta: true },
])('$name client routing', ({ Realtime, beta }) => {
  test('uses client defaults and explicit transport headers at the handshake', () => {
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      baseURL: 'https://api.example/v1/',
      organization: 'org-from-client',
      project: 'project-from-client',
      defaultHeaders: { 'X-Route': 'default', 'X-Remove': 'default', 'OpenAI-Project': 'project-default' },
    });
    const connection = new Realtime(
      {
        model: 'gpt-realtime',
        options: {
          // @ts-expect-error ws only declares string headers; the SDK also honors explicit runtime removals.
          headers: { authorization: 'Bearer synthetic-explicit', 'x-remove': null, 'X-Route': 'call' },
        },
      },
      client,
    );
    expect(connection.socket).toBe(sockets[0]);
    const headers = new Headers(sockets[0]?.headers);
    expect(headers.get('authorization')).toBe('Bearer synthetic-explicit');
    expect(headers.get('openai-organization')).toBe('org-from-client');
    expect(headers.get('openai-project')).toBe('project-default');
    expect(headers.get('x-route')).toBe('call');
    expect(headers.has('x-remove')).toBe(false);
    expect(headers.get('openai-beta')).toBe(beta ? 'realtime=v1' : null);
  });

  test('supports default and per-connection removal with case-insensitive auth and routing', () => {
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      baseURL: 'https://api.example/v1/',
      organization: 'org-from-client',
      project: 'project-from-client',
      defaultHeaders: { 'OPENAI-Organization': null, Authorization: 'Bearer default-credential' },
    });
    const connection = new Realtime(
      // @ts-expect-error Verify untyped null removals without widening the published ws options.
      { model: 'gpt-realtime', options: { headers: { Authorization: null, 'OpenAI-Project': null } } },
      client,
    );
    expect(connection.socket).toBe(sockets[0]);
    const headers = new Headers(sockets[0]?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('openai-organization')).toBe(false);
    expect(headers.has('openai-project')).toBe(false);
  });

  test('preserves structural partial clients with static credentials', () => {
    const connection = new Realtime(
      { model: 'gpt-realtime', options: { headers: { Authorization: 'Bearer partial-override' } } },
      { apiKey: 'synthetic-partial', baseURL: 'https://api.example/v1/' },
    );
    expect(connection.socket).toBe(sockets[0]);
    const headers = new Headers(sockets[0]?.headers);
    expect(headers.get('authorization')).toBe('Bearer partial-override');
    expect(headers.get('user-agent')).toMatch(/^Object\/JS /u);
  });
});

describe.each(surfaces)('$name effective client routing', ({ Realtime }) => {
  test("uses a one-argument header hook with each connection's captured credential", async () => {
    class RoutingClient extends OpenAI {
      override _buildWebSocketHeaders(authHeaders: Record<string, string>) {
        const authorization = authHeaders['Authorization'];
        if (!authorization) {
          throw new Error('Expected the connection credential');
        }
        return {
          ...super._buildWebSocketHeaders(authHeaders),
          'OpenAI-Project': authorization.slice('Bearer '.length),
        };
      }
    }
    let calls = 0;
    const client = new RoutingClient({
      apiKey: async () => {
        calls += 1;
        return `synthetic-route-${calls}`;
      },
      baseURL: 'https://api.example/v1/',
      organization: 'routing-client',
      defaultHeaders: { 'OpenAI-Organization': null },
    });

    await Promise.all([
      Realtime.create(client, { model: 'gpt-realtime' }),
      Realtime.create(client, { model: 'gpt-realtime' }),
    ]);

    expect(sockets).toHaveLength(2);
    for (const [index, socket] of sockets.entries()) {
      const headers = new Headers(socket.headers);
      const prefix = 'openai-project.';
      const protocol = socket.protocols.find((entry) => entry.startsWith(prefix));
      expect(protocol?.slice(prefix.length) ?? headers.get('openai-project')).toBe(
        `synthetic-route-${index + 1}`,
      );
      expect(headers.has('openai-organization')).toBe(false);
      expect(socket.protocols.some((entry) => entry.startsWith('openai-organization.'))).toBe(false);
    }
  });

  test.each([
    { name: 'overrides', value: 'routing-override', expected: 'routing-override' },
    { name: 'removals', value: null, expected: undefined },
    { name: 'omitted overrides', value: undefined, expected: 'routing-client' },
    { name: 'empty values', value: '', expected: '' },
  ])('honors case-insensitive $name', ({ value, expected }) => {
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      baseURL: 'https://api.example/v1/',
      organization: 'routing-client',
      project: 'routing-client',
      defaultHeaders: { 'openai-organization': value, 'OPENAI-PROJECT': value },
    });

    const connection = new Realtime({ model: 'gpt-realtime' }, client);

    const [socket] = sockets;
    if (!socket) {
      throw new Error('Expected a Realtime connection');
    }
    expect(connection.socket).toBe(socket);
    const headers = new Headers(socket.headers);
    for (const field of ['organization', 'project']) {
      const prefix = `openai-${field}.`;
      const protocol = socket.protocols.find((entry) => entry.startsWith(prefix));
      expect(protocol?.slice(prefix.length) ?? headers.get(`openai-${field}`) ?? undefined).toBe(expected);
    }
  });
});

describe.each([
  { name: 'stable native', Realtime: StableNativeRealtime },
  { name: 'beta native', Realtime: BetaNativeRealtime },
])('$name client routing', ({ Realtime }) => {
  test('preserves routing fields on structural partial clients', () => {
    const client = {
      apiKey: 'synthetic-partial',
      baseURL: 'https://api.example/v1/',
      organization: 'org-partial',
      project: 'proj-partial',
    };
    const connection = new Realtime({ model: 'gpt-realtime' }, client);

    expect(connection.socket).toBe(sockets[0]);
    expect(sockets[0]?.protocols).toEqual(
      expect.arrayContaining(['openai-organization.org-partial', 'openai-project.proj-partial']),
    );
  });

  test('passes supported routing protocols only for non-Azure clients', () => {
    const connection = new Realtime(
      { model: 'gpt-realtime' },
      new OpenAI({
        apiKey: 'synthetic-key',
        baseURL: 'https://api.example/v1/',
        organization: 'org-client',
        project: 'proj-client',
        defaultHeaders: { 'X-Private': 'never-a-protocol' },
      }),
    );
    expect(connection.socket).toBe(sockets[0]);
    expect(sockets[0]?.protocols).toEqual(
      expect.arrayContaining([
        'realtime',
        'openai-insecure-api-key.synthetic-key',
        'openai-organization.org-client',
        'openai-project.proj-client',
      ]),
    );
    expect(sockets[0]?.protocols.join(',')).not.toContain('never-a-protocol');
  });

  test('keeps native Azure credentials out of routing protocols', async () => {
    const client = new AzureOpenAI({
      apiKey: 'synthetic-azure',
      apiVersion: '2024-10-01-preview',
      baseURL: 'https://azure.example/openai/',
      deployment: 'synthetic-deployment',
      organization: 'org-client',
      project: 'proj-client',
    });
    await Realtime.azure(client);
    expect(sockets[0]?.protocols.join(',')).not.toMatch(
      /synthetic-azure|openai-organization|openai-project/u,
    );
  });
});
