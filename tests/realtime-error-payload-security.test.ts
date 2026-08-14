import { vi } from 'vitest';

import OpenAI from 'openai';
import { OpenAIRealtimeError as StableRealtimeError } from 'openai/realtime';
import { OpenAIRealtimeWebSocket as StableNativeRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeError as BetaRealtimeError } from 'openai/beta/realtime';
import { OpenAIRealtimeWebSocket as BetaNativeRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';

type Listener = (event: any) => void;

interface FakeSocket {
  dispatch: (event: string, value: unknown) => void;
}

vi.mock('ws', () => {
  function FakeNodeSocket() {
    const listeners = new Map<string, Listener>();

    return {
      on: (event: string, listener: Listener) => listeners.set(event, listener),
      send: vi.fn(),
      close: vi.fn(),
      dispatch: (event: string, value: unknown) => listeners.get(event)?.(value),
    };
  }

  return { WebSocket: FakeNodeSocket };
});

class FakeNativeSocket implements FakeSocket {
  private readonly listeners = new Map<string, Listener>();

  readonly send = vi.fn();
  readonly close = vi.fn();

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, listener);
  }

  dispatch(event: string, value: unknown): void {
    this.listeners.get(event)?.(value);
  }
}

const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

const errorFields = ['message', 'code', 'param', 'type', 'event_id'] as const;

function serverError(overrides: Record<string, unknown> = {}) {
  return {
    type: 'error',
    event_id: 'evt_server',
    error: {
      message: 'request rejected',
      code: 'invalid_request',
      param: null,
      type: 'invalid_request_error',
      event_id: 'evt_request',
      ...overrides,
    },
  };
}

function dispatchFrame(socket: FakeSocket, transport: 'native' | 'node', frame: object): void {
  const data = JSON.stringify(frame);
  socket.dispatch('message', transport === 'native' ? { data } : data);
}

function onRealtimeEvent(realtime: unknown, event: string, listener: Listener): void {
  (realtime as { on: (event: string, listener: Listener) => unknown }).on(event, listener);
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeNativeSocket,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();

  if (originalWebSocket) {
    Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
  } else {
    Reflect.deleteProperty(globalThis, 'WebSocket');
  }
});

describe.each([
  {
    name: 'stable native',
    Realtime: StableNativeRealtime,
    RealtimeError: StableRealtimeError,
    transport: 'native' as const,
  },
  {
    name: 'stable Node',
    Realtime: StableNodeRealtime,
    RealtimeError: StableRealtimeError,
    transport: 'node' as const,
  },
  {
    name: 'beta native',
    Realtime: BetaNativeRealtime,
    RealtimeError: BetaRealtimeError,
    transport: 'native' as const,
  },
  {
    name: 'beta Node',
    Realtime: BetaNodeRealtime,
    RealtimeError: BetaRealtimeError,
    transport: 'node' as const,
  },
])('$name Realtime error payload security', ({ Realtime, RealtimeError, transport }) => {
  function connect() {
    const realtime = new Realtime(
      { model: 'gpt-realtime' },
      new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' }),
    );

    return { realtime, socket: realtime.socket as unknown as FakeSocket };
  }

  test.each(errorFields)('delivers a noncoercible JSON %s without throwing', (field) => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();
    const value = { toString: null, valueOf: null };
    const event = serverError({ [field]: value });

    onRealtimeEvent(realtime, 'event', events);
    onRealtimeEvent(realtime, 'error', errors);

    expect(() => dispatchFrame(socket, transport, event)).not.toThrow();
    expect(events).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith(event);
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.name).toBe('OpenAIRealtimeError');
    expect(error.message).toContain('[unserializable error value]');
    expect(error.event_id).toBe('evt_server');
    expect(error.error).toEqual(event.error);
    expect(error.error[field]).toEqual(value);
  });

  test('preserves the exact formatting of valid server errors', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const event = serverError();

    onRealtimeEvent(realtime, 'error', errors);
    dispatchFrame(socket, transport, event);

    expect(errors).toHaveBeenCalledTimes(1);
    const [[error] = []] = errors.mock.calls;
    expect(error).toMatchObject({
      name: 'OpenAIRealtimeError',
      message:
        'request rejected code=invalid_request param=null type=invalid_request_error event_id=evt_request',
      event_id: 'evt_server',
      error: event.error,
    });
  });

  test.each([
    { label: 'null', value: null, formatted: 'null' },
    { label: 'missing', value: undefined, formatted: 'undefined' },
    { label: 'number', value: 429, formatted: '429' },
    { label: 'ordinary nested JSON', value: { nested: { toString: null } }, formatted: '[object Object]' },
  ])('preserves existing formatting for a $label error value', ({ value, formatted }) => {
    const { realtime, socket } = connect();
    const errors = vi.fn();

    onRealtimeEvent(realtime, 'error', errors);
    dispatchFrame(socket, transport, serverError({ message: value }));

    expect(errors).toHaveBeenCalledTimes(1);
    const [[error] = []] = errors.mock.calls;
    expect(error.message).toBe(
      `${formatted} code=invalid_request param=null type=invalid_request_error event_id=evt_request`,
    );
  });

  test('handles nested noncoercible JSON without serializing or changing its metadata', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const nested = {
      toString: { message: { toString: null, valueOf: null } },
      valueOf: { nested: [{ toString: null, valueOf: null }] },
    };
    const event = serverError({ message: nested, code: nested, event_id: nested });

    onRealtimeEvent(realtime, 'error', errors);

    expect(() => dispatchFrame(socket, transport, event)).not.toThrow();
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error.message).toBe(
      '[unserializable error value] code=[unserializable error value] param=null type=invalid_request_error event_id=[unserializable error value]',
    );
    expect(error.error).toEqual(event.error);
    expect(error.event_id).toBe(event.event_id);
  });

  test('retains asynchronous rejection for an unhandled malformed server error', () => {
    const { socket } = connect();
    const reject = vi.spyOn(Promise, 'reject').mockReturnValue(Promise.resolve() as Promise<never>);

    expect(() =>
      dispatchFrame(socket, transport, serverError({ message: { toString: null, valueOf: null } })),
    ).not.toThrow();
    expect(reject).toHaveBeenCalledTimes(1);

    const [[error] = []] = reject.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toContain('[unserializable error value]');
    expect(error.message).toContain('bind an `error` callback');
    expect(error.event_id).toBe('evt_server');
  });

  test('does not swallow exceptions thrown by registered error listeners', () => {
    const { realtime, socket } = connect();
    const listenerError = new Error('application error listener failed');

    onRealtimeEvent(realtime, 'error', () => {
      throw listenerError;
    });

    expect(() =>
      dispatchFrame(socket, transport, serverError({ message: { toString: null, valueOf: null } })),
    ).toThrow(listenerError);
  });
});
