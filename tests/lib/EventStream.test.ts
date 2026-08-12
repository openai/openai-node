import { vi } from 'vitest';
import { OpenAIError } from 'openai/error';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

interface TestEvents extends BaseEvents {
  foo: (value: string, index: number) => void;
}

class TestStream extends EventStream<TestEvents> {
  emitFoo(value: string, index: number) {
    this._emit('foo', value, index);
  }

  emitError(error: OpenAIError) {
    this._emit('error', error);
  }

  end() {
    this._emit('end');
  }
}

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
