import { EventEmitter as CoreEventEmitter } from 'openai/core/EventEmitter';
import { EventEmitter as LibEventEmitter } from 'openai/lib/EventEmitter';

type TestEvents = {
  message: (message: string) => void;
  error: (error: Error) => void;
};

interface TestEmitter {
  emitted(event: keyof TestEvents): Promise<unknown>;
  emit<Event extends keyof TestEvents>(event: Event, ...args: Parameters<TestEvents[Event]>): void;
  hasListener(event: keyof TestEvents): boolean;
}

class CoreTestEmitter extends CoreEventEmitter<TestEvents> implements TestEmitter {
  emit<Event extends keyof TestEvents>(event: Event, ...args: Parameters<TestEvents[Event]>) {
    this._emit(event, ...args);
  }

  hasListener(event: keyof TestEvents) {
    return this._hasListener(event);
  }
}

class LibTestEmitter extends LibEventEmitter<TestEvents> implements TestEmitter {
  emit<Event extends keyof TestEvents>(event: Event, ...args: Parameters<TestEvents[Event]>) {
    this._emit(event, ...args);
  }

  hasListener(event: keyof TestEvents) {
    return this._hasListener(event);
  }
}

function runEventEmitterTests(name: string, makeEmitter: () => TestEmitter) {
  describe(`${name} EventEmitter`, () => {
    it('resolves emitted() when the requested event is emitted', async () => {
      const emitter = makeEmitter();
      const promise = emitter.emitted('message');

      expect(emitter.hasListener('message')).toBe(true);
      expect(emitter.hasListener('error')).toBe(true);

      emitter.emit('message', 'hello');

      await expect(promise).resolves.toBe('hello');
      expect(emitter.hasListener('message')).toBe(false);
      expect(emitter.hasListener('error')).toBe(false);
    });

    it('rejects emitted() if error is emitted first', async () => {
      const emitter = makeEmitter();
      const error = new Error('boom');
      const promise = emitter.emitted('message');

      expect(emitter.hasListener('message')).toBe(true);
      expect(emitter.hasListener('error')).toBe(true);

      emitter.emit('error', error);

      await expect(promise).rejects.toBe(error);
      expect(emitter.hasListener('message')).toBe(false);
      expect(emitter.hasListener('error')).toBe(false);
    });

    it('resolves emitted() when waiting for error', async () => {
      const emitter = makeEmitter();
      const error = new Error('boom');
      const promise = emitter.emitted('error');

      expect(emitter.hasListener('error')).toBe(true);

      emitter.emit('error', error);

      await expect(promise).resolves.toBe(error);
      expect(emitter.hasListener('error')).toBe(false);
    });
  });
}

runEventEmitterTests('core', () => new CoreTestEmitter());
runEventEmitterTests('lib', () => new LibTestEmitter());
