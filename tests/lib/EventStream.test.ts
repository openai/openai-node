import { vi } from 'vitest';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

interface TestEvents extends BaseEvents {
  foo: (value: string, index: number) => void;
  payload: (value: unknown) => void;
}

class TestStream extends EventStream<TestEvents> {
  emitFoo(value: string, index: number) {
    this._emit('foo', value, index);
  }

  emitPayload(value: unknown) {
    this._emit('payload', value);
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

describe('EventStream iterator buffer limits', () => {
  test('aborts detached iterators after the queued-event high-water mark', async () => {
    const stream = new TestStream();
    const iterator = stream.events('foo');
    const bufferedEvents = 4096;

    for (let index = 0; index < bufferedEvents; index += 1) {
      stream.emitFoo('buffered', index);
    }

    expect(stream.controller.signal.aborted).toBe(false);

    stream.emitFoo('overflow', bufferedEvents);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(stream.ended).toBe(true);
    expect(stream.errored).toBe(true);
    await expect(stream.done()).rejects.toThrow(/iterator buffer limit/iu);

    const buffered = await Promise.all(Array.from({ length: bufferedEvents }, () => iterator.next()));

    expect(buffered.every((result, index) => !result.done && result.value[1] === index)).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/4096 events/iu);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  test('aborts detached iterators when nested event payloads exceed the byte high-water mark', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const fragment = 'x'.repeat(1024 * 1024);
    let emitted = 0;

    while (!stream.controller.signal.aborted && emitted < 8) {
      stream.emitPayload({ nested: [{ text: fragment }] });
      emitted += 1;
    }

    expect(stream.controller.signal.aborted).toBe(true);
    expect(emitted).toBeLessThanOrEqual(4);
    await expect(stream.done()).rejects.toThrow(/8388608 bytes/iu);

    const buffered = await Promise.all(Array.from({ length: emitted - 1 }, () => iterator.next()));

    expect(buffered.every((result) => !result.done)).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects an oversized event before retaining it', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload({ text: 'x'.repeat(4 * 1024 * 1024 + 1) });

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  test.each([
    { name: 'Map keys', create: (value: string) => new Map([[value, 'small']]) },
    { name: 'Map values', create: (value: string) => new Map([['small', value]]) },
    { name: 'Set values', create: (value: string) => new Set([value]) },
    { name: 'non-enumerable Error messages', create: (value: string) => new Error(value) },
    {
      name: 'non-enumerable Error causes',
      create: (value: string) => {
        const error = new Error('small');
        Object.defineProperty(error, 'cause', { value, enumerable: false });
        return error;
      },
    },
  ])('rejects oversized data hidden in $name', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create('x'.repeat(5 * 1024 * 1024)));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'SharedArrayBuffer', create: () => new SharedArrayBuffer(9 * 1024 * 1024) },
    {
      name: 'ArrayBuffer-backed views',
      create: () => new Uint8Array(new ArrayBuffer(9 * 1024 * 1024), 0, 1),
    },
    {
      name: 'SharedArrayBuffer-backed views',
      create: () => new Uint8Array(new SharedArrayBuffer(9 * 1024 * 1024), 0, 1),
    },
  ])('accounts for the entire retained backing store of $name', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create());

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('delivers oversized events directly to waiting consumers without buffering', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const next = iterator.next();
    const payload = { text: 'x'.repeat(4 * 1024 * 1024 + 1) };

    stream.emitPayload(payload);

    await expect(next).resolves.toEqual({ done: false, value: [payload] });
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test('restores the byte budget when buffered events are consumed', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = { text: 'x'.repeat(1024 * 1024) };

    const received = await Promise.all(
      Array.from({ length: 12 }, () => {
        stream.emitPayload(payload);
        return iterator.next();
      }),
    );

    expect(received.every((result) => !result.done && result.value[0] === payload)).toBe(true);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test('buffers valid deeply nested parsed event snapshots without aborting the request', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    let parsed: unknown = 0;

    for (let depth = 0; depth < 128; depth += 1) {
      parsed = [parsed];
    }

    const payload = { snapshot: 'valid nested JSON', parsed };
    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(false);

    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value?.[0]).toBe(payload);
    stream.end();
  });

  test('sizes cyclic event payloads without invoking accessor properties', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readAccessor = vi.fn(() => {
      throw new Error('accessor should not run');
    });
    const payload: { self?: unknown } = {};

    payload.self = payload;
    Object.defineProperty(payload, 'accessor', { enumerable: true, get: readAccessor });
    stream.emitPayload(payload);

    await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
    expect(readAccessor).not.toHaveBeenCalled();
    stream.end();
  });

  test('sizes cyclic Maps, Sets, and Error causes without invoking accessor properties', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readAccessor = vi.fn(() => {
      throw new Error('accessor should not run');
    });
    const map = new Map<unknown, unknown>();
    const set = new Set<unknown>();
    const error = new Error('small');
    const backingBuffer = new ArrayBuffer(16);
    const view = new Uint8Array(backingBuffer);
    const payload = { map, set, error, view, backingBuffer };

    map.set(map, set);
    set.add(map);
    Object.defineProperty(error, 'cause', { value: error, enumerable: false });
    Object.defineProperty(map, 'accessor', { enumerable: true, get: readAccessor });
    Object.defineProperty(map, 'entries', { enumerable: true, get: readAccessor });
    Object.defineProperty(set, Symbol.iterator, { get: readAccessor });
    Object.defineProperty(error, 'hiddenAccessor', { enumerable: false, get: readAccessor });
    Object.defineProperty(backingBuffer, 'byteLength', { enumerable: true, get: readAccessor });
    Object.defineProperty(view, 'buffer', { enumerable: true, get: readAccessor });
    stream.emitPayload(payload);

    const result = await iterator.next();

    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    expect(readAccessor).not.toHaveBeenCalled();
    stream.end();
  });
});
