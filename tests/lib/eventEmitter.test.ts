import { vi } from 'vitest';
import { EventEmitter } from 'openai/lib/EventEmitter';

type TestEvents = {
  foo: (value: string) => void;
  error: (err: Error) => void;
};

class TestEmitter extends EventEmitter<TestEvents> {
  emitFoo(value: string) {
    this._emit('foo', value);
  }
  emitError(err: Error) {
    this._emit('error', err);
  }
  hasListener(event: keyof TestEvents) {
    return this._hasListener(event);
  }
}

describe('EventEmitter.emitted', () => {
  test('resolves when event is emitted', async () => {
    const emitter = new TestEmitter();
    const promise = emitter.emitted('foo');
    emitter.emitFoo('bar');
    await expect(promise).resolves.toBe('bar');
    expect(emitter.hasListener('error')).toBe(false);
  });

  test('rejects if error emitted before event', async () => {
    const emitter = new TestEmitter();
    const promise = emitter.emitted('foo');
    const error = new Error('oops');
    emitter.emitError(error);
    await expect(promise).rejects.toBe(error);
    expect(emitter.hasListener('foo')).toBe(false);
  });

  test('resolves when waiting for the error event', async () => {
    const emitter = new TestEmitter();
    const promise = emitter.emitted('error');
    const error = new Error('oops');
    emitter.emitError(error);
    await expect(promise).resolves.toBe(error);
  });
});

describe('EventEmitter listeners', () => {
  test('invokes repeated listeners in registration order', () => {
    const emitter = new TestEmitter();
    const values: string[] = [];
    const repeated = (value: string) => values.push(`repeated:${value}`);

    expect(emitter.on('foo', repeated)).toBe(emitter);
    emitter.on('foo', (value) => values.push(`second:${value}`));
    emitter.on('foo', repeated);
    emitter.emitFoo('value');

    expect(values).toEqual(['repeated:value', 'second:value', 'repeated:value']);
  });

  test('removes one matching listener at a time without affecting unknown listeners', () => {
    const emitter = new TestEmitter();
    const listener = vi.fn();

    expect(emitter.off('foo', listener)).toBe(emitter);
    emitter.on('foo', listener).on('foo', listener);
    emitter.off('foo', () => {});
    emitter.off('foo', listener);
    emitter.emitFoo('first');
    emitter.off('foo', listener);
    emitter.emitFoo('second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
    expect(emitter.hasListener('foo')).toBe(false);
  });

  test('automatically removes one-time listeners after their first invocation', () => {
    const emitter = new TestEmitter();
    const listener = vi.fn();

    expect(emitter.once('foo', listener)).toBe(emitter);
    expect(emitter.hasListener('foo')).toBe(true);
    emitter.emitFoo('first');
    emitter.emitFoo('second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
    expect(emitter.hasListener('foo')).toBe(false);
  });

  test('safely emits events without registered listeners', () => {
    const emitter = new TestEmitter();

    expect(emitter.hasListener('foo')).toBeFalsy();
    expect(() => emitter.emitFoo('ignored')).not.toThrow();
  });
});
