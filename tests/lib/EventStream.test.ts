import { vi } from 'vitest';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

interface TestEvents extends BaseEvents {
  foo: (value: string, index: number) => void;
}

class TestStream extends EventStream<TestEvents> {
  emitFoo(value: string, index: number) {
    this._emit('foo', value, index);
  }

  emitNamed(event: string, value: string, index: number) {
    this._emit(event as 'foo', value, index);
  }

  emitError(error: OpenAIError) {
    this._emit('error', error);
  }

  emitAbort(error: APIUserAbortError) {
    this._emit('abort', error);
  }

  end() {
    this._emit('end');
  }
}

describe('EventStream listeners', () => {
  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'safely emits unobserved Object.prototype event %s',
    (eventName) => {
      const stream = new TestStream();
      const event = eventName as 'foo';

      expect(() => stream.off(event, vi.fn())).not.toThrow();
      expect(() => stream.emitNamed(event, 'ignored', 0)).not.toThrow();
    },
  );

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'supports regular and one-time Object.prototype event listeners for %s',
    (eventName) => {
      const stream = new TestStream();
      const event = eventName as 'foo';
      const repeated = vi.fn();
      const once = vi.fn();

      stream.on(event, repeated);
      stream.once(event, once);
      stream.emitNamed(event, 'first', 1);
      stream.emitNamed(event, 'second', 2);
      stream.off(event, repeated);
      stream.emitNamed(event, 'ignored', 3);

      expect(repeated).toHaveBeenCalledTimes(2);
      expect(once).toHaveBeenCalledTimes(1);
      expect(once).toHaveBeenCalledWith('first', 1);
    },
  );
});

describe('EventStream.emitted', () => {
  test('resolves all arguments from a multi-argument event as a tuple', async () => {
    const stream = new TestStream();
    const pending = stream.emitted('foo');

    stream.emitFoo('received', 4);

    await expect(pending).resolves.toEqual(['received', 4]);
  });

  test('rejects when an error arrives before the requested event', async () => {
    const stream = new TestStream();
    const pending = stream.emitted('foo');
    const failure = new OpenAIError('stream failed');

    stream.emitError(failure);

    await expect(pending).rejects.toBe(failure);
  });

  test('removes the error listener after the requested event arrives', async () => {
    const stream = new TestStream();
    const removeListener = vi.spyOn(stream, 'off');
    const pending = stream.emitted('foo');

    stream.emitFoo('received', 4);

    await expect(pending).resolves.toEqual(['received', 4]);
    expect(removeListener).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('removes the requested-event listener when an error arrives first', async () => {
    const stream = new TestStream();
    const removeListener = vi.spyOn(stream, 'off');
    const pending = stream.emitted('foo');
    const failure = new OpenAIError('stream failed');

    stream.emitError(failure);

    await expect(pending).rejects.toBe(failure);
    expect(removeListener).toHaveBeenCalledWith('foo', expect.any(Function));
  });

  test('resolves rather than rejects when waiting for the error event itself', async () => {
    const stream = new TestStream();
    const pending = stream.emitted('error');
    const failure = new OpenAIError('expected event');

    stream.emitError(failure);

    await expect(pending).resolves.toBe(failure);
  });
});

describe('EventStream.events', () => {
  test('iterates over repeated events in order', async () => {
    const stream = new TestStream();
    const seen: string[] = [];

    const consuming = (async () => {
      for await (const [value, index] of stream.events('foo')) {
        seen.push('start:' + value + ':' + index);
        await Promise.resolve();
        seen.push('end:' + value + ':' + index);
      }
    })();

    stream.emitFoo('first', 1);
    stream.emitFoo('second', 2);
    stream.end();

    await consuming;

    expect(seen).toEqual(['start:first:1', 'end:first:1', 'start:second:2', 'end:second:2']);
  });

  test('rejects pending reads when the stream errors', async () => {
    const stream = new TestStream();
    const iterator = stream.events('foo');
    const next = iterator.next();
    const error = new OpenAIError('oops');

    stream.emitError(error);

    await expect(next).rejects.toBe(error);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('drains queued events before rejecting on an error', async () => {
    const stream = new TestStream();
    const iterator = stream.events('foo');
    const error = new OpenAIError('oops');

    stream.emitFoo('first', 1);
    stream.emitError(error);

    await expect(iterator.next()).resolves.toEqual({ value: ['first', 1], done: false });
    await expect(iterator.next()).rejects.toBe(error);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('drains queued events before rejecting on abort', async () => {
    const stream = new TestStream();
    const iterator = stream.events('foo');
    const error = new APIUserAbortError();

    stream.emitFoo('first', 1);
    stream.emitAbort(error);

    await expect(iterator.next()).resolves.toEqual({ value: ['first', 1], done: false });
    await expect(iterator.next()).rejects.toBe(error);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test("yields the 'error' event as a value instead of rejecting when iterating it", async () => {
    const stream = new TestStream();
    const iterator = stream.events('error');
    const error = new OpenAIError('oops');

    stream.emitError(error);

    await expect(iterator.next()).resolves.toEqual({ value: [error], done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test("yields the 'abort' event as a value instead of rejecting when iterating it", async () => {
    const stream = new TestStream();
    const iterator = stream.events('abort');
    const error = new APIUserAbortError();

    stream.emitAbort(error);

    await expect(iterator.next()).resolves.toEqual({ value: [error], done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test.each(['end', 'return'] as const)(
    'removes producer and lifecycle listeners on %s',
    async (termination) => {
      const stream = new TestStream();
      const removeListener = vi.spyOn(stream, 'off');
      const iterator = stream.events('foo');

      if (termination === 'end') {
        stream.end();
      } else {
        await iterator.return?.();
      }

      for (const event of ['foo', 'end', 'error', 'abort'] as const) {
        expect(removeListener).toHaveBeenCalledWith(event, expect.any(Function));
      }
    },
  );

  test('does not suppress errors after iterator cleanup', async () => {
    const stream = new TestStream();
    const iterator = stream.events('foo');
    const reject = vi.spyOn(Promise, 'reject').mockImplementation(() => Promise.resolve() as Promise<never>);
    const error = new OpenAIError('oops');

    try {
      await iterator.return?.();
      stream.emitError(error);

      expect(reject).toHaveBeenCalledWith(error);
    } finally {
      reject.mockRestore();
    }
  });
});
