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
const confidentialPayload = 'CONFIDENTIAL_REALTIME_CUSTOMER_DATA';
const invalidFrameMessage = 'Realtime WebSocket event must be an object with a string type.';

const malformedFrames = [
  {
    name: 'a noncoercible object discriminator',
    frame: { type: { toString: null, valueOf: null }, transcript: confidentialPayload },
  },
  {
    name: 'an array discriminator',
    frame: { type: ['response.created'], transcript: confidentialPayload },
  },
  {
    name: 'a null discriminator',
    frame: { type: null, transcript: confidentialPayload },
  },
  {
    name: 'a numeric discriminator',
    frame: { type: 42, transcript: confidentialPayload },
  },
  {
    name: 'a boolean discriminator',
    frame: { type: true, transcript: confidentialPayload },
  },
  {
    name: 'a missing discriminator',
    frame: { transcript: confidentialPayload },
  },
  {
    name: 'a null frame',
    frame: null,
  },
  {
    name: 'an array frame',
    frame: [{ type: 'response.created', transcript: confidentialPayload }],
  },
  {
    name: 'a string frame',
    frame: confidentialPayload,
  },
  {
    name: 'a numeric frame',
    frame: 42,
  },
  {
    name: 'a zero frame',
    frame: 0,
  },
  {
    name: 'a false frame',
    frame: false,
  },
  {
    name: 'an empty-string frame',
    frame: '',
  },
  {
    name: 'a boolean frame',
    frame: true,
  },
] as const;

function dispatchRawFrame(socket: FakeSocket, transport: 'native' | 'node', frame: string): void {
  socket.dispatch('message', transport === 'native' ? { data: frame } : frame);
}

function dispatchFrame(socket: FakeSocket, transport: 'native' | 'node', frame: unknown): void {
  dispatchRawFrame(socket, transport, JSON.stringify(frame));
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
])('$name malformed Realtime frames', ({ Realtime, RealtimeError, transport }) => {
  function connect() {
    const realtime = new Realtime(
      { model: 'gpt-realtime' },
      new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/' }),
    );

    return { realtime, socket: realtime.socket as unknown as FakeSocket };
  }

  test.each(malformedFrames)('safely rejects $name', ({ frame }) => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();

    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);

    expect(() => dispatchFrame(socket, transport, frame)).not.toThrow();
    expect(events).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toBe('could not parse websocket event');
    expect(error.event_id).toBeUndefined();
    expect(error.error).toBeUndefined();
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.cause.message).toBe(invalidFrameMessage);
    expect(error.message).not.toContain(confidentialPayload);
    expect(error.cause.message).not.toContain(confidentialPayload);
  });

  test.each(['', 'future.unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'preserves the valid string discriminator %s',
    (type) => {
      const { realtime, socket } = connect();
      const events = vi.fn();
      const typed = vi.fn();
      const errors = vi.fn();
      const event = { type, id: 'evt_valid' };

      onRealtimeEvent(realtime, 'event', events);
      onRealtimeEvent(realtime, type, typed);
      onRealtimeEvent(realtime, 'error', errors);

      expect(() => dispatchFrame(socket, transport, event)).not.toThrow();
      expect(events).toHaveBeenCalledWith(event);
      expect(typed).toHaveBeenCalledWith(event);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  test('rejects a discriminator inherited from the parsed event prototype', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();

    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);
    vi.spyOn(JSON, 'parse').mockReturnValueOnce(Object.create({ type: 'response.created' }));

    expect(() => dispatchRawFrame(socket, transport, '{}')).not.toThrow();
    expect(events).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toBe('could not parse websocket event');
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.cause.message).toBe(invalidFrameMessage);
  });

  test('preserves the error caused by an unreadable transport frame', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();
    const frameFailure = new Error('frame could not be decoded');
    const frame = {
      toString: () => {
        throw frameFailure;
      },
    };

    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);

    expect(() => socket.dispatch('message', transport === 'native' ? { data: frame } : frame)).not.toThrow();
    expect(events).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toBe('could not parse websocket event');
    expect(error.cause).toBe(frameFailure);
  });

  test('preserves the existing malformed JSON error path', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();

    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);

    expect(() => dispatchRawFrame(socket, transport, '{invalid')).not.toThrow();
    expect(events).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toBe('could not parse websocket event');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  test('preserves normal server error events and metadata', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();
    const event = {
      type: 'error',
      event_id: 'evt_server',
      error: {
        message: 'request rejected',
        code: 'invalid_request',
        param: null,
        type: 'invalid_request_error',
        event_id: 'evt_request',
      },
    };

    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);

    expect(() => dispatchFrame(socket, transport, event)).not.toThrow();
    expect(events).toHaveBeenCalledWith(event);
    expect(errors).toHaveBeenCalledTimes(1);

    const [[error] = []] = errors.mock.calls;
    expect(error).toBeInstanceOf(RealtimeError);
    expect(error.message).toBe(
      'request rejected code=invalid_request param=null type=invalid_request_error event_id=evt_request',
    );
    expect(error.event_id).toBe('evt_server');
    expect(error.error).toEqual(event.error);
  });

  test('preserves exceptions thrown by valid event listeners', () => {
    const { realtime, socket } = connect();
    const listenerError = new Error('intentional listener failure');

    onRealtimeEvent(realtime, 'event', () => {
      throw listenerError;
    });

    expect(() => dispatchFrame(socket, transport, { type: 'response.created' })).toThrow(listenerError);
  });
});
