import { vi } from 'vitest';

import { EventEmitter } from 'node:events';
import { BrowserWebSocket } from 'openai/internal/ws-adapter-browser';
import { NodeWebSocket } from 'openai/internal/ws-adapter-node';
import { ReadyState } from 'openai/internal/ws-adapter';
import { flattenRawData, isRecoverableClose, SendQueue } from 'openai/internal/ws';

class FakeBrowserSocket {
  readyState = ReadyState.OPEN;
  binaryType = 'blob';
  readonly send = vi.fn();
  readonly close = vi.fn();
  readonly addEventListener = vi.fn((event: string, listener: (...args: any[]) => void) => {
    this.listeners.set(event, listener);
  });
  readonly removeEventListener = vi.fn((event: string) => {
    this.listeners.delete(event);
  });
  readonly listeners = new Map<string, (...args: any[]) => void>();

  emit(event: string, payload?: unknown) {
    this.listeners.get(event)?.(payload);
  }
}

class FakeNodeSocket extends EventEmitter {
  readyState = ReadyState.OPEN;
  readonly send = vi.fn();
  readonly close = vi.fn();
}

describe('BrowserWebSocket', () => {
  test('normalizes platform socket properties and forwards outbound operations', () => {
    const socket = new FakeBrowserSocket();
    const adapter = new BrowserWebSocket(socket as any);

    expect(socket.binaryType).toBe('arraybuffer');
    expect(adapter.platformSocket).toBe(socket);
    expect(adapter.readyState).toBe(ReadyState.OPEN);

    adapter.send('hello');
    adapter.close(1000, 'finished');

    expect(socket.send).toHaveBeenCalledWith('hello');
    expect(socket.close).toHaveBeenCalledWith(1000, 'finished');
  });

  test('normalizes text, binary, and close event arguments', () => {
    const socket = new FakeBrowserSocket();
    const adapter = new BrowserWebSocket(socket as any);
    const onMessage = vi.fn();
    const onClose = vi.fn();

    adapter.on('message', onMessage);
    socket.emit('message', { data: 'hello' });
    socket.emit('message', { data: new Uint8Array([1, 2]) });
    adapter.on('close', onClose);
    socket.emit('close', { code: 1006, reason: 'network interrupted' });

    expect(onMessage).toHaveBeenNthCalledWith(1, 'hello', false);
    expect(onMessage).toHaveBeenNthCalledWith(2, new Uint8Array([1, 2]), true);
    expect(onClose).toHaveBeenCalledWith(1006, 'network interrupted');
  });

  test.each([
    [{ message: 'explicit message' }, 'explicit message', undefined],
    [{ error: new Error('nested message') }, 'nested message', 'nested message'],
    [{}, 'WebSocket error', undefined],
  ])('normalizes browser error events', (event, message, cause) => {
    const socket = new FakeBrowserSocket();
    const adapter = new BrowserWebSocket(socket as any);
    const listener = vi.fn();
    adapter.on('error', listener);

    socket.emit('error', event);

    expect(listener).toHaveBeenCalledTimes(1);
    const error = listener.mock.calls[0]![0] as Error & { cause?: Error };
    expect(error.message).toBe(message);
    expect(error.cause?.message).toBe(cause);
  });

  test('forwards open listeners and removes regular and one-time listeners', () => {
    const socket = new FakeBrowserSocket();
    const adapter = new BrowserWebSocket(socket as any);
    const onOpen = vi.fn();
    const once = vi.fn();

    adapter.off('missing', onOpen);
    adapter.on('open', onOpen);
    socket.emit('open');
    adapter.off('open', () => {});
    adapter.off('open', onOpen);

    adapter.once('message', once);
    socket.emit('message', { data: 'first' });
    socket.emit('message', { data: 'second' });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith('first', false);
    expect(socket.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('NodeWebSocket', () => {
  test('forwards platform socket properties and outbound operations', () => {
    const socket = new FakeNodeSocket();
    const adapter = new NodeWebSocket(socket as any);

    expect(adapter.platformSocket).toBe(socket);
    expect(adapter.readyState).toBe(ReadyState.OPEN);

    adapter.send('hello');
    adapter.close(1001, 'going away');

    expect(socket.send).toHaveBeenCalledWith('hello');
    expect(socket.close).toHaveBeenCalledWith(1001, 'going away');
  });

  test.each([
    [Buffer.from('hello'), false, 'hello'],
    [[Buffer.from('hel'), Buffer.from('lo')], false, 'hello'],
    [Uint8Array.from([104, 105]).buffer, false, 'hi'],
    [Buffer.from([1, 2]), true, Buffer.from([1, 2])],
    [[Buffer.from([1]), Buffer.from([2])], true, Buffer.from([1, 2])],
    [Uint8Array.from([1, 2]).buffer, true, Buffer.from([1, 2])],
  ] as const)('normalizes ws message payloads', (data, isBinary, expected) => {
    const socket = new FakeNodeSocket();
    const adapter = new NodeWebSocket(socket as any);
    const listener = vi.fn();
    adapter.on('message', listener);

    socket.emit('message', data, isBinary);

    expect(listener).toHaveBeenCalledWith(expected, isBinary);
  });

  test('normalizes close reasons, preserves pass-through events, and removes listeners', () => {
    const socket = new FakeNodeSocket();
    const adapter = new NodeWebSocket(socket as any);
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const once = vi.fn();

    adapter.off('missing', onOpen);
    adapter.on('close', onClose);
    adapter.on('open', onOpen);
    adapter.off('open', () => {});
    socket.emit('close', 1006, Buffer.from('interrupted'));
    socket.emit('open');
    adapter.off('open', onOpen);
    socket.emit('open');

    adapter.once('message', once);
    socket.emit('message', Buffer.from('first'), false);
    socket.emit('message', Buffer.from('second'), false);

    expect(onClose).toHaveBeenCalledWith(1006, 'interrupted');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith('first', false);
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocket transport helpers', () => {
  test('flattens fragmented array views while preserving standalone payloads', () => {
    const first = new Uint16Array([0x0201]);
    const second = Uint8Array.from([3]);
    const standalone = Uint8Array.from([4]);

    expect(flattenRawData([first, second])).toEqual(new Uint8Array([1, 2, 3]));
    expect(flattenRawData(standalone)).toBe(standalone);
    expect(flattenRawData('text')).toBe('text');
  });

  test.each([
    [1000, false],
    [1001, true],
    [1002, false],
    [1003, false],
    [1005, true],
    [1006, true],
    [1007, false],
    [1008, false],
    [1009, false],
    [1010, false],
    [1011, true],
    [1012, true],
    [1013, true],
    [1015, true],
    [4999, false],
  ])('classifies close code %i as recoverable=%s', (code, expected) => {
    expect(isRecoverableClose(code)).toBe(expected);
  });

  test('snapshots ArrayBuffers and fragmented views when queueing raw messages', () => {
    const queue = new SendQueue(100);
    const bytes = Uint8Array.from([1, 2]);
    const buffer = Uint8Array.from([3, 4]).buffer;

    expect(queue.enqueueRaw(bytes)).toBe(true);
    expect(queue.enqueueRaw(buffer)).toBe(true);
    expect(queue.enqueueRaw([Uint8Array.from([5]), Uint8Array.from([6])])).toBe(true);
    bytes[0] = 9;

    expect(queue.drain()).toEqual([
      { type: 'raw', data: Uint8Array.from([1, 2]) },
      { type: 'raw', data: Uint8Array.from([3, 4]).buffer },
      { type: 'raw', data: Uint8Array.from([5, 6]) },
    ]);
  });
});
