import { EventEmitter } from 'openai/lib/EventEmitter';

interface TestEvents {
  foo: (value: string) => void;
  error: (err: Error) => void;
}

class TestEmitter extends EventEmitter<TestEvents> {
  emitFoo(value: string) {
    this._emit('foo', value);
  }
  emitError(err: Error) {
    this._emit('error', err);
  }
}

describe('EventEmitter.emitted', () => {
  test('resolves when event is emitted', async () => {
    const emitter = new TestEmitter();
    const promise = emitter.emitted('foo');
    emitter.emitFoo('bar');
    await expect(promise).resolves.toBe('bar');
  });

  test('rejects if error emitted before event', async () => {
    const emitter = new TestEmitter();
    const promise = emitter.emitted('foo');
    const error = new Error('oops');
    emitter.emitError(error);
    emitter.emitFoo('bar');
    await expect(promise).rejects.toBe(error);
  });
});
