import { runInNewContext } from 'node:vm';
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

  test.each(['iterator-first', 'observer-first'] as const)(
    'delivers the overflow-triggering event to ordinary listeners when registered %s',
    async (order) => {
      const stream = new TestStream();
      const observer = vi.fn();
      let iterator: AsyncIterableIterator<[unknown]>;

      if (order === 'iterator-first') {
        iterator = stream.events('payload');
        stream.on('payload', observer);
      } else {
        stream.on('payload', observer);
        iterator = stream.events('payload');
      }

      const payload = { text: 'x'.repeat(5 * 1024 * 1024) };
      stream.emitPayload(payload);

      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith(payload);
      expect(stream.controller.signal.aborted).toBe(true);
      expect(stream.ended).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

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

  test.each([
    {
      name: 'a callable with oversized own data',
      create: () => Object.assign(() => {}, { payload: 'x'.repeat(5 * 1024 * 1024) }),
    },
    {
      name: 'a callable with an uninspectable retained closure',
      create: () => {
        const retained = 'x'.repeat(5 * 1024 * 1024);
        return () => retained;
      },
    },
    {
      name: 'oversized URLSearchParams internal slots',
      create: () => new URLSearchParams([['payload', 'x'.repeat(5 * 1024 * 1024)]]),
    },
    { name: 'unsupported URL internal slots', create: () => new URL('https://example.com/private') },
    { name: 'unsupported Promise internal slots', create: () => Promise.resolve('private') },
    { name: 'unsupported WeakMap internal slots', create: () => new WeakMap() },
    { name: 'unsupported RegExp internal slots', create: () => /private/u },
    {
      name: 'an unsupported custom object prototype',
      create: () => Object.create({ inspect: () => 'private' }) as object,
    },
  ])('rejects $name before it enters a detached queue', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create());

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('charges oversized data retained through a custom immediate prototype', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const prototype: object = Object.create(null);
    Object.defineProperty(prototype, 'hidden', {
      enumerable: false,
      value: 'x'.repeat(5 * 1024 * 1024),
    });

    stream.emitPayload(Object.create(prototype));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects inherited accessor closures without invoking their getters', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const retained = 'x'.repeat(5 * 1024 * 1024);
    const readAccessor = vi.fn(() => retained);
    const prototype: object = Object.create(null);
    Object.defineProperty(prototype, 'hidden', { get: readAccessor });

    stream.emitPayload(Object.create(prototype));

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readAccessor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects callable data retained through a custom immediate prototype', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const prototype: object = Object.create(null);
    Object.defineProperty(prototype, 'hidden', { value: () => 'uninspectable closure' });

    stream.emitPayload(Object.create(prototype));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('preserves safe accessor-free custom-prototype data, cycles, and identity', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const prototype: { retained?: unknown } = Object.create(null);
    const payload: { own?: string } = Object.create(prototype);
    prototype.retained = payload;
    payload.own = 'safe';

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each([
    { name: 'a root object', create: () => ({}) },
    { name: 'a Map', create: () => new Map() },
    { name: 'a Set', create: () => new Set() },
    { name: 'an Error', create: () => new Error('small') },
    { name: 'an ArrayBuffer', create: () => new ArrayBuffer(8) },
    { name: 'a SharedArrayBuffer', create: () => new SharedArrayBuffer(8) },
    { name: 'a DataView', create: () => new DataView(new ArrayBuffer(8)) },
    { name: 'a typed array', create: () => new Uint8Array(8) },
    { name: 'a Blob', create: () => new Blob(['small']) },
  ])('rejects a retained accessor closure on $name without invoking it', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const readAccessor = vi.fn(() => retained);
    const payload = create();
    Object.defineProperty(payload, Symbol('hidden closure'), { enumerable: false, get: readAccessor });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readAccessor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects nested accessor closures without invoking them', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const readAccessor = vi.fn(() => retained);
    const nested = Object.defineProperty({}, 'hidden', { enumerable: false, get: readAccessor });

    stream.emitPayload({ nested });

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readAccessor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['get', 'set'] as const)(
    'rejects an Error stack accessor with a producer-controlled %s closure',
    async (accessor) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const retained = 'x'.repeat(9 * 1024 * 1024);
      const untrusted = vi.fn(() => retained);
      const payload = new Error('small');
      const descriptor = Object.getOwnPropertyDescriptor(payload, 'stack');
      Object.defineProperty(payload, 'stack', { ...descriptor, [accessor]: untrusted });

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(untrusted).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([4096, 4097])(
    'bounds ordinary queued arrays at the %i-element inspection boundary',
    async (length) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = Array.from({ length }, () => 0);

      stream.emitPayload(payload);

      if (length === 4096) {
        await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
        stream.end();
        return;
      }

      expect(stream.controller.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([
    { name: 'dense', create: () => Array.from({ length: 1_000_000 }, () => 0) },
    {
      name: 'sparse',
      create: () => {
        const values: number[] = [];
        values.length = 1_000_000;
        return values;
      },
    },
  ])('rejects large $name arrays before materializing dense own keys', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = create();
    const ownKeys = vi.spyOn(Reflect, 'ownKeys');

    try {
      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(ownKeys.mock.calls.some(([value]) => value === payload)).toBe(false);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    } finally {
      ownKeys.mockRestore();
    }
  });

  test('revalidates queued payloads after later listeners mutate them in the same dispatch', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: { text: string; hidden?: string } = { text: 'small' };
    stream.on('payload', (value) => {
      (value as typeof payload).hidden = 'x'.repeat(5 * 1024 * 1024);
    });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('does not revalidate events discarded by an iterator returning during the same dispatch', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: { text: string; hidden?: string } = { text: 'small' };
    stream.on('payload', (value) => {
      void iterator.return?.();
      (value as typeof payload).hidden = 'x'.repeat(5 * 1024 * 1024);
    });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(false);
    expect(stream.errored).toBe(false);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    stream.end();
  });

  test('keeps another iterator protected when its sibling returns during dispatch', async () => {
    const stream = new TestStream();
    const returned = stream.events('payload');
    const retained = stream.events('payload');
    const payload: { text: string; hidden?: string } = { text: 'small' };
    stream.on('payload', (value) => {
      void returned.return?.();
      (value as typeof payload).hidden = 'x'.repeat(5 * 1024 * 1024);
    });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(returned.next()).resolves.toEqual({ done: true, value: undefined });
    await expect(retained.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('revalidates custom-prototype data mutated later in the same dispatch', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const prototype: { hidden: string } = Object.assign(Object.create(null), { hidden: 'small' });
    const payload: object = Object.create(prototype);
    stream.on('payload', () => {
      prototype.hidden = 'x'.repeat(5 * 1024 * 1024);
    });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('revalidates preserved payload identities after mutation and before dequeue', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: { text: string; hidden?: string } = { text: 'small' };

    stream.emitPayload(payload);
    payload.hidden = 'x'.repeat(5 * 1024 * 1024);
    const next = iterator.next();

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(next).rejects.toThrow(/iterator buffer limit/iu);
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
    { name: 'Blob', create: () => new Blob([new Uint8Array(9 * 1024 * 1024)]) },
    { name: 'File', create: () => new File([new Uint8Array(9 * 1024 * 1024)], 'large.bin') },
  ])(
    'rejects oversized $name backing storage without invoking an overridden size getter',
    async ({ create }) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = create();
      const readSize = vi.fn(() => 1);
      Object.defineProperty(payload, 'size', { get: readSize });

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
      expect(readSize).not.toHaveBeenCalled();
    },
  );

  test('rejects a small queued Blob with an own size accessor without invoking it', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = new Blob(['small']);
    const readSize = vi.fn(() => {
      throw new Error('untrusted size accessor');
    });
    Object.defineProperty(payload, 'size', { get: readSize });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    expect(readSize).not.toHaveBeenCalled();
  });

  test('fails closed on a spoofed Blob receiver without invoking its size accessor', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readSize = vi.fn(() => 1);
    const payload = Object.create(Blob.prototype);
    Object.defineProperty(payload, 'size', { get: readSize });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    expect(readSize).not.toHaveBeenCalled();
  });

  test.each([
    { name: 'DataView', expression: 'new DataView(new ArrayBuffer(16))' },
    { name: 'ArrayBuffer', expression: 'new ArrayBuffer(16)' },
    { name: 'SharedArrayBuffer-backed DataView', expression: 'new DataView(new SharedArrayBuffer(16))' },
  ])('accepts a small cross-realm $name without reading spoofable accessors', async ({ expression }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: unknown = runInNewContext(expression);

    stream.emitPayload(payload);

    await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each([
    { name: 'ArrayBuffer', expression: 'new ArrayBuffer(9 * 1024 * 1024)' },
    {
      name: 'ArrayBuffer-backed DataView',
      expression: 'new DataView(new ArrayBuffer(9 * 1024 * 1024), 0, 1)',
    },
    {
      name: 'SharedArrayBuffer-backed DataView',
      expression: 'new DataView(new SharedArrayBuffer(9 * 1024 * 1024), 0, 1)',
    },
  ])('charges the complete cross-realm $name backing store', async ({ expression }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(runInNewContext(expression));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('charges non-enumerable data retained by a cross-realm DataView', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext('new DataView(new ArrayBuffer(16))') as DataView;
    Object.defineProperty(payload, 'hidden', { value: 'x'.repeat(5 * 1024 * 1024) });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'Map keys', expression: "new Map([['x'.repeat(5 * 1024 * 1024), 'small']])" },
    { name: 'Map values', expression: "new Map([['small', 'x'.repeat(5 * 1024 * 1024)]])" },
    { name: 'Set values', expression: "new Set(['x'.repeat(5 * 1024 * 1024)])" },
  ])('charges cross-realm $name hidden in internal collection slots', async ({ expression }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: unknown = runInNewContext(expression);

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'Map', expression: "new Map([['small', 'value']])", method: 'entries' },
    { name: 'Set', expression: "new Set(['small'])", method: 'values' },
  ])(
    'rejects cross-realm $name own iterator accessors without invoking them',
    async ({ expression, method }) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = runInNewContext(expression) as object;
      const invokeHostileIterator = vi.fn(() => {
        throw new Error('hostile iterator');
      });
      Object.defineProperty(payload, method, { get: invokeHostileIterator });
      Object.defineProperty(payload, Symbol.iterator, { get: invokeHostileIterator });

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
      expect(invokeHostileIterator).not.toHaveBeenCalled();
    },
  );

  test('handles cyclic cross-realm Maps and Sets without reentering untrusted iterators', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload: unknown = runInNewContext(
      'const map = new Map(); const set = new Set(); map.set(map, set); set.add(map); map',
    );

    stream.emitPayload(payload);

    await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
    stream.end();
  });

  test.each([
    { name: 'Map', prototype: Map.prototype },
    { name: 'Set', prototype: Set.prototype },
  ])(
    'fails closed when a $name prototype is forged without collection internal slots',
    async ({ prototype }) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');

      stream.emitPayload(Object.create(prototype));

      expect(stream.controller.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([
    { name: 'Map keys', create: (value: string) => new Map([[value, 'small']]) },
    { name: 'Map values', create: (value: string) => new Map([['small', value]]) },
    { name: 'Set values', create: (value: string) => new Set([value]) },
    {
      name: 'non-enumerable own data properties',
      create: (value: string) => Object.defineProperty({}, 'hidden', { value, enumerable: false }),
    },
    {
      name: 'symbol-keyed own data properties',
      create: (value: string) => ({ [Symbol('hidden payload')]: value }),
    },
    {
      name: 'non-enumerable symbol-keyed own data properties',
      create: (value: string) =>
        Object.defineProperty({}, Symbol('hidden payload'), { value, enumerable: false }),
    },
    {
      name: 'non-enumerable ArrayBuffer data properties',
      create: (value: string) =>
        Object.defineProperty(new ArrayBuffer(8), 'hidden', { value, enumerable: false }),
    },
    {
      name: 'symbol-keyed ArrayBuffer data properties',
      create: (value: string) => Object.defineProperty(new ArrayBuffer(8), Symbol('hidden'), { value }),
    },
    {
      name: 'non-enumerable DataView data properties',
      create: (value: string) =>
        Object.defineProperty(new DataView(new ArrayBuffer(8)), 'hidden', { value, enumerable: false }),
    },
    {
      name: 'symbol-keyed DataView data properties',
      create: (value: string) =>
        Object.defineProperty(new DataView(new ArrayBuffer(8)), Symbol('hidden'), { value }),
    },
    {
      name: 'enumerable typed-array own string data properties',
      create: (value: string) =>
        Object.defineProperty(new Uint8Array(1), 'payload', { value, enumerable: true }),
    },
    {
      name: 'non-enumerable typed-array own string data properties',
      create: (value: string) =>
        Object.defineProperty(new Uint8Array(1), 'payload', { value, enumerable: false }),
    },
    {
      name: 'enumerable Buffer own string data properties',
      create: (value: string) =>
        Object.defineProperty(Buffer.alloc(1), 'payload', { value, enumerable: true }),
    },
    {
      name: 'non-enumerable Buffer own string data properties',
      create: (value: string) =>
        Object.defineProperty(Buffer.alloc(1), 'payload', { value, enumerable: false }),
    },
    {
      name: 'symbol-keyed typed-array data properties',
      create: (value: string) => Object.defineProperty(new Uint8Array(8), Symbol('hidden'), { value }),
    },
    {
      name: 'symbol-keyed Buffer data properties',
      create: (value: string) => Object.defineProperty(Buffer.alloc(8), Symbol('hidden'), { value }),
    },
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

  test.each([
    { name: 'Uint8Array', create: (length: number) => new Uint8Array(length) },
    { name: 'Buffer', create: (length: number) => Buffer.alloc(length) },
    {
      name: 'cross-realm Uint8Array',
      create: (length: number) => runInNewContext(`new Uint8Array(${length})`) as Uint8Array,
    },
  ])('buffers a $name at the own-key inspection boundary', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = create(4096);

    stream.emitPayload(payload);

    await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each([
    { name: 'Uint8Array', create: (length: number) => new Uint8Array(length) },
    { name: 'Buffer', create: (length: number) => Buffer.alloc(length) },
    {
      name: 'cross-realm Uint8Array',
      create: (length: number) => runInNewContext(`new Uint8Array(${length})`) as Uint8Array,
    },
  ])('rejects a detached $name above the bounded own-key inspection threshold', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create(4097));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects large dense typed arrays before materializing their index keys', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = new Uint8Array(1024 * 1024);
    const ownKeys = vi.spyOn(Reflect, 'ownKeys');

    try {
      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(ownKeys.mock.calls.some(([value]) => value === payload)).toBe(false);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    } finally {
      ownKeys.mockRestore();
    }
  });

  test('rejects small queued typed arrays with own accessors without invoking them', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = new Uint8Array(16);
    const readAccessor = vi.fn(() => {
      throw new Error('untrusted typed-array accessor');
    });
    Object.defineProperty(payload, 'length', { get: readAccessor });
    Object.defineProperty(payload, 'buffer', { get: readAccessor });
    Object.defineProperty(payload, 'hidden', { get: readAccessor });
    Object.defineProperty(payload, Symbol('hidden accessor'), { get: readAccessor });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    expect(readAccessor).not.toHaveBeenCalled();
  });

  test('delivers large typed arrays directly to waiting consumers without inspecting dense indices', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const next = iterator.next();
    const payload = new Uint8Array(4097);

    stream.emitPayload(payload);

    await expect(next).resolves.toEqual({ done: false, value: [payload] });
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each([
    { name: 'a callable', value: () => 'retained' },
    { name: 'an unsupported host object', value: new URLSearchParams([['key', 'value']]) },
    { name: 'a large ordinary array', value: Array.from({ length: 4097 }, () => 0) },
  ])(
    'delivers $name directly to waiting consumers without detached-queue restrictions',
    async ({ value }) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const next = iterator.next();

      stream.emitPayload(value);

      await expect(next).resolves.toEqual({ done: false, value: [value] });
      expect(stream.controller.signal.aborted).toBe(false);
      stream.end();
    },
  );

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

  test.each([
    { name: 'a root object', create: () => ({}) },
    { name: 'a Map', create: () => new Map() },
    { name: 'a typed array', create: () => new Uint8Array(8) },
    { name: 'a Blob', create: () => new Blob(['small']) },
  ])('delivers accessor-backed $name directly to a waiting consumer', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const next = iterator.next();
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const readAccessor = vi.fn(() => retained);
    const payload = create();
    Object.defineProperty(payload, Symbol('hidden closure'), { get: readAccessor });

    stream.emitPayload(payload);

    const result = await next;
    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    expect(readAccessor).not.toHaveBeenCalled();
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

  test('rejects queued cyclic event payload accessors without invoking them', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readAccessor = vi.fn(() => {
      throw new Error('accessor should not run');
    });
    const payload: { self?: unknown } = {};

    payload.self = payload;
    Object.defineProperty(payload, 'accessor', { enumerable: true, get: readAccessor });
    Object.defineProperty(payload, Symbol('hidden accessor'), { get: readAccessor });
    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    expect(readAccessor).not.toHaveBeenCalled();
  });

  test('preserves accessor-free cyclic Maps, Sets, Errors, and backing stores', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const map = new Map<unknown, unknown>();
    const set = new Set<unknown>();
    const error = new Error('small');
    const backingBuffer = new ArrayBuffer(16);
    const view = new Uint8Array(backingBuffer);
    const payload = { map, set, error, view, backingBuffer };

    map.set(map, set);
    set.add(map);
    Object.defineProperty(error, 'cause', { value: error, enumerable: false });
    stream.emitPayload(payload);

    const result = await iterator.next();

    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });
});
