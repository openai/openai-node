import { vi } from 'vitest';
import type { Mock } from 'vitest';

import OpenAI, { AzureOpenAI, OpenAIError } from 'openai';
import { OpenAIRealtimeWebSocket as StableBrowserRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaBrowserRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import * as WS from 'ws';

type Listener = (event: any) => void;

type FakeNodeSocket = {
  url: URL;
  options: WS.ClientOptions;
  on: Mock;
  send: Mock;
  close: Mock;
  dispatch: (event: string, value: unknown) => void;
};

vi.mock('ws', () => ({
  WebSocket: vi.fn().mockImplementation(function WebSocket(url: URL, options: FakeNodeSocket['options']) {
    const listeners = new Map<string, Listener>();

    return {
      url,
      options,
      on: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      send: vi.fn(),
      close: vi.fn(),
      dispatch: (event: string, value: unknown) => listeners.get(event)?.(value),
    } satisfies FakeNodeSocket;
  }),
}));

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

  dispatch(event: string, value: unknown): void {
    this.listeners.get(event)?.(value);
  }
}

const originalWebSocket = globalThis.WebSocket;
const nodeSocketConstructor = WS.WebSocket as unknown as Mock;
const azureCredentialCases = [
  {
    authentication: 'an Azure API key',
    tokenProvider: false,
    queryParameter: 'api-key',
    credential: 'azure-key',
  },
  {
    authentication: 'an Entra bearer token',
    tokenProvider: true,
    queryParameter: 'Authorization',
    credential: 'Bearer azure-token',
  },
] as const;

function lastBrowserSocket(): FakeBrowserSocket {
  return FakeBrowserSocket.instances[FakeBrowserSocket.instances.length - 1]!;
}

function lastNodeSocket(): FakeNodeSocket {
  return nodeSocketConstructor.mock.results[nodeSocketConstructor.mock.results.length - 1]!
    .value as FakeNodeSocket;
}

function onRealtimeEvent(realtime: unknown, event: string, listener: Listener): void {
  (realtime as { on: (event: string, listener: Listener) => unknown }).on(event, listener);
}

function createClient(apiKey: string | (() => Promise<string>) = 'test-key'): OpenAI {
  return new OpenAI({ apiKey, baseURL: 'https://example.com/v1/' });
}

function createAzureClient(
  options: {
    tokenProvider?: boolean;
    deployment?: string;
    dangerouslyAllowBrowser?: boolean;
    baseURL?: string;
  } = {},
): AzureOpenAI {
  return new AzureOpenAI({
    apiVersion: '2024-10-01-preview',
    baseURL: options.baseURL ?? 'https://azure.example.com/openai/',
    ...(options.tokenProvider
      ? { azureADTokenProvider: async () => 'azure-token' }
      : { apiKey: 'azure-key' }),
    ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
    ...(options.dangerouslyAllowBrowser === undefined
      ? {}
      : { dangerouslyAllowBrowser: options.dangerouslyAllowBrowser }),
  });
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

describe.each([
  { name: 'stable', Realtime: StableBrowserRealtime, beta: false },
  { name: 'beta', Realtime: BetaBrowserRealtime, beta: true },
])('$name browser realtime websocket', ({ Realtime, beta }) => {
  test('opens model and sideband sessions with the expected authentication protocols', () => {
    const client = createClient();
    const model = new Realtime({ model: 'gpt-realtime' }, client);

    expect(model.url.toString()).toBe('wss://example.com/v1/realtime?model=gpt-realtime');
    expect(lastBrowserSocket().protocols).toEqual([
      'realtime',
      'openai-insecure-api-key.test-key',
      ...(beta ? ['openai-beta.realtime-v1'] : []),
    ]);

    const sideband = new Realtime({ callID: 'call-123' }, client);
    expect(sideband.url.searchParams.get('call_id')).toBe('call-123');
  });

  test('rejects function-based credentials until create resolves the token', async () => {
    const client = createClient(async () => 'rotating-key');

    expect(() => new Realtime({ model: 'gpt-realtime' }, client)).toThrow(
      'Cannot open Realtime WebSocket with a function-based apiKey',
    );

    const realtime = await Realtime.create(client, { model: 'gpt-realtime' });
    expect(realtime.socket).toBe(lastBrowserSocket());
    expect(lastBrowserSocket().protocols).toContain('openai-insecure-api-key.rotating-key');
  });

  test('refuses an unsafe browser environment but permits ephemeral credentials', () => {
    const client = createClient();
    const ephemeral = createClient('ek_temporary');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    Object.defineProperty(globalThis, 'window', { configurable: true, value: { document: {} } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });

    try {
      expect(() => new Realtime({ model: 'gpt-realtime' }, client)).toThrow(
        "It looks like you're running in a browser-like environment",
      );
      expect(new Realtime({ model: 'gpt-realtime' }, ephemeral).socket).toBe(lastBrowserSocket());
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }

      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }
    }
  });

  test('dispatches valid events and reports malformed messages and socket failures', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastBrowserSocket();
    const events = vi.fn();
    const created = vi.fn();
    const errors = vi.fn();

    onRealtimeEvent(realtime, 'event', events);
    onRealtimeEvent(realtime, 'response.created', created);
    onRealtimeEvent(realtime, 'error', errors);

    socket.dispatch('message', { data: JSON.stringify({ type: 'response.created', id: 'evt_1' }) });
    expect(events).toHaveBeenCalledWith({ type: 'response.created', id: 'evt_1' });
    expect(created).toHaveBeenCalled();

    socket.dispatch('message', {
      data: JSON.stringify({
        type: 'error',
        event_id: 'evt_2',
        error: { message: 'request rejected', code: 'invalid_request', param: null, type: 'error' },
      }),
    });
    socket.dispatch('message', { data: '{invalid' });
    socket.dispatch('error', { message: 'socket failed' });
    expect(errors).toHaveBeenCalledTimes(3);
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'dispatches Object.prototype event type %s without crashing',
    (eventType) => {
      const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
      const events = vi.fn();
      const event = { type: eventType };
      onRealtimeEvent(realtime, 'event', events);

      expect(() => lastBrowserSocket().dispatch('message', { data: JSON.stringify(event) })).not.toThrow();
      expect(events).toHaveBeenCalledWith(event);
    },
  );

  test('serializes outgoing events and closes with defaults and custom options', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastBrowserSocket();

    realtime.send({ type: 'session.update' } as any);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'session.update' }));

    realtime.close();
    realtime.close({ code: 1001, reason: 'done' });
    expect(socket.close).toHaveBeenNthCalledWith(1, 1000, 'OK');
    expect(socket.close).toHaveBeenNthCalledWith(2, 1001, 'done');
  });

  test('reports failures while sending and closing', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastBrowserSocket();
    const errors = vi.fn();
    onRealtimeEvent(realtime, 'error', errors);

    socket.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });
    socket.close.mockImplementationOnce(() => {
      throw new Error('close failed');
    });

    realtime.send({ type: 'session.update' } as any);
    realtime.close();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  test('places Azure API keys in the URL and redacts them after opening', async () => {
    const realtime = await Realtime.azure(createAzureClient({ deployment: 'chat' }));
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(lastBrowserSocket().url).toContain('api-key=azure-key');
    expect(lastBrowserSocket().protocols).not.toContain('openai-insecure-api-key.azure-key');
    expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
    expect(connectionURL.pathname).toBe(beta ? '/openai/realtime' : '/openai/v1/realtime');
    expect(connectionURL.searchParams.get(beta ? 'deployment' : 'model')).toBe('chat');
    expect(connectionURL.searchParams.has('api-version')).toBe(beta);
  });

  test('places rotating Azure credentials in Authorization and redacts them', async () => {
    const realtime = await Realtime.azure(createAzureClient({ deployment: 'chat', tokenProvider: true }));
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(connectionURL.searchParams.get('Authorization')).toBe('Bearer azure-token');
    expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
    expect(connectionURL.pathname).toBe(beta ? '/openai/realtime' : '/openai/v1/realtime');
    expect(connectionURL.searchParams.get(beta ? 'deployment' : 'model')).toBe('chat');
    expect(connectionURL.searchParams.has('api-version')).toBe(beta);
  });

  test.each(azureCredentialCases)(
    'redacts both Azure query credentials when the URL already contains another credential with $authentication',
    async ({ tokenProvider, queryParameter, credential }) => {
      const existingParameter = queryParameter === 'api-key' ? 'Authorization' : 'api-key';
      const existingCredential = tokenProvider ? 'existing-gateway-key' : 'existing-gateway-token';
      const baseURL = `https://azure.example.com/openai/?${existingParameter}=${existingCredential}&routing=value`;
      const client = createAzureClient({ deployment: 'chat', tokenProvider, baseURL });

      const realtime = beta
        ? await Realtime.azure(client)
        : await StableBrowserRealtime.azure(client, {
            buildRealtimeURL: () => {
              const url = new URL(client.baseURL);
              url.protocol = 'wss:';
              return url;
            },
          });
      const connectionURL = new URL(lastBrowserSocket().url);

      expect(connectionURL.searchParams.get(existingParameter)).toBe(existingCredential);
      expect(connectionURL.searchParams.get(queryParameter)).toBe(credential);
      expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
      expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
      expect(realtime.url.toString()).not.toContain(existingCredential);
      expect(realtime.url.toString()).not.toContain(tokenProvider ? 'azure-token' : 'azure-key');
    },
  );

  test.each(azureCredentialCases)(
    'opens outside a browser when browser access is explicitly disabled with $authentication',
    async ({ tokenProvider, queryParameter, credential }) => {
      const client = createAzureClient({
        deployment: 'chat',
        tokenProvider,
        dangerouslyAllowBrowser: true,
      });

      const realtime = await Realtime.azure(client, { dangerouslyAllowBrowser: false });

      expect(realtime.socket).toBe(lastBrowserSocket());
      expect(new URL(lastBrowserSocket().url).searchParams.get(queryParameter)).toBe(credential);
    },
  );

  describe('Azure browser security', () => {
    beforeEach(() => {
      vi.stubGlobal('window', { document: {} });
      vi.stubGlobal('navigator', {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    describe.each(azureCredentialCases)(
      'with $authentication',
      ({ tokenProvider, queryParameter, credential }) => {
        test('rejects an explicit browser denial before opening a WebSocket', async () => {
          const client = createAzureClient({
            deployment: 'chat',
            tokenProvider,
            dangerouslyAllowBrowser: true,
          });

          await expect(Realtime.azure(client, { dangerouslyAllowBrowser: false })).rejects.toThrow(
            OpenAIError,
          );
          expect(FakeBrowserSocket.instances).toHaveLength(0);
        });

        test.each([
          { setting: 'explicitly enabled', dangerouslyAllowBrowser: true },
          { setting: 'inherited from the client', dangerouslyAllowBrowser: undefined },
        ])('opens a WebSocket when browser access is $setting', async ({ dangerouslyAllowBrowser }) => {
          const client = createAzureClient({
            deployment: 'chat',
            tokenProvider,
            dangerouslyAllowBrowser: true,
          });

          const realtime = await Realtime.azure(
            client,
            dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser },
          );

          expect(realtime.socket).toBe(lastBrowserSocket());
          expect(new URL(lastBrowserSocket().url).searchParams.get(queryParameter)).toBe(credential);
        });
      },
    );
  });

  test('rejects Azure connections without a deployment', async () => {
    await expect(Realtime.azure(createAzureClient())).rejects.toThrow('No deployment name provided');
  });

  test('rejects Azure connections without a resolved API key', async () => {
    const client = createAzureClient({ deployment: 'chat' });
    client.apiKey = null;

    await expect(Realtime.azure(client)).rejects.toThrow('Azure OpenAI Realtime requires an API key');
  });
});

describe('stable browser realtime transcription', () => {
  test('uses an explicit Azure model deployment without preview query parameters', async () => {
    const realtime = await StableBrowserRealtime.azure(createAzureClient({ deployment: 'configured' }), {
      deploymentName: 'override',
    });
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(connectionURL.pathname).toBe('/openai/v1/realtime');
    expect(connectionURL.searchParams.get('model')).toBe('override');
    expect(connectionURL.searchParams.has('api-version')).toBe(false);
    expect(connectionURL.searchParams.has('deployment')).toBe(false);
    expect(lastBrowserSocket().protocols).toEqual(['realtime']);
    expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
  });

  test('opens authenticated transcription-only sessions without a model or beta protocol', () => {
    const realtime = new StableBrowserRealtime({ intent: 'transcription' }, createClient());

    expect(realtime.url.toString()).toBe('wss://example.com/v1/realtime?intent=transcription');
    expect(lastBrowserSocket().protocols).toEqual(['realtime', 'openai-insecure-api-key.test-key']);
  });

  test.each([undefined, 'configured-deployment'])(
    'opens Azure transcription without using deployment %s',
    async (deployment) => {
      const client = createAzureClient(deployment === undefined ? {} : { deployment });
      const realtime = await StableBrowserRealtime.azure(client, { intent: 'transcription' });
      const connectionURL = new URL(lastBrowserSocket().url);

      expect(connectionURL.pathname).toBe('/openai/v1/realtime');
      expect(connectionURL.searchParams.get('intent')).toBe('transcription');
      expect(connectionURL.searchParams.has('api-version')).toBe(false);
      expect(connectionURL.searchParams.has('deployment')).toBe(false);
      expect(connectionURL.searchParams.get('api-key')).toBe('azure-key');
      expect(lastBrowserSocket().protocols).toEqual(['realtime']);
      expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
    },
  );

  test('authenticates and redacts Azure token-provider transcription sessions', async () => {
    const realtime = await StableBrowserRealtime.azure(createAzureClient({ tokenProvider: true }), {
      intent: 'transcription',
    });
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(connectionURL.pathname).toBe('/openai/v1/realtime');
    expect(connectionURL.searchParams.get('intent')).toBe('transcription');
    expect(connectionURL.searchParams.has('api-version')).toBe(false);
    expect(connectionURL.searchParams.has('deployment')).toBe(false);
    expect(connectionURL.searchParams.get('Authorization')).toBe('Bearer azure-token');
    expect(lastBrowserSocket().protocols).toEqual(['realtime']);
    expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
  });

  test.each([
    { deploymentName: 'chat', intent: 'transcription' },
    { deploymentName: '', intent: 'transcription' },
    { callID: 'rtc_123', intent: 'transcription' },
    { callID: 'rtc_123', intent: 'unsupported' },
    { intent: 'unsupported' },
  ])('rejects conflicting Azure transcription targets before opening a socket %#', async (options) => {
    await expect(
      StableBrowserRealtime.azure(createAzureClient({ deployment: 'configured' }), options as any),
    ).rejects.toThrow(
      'Pass exactly one of `deploymentName`, `callID`, or transcription `intent` when opening an Azure Realtime WebSocket.',
    );
    expect(FakeBrowserSocket.instances).toHaveLength(0);
  });
});

describe.each([
  { name: 'stable', Realtime: StableNodeRealtime, beta: false },
  { name: 'beta', Realtime: BetaNodeRealtime, beta: true },
])('$name Node realtime websocket', ({ Realtime, beta }) => {
  test('opens authenticated model and sideband sessions and preserves custom headers', () => {
    const client = createClient();
    const model = new Realtime(
      { model: 'gpt-realtime', options: { headers: { 'X-Custom': 'value' } } },
      client,
    );

    expect(model.url.toString()).toBe('wss://example.com/v1/realtime?model=gpt-realtime');
    expect(lastNodeSocket().options.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'X-Custom': 'value',
      ...(beta ? { 'OpenAI-Beta': 'realtime=v1' } : {}),
    });

    const sideband = new Realtime({ callID: 'call-123' }, client);
    expect(sideband.url.searchParams.get('call_id')).toBe('call-123');
  });

  test('requires function-based credentials to be resolved with create', async () => {
    const client = createClient(async () => 'rotating-key');

    expect(() => new Realtime({ model: 'gpt-realtime' }, client)).toThrow(
      'Cannot open Realtime WebSocket with a function-based apiKey',
    );

    await Realtime.create(client, { model: 'gpt-realtime' });
    expect(lastNodeSocket().options.headers).toMatchObject({ Authorization: 'Bearer rotating-key' });
  });

  test('dispatches valid events and reports malformed messages and socket failures', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastNodeSocket();
    const events = vi.fn();
    const created = vi.fn();
    const errors = vi.fn();

    onRealtimeEvent(realtime, 'event', events);
    onRealtimeEvent(realtime, 'response.created', created);
    onRealtimeEvent(realtime, 'error', errors);

    socket.dispatch('message', JSON.stringify({ type: 'response.created', id: 'evt_1' }));
    expect(events).toHaveBeenCalledWith({ type: 'response.created', id: 'evt_1' });
    expect(created).toHaveBeenCalled();

    socket.dispatch(
      'message',
      JSON.stringify({
        type: 'error',
        event_id: 'evt_2',
        error: { message: 'request rejected', code: 'invalid_request', param: null, type: 'error' },
      }),
    );
    socket.dispatch('message', '{invalid');
    socket.dispatch('error', new Error('socket failed'));
    expect(errors).toHaveBeenCalledTimes(3);
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'dispatches Object.prototype event type %s without crashing',
    (eventType) => {
      const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
      const events = vi.fn();
      const event = { type: eventType };
      onRealtimeEvent(realtime, 'event', events);

      expect(() => lastNodeSocket().dispatch('message', JSON.stringify(event))).not.toThrow();
      expect(events).toHaveBeenCalledWith(event);
    },
  );

  test('sends JSON events and closes with default and custom settings', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastNodeSocket();

    realtime.send({ type: 'session.update' } as any);
    realtime.close();
    realtime.close({ code: 1001, reason: 'done' });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'session.update' }));
    expect(socket.close).toHaveBeenNthCalledWith(1, 1000, 'OK');
    expect(socket.close).toHaveBeenNthCalledWith(2, 1001, 'done');
  });

  test('reports send and close failures to error listeners', () => {
    const realtime = new Realtime({ model: 'gpt-realtime' }, createClient());
    const socket = lastNodeSocket();
    const errors = vi.fn();
    onRealtimeEvent(realtime, 'error', errors);

    socket.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });
    socket.close.mockImplementationOnce(() => {
      throw new Error('close failed');
    });

    realtime.send({ type: 'session.update' } as any);
    realtime.close();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  test('authenticates Azure sessions with an API-key header', async () => {
    await Realtime.azure(createAzureClient({ deployment: 'chat' }));
    const socket = lastNodeSocket();

    expect(socket.options.headers).toMatchObject({ 'api-key': 'azure-key' });
    expect(socket.options.headers).not.toHaveProperty('Authorization');
    expect(socket.url.pathname).toBe(beta ? '/openai/realtime' : '/openai/v1/realtime');
    expect(socket.url.searchParams.get(beta ? 'deployment' : 'model')).toBe('chat');
    expect(socket.url.searchParams.has('api-version')).toBe(beta);
  });

  test('authenticates Azure token-provider sessions with a bearer header', async () => {
    await Realtime.azure(createAzureClient({ deployment: 'chat', tokenProvider: true }));
    const socket = lastNodeSocket();

    expect(socket.options.headers).toMatchObject({ Authorization: 'Bearer azure-token' });
    expect(socket.options.headers).not.toHaveProperty('api-key');
    expect(socket.url.pathname).toBe(beta ? '/openai/realtime' : '/openai/v1/realtime');
    expect(socket.url.searchParams.get(beta ? 'deployment' : 'model')).toBe('chat');
    expect(socket.url.searchParams.has('api-version')).toBe(beta);
  });

  test('requires an Azure deployment', async () => {
    await expect(Realtime.azure(createAzureClient())).rejects.toThrow('No deployment name provided');
  });

  test('requires a resolved Azure API key', async () => {
    const client = createAzureClient({ deployment: 'chat' });
    client.apiKey = null;

    await expect(Realtime.azure(client)).rejects.toThrow('Azure OpenAI Realtime requires an API key');
  });
});

describe('stable Node realtime transcription', () => {
  test('uses an explicit Azure model deployment without preview headers or query parameters', async () => {
    await StableNodeRealtime.azure(createAzureClient({ deployment: 'configured' }), {
      deploymentName: 'override',
      options: { headers: { 'X-Custom': 'value' } },
    });
    const socket = lastNodeSocket();

    expect(socket.url.pathname).toBe('/openai/v1/realtime');
    expect(socket.url.searchParams.get('model')).toBe('override');
    expect(socket.url.searchParams.has('api-version')).toBe(false);
    expect(socket.url.searchParams.has('deployment')).toBe(false);
    expect(socket.options.headers).toMatchObject({ 'api-key': 'azure-key', 'X-Custom': 'value' });
    expect(socket.options.headers).not.toHaveProperty('OpenAI-Beta');
  });

  test('opens authenticated transcription-only sessions without a beta header', () => {
    const realtime = new StableNodeRealtime(
      { intent: 'transcription', options: { headers: { 'X-Custom': 'value' } } },
      createClient(),
    );

    expect(realtime.url.toString()).toBe('wss://example.com/v1/realtime?intent=transcription');
    expect(lastNodeSocket().options.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'X-Custom': 'value',
    });
    expect(lastNodeSocket().options.headers).not.toHaveProperty('OpenAI-Beta');
  });

  test.each([undefined, 'configured-deployment'])(
    'authenticates Azure transcription without using deployment %s',
    async (deployment) => {
      const client = createAzureClient(deployment === undefined ? {} : { deployment });
      await StableNodeRealtime.azure(client, {
        intent: 'transcription',
        options: { headers: { 'X-Custom': 'value' } },
      });
      const socket = lastNodeSocket();

      expect(socket.url.pathname).toBe('/openai/v1/realtime');
      expect(socket.url.searchParams.get('intent')).toBe('transcription');
      expect(socket.url.searchParams.has('api-version')).toBe(false);
      expect(socket.url.searchParams.has('deployment')).toBe(false);
      expect(socket.options.headers).toMatchObject({
        'api-key': 'azure-key',
        'X-Custom': 'value',
      });
      expect(socket.options.headers).not.toHaveProperty('Authorization');
      expect(socket.options.headers).not.toHaveProperty('OpenAI-Beta');
    },
  );

  test('authenticates Azure token-provider transcription with a bearer header', async () => {
    await StableNodeRealtime.azure(createAzureClient({ tokenProvider: true }), {
      intent: 'transcription',
    });
    const socket = lastNodeSocket();

    expect(socket.url.pathname).toBe('/openai/v1/realtime');
    expect(socket.url.searchParams.get('intent')).toBe('transcription');
    expect(socket.url.searchParams.has('api-version')).toBe(false);
    expect(socket.url.searchParams.has('deployment')).toBe(false);
    expect(socket.options.headers).toMatchObject({ Authorization: 'Bearer azure-token' });
    expect(socket.options.headers).not.toHaveProperty('api-key');
    expect(socket.options.headers).not.toHaveProperty('OpenAI-Beta');
  });

  test.each([
    { deploymentName: 'chat', intent: 'transcription' },
    { deploymentName: '', intent: 'transcription' },
    { callID: 'rtc_123', intent: 'transcription' },
    { callID: 'rtc_123', intent: 'unsupported' },
    { intent: 'unsupported' },
  ])('rejects conflicting Azure transcription targets before opening a socket %#', async (options) => {
    await expect(
      StableNodeRealtime.azure(createAzureClient({ deployment: 'configured' }), options as any),
    ).rejects.toThrow(
      'Pass exactly one of `deploymentName`, `callID`, or transcription `intent` when opening an Azure Realtime WebSocket.',
    );
    expect(nodeSocketConstructor).not.toHaveBeenCalled();
  });
});

describe('stable browser realtime custom URL builder', () => {
  test('opens the exact custom URL while preserving authentication and its existing query', () => {
    const client = createClient();
    const customURL = new URL('wss://sap.example.com/deployments/custom/realtime?existing=value');
    const customBuilder = vi.fn(() => customURL);

    const realtime = new StableBrowserRealtime(
      { model: 'gpt-realtime', buildRealtimeURL: customBuilder },
      client,
    );

    expect(lastBrowserSocket().url).toBe(customURL.toString());
    expect(lastBrowserSocket().protocols).toEqual(['realtime', 'openai-insecure-api-key.test-key']);
    expect(realtime.url.toString()).toBe(customURL.toString());
    expect(realtime.url).not.toBe(customURL);
    expect(realtime.url.searchParams.has('model')).toBe(false);
  });

  test('rejects an insecure custom URL before opening a socket', () => {
    expect(
      () =>
        new StableBrowserRealtime(
          {
            model: 'gpt-realtime',
            buildRealtimeURL: () => new URL('ws://sap.example.com/realtime'),
          },
          createClient(),
        ),
    ).toThrow();
    expect(FakeBrowserSocket.instances).toHaveLength(0);
  });

  test('preserves custom URLs when the factory resolves a rotating credential', async () => {
    const customURL = new URL('wss://sap.example.com/custom?existing=value');

    const realtime = await StableBrowserRealtime.create(
      createClient(async () => 'rotating-key'),
      {
        model: 'gpt-realtime',
        buildRealtimeURL: () => customURL,
      },
    );

    expect(lastBrowserSocket().url).toBe(customURL.toString());
    expect(lastBrowserSocket().protocols).toEqual(['realtime', 'openai-insecure-api-key.rotating-key']);
    expect(realtime.url.searchParams.has('model')).toBe(false);
  });

  test('authenticates and redacts an Azure API key without modifying the caller URL', async () => {
    const client = createAzureClient({ deployment: 'configured' });
    const customURL = new URL('wss://sap.example.com/azure/custom?existing=value');
    const customBuilder = vi.fn(() => customURL);

    const realtime = await StableBrowserRealtime.azure(client, {
      deploymentName: 'override',
      buildRealtimeURL: customBuilder,
    });
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(customBuilder).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ model: 'override', buildRealtimeURL: customBuilder }),
    );
    expect(connectionURL.pathname).toBe('/azure/custom');
    expect(connectionURL.searchParams.get('existing')).toBe('value');
    expect(connectionURL.searchParams.get('api-key')).toBe('azure-key');
    expect(connectionURL.searchParams.has('model')).toBe(false);
    expect(connectionURL.searchParams.has('deployment')).toBe(false);
    expect(lastBrowserSocket().protocols).toEqual(['realtime']);
    expect(realtime.url.searchParams.get('existing')).toBe('value');
    expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
    expect(customURL.toString()).toBe('wss://sap.example.com/azure/custom?existing=value');
  });

  test('authenticates and redacts an Azure token without modifying the caller URL', async () => {
    const customURL = new URL('wss://sap.example.com/azure/custom?existing=value');

    const realtime = await StableBrowserRealtime.azure(
      createAzureClient({ deployment: 'configured', tokenProvider: true }),
      { buildRealtimeURL: () => customURL },
    );
    const connectionURL = new URL(lastBrowserSocket().url);

    expect(connectionURL.searchParams.get('existing')).toBe('value');
    expect(connectionURL.searchParams.get('Authorization')).toBe('Bearer azure-token');
    expect(connectionURL.searchParams.has('model')).toBe(false);
    expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
    expect(customURL.toString()).toBe('wss://sap.example.com/azure/custom?existing=value');
  });

  test.each([
    {
      existingParameter: 'Authorization',
      authenticationParameter: 'api-key',
      authenticationValue: 'azure-key',
      tokenProvider: false,
    },
    {
      existingParameter: 'api-key',
      authenticationParameter: 'Authorization',
      authenticationValue: 'Bearer azure-token',
      tokenProvider: true,
    },
  ])(
    'redacts both Azure credential parameters when the custom URL already contains $existingParameter',
    async ({ existingParameter, authenticationParameter, authenticationValue, tokenProvider }) => {
      const customURL = new URL('wss://sap.example.com/azure/custom?routing=value');
      customURL.searchParams.set(existingParameter, 'existing');
      const callerURL = customURL.toString();

      const realtime = await StableBrowserRealtime.azure(
        createAzureClient({ deployment: 'configured', tokenProvider }),
        { buildRealtimeURL: () => customURL },
      );
      const connectionURL = new URL(lastBrowserSocket().url);

      expect(connectionURL.pathname).toBe('/azure/custom');
      expect(connectionURL.searchParams.get('routing')).toBe('value');
      expect(connectionURL.searchParams.get(existingParameter)).toBe('existing');
      expect(connectionURL.searchParams.get(authenticationParameter)).toBe(authenticationValue);
      expect(realtime.url.searchParams.get('routing')).toBe('value');
      expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
      expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
      expect(customURL.toString()).toBe(callerURL);
    },
  );

  test('requires an Azure deployment before invoking a custom builder', async () => {
    const customBuilder = vi.fn(() => new URL('wss://sap.example.com/realtime'));

    await expect(
      StableBrowserRealtime.azure(createAzureClient(), { buildRealtimeURL: customBuilder }),
    ).rejects.toThrow('No deployment name provided');
    expect(customBuilder).not.toHaveBeenCalled();
    expect(FakeBrowserSocket.instances).toHaveLength(0);
  });
});

describe('stable Node realtime custom URL builder', () => {
  test('opens the exact custom URL while preserving authentication, query, and ws options', () => {
    const client = createClient();
    const customURL = new URL('wss://sap.example.com/deployments/custom/realtime?existing=value');
    const customBuilder = vi.fn(() => customURL);

    const realtime = new StableNodeRealtime(
      {
        model: 'gpt-realtime',
        buildRealtimeURL: customBuilder,
        options: { handshakeTimeout: 4321, headers: { 'X-Custom': 'value' } },
      },
      client,
    );

    expect(lastNodeSocket().url.toString()).toBe(customURL.toString());
    expect(lastNodeSocket().options).toMatchObject({
      handshakeTimeout: 4321,
      headers: { Authorization: 'Bearer test-key', 'X-Custom': 'value' },
    });
    expect(realtime.url).not.toBe(customURL);
    expect(realtime.url.searchParams.has('model')).toBe(false);
  });

  test('rejects a malformed custom URL before opening a socket', () => {
    expect(
      () =>
        new StableNodeRealtime(
          { model: 'gpt-realtime', buildRealtimeURL: () => 'not a valid URL' as unknown as URL },
          createClient(),
        ),
    ).toThrow();
    expect(nodeSocketConstructor).not.toHaveBeenCalled();
  });

  test('preserves custom URLs and ws options when resolving a rotating credential', async () => {
    const customURL = new URL('wss://sap.example.com/custom?existing=value');

    const realtime = await StableNodeRealtime.create(
      createClient(async () => 'rotating-key'),
      {
        model: 'gpt-realtime',
        buildRealtimeURL: () => customURL,
        options: { headers: { 'X-Custom': 'value' } },
      },
    );

    expect(lastNodeSocket().url.toString()).toBe(customURL.toString());
    expect(lastNodeSocket().options.headers).toMatchObject({
      Authorization: 'Bearer rotating-key',
      'X-Custom': 'value',
    });
    expect(realtime.url.searchParams.has('model')).toBe(false);
  });

  test('preserves custom Azure URLs, API-key authentication, and ws options', async () => {
    const client = createAzureClient({ deployment: 'configured' });
    const customURL = new URL('wss://sap.example.com/azure/custom?existing=value');
    const customBuilder = vi.fn(() => customURL);

    await StableNodeRealtime.azure(client, {
      deploymentName: 'override',
      buildRealtimeURL: customBuilder,
      options: { handshakeTimeout: 4321, headers: { 'X-Custom': 'value' } },
    });
    const socket = lastNodeSocket();

    expect(customBuilder).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ model: 'override', buildRealtimeURL: customBuilder }),
    );
    expect(socket.url.toString()).toBe(customURL.toString());
    expect(socket.url.searchParams.has('model')).toBe(false);
    expect(socket.url.searchParams.has('deployment')).toBe(false);
    expect(socket.options).toMatchObject({
      handshakeTimeout: 4321,
      headers: { 'api-key': 'azure-key', 'X-Custom': 'value' },
    });
    expect(socket.options.headers).not.toHaveProperty('Authorization');
  });

  test('preserves custom Azure URLs and authenticates token providers with a bearer header', async () => {
    const customURL = new URL('wss://sap.example.com/azure/custom?existing=value');

    await StableNodeRealtime.azure(createAzureClient({ deployment: 'configured', tokenProvider: true }), {
      buildRealtimeURL: () => customURL,
    });
    const socket = lastNodeSocket();

    expect(socket.url.toString()).toBe(customURL.toString());
    expect(socket.url.searchParams.has('model')).toBe(false);
    expect(socket.options.headers).toMatchObject({ Authorization: 'Bearer azure-token' });
    expect(socket.options.headers).not.toHaveProperty('api-key');
  });

  test('requires an Azure deployment before invoking a custom builder', async () => {
    const customBuilder = vi.fn(() => new URL('wss://sap.example.com/realtime'));

    await expect(
      StableNodeRealtime.azure(createAzureClient(), { buildRealtimeURL: customBuilder }),
    ).rejects.toThrow('No deployment name provided');
    expect(customBuilder).not.toHaveBeenCalled();
    expect(nodeSocketConstructor).not.toHaveBeenCalled();
  });
});
