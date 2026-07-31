import { vi } from 'vitest';
import { EventEmitter, InternalEventEmitter } from 'openai/core/EventEmitter';

type Events = {
  message: (value: string) => void;
  empty: () => void;
  error: (error: Error) => void;
};

class TestEmitter extends EventEmitter<Events> {
  emitMessage(value: string) {
    this._emit('message', value);
  }

  emitEmpty() {
    this._emit('empty');
  }

  hasMessageListener() {
    return this._hasListener('message');
  }
}

describe('core EventEmitter', () => {
  test('invokes listeners in registration order, including repeated listeners', () => {
    const emitter = new TestEmitter();
    const values: string[] = [];
    const repeated = (value: string) => values.push(`repeated:${value}`);

    expect(emitter.on('message', repeated)).toBe(emitter);
    emitter.on('message', (value) => values.push(`second:${value}`));
    emitter.on('message', repeated);
    emitter.emitMessage('event');

    expect(values).toEqual(['repeated:event', 'second:event', 'repeated:event']);
  });

  test('removes only one matching listener and tolerates unknown listeners', () => {
    const emitter = new TestEmitter();
    const listener = vi.fn();

    expect(emitter.off('message', listener)).toBe(emitter);
    emitter.on('message', listener).on('message', listener);
    emitter.off('message', () => {});
    emitter.off('message', listener);
    emitter.emitMessage('first');
    emitter.off('message', listener);
    emitter.emitMessage('second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
    expect(emitter.hasMessageListener()).toBe(false);
  });

  test('removes one-time listeners while retaining ordinary listeners', () => {
    const emitter = new TestEmitter();
    const once = vi.fn();
    const repeated = vi.fn();

    expect(emitter.once('message', once)).toBe(emitter);
    emitter.on('message', repeated);
    expect(emitter.hasMessageListener()).toBe(true);
    emitter.emitMessage('first');
    emitter.emitMessage('second');

    expect(once).toHaveBeenCalledTimes(1);
    expect(repeated).toHaveBeenCalledTimes(2);
  });

  test('resolves emitted promises with the next matching event', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('message');

    emitter.emitMessage('next');
    emitter.emitMessage('ignored');

    await expect(pending).resolves.toBe('next');
    expect(emitter.hasMessageListener()).toBe(false);
  });

  test('resolves events without arguments and tolerates events without listeners', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('empty');

    emitter.emitEmpty();
    emitter.emitMessage('unobserved');

    await expect(pending).resolves.toBeUndefined();
  });
});

describe('InternalEventEmitter', () => {
  test('exposes public event dispatch while preserving EventEmitter behavior', () => {
    const emitter = new InternalEventEmitter<Events>();
    const listener = vi.fn();

    emitter.once('message', listener);
    emitter._emit('message', 'first');
    emitter._emit('message', 'second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
  });
});
