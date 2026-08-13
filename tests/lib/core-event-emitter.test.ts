import { vi } from 'vitest';
import { EventEmitter, InternalEventEmitter } from 'openai/core/EventEmitter';

type Events = {
  message: (value: string) => void;
  pair: (value: string, index: number) => void;
  empty: () => void;
  error: (error: Error) => void;
};

class TestEmitter extends EventEmitter<Events> {
  emitMessage(value: string) {
    this._emit('message', value);
  }

  emitNamed(event: string, value: string) {
    this._emit(event as 'message', value);
  }

  emitEmpty() {
    this._emit('empty');
  }

  emitPair(value: string, index: number) {
    this._emit('pair', value, index);
  }

  emitError(error: Error) {
    this._emit('error', error);
  }

  hasMessageListener() {
    return this._hasListener('message');
  }

  hasErrorListener() {
    return this._hasListener('error');
  }

  hasListener(event: string) {
    return this._hasListener(event as keyof Events);
  }
}

describe('core EventEmitter', () => {
  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'safely emits unobserved Object.prototype event %s',
    (eventName) => {
      const emitter = new TestEmitter();
      const event = eventName as keyof Events;

      expect(emitter.hasListener(event)).toBeFalsy();
      expect(() => emitter.off(event, vi.fn())).not.toThrow();
      expect(() => emitter.emitNamed(event, 'ignored')).not.toThrow();
    },
  );

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'supports regular and one-time Object.prototype event listeners for %s',
    (eventName) => {
      const emitter = new TestEmitter();
      const event = eventName as 'message';
      const repeated = vi.fn();
      const once = vi.fn();

      emitter.on(event, repeated);
      emitter.once(event, once);
      expect(emitter.hasListener(event)).toBe(true);

      emitter.emitNamed(event, 'first');
      emitter.emitNamed(event, 'second');
      emitter.off(event, repeated);
      emitter.emitNamed(event, 'ignored');

      expect(repeated).toHaveBeenCalledTimes(2);
      expect(once).toHaveBeenCalledTimes(1);
      expect(once).toHaveBeenCalledWith('first');
      expect(emitter.hasListener(event)).toBe(false);
    },
  );

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

  test('rejects pending emitted promises when an error occurs first', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('message');
    const failure = new Error('connection failed');

    emitter.emitError(failure);

    await expect(pending).rejects.toBe(failure);
    expect(emitter.hasMessageListener()).toBe(false);
  });

  test('removes its error listener after the requested event arrives', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('message');

    emitter.emitMessage('received');

    await expect(pending).resolves.toBe('received');
    expect(emitter.hasErrorListener()).toBe(false);
  });

  test('resolves events with multiple arguments as their complete argument tuple', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('pair');

    emitter.emitPair('received', 2);

    await expect(pending).resolves.toEqual(['received', 2]);
  });

  test('resolves rather than rejects when waiting for the error event itself', async () => {
    const emitter = new TestEmitter();
    const pending = emitter.emitted('error');
    const failure = new Error('expected event');

    emitter.emitError(failure);

    await expect(pending).resolves.toBe(failure);
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
