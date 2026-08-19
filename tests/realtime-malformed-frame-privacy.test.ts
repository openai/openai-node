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
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface RealtimeFailure {
  message: string;
  stack?: string | undefined;
  cause?: unknown;
  error?: unknown;
  event_id?: string | undefined;
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
const sensitiveFrames = [
  { name: 'an API credential', value: 'sk-private-91a7' },
  { name: 'a patient identifier', value: 'patient-123-45-6789' },
  { name: 'a private voice transcript', value: 'private-voice-91a7' },
] as const;
const privateSyntaxMessage = 'Could not parse Realtime WebSocket event data as JSON.';

function onRealtimeEvent(realtime: unknown, event: string, listener: Listener): void {
  (realtime as { on: (event: string, listener: Listener) => unknown }).on(event, listener);
}

function dispatchFrame(socket: FakeSocket, transport: 'native' | 'node', data: unknown): void {
  socket.dispatch('message', transport === 'native' ? { data } : data);
}

function dispatchSensitiveFrame(
  socket: FakeSocket,
  transport: 'native' | 'node',
  value: string,
): SyntaxError {
  const parseJSON = JSON.parse;
  let original: SyntaxError | undefined;

  vi.spyOn(JSON, 'parse').mockImplementationOnce((input: string) => {
    try {
      return parseJSON(input);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      original = error;
      throw error;
    }
  });

  dispatchFrame(socket, transport, value);

  if (!original) {
    throw new Error('The sensitive frame did not produce a JSON syntax error.');
  }

  expect(original.message).toContain(value);
  expect(original.stack).toContain(value);
  return original;
}

function expectPrivateFailure(
  failure: RealtimeFailure,
  secret: string,
  original: SyntaxError,
  unhandled = false,
): void {
  if (unhandled) {
    expect(failure.message).toContain('could not parse websocket event');
    expect(failure.message).toContain('bind an `error` callback');
  } else {
    expect(failure.message).toBe('could not parse websocket event');
  }

  expect(failure.error).toBeUndefined();
  expect(failure.event_id).toBeUndefined();
  expect(failure.cause).toBeInstanceOf(SyntaxError);
  expect(failure.cause).not.toBe(original);

  const cause = failure.cause as SyntaxError & { cause?: unknown };
  expect(cause.message).toBe(privateSyntaxMessage);
  expect(cause.cause).toBeUndefined();

  for (const value of [failure.message, failure.stack ?? '', cause.message, cause.stack ?? '']) {
    expect(value).not.toContain(secret);
  }
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
])('$name malformed-frame diagnostic privacy', ({ Realtime, RealtimeError, transport }) => {
  function connect() {
    const realtime = new Realtime(
      { model: 'gpt-realtime' },
      new OpenAI({ apiKey: 'safe-client-key', baseURL: 'https://example.com/v1/' }),
    );

    return { realtime, socket: realtime.socket as unknown as FakeSocket };
  }

  test.each(sensitiveFrames)(
    'never exposes $name through registered error listeners',
    ({ value: secret }) => {
      const { realtime, socket } = connect();
      const errors = vi.fn();
      const events = vi.fn();
      onRealtimeEvent(realtime, 'error', errors);
      onRealtimeEvent(realtime, 'event', events);

      const original = dispatchSensitiveFrame(socket, transport, secret);

      expect(events).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(1);

      const [[failure] = []] = errors.mock.calls;
      expect(failure).toBeInstanceOf(RealtimeError);
      expectPrivateFailure(failure, secret, original);
    },
  );

  test.each(sensitiveFrames)(
    'never exposes $name through unhandled error rejections',
    ({ value: secret }) => {
      const { socket } = connect();
      const reject = vi.spyOn(Promise, 'reject').mockReturnValue(Promise.resolve() as Promise<never>);

      const original = dispatchSensitiveFrame(socket, transport, secret);

      expect(reject).toHaveBeenCalledTimes(1);
      const [[failure] = []] = reject.mock.calls;
      expect(failure).toBeInstanceOf(RealtimeError);
      expectPrivateFailure(failure as RealtimeFailure, secret, original, true);
    },
  );

  test('preserves the exact error caused by an unreadable transport frame', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const frameFailure = new Error('frame could not be decoded');
    onRealtimeEvent(realtime, 'error', errors);

    dispatchFrame(socket, transport, {
      toString: () => {
        throw frameFailure;
      },
    });

    expect(errors).toHaveBeenCalledTimes(1);
    const [[failure] = []] = errors.mock.calls;
    expect(failure.message).toBe('could not parse websocket event');
    expect(failure.cause).toBe(frameFailure);
  });

  test('preserves the exact SyntaxError caused by an unreadable transport frame', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const frameFailure = new SyntaxError('frame contains an invalid transport byte sequence');
    onRealtimeEvent(realtime, 'error', errors);

    dispatchFrame(socket, transport, {
      toString: () => {
        throw frameFailure;
      },
    });

    expect(errors).toHaveBeenCalledTimes(1);
    const [[failure] = []] = errors.mock.calls;
    expect(failure).toBeInstanceOf(RealtimeError);
    expect(failure.message).toBe('could not parse websocket event');
    expect(failure.cause).toBe(frameFailure);
  });

  test('preserves unreadable transport SyntaxError causes in unhandled rejections', () => {
    const { socket } = connect();
    const frameFailure = new SyntaxError('frame contains an invalid transport byte sequence');
    const reject = vi.spyOn(Promise, 'reject').mockReturnValue(Promise.resolve() as Promise<never>);

    dispatchFrame(socket, transport, {
      toString: () => {
        throw frameFailure;
      },
    });

    expect(reject).toHaveBeenCalledTimes(1);
    const [[failure] = []] = reject.mock.calls;
    expect(failure).toBeInstanceOf(RealtimeError);
    expect(failure.message).toContain('could not parse websocket event');
    expect(failure.cause).toBe(frameFailure);
  });

  test('preserves safe invalid-discriminator TypeError causes', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    onRealtimeEvent(realtime, 'error', errors);

    dispatchFrame(socket, transport, JSON.stringify({ type: null, transcript: 'private-voice-91a7' }));

    expect(errors).toHaveBeenCalledTimes(1);
    const [[failure] = []] = errors.mock.calls;
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect(failure.cause.message).toBe('Realtime WebSocket event must be an object with a string type.');
  });

  test('preserves SyntaxError identity outside malformed-frame parsing', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const transportFailure = new SyntaxError('transport failed before send');
    socket.send.mockImplementationOnce(() => {
      throw transportFailure;
    });
    onRealtimeEvent(realtime, 'error', errors);

    realtime.send({ type: 'response.create' });

    expect(errors).toHaveBeenCalledTimes(1);
    const [[failure] = []] = errors.mock.calls;
    expect(failure.message).toBe('could not send data');
    expect(failure.cause).toBe(transportFailure);
  });

  test('preserves normal server error data and event identifiers', () => {
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

    dispatchFrame(socket, transport, JSON.stringify(event));

    expect(events).toHaveBeenCalledWith(event);
    expect(errors).toHaveBeenCalledTimes(1);
    const [[failure] = []] = errors.mock.calls;
    expect(failure).toBeInstanceOf(RealtimeError);
    expect(failure.message).toBe(
      'request rejected code=invalid_request param=null type=invalid_request_error event_id=evt_request',
    );
    expect(failure.event_id).toBe('evt_server');
    expect(failure.error).toEqual(event.error);
  });

  test('continues dispatching valid events after a sanitized malformed frame', () => {
    const { realtime, socket } = connect();
    const errors = vi.fn();
    const events = vi.fn();
    const event = { type: 'response.created', id: 'evt_valid' };
    onRealtimeEvent(realtime, 'error', errors);
    onRealtimeEvent(realtime, 'event', events);

    dispatchSensitiveFrame(socket, transport, 'patient-123-45-6789');
    dispatchFrame(socket, transport, JSON.stringify(event));

    expect(errors).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith(event);
  });
});
