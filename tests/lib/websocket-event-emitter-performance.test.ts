import { vi } from 'vitest';

import OpenAI from 'openai';
import { EventEmitter as CoreEventEmitter, InternalEventEmitter } from 'openai/core/EventEmitter';
import { EventEmitter as RealtimeEventEmitter } from 'openai/lib/EventEmitter';
import { OpenAIRealtimeWebSocket as StableBrowserRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaBrowserRealtime } from 'openai/beta/realtime/websocket';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

const WAITER_COUNT = 4096;

type Listener = (...args: any[]) => void;

interface FakeNodeSocket {
  readyState: number;
  on: (event: string, listener: Listener) => void;
  removeListener: (event: string, listener: Listener) => void;
  emit: (event: string, ...args: unknown[]) => void;
  send: () => void;
  close: () => void;
  terminate: () => void;
}

interface FakeBrowserSocket {
  addEventListener: (event: string, listener: Listener) => void;
  dispatch: (event: Record<string, unknown>) => void;
  send: () => void;
  close: () => void;
}

interface PublicWebSocket {
  on: (event: string, listener: Listener) => unknown;
  emitted: (event: string) => Promise<unknown>;
  socket: unknown;
}

interface WebSocketVariant {
  name: string;
  event: string;
  create: (client: OpenAI) => PublicWebSocket;
  dispatch: (connection: PublicWebSocket, event: Record<string, unknown>) => void;
}

interface AuditedEvents {
  value: (value: number) => void;
  other: (value: string) => void;
  pair: (value: string, index: number) => void;
  empty: () => void;
  error: (error: unknown) => void;
  __proto__: (value: number) => void;
}

type AuditedEventMap = AuditedEvents & Record<string, (...args: any[]) => void>;

interface AuditedEmitter {
  on: (event: keyof AuditedEvents, listener: Listener) => AuditedEmitter;
  once: (event: keyof AuditedEvents, listener: Listener) => AuditedEmitter;
  off: (event: keyof AuditedEvents, listener: Listener) => AuditedEmitter;
  emitted: (event: keyof AuditedEvents) => Promise<unknown>;
}

vi.mock('ws', () => {
  function WebSocket(): FakeNodeSocket {
    const listeners = new Map<string, Listener[]>();
    const socket: FakeNodeSocket = {
      readyState: 1,
      on(event, listener) {
        const registrations = listeners.get(event) ?? [];
        registrations.push(listener);
        listeners.set(event, registrations);
      },
      removeListener(event, listener) {
        const registrations = listeners.get(event);
        const index = registrations?.lastIndexOf(listener) ?? -1;
        if (registrations && index !== -1) {
          registrations.splice(index, 1);
        }
      },
      emit(event, ...args) {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args);
        }
      },
      send() {},
      close() {},
      terminate() {},
    };
    return socket;
  }

  return { WebSocket: vi.fn().mockImplementation(WebSocket) };
});

function createBrowserSocket(): FakeBrowserSocket {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(event: string, listener: Listener) {
      const registrations = listeners.get(event) ?? [];
      registrations.push(listener);
      listeners.set(event, registrations);
    },
    dispatch(event: Record<string, unknown>) {
      for (const listener of listeners.get('message') ?? []) {
        listener({ data: JSON.stringify(event) });
      }
    },
    send() {},
    close() {},
  };
}

function installBrowserSocket(): void {
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(createBrowserSocket));
}

function dispatchBrowser(connection: PublicWebSocket, event: Record<string, unknown>): void {
  (connection.socket as { dispatch: (value: Record<string, unknown>) => void }).dispatch(event);
}

function dispatchNodeRealtime(connection: PublicWebSocket, event: Record<string, unknown>): void {
  (connection.socket as FakeNodeSocket).emit('message', Buffer.from(JSON.stringify(event)));
}

function dispatchResponses(connection: PublicWebSocket, event: Record<string, unknown>): void {
  (connection.socket as { platformSocket: FakeNodeSocket }).platformSocket.emit(
    'message',
    Buffer.from(JSON.stringify(event)),
    false,
  );
}

const websocketVariants: WebSocketVariant[] = [
  {
    name: 'stable browser Realtime',
    event: 'response.done',
    create: (client) =>
      new StableBrowserRealtime({ model: 'gpt-realtime' }, client) as unknown as PublicWebSocket,
    dispatch: dispatchBrowser,
  },
  {
    name: 'beta browser Realtime',
    event: 'response.done',
    create: (client) =>
      new BetaBrowserRealtime({ model: 'gpt-realtime' }, client) as unknown as PublicWebSocket,
    dispatch: dispatchBrowser,
  },
  {
    name: 'stable Node Realtime',
    event: 'response.done',
    create: (client) =>
      new StableNodeRealtime({ model: 'gpt-realtime' }, client) as unknown as PublicWebSocket,
    dispatch: dispatchNodeRealtime,
  },
  {
    name: 'beta Node Realtime',
    event: 'response.done',
    create: (client) => new BetaNodeRealtime({ model: 'gpt-realtime' }, client) as unknown as PublicWebSocket,
    dispatch: dispatchNodeRealtime,
  },
  {
    name: 'stable Responses WebSocket',
    event: 'response.completed',
    create: (client) => new StableResponsesWS(client) as unknown as PublicWebSocket,
    dispatch: dispatchResponses,
  },
  {
    name: 'beta Responses WebSocket',
    event: 'response.completed',
    create: (client) => new BetaResponsesWS(client) as unknown as PublicWebSocket,
    dispatch: dispatchResponses,
  },
];

const emitterVariants = [
  { name: 'Realtime emitter', create: () => new RealtimeEventEmitter<AuditedEventMap>() },
  { name: 'Responses emitter', create: () => new CoreEventEmitter<AuditedEventMap>() },
  { name: 'Responses internal emitter', create: () => new InternalEventEmitter<AuditedEventMap>() },
] as const;

function measureListenerMovement(operation: () => void): {
  elementMoves: number;
  spliceCalls: number;
} {
  const originalSplice = Array.prototype.splice;
  const originalFilter = Array.prototype.filter;
  let elementMoves = 0;
  let spliceCalls = 0;

  function trackedSplice(this: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
    if (deleteCount === 1 && items.length === 0) {
      elementMoves += Math.max(this.length - start - deleteCount, 0);
      spliceCalls += 1;
    }
    if (deleteCount === undefined) {
      return Reflect.apply(originalSplice, this, [start]);
    }
    return originalSplice.call(this, start, deleteCount, ...items);
  }

  function trackedFilter(
    this: unknown[],
    predicate: (value: unknown, index: number, values: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    const result = originalFilter.call(this, predicate, thisArg);
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'splice', trackedSplice);
  Reflect.set(Array.prototype, 'filter', trackedFilter);
  try {
    operation();
  } finally {
    Reflect.set(Array.prototype, 'filter', originalFilter);
    Reflect.set(Array.prototype, 'splice', originalSplice);
  }

  return { elementMoves, spliceCalls };
}

function emit(emitter: AuditedEmitter, event: keyof AuditedEvents, ...values: unknown[]): void {
  (emitter as unknown as { _emit: (name: string, ...args: unknown[]) => void })._emit(event, ...values);
}

function hasListener(emitter: AuditedEmitter, event: keyof AuditedEvents): boolean | undefined {
  return (emitter as unknown as { _hasListener: (name: string) => boolean | undefined })._hasListener(event);
}

async function captureOutcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  installBrowserSocket();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(websocketVariants)('$name event waiters', ({ event, create, dispatch }) => {
  test.each(['success', 'error'] as const)(
    'settles 4,096 concurrent public waiters in linear time when %s arrives first',
    async (mode) => {
      const client = new OpenAI({ apiKey: 'synthetic-api-key', baseURL: 'https://example.test/v1' });
      const connection = create(client);
      const pending = Array.from({ length: WAITER_COUNT }, () => connection.emitted(event));
      const outcomes = pending.map(captureOutcome);
      const payload =
        mode === 'success'
          ? { type: event, response: { id: 'response_synthetic' } }
          : {
              type: 'error',
              error: { message: 'synthetic failure', code: 'synthetic', type: 'invalid_request_error' },
            };

      const { elementMoves, spliceCalls } = measureListenerMovement(() => dispatch(connection, payload));
      const settled = await Promise.all(outcomes);

      expect(settled).toHaveLength(WAITER_COUNT);
      if (mode === 'success') {
        expect(
          settled.every(
            (value) => typeof value === 'object' && value !== null && 'type' in value && value.type === event,
          ),
        ).toBe(true);
      } else {
        expect(settled.every((value) => value instanceof Error)).toBe(true);
      }
      expect(elementMoves).toBeLessThanOrEqual(WAITER_COUNT * 4);
      expect(spliceCalls).toBe(0);
    },
  );

  test.each(['success', 'error'] as const)(
    'settles the current %s event after an earlier public listener throws',
    async (mode) => {
      const client = new OpenAI({ apiKey: 'synthetic-api-key', baseURL: 'https://example.test/v1' });
      const connection = create(client);
      const failure = new Error('synthetic listener failure');
      const settled = vi.fn();
      connection.on(mode === 'success' ? event : 'error', () => {
        throw failure;
      });
      void connection.emitted(event).then(settled, settled);
      const payload =
        mode === 'success'
          ? { type: event, response: { id: 'current_response' } }
          : {
              type: 'error',
              error: { message: 'current failure', code: 'synthetic', type: 'invalid_request_error' },
            };

      expect(() => dispatch(connection, payload)).toThrow(failure);
      if (mode === 'error') {
        dispatch(connection, { type: event, response: { id: 'PRIVATE_FUTURE_EVENT' } });
      }
      await Promise.resolve();

      const expectedError = expect.objectContaining({ message: expect.stringContaining('current failure') });
      expect(settled.mock.calls).toEqual([[mode === 'success' ? payload : expectedError]]);
    },
  );
});

test.each([
  ['stable', StableResponsesWS],
  ['beta', BetaResponsesWS],
] as const)('%s Responses close settles after a listener throws', async (_version, WebSocket) => {
  const client = new OpenAI({ apiKey: 'synthetic-api-key', baseURL: 'https://example.test/v1' });
  const connection: {
    on: (event: 'close', listener: () => void) => unknown;
    emitted: (event: 'close') => Promise<unknown>;
    socket: StableResponsesWS['socket'];
  } = new WebSocket(client);
  const failure = new Error('synthetic close listener failure');
  const settled = vi.fn();
  connection.on('close', () => {
    throw failure;
  });
  void connection.emitted('close').then(settled, settled);
  const socket = connection.socket.platformSocket;

  expect(() => socket.emit('close', 1000, Buffer.from('complete'))).toThrow(failure);
  await Promise.resolve();

  expect(settled.mock.calls).toEqual([[[1000, 'complete', []]]]);
});

describe.each(emitterVariants)('$name listener compatibility', ({ create }) => {
  function createEmitter(): AuditedEmitter {
    return create() as unknown as AuditedEmitter;
  }

  test.each([undefined, false, new Error('first listener failure')] as const)(
    'preserves the first thrown value %s while settling later one-time listeners',
    async (firstFailure) => {
      const emitter = createEmitter();
      const laterFailure = new Error('later listener failure');
      const once = vi.fn();
      const settled = vi.fn();
      emitter.once('value', () => {
        throw firstFailure;
      });
      emitter.on('value', () => {
        throw laterFailure;
      });
      emitter.once('value', once);
      void emitter.emitted('value').then(settled, settled);
      let didThrow = false;
      let thrown: unknown = laterFailure;

      try {
        emit(emitter, 'value', 7);
      } catch (error) {
        didThrow = true;
        thrown = error;
      }
      await Promise.resolve();

      expect(didThrow).toBe(true);
      expect(thrown).toBe(firstFailure);
      expect(() => emit(emitter, 'value', 8)).toThrow(laterFailure);
      expect(once.mock.calls).toEqual([[7]]);
      expect(settled.mock.calls).toEqual([[7]]);
      expect(hasListener(emitter, 'error')).toBe(false);
    },
  );

  test('retains outer one-time listeners during nested same-event dispatch', () => {
    const emitter = createEmitter();
    const once = vi.fn();
    const failure = new Error('nested listener failure');
    emitter.on('value', (value: number) => {
      if (value === 1) {
        emit(emitter, 'value', 2);
        throw failure;
      }
    });
    emitter.once('value', once);

    expect(() => emit(emitter, 'value', 1)).toThrow(failure);

    expect(once.mock.calls).toEqual([[1]]);
  });

  test('retains observable public once and off hooks and immediate listener visibility', async () => {
    const emitter = createEmitter();
    const register = vi.spyOn(emitter, 'once');
    const remove = vi.spyOn(emitter, 'off');
    let errorListenerWhileDispatching: boolean | undefined;
    const pending = emitter.emitted('value');
    emitter.on('value', () => {
      errorListenerWhileDispatching = hasListener(emitter, 'error');
    });

    emit(emitter, 'value', 12);

    await expect(pending).resolves.toBe(12);
    expect(register).toHaveBeenCalledWith('error', expect.any(Function));
    expect(register).toHaveBeenCalledWith('value', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('error', expect.any(Function));
    expect(errorListenerWhileDispatching).toBe(false);
    expect(hasListener(emitter, 'other')).toBeUndefined();
    expect(hasListener(emitter, 'error')).toBe(false);
  });

  test.each(['value', 'error'] as const)(
    'retains detached %s listeners in the current dispatch snapshot',
    async (event) => {
      const emitter = createEmitter();
      const registrations = vi.spyOn(emitter, 'once');
      const failure = new Error('synthetic snapshot failure');
      emitter.on(event, () => {
        const callback = registrations.mock.calls.find(([name]) => name === event)?.[1];
        if (!callback) {
          throw new Error('Expected a captured emitted listener');
        }
        emitter.off(event, callback);
      });

      const pending = emitter.emitted('value');
      const settled = vi.fn();
      void pending.then(settled, settled);
      emit(emitter, event, event === 'error' ? failure : 8);
      await Promise.resolve();

      expect(settled).toHaveBeenCalledWith(event === 'error' ? failure : 8);
      expect(hasListener(emitter, event === 'error' ? 'value' : 'error')).toBe(false);
    },
  );

  test.each(['before', 'after'] as const)(
    'retains first-match removal when public once adds a duplicate %s its callback',
    async (order) => {
      const emitter = createEmitter();
      const originalOnce = emitter.once.bind(emitter);
      const registrations = vi.spyOn(emitter, 'once').mockImplementation((event, listener) => {
        if (event === 'value' && order === 'before') {
          emitter.on(event, listener);
        }
        const registered = originalOnce(event, listener);
        if (event === 'value' && order === 'after') {
          emitter.on(event, listener);
        }
        return registered;
      });

      const pending = emitter.emitted('value');
      const callback = registrations.mock.calls.find(([event]) => event === 'value')?.[1];
      if (!callback) {
        throw new Error('Expected a duplicated emitted listener');
      }
      emitter.off('value', callback);
      emit(emitter, 'value', 17);

      await expect(pending).resolves.toBe(17);
      expect(hasListener(emitter, 'value')).toBe(order === 'after');
      expect(hasListener(emitter, 'error')).toBe(false);
    },
  );

  test('retains snapshot order, nested errors, unrelated events, and duplicate user callbacks', async () => {
    const emitter = createEmitter();
    const duplicate = vi.fn();
    const order: string[] = [];
    emitter.on('value', duplicate);
    emitter.on('value', duplicate);
    emitter.on('value', () => {
      order.push('outer');
      emit(emitter, 'other', 'nested');
    });
    const value = emitter.emitted('value');
    const nested = emitter.emitted('other');

    emitter.off('value', duplicate);
    emit(emitter, 'value', 6);

    await expect(value).resolves.toBe(6);
    await expect(nested).resolves.toBe('nested');
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['outer']);
    expect(hasListener(emitter, 'error')).toBe(false);

    const failure = { reason: 'synthetic unknown error' };
    const rejected = emitter.emitted('pair');
    emit(emitter, 'error', failure);
    await expect(rejected).rejects.toBe(failure);
  });

  test('retains error identity, empty events, argument tuples, and prototype-like event names', async () => {
    const emitter = createEmitter();
    const reason = { reason: 'synthetic error' };
    const failure = emitter.emitted('error');
    emit(emitter, 'error', reason);
    await expect(failure).resolves.toBe(reason);

    const empty = emitter.emitted('empty');
    emit(emitter, 'empty');
    await expect(empty).resolves.toBeUndefined();

    const pair = emitter.emitted('pair');
    emit(emitter, 'pair', 'left', 9);
    await expect(pair).resolves.toEqual(['left', 9]);

    const prototype = emitter.emitted('__proto__');
    emit(emitter, '__proto__', 11);
    await expect(prototype).resolves.toBe(11);
    expect(hasListener(emitter, 'error')).toBe(false);
  });
});

test('the Responses internal emitter supports event maps without a declared error event', async () => {
  const emitter = new InternalEventEmitter<{ socketSwap: (value: number) => void }>();
  const pending = emitter.emitted('socketSwap');

  emitter._emit('socketSwap', 21);

  await expect(pending).resolves.toBe(21);
});
