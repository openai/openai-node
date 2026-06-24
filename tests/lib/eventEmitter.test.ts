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
