import { vi } from 'vitest';

import { EventEmitter, getEventListeners } from 'node:events';
import { BrowserWebSocket } from 'openai/internal/ws-adapter-browser';
import { NodeWebSocket } from 'openai/internal/ws-adapter-node';
import { ReadyState } from 'openai/internal/ws-adapter';
import type { WebSocketLike } from 'openai/internal/ws-adapter';

interface AdapterHarness {
  adapter: WebSocketLike;
  emitMessage: (message: string) => void;
  emitOpen: () => void;
  emitClose: (code: number, reason: string) => void;
  emitError: (error: Error) => void;
  platformListeners: (event: string) => readonly unknown[];
}

function createNodeHarness(): AdapterHarness {
  // oxlint-disable-next-line unicorn/prefer-event-target -- Exercise real EventEmitter snapshot/removal semantics.
  const socket = Object.assign(new EventEmitter(), {
    readyState: ReadyState.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  });
  const adapter = new NodeWebSocket(socket as unknown as ConstructorParameters<typeof NodeWebSocket>[0]);

  return {
    adapter,
    emitMessage: (message) => {
      socket.emit('message', Buffer.from(message), false);
    },
    emitOpen: () => {
      socket.emit('open');
    },
    emitClose: (code, reason) => {
      socket.emit('close', code, Buffer.from(reason));
    },
    emitError: (error) => {
      socket.emit('error', error);
    },
    platformListeners: (event) => getEventListeners(socket, event),
  };
}

function createBrowserHarness(): AdapterHarness {
  const socket = Object.assign(new EventTarget(), {
    readyState: ReadyState.OPEN,
    binaryType: 'blob',
    send: vi.fn(),
    close: vi.fn(),
  });
  const adapter = new BrowserWebSocket(socket);

  return {
    adapter,
    emitMessage: (message) => {
      socket.dispatchEvent(Object.assign(new Event('message'), { data: message }));
    },
    emitOpen: () => {
      socket.dispatchEvent(new Event('open'));
    },
    emitClose: (code, reason) => {
      socket.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    },
    emitError: (error) => {
      socket.dispatchEvent(Object.assign(new Event('error'), { error }));
    },
    platformListeners: (event) => getEventListeners(socket, event),
  };
}

function listenerBookkeeping(adapter: WebSocketLike): Map<string, Map<unknown, unknown>> {
  return (adapter as unknown as { _listenerMap: Map<string, Map<unknown, unknown>> })._listenerMap;
}

const adapterFactories = [
  ['NodeWebSocket', createNodeHarness],
  ['BrowserWebSocket', createBrowserHarness],
] as const;

describe.each(adapterFactories)('%s listener lifecycle', (_name, createHarness) => {
  test('removes duplicate regular subscriptions individually without orphaning a platform listener', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter.on('message', listener);
    adapter.on('message', listener);

    expect(platformListeners('message')).toHaveLength(2);
    emitMessage('first');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'first', false);
    expect(listener).toHaveBeenNthCalledWith(2, 'first', false);

    adapter.off('message', listener);
    expect(platformListeners('message')).toHaveLength(1);
    emitMessage('second');
    expect(listener).toHaveBeenCalledTimes(3);

    adapter.off('message', listener);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);

    emitMessage('third');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('removes the most recent matching regular registration while preserving listener order', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const calls: string[] = [];
    const repeated = vi.fn((message: string) => {
      calls.push(`repeated:${message}`);
    });
    const middle = vi.fn((message: string) => {
      calls.push(`middle:${message}`);
    });

    adapter.on('message', repeated);
    adapter.on('message', middle);
    adapter.on('message', repeated);
    adapter.off('message', repeated);

    emitMessage('first');

    expect(calls).toEqual(['repeated:first', 'middle:first']);
    expect(platformListeners('message')).toHaveLength(2);

    adapter.off('message', repeated);
    adapter.off('message', middle);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test.each([
    ['regular then one-time', 'on', 'once', 2],
    ['one-time then regular', 'once', 'on', 1],
  ] as const)(
    'off removes only the newest subscription when registration order is %s',
    (_description, first, second, expectedCalls) => {
      const { adapter, emitMessage, platformListeners } = createHarness();
      const listener = vi.fn();

      adapter[first]('message', listener);
      adapter[second]('message', listener);
      adapter.off('message', listener);

      expect(platformListeners('message')).toHaveLength(1);
      emitMessage('first');
      emitMessage('second');

      expect(listener).toHaveBeenCalledTimes(expectedCalls);

      adapter.off('message', listener);
      expect(platformListeners('message')).toHaveLength(0);
      expect(listenerBookkeeping(adapter)).toHaveLength(0);
    },
  );

  test('invokes every duplicate one-time subscription exactly once across repeated events', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter.once('message', listener);
    adapter.once('message', listener);
    expect(platformListeners('message')).toHaveLength(2);

    emitMessage('first');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'first', false);
    expect(listener).toHaveBeenNthCalledWith(2, 'first', false);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);

    emitMessage('second');
    emitMessage('third');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['regular then one-time', 'on', 'once'],
    ['one-time then regular', 'once', 'on'],
  ] as const)('preserves the regular subscription after %s registrations', (_description, first, second) => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter[first]('message', listener);
    adapter[second]('message', listener);

    emitMessage('first');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(platformListeners('message')).toHaveLength(1);

    emitMessage('second');
    emitMessage('third');
    expect(listener.mock.calls.map(([message]) => message)).toEqual(['first', 'first', 'second', 'third']);

    adapter.off('message', listener);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('removes the exact one-time wrapper before reentrant dispatch with the same regular callback', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();
    let emittedNestedMessage = false;

    listener.mockImplementation((message: string) => {
      if (message === 'first' && !emittedNestedMessage) {
        emittedNestedMessage = true;
        expect(platformListeners('message')).toHaveLength(1);
        emitMessage('nested');
      }
    });

    adapter.once('message', listener);
    adapter.on('message', listener);

    emitMessage('first');
    expect(listener.mock.calls.map(([message]) => message)).toEqual(['first', 'nested', 'first']);
    expect(platformListeners('message')).toHaveLength(1);

    emitMessage('later');
    expect(listener.mock.calls.map(([message]) => message)).toEqual(['first', 'nested', 'first', 'later']);

    adapter.off('message', listener);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('does not invoke a one-time registration twice when another one-time callback reenters', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();
    let emittedNestedMessage = false;

    listener.mockImplementation((message: string) => {
      if (message === 'first' && !emittedNestedMessage) {
        emittedNestedMessage = true;
        emitMessage('nested');
      }
    });

    adapter.once('message', listener);
    adapter.once('message', listener);
    emitMessage('first');

    expect(listener.mock.calls.map(([message]) => message)).toEqual(['first', 'nested']);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);

    emitMessage('later');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('cleans up a one-time subscription before its callback registers itself again', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const listener = vi.fn();

    listener.mockImplementation((message: string) => {
      expect(platformListeners('message')).toHaveLength(0);
      expect(listenerBookkeeping(adapter).has('message')).toBe(false);

      if (message === 'first') {
        adapter.once('message', listener);
        emitMessage('nested');
      }
    });

    adapter.once('message', listener);
    emitMessage('first');
    emitMessage('later');

    expect(listener.mock.calls.map(([message]) => message)).toEqual(['first', 'nested']);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('keeps registrations isolated by event name and normalizes close arguments', () => {
    const { adapter, emitMessage, emitClose, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter.on('message', listener);
    adapter.on('close', listener);
    adapter.on('close', listener);
    adapter.off('message', listener);

    expect(platformListeners('message')).toHaveLength(0);
    expect(platformListeners('close')).toHaveLength(2);
    emitMessage('ignored');
    emitClose(1000, 'finished');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 1000, 'finished');
    expect(listener).toHaveBeenNthCalledWith(2, 1000, 'finished');

    adapter.off('close', listener);
    adapter.off('close', listener);
    expect(platformListeners('close')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('keeps callback identity intact for pass-through events', () => {
    const { adapter, emitOpen, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter.on('open', listener);

    expect(platformListeners('open')).toEqual([listener]);
    emitOpen();
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.off('open', listener);
    expect(platformListeners('open')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('ignores unknown callbacks and events without corrupting active registrations', () => {
    const { adapter, emitMessage, platformListeners } = createHarness();
    const active = vi.fn();
    const unknown = vi.fn();

    adapter.off('missing', unknown);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);

    adapter.on('message', active);
    adapter.off('missing', active);
    adapter.off('message', unknown);

    expect(platformListeners('message')).toHaveLength(1);
    emitMessage('first');
    expect(active).toHaveBeenCalledWith('first', false);
    expect(unknown).not.toHaveBeenCalled();

    adapter.off('message', active);
    adapter.off('message', active);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });

  test('preserves normalized error listeners while removing only their one-time registration', () => {
    const { adapter, emitError, platformListeners } = createHarness();
    const listener = vi.fn();

    adapter.on('error', listener);
    adapter.once('error', listener);
    emitError(new Error('socket failed'));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([error]) => (error as Error).message)).toEqual([
      'socket failed',
      'socket failed',
    ]);
    expect(platformListeners('error')).toHaveLength(1);

    adapter.off('error', listener);
    expect(platformListeners('error')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });
});

describe('browser-native pass-through registration', () => {
  test('preserves EventTarget deduplication and original callback identity for duplicate open listeners', () => {
    const { adapter, emitOpen, platformListeners } = createBrowserHarness();
    const listener = vi.fn();

    adapter.on('open', listener);
    adapter.on('open', listener);

    expect(platformListeners('open')).toEqual([listener]);
    emitOpen();
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.off('open', listener);
    expect(platformListeners('open')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
    adapter.off('open', listener);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);
  });
});

describe('NodeWebSocket one-time listener failures', () => {
  test('removes and forgets a one-time registration before its callback throws', () => {
    const { adapter, emitMessage, platformListeners } = createNodeHarness();
    const failure = new Error('listener failed');
    const listener = vi.fn(() => {
      throw failure;
    });

    adapter.once('message', listener);

    expect(() => emitMessage('first')).toThrow(failure);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(platformListeners('message')).toHaveLength(0);
    expect(listenerBookkeeping(adapter)).toHaveLength(0);

    emitMessage('later');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
