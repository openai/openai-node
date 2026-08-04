import { vi, type Mock } from 'vitest';

import OpenAI, { AzureOpenAI } from 'openai';
import { OpenAIRealtimeWebSocket as StableBrowserRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaBrowserRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import * as WS from 'ws';

type Listener = (event: any) => void;

type FakeNodeSocket = {
  url: URL;
  options: { headers?: Record<string, string> };
  on: Mock;
  send: Mock;
  close: Mock;
  dispatch: (event: string, value: unknown) => void;
};

vi.mock('ws', () => ({
  WebSocket: vi.fn().mockImplementation(function (url: URL, options: FakeNodeSocket['options']) {
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

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
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

function createAzureClient(options: { tokenProvider?: boolean; deployment?: string } = {}): AzureOpenAI {
  return new AzureOpenAI({
    apiVersion: '2024-10-01-preview',
    baseURL: 'https://azure.example.com/openai/',
    ...(options.tokenProvider
      ? { azureADTokenProvider: async () => 'azure-token' }
      : { apiKey: 'azure-key' }),
    ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
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
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');

      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
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

    expect(lastBrowserSocket().url).toContain('api-key=azure-key');
    expect(lastBrowserSocket().protocols).not.toContain('openai-insecure-api-key.azure-key');
    expect(realtime.url.searchParams.get('api-key')).toBe('<REDACTED>');
  });

  test('places rotating Azure credentials in Authorization and redacts them', async () => {
    const realtime = await Realtime.azure(createAzureClient({ deployment: 'chat', tokenProvider: true }));

    expect(new URL(lastBrowserSocket().url).searchParams.get('Authorization')).toBe('Bearer azure-token');
    expect(realtime.url.searchParams.get('Authorization')).toBe('<REDACTED>');
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

    expect(lastNodeSocket().options.headers).toMatchObject({ 'api-key': 'azure-key' });
    expect(lastNodeSocket().options.headers).not.toHaveProperty('Authorization');
  });

  test('authenticates Azure token-provider sessions with a bearer header', async () => {
    await Realtime.azure(createAzureClient({ deployment: 'chat', tokenProvider: true }));

    expect(lastNodeSocket().options.headers).toMatchObject({ Authorization: 'Bearer azure-token' });
    expect(lastNodeSocket().options.headers).not.toHaveProperty('api-key');
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
