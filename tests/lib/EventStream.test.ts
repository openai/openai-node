import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ContentFilterFinishReasonError,
  InternalServerError,
  LengthFinishReasonError,
  NotFoundError,
  OAuthError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
  SubjectTokenProviderError,
  UnprocessableEntityError,
} from 'openai/error';
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

  test.each([
    { name: 'an isolated high surrogate', value: String.fromCodePoint(55_296) },
    { name: 'an isolated low surrogate', value: String.fromCodePoint(56_320) },
    { name: 'an astral code point', value: String.fromCodePoint(128_512) },
    { name: 'escaped JSON control characters', value: '\n\u0000"\\' },
  ])('preserves $name while detaching a queued string argument', async ({ value }) => {
    const source = `prefix-${value}-${'x'.repeat(2048)}`;
    const sliced = source.slice(7, 7 + value.length);
    const stream = new TestStream();
    const iterator = stream.events('foo');

    stream.emitFoo(sliced, 3);

    await expect(iterator.next()).resolves.toEqual({ value: [value, 3], done: false });
    expect(stream.controller.signal.aborted).toBe(false);
  });

  test('preserves direct waiting string delivery and the caller-owned frozen payload identity', async () => {
    const stream = new TestStream();
    const immediate = stream.events('foo');
    const pending = immediate.next();
    const value = String.fromCodePoint(55_296);

    stream.emitFoo(value, 4);

    await expect(pending).resolves.toEqual({ value: [value, 4], done: false });

    const frozen = Object.freeze({ value: 'frozen retained string' });
    const buffered = stream.events('payload');
    stream.emitPayload(frozen);
    const next = await buffered.next();

    expect(next.done).toBe(false);
    expect(next.value?.[0]).toBe(frozen);
    expect(Object.isFrozen(next.value?.[0])).toBe(true);
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

  test.each([
    { name: 'length finish', create: () => new LengthFinishReasonError() },
    { name: 'content filter', create: () => new ContentFilterFinishReasonError() },
    { name: 'connection', create: () => new APIConnectionError({ message: 'connection failure' }) },
    { name: 'connection timeout', create: () => new APIConnectionTimeoutError() },
    {
      name: 'subject token provider',
      create: () => new SubjectTokenProviderError('token failure', 'trusted-provider'),
    },
  ])('preserves a queued genuine $name SDK error subclass', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('error');
    const error = create();

    stream.emitError(error);

    await expect(iterator.next()).resolves.toEqual({ value: [error], done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test.each([
    {
      name: 'generic HTTP error',
      status: 418,
      create: (headers: Headers) => new APIError(418, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'bad request',
      status: 400,
      create: (headers: Headers) =>
        new BadRequestError(400, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'authentication',
      status: 401,
      create: (headers: Headers) =>
        new AuthenticationError(401, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'permission denied',
      status: 403,
      create: (headers: Headers) =>
        new PermissionDeniedError(403, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'not found',
      status: 404,
      create: (headers: Headers) =>
        new NotFoundError(404, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'conflict',
      status: 409,
      create: (headers: Headers) =>
        new ConflictError(409, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'unprocessable entity',
      status: 422,
      create: (headers: Headers) =>
        new UnprocessableEntityError(422, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'rate limit',
      status: 429,
      create: (headers: Headers) =>
        new RateLimitError(429, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'internal server',
      status: 503,
      create: (headers: Headers) =>
        new InternalServerError(503, { message: 'original failure' }, undefined, headers),
    },
    {
      name: 'OAuth',
      status: 400,
      create: (headers: Headers) =>
        new OAuthError(400, { error: 'invalid_request', error_description: 'original failure' }, headers),
    },
  ])('preserves a queued genuine $name SDK error with its response Headers', async ({ status, create }) => {
    const headers = new Headers([
      ['x-request-id', 'req-original-123'],
      ['x-context', 'small retained header'],
    ]);
    const error = create(headers);
    const stream = new TestStream();
    const iterator = stream.events('error');

    stream.emitError(error);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(error);
    expect(error.headers).toBe(headers);
    expect(error.status).toBe(status);
    expect(error.requestID).toBe('req-original-123');
    expect(stream.controller.signal.aborted).toBe(false);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('preserves the original API error and Headers identity for a directly waiting iterator', async () => {
    const headers = new Headers([['x-request-id', 'req-direct']]);
    const error = new BadRequestError(400, { message: 'direct failure' }, undefined, headers);
    const stream = new TestStream();
    const iterator = stream.events('error');
    const next = iterator.next();

    stream.emitError(error);

    const result = await next;
    expect(result.value?.[0]).toBe(error);
    expect(error.headers).toBe(headers);
    expect(error.requestID).toBe('req-direct');
    expect(stream.controller.signal.aborted).toBe(false);
  });

  test('rejects a producer-owned SDK Error subclass prototype without invoking its callable', async () => {
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const inspectRetained = vi.fn(() => retained);
    const prototype = Object.create(OpenAIError.prototype) as object;
    Object.defineProperty(prototype, 'inspectRetained', { value: inspectRetained });
    const error = new OpenAIError('producer-controlled subclass');
    Object.setPrototypeOf(error, prototype);
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(error);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(inspectRetained).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects a producer-owned accessor on a genuine SDK Error without invoking it', async () => {
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const getter = vi.fn(() => retained);
    const error = new LengthFinishReasonError();
    Object.defineProperty(error, 'retained', { configurable: true, enumerable: false, get: getter });
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(error);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
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
  test.each([
    { name: 'local Date', create: () => new Date(1_725_000_000_000) },
    { name: 'cross-realm Date', create: () => runInNewContext('new Date(1725000000000)') as Date },
  ])('preserves a buffered genuine $name and its exact identity', async ({ create }) => {
    const payload = create();
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    expect(Date.prototype.getTime.call(payload)).toBe(1_725_000_000_000);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each([
    { name: 'local', create: () => Object.create(Date.prototype) as Date },
    { name: 'cross-realm', create: () => runInNewContext('Object.create(Date.prototype)') as Date },
  ])('rejects a $name Date-prototype spoof without genuine timestamp storage', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create());

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['accessor', 'callable'] as const)(
    'rejects a custom genuine Date prototype %s without invoking it',
    async (kind) => {
      const payload = runInNewContext('new Date(123)') as Date;
      const inspectRetained = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
      const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
      Object.defineProperty(
        prototype,
        'retained',
        kind === 'accessor' ? { get: inspectRetained } : { value: inspectRetained },
      );
      Object.setPrototypeOf(payload, prototype);
      const stream = new TestStream();
      const iterator = stream.events('payload');

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(inspectRetained).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([
    { name: 'local', create: () => new Date(123) },
    { name: 'cross-realm', create: () => runInNewContext('new Date(123)') as Date },
  ])('charges oversized custom prototype data on a genuine $name Date', async ({ create }) => {
    const payload = create();
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'hidden', { value: 'x'.repeat(5 * 1024 * 1024) });
    Object.setPrototypeOf(payload, prototype);
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('preserves safe custom Date prototype data and buffered identity', async () => {
    const payload = runInNewContext('new Date(123)') as Date;
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'safe', { value: 'small retained data' });
    Object.setPrototypeOf(payload, prototype);
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });
  test.each([
    { name: 'local Headers', create: () => new Headers([['x-safe', 'small']]) },
    {
      name: 'injected-realm Headers',
      create: () => runInNewContext('new Headers([["x-safe", "small"]])', { Headers }) as Headers,
    },
  ])('preserves a queued genuine $name and its identity', async ({ create }) => {
    const headers = create();
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(headers);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(headers);
    expect(headers.get('x-safe')).toBe('small');
    expect(stream.controller.signal.aborted).toBe(false);
  });

  test.each(['header name', 'header value'] as const)(
    'charges oversized genuine Headers hidden %s storage',
    async (location) => {
      const retained = 'x'.repeat(4 * 1024 * 1024);
      const headers =
        location === 'header name'
          ? new Headers([[retained, 'small']])
          : new Headers([['x-hidden', retained]]);
      const stream = new TestStream();
      const iterator = stream.events('payload');

      stream.emitPayload(headers);

      expect(stream.controller.signal.aborted).toBe(true);
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test('rejects a Headers-prototype spoof without genuine hidden internal slots', async () => {
    const spoof = Object.create(Headers.prototype) as Headers;
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(spoof);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['accessor', 'callable'] as const)(
    'rejects a producer-owned Headers.entries %s without invoking it',
    async (kind) => {
      const retained = 'x'.repeat(9 * 1024 * 1024);
      const inspectRetained = vi.fn(() => retained);
      const headers = new Headers([['x-safe', 'small']]);
      Object.defineProperty(
        headers,
        'entries',
        kind === 'accessor' ? { get: inspectRetained } : { value: inspectRetained },
      );
      const stream = new TestStream();
      const iterator = stream.events('payload');

      stream.emitPayload(headers);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(inspectRetained).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([
    { name: 'root proxy', wrap: (proxy: object) => proxy },
    { name: 'nested proxy', wrap: (proxy: object) => ({ nested: proxy }) },
    { name: 'Map-value proxy', wrap: (proxy: object) => new Map([['safe', proxy]]) },
    { name: 'Set-value proxy', wrap: (proxy: object) => new Set([proxy]) },
  ])('rejects a detached $name before invoking its hidden handler', async ({ wrap }) => {
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const read = vi.fn((target: object, property: PropertyKey, receiver: unknown) => {
      if (retained.length === 0) {
        throw new Error('Expected retained handler state');
      }
      return Reflect.get(target, property, receiver);
    });
    const proxy = new Proxy({}, { get: read });
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(wrap(proxy));

    expect(stream.controller.signal.aborted).toBe(true);
    expect(read).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('preserves a proxy identity when delivering directly to a waiting iterator', async () => {
    const proxy = new Proxy({ value: 'direct' }, {});
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const next = iterator.next();

    stream.emitPayload(proxy);

    await expect(next).resolves.toEqual({ value: [proxy], done: false });
    expect(stream.controller.signal.aborted).toBe(false);
  });

  test.each([
    { name: 'root symbol', create: (value: symbol) => value },
    { name: 'nested symbol', create: (value: symbol) => ({ nested: [value] }) },
    { name: 'Map-key symbol', create: (value: symbol) => new Map([[value, 'small']]) },
    { name: 'Set-value symbol', create: (value: symbol) => new Set([value]) },
    { name: 'symbol property key', create: (value: symbol) => ({ [value]: 'small' }) },
  ])('charges retained description storage for a $name', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(create(Symbol('x'.repeat(5 * 1024 * 1024))));

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('uses the captured intrinsic symbol-description getter without invoking a replacement', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const replacement = vi.spyOn(Symbol.prototype, 'description', 'get').mockReturnValue('small');

    try {
      stream.emitPayload(Symbol('x'.repeat(5 * 1024 * 1024)));
      expect(replacement).not.toHaveBeenCalled();
    } finally {
      replacement.mockRestore();
    }

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('charges a repeatedly retained symbol description only once', async () => {
    const symbol = Symbol('x'.repeat(3 * 1024 * 1024));
    const payload = { root: symbol, nested: [symbol], map: new Map([[symbol, symbol]]) };
    const stream = new TestStream();
    const iterator = stream.events('payload');

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(false);
    await expect(iterator.next()).resolves.toEqual({ value: [payload], done: false });
  });

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
    { name: 'Map', create: () => new Map() },
    { name: 'Set', create: () => new Set() },
    { name: 'ArrayBuffer', create: () => new ArrayBuffer(8) },
    { name: 'SharedArrayBuffer', create: () => new SharedArrayBuffer(8) },
    { name: 'DataView', create: () => new DataView(new ArrayBuffer(8)) },
    { name: 'typed array', create: () => new Uint8Array(8) },
    { name: 'Array', create: () => [1, 2, 3] },
    { name: 'Error', create: () => new Error('safe') },
    { name: 'Blob', create: () => new Blob(['safe']) },
    { name: 'Headers', create: () => new Headers([['x-safe', 'small']]) },
  ])('charges oversized data retained by a custom $name prototype', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = create();
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'hidden', { value: 'x'.repeat(5 * 1024 * 1024) });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'Map', create: () => new Map() },
    { name: 'typed array', create: () => new Uint8Array(8) },
    { name: 'Error', create: () => new Error('safe') },
    { name: 'Headers', create: () => new Headers([['x-safe', 'small']]) },
  ])('rejects a custom $name prototype accessor without invoking it', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = create();
    const retained = 'x'.repeat(9 * 1024 * 1024);
    const readAccessor = vi.fn(() => retained);
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, Symbol('hidden closure'), { get: readAccessor });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readAccessor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'Map', create: () => new Map() },
    { name: 'typed array', create: () => new Uint8Array(8) },
    { name: 'Error', create: () => new Error('safe') },
    { name: 'Headers', create: () => new Headers([['x-safe', 'small']]) },
  ])('preserves small safe custom $name prototype data and payload identity', async ({ create }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = create();
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'safe', { value: 'small retained data' });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test('charges custom data through multiple branded prototype levels', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = new Map();
    const first = Object.create(Map.prototype) as object;
    const second = Object.create(first) as object;
    Object.defineProperty(first, 'hidden', { value: 'x'.repeat(5 * 1024 * 1024) });
    Object.setPrototypeOf(payload, second);

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
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

  test('rejects a foreign Error with a producer-controlled constructor without invoking it', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const invokeConstructor = vi.fn(() => {
      throw new Error('producer constructor must not run');
    });
    const payload = runInNewContext(
      `const error = new Error('safe');
       const custom = Object.create(Error.prototype);
       Object.defineProperty(custom, 'constructor', { value: invokeConstructor });
       Object.setPrototypeOf(error, custom);
       error`,
      { invokeConstructor },
    ) as Error;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(invokeConstructor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects a proxied foreign Error constructor without invoking its construct trap', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const invokeConstructor = vi.fn(() => {
      throw new Error('proxied constructor must not run');
    });
    const payload = runInNewContext(
      `const RealError = Error;
       const proxy = new Proxy(RealError, {
         construct() { return invokeConstructor(); },
       });
       Object.defineProperty(RealError.prototype, 'constructor', { value: proxy });
       new RealError('safe')`,
      { invokeConstructor },
    ) as Error;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(invokeConstructor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects an Error-brand spoof without invoking Symbol.toStringTag or stack getters', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readTag = vi.fn(() => 'Error');
    const readStack = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
    const payload = Object.create(null) as object;
    Object.defineProperty(payload, Symbol.toStringTag, { get: readTag });
    Object.defineProperty(payload, 'stack', { get: readStack });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readTag).not.toHaveBeenCalled();
    expect(readStack).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { location: 'own', accessor: false },
    { location: 'own', accessor: true },
    { location: 'inherited', accessor: false },
    { location: 'inherited', accessor: true },
  ])(
    'rejects an $location Symbol.toStringTag Error-brand spoof without invoking its accessor',
    async ({ location, accessor }) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const genuine = runInNewContext("new Error('safe foreign error')") as Error;
      const payload = Object.create(Object.getPrototypeOf(genuine) as object) as object;
      const stack = Object.getOwnPropertyDescriptor(genuine, 'stack');
      if (!stack) {
        throw new Error('Expected a native Error stack descriptor');
      }
      Object.defineProperty(payload, 'stack', stack);

      const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
      const target = location === 'own' ? payload : prototype;
      const readTag = vi.fn(() => 'Error');
      Object.defineProperty(target, Symbol.toStringTag, accessor ? { get: readTag } : { value: 'Error' });
      if (location === 'inherited') {
        Object.setPrototypeOf(payload, prototype);
      }

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(readTag).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test('preserves safe custom prototype data on a genuine cross-realm Error', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext("new Error('safe foreign error')") as Error;
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'safe', { value: 'small' });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    stream.end();
  });

  test.each([4096, 4097, 8192])(
    'buffers ordinary %i-element arrays within the retained-byte budget',
    async (length) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = Array.from({ length }, () => 0);

      stream.emitPayload(payload);

      await expect(iterator.next()).resolves.toEqual({ done: false, value: [payload] });
      expect(stream.controller.signal.aborted).toBe(false);
      stream.end();
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
    { name: 'Error', expression: "new Error('safe foreign error')" },
    { name: 'TypeError', expression: "new TypeError('safe foreign type error')" },
    { name: 'AggregateError', expression: "new AggregateError([], 'safe foreign aggregate error')" },
  ])('accepts a small genuine cross-realm $name and preserves its identity', async ({ expression }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext(expression) as Error;

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
    expect(stream.controller.signal.aborted).toBe(false);
    stream.end();
  });

  test.each(['get', 'set'] as const)(
    'rejects a producer-replaced cross-realm Error stack %s without invoking it',
    async (accessor) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = runInNewContext("new Error('safe foreign error')") as Error;
      const descriptor = Object.getOwnPropertyDescriptor(payload, 'stack');
      const readAccessor = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
      Object.defineProperty(payload, 'stack', { ...descriptor, [accessor]: readAccessor });

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(readAccessor).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each(['get', 'set'] as const)(
    'rejects a same-realm proxied native Error stack %s without invoking its trap',
    async (accessor) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const invokeAccessor = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
      const payload = runInNewContext(
        `const error = new Error('safe foreign error');
         const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
         Object.defineProperty(error, 'stack', {
           ...descriptor,
           [accessor]: new Proxy(descriptor[accessor], {
             apply() { return invokeAccessor(); },
           }),
         });
         error`,
        { accessor, invokeAccessor },
      ) as Error;

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(invokeAccessor).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test.each([
    { name: 'Map', expression: 'new Map()' },
    { name: 'Set', expression: 'new Set()' },
    { name: 'ArrayBuffer', expression: 'new ArrayBuffer(8)' },
    { name: 'typed array', expression: 'new Uint8Array(8)' },
  ])('charges custom prototype data retained by a cross-realm $name', async ({ expression }) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext(expression) as object;
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'hidden', { value: 'x'.repeat(5 * 1024 * 1024) });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each([
    { name: 'Map', prototype: 'Map.prototype', expression: 'new Map()' },
    { name: 'Set', prototype: 'Set.prototype', expression: 'new Set()' },
    { name: 'ArrayBuffer', prototype: 'ArrayBuffer.prototype', expression: 'new ArrayBuffer(8)' },
    { name: 'DataView', prototype: 'DataView.prototype', expression: 'new DataView(new ArrayBuffer(8))' },
    { name: 'typed array', prototype: 'Uint8Array.prototype', expression: 'new Uint8Array(8)' },
    {
      name: 'shared typed-array parent',
      prototype: 'Object.getPrototypeOf(Uint8Array.prototype)',
      expression: 'new Uint8Array(8)',
    },
    { name: 'Array', prototype: 'Array.prototype', expression: '[1, 2, 3]' },
    { name: 'Error', prototype: 'Error.prototype', expression: "new Error('safe')" },
    { name: 'Object parent', prototype: 'Object.prototype', expression: 'new Map()' },
  ])('charges oversized data added directly to a foreign $name intrinsic prototype', async (scenario) => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext(
      `Object.defineProperty(${scenario.prototype}, 'retained', {
         value: 'x'.repeat(5 * 1024 * 1024),
       });
       ${scenario.expression}`,
    ) as object;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['Map.prototype', 'Object.prototype'] as const)(
    'rejects an accessor added to foreign %s without invoking its retained closure',
    async (prototype) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const readAccessor = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
      const payload = runInNewContext(
        `Object.defineProperty(${prototype}, 'retained', { get: readAccessor }); new Map()`,
        { readAccessor },
      ) as object;

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(readAccessor).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test('rejects a producer-replaced foreign intrinsic method without invoking its closure', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const invokeMethod = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
    const payload = runInNewContext('Map.prototype.get = invokeMethod; new Map()', { invokeMethod }) as Map<
      unknown,
      unknown
    >;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(invokeMethod).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('rejects a replaced foreign intrinsic getter without invoking its retained closure', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const readSize = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
    const payload = runInNewContext(
      "Object.defineProperty(Map.prototype, 'size', { get: readSize }); new Map()",
      { readSize },
    ) as Map<unknown, unknown>;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(readSize).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['toBase64', 'toHex'] as const)(
    'rejects a replaced cross-realm typed-array %s method without invoking it',
    async (method) => {
      if (!Object.getOwnPropertyDescriptor(Uint8Array.prototype, method)) {
        return;
      }

      const stream = new TestStream();
      const iterator = stream.events('payload');
      const invokeMethod = vi.fn(() => 'x'.repeat(9 * 1024 * 1024));
      const payload = runInNewContext(`Uint8Array.prototype.${method} = invokeMethod; new Uint8Array(8)`, {
        invokeMethod,
      }) as Uint8Array;

      stream.emitPayload(payload);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(invokeMethod).not.toHaveBeenCalled();
      await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
    },
  );

  test('rejects a proxied hidden native Function realm without invoking its constructor', async () => {
    if (!Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toHex')) {
      return;
    }

    const stream = new TestStream();
    const iterator = stream.events('payload');
    const invokeConstructor = vi.fn(() => {
      throw new Error('producer Function constructor must not run');
    });
    const payload = runInNewContext(
      `const prototype = Object.getPrototypeOf(Uint8Array.prototype.toHex);
       const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor').value;
       Object.defineProperty(prototype, 'constructor', {
         value: new Proxy(constructor, { construct() { return invokeConstructor(); } }),
       });
       new Uint8Array(8)`,
      { invokeConstructor },
    ) as Uint8Array;

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(invokeConstructor).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test('revalidates a foreign intrinsic prototype changed by a later listener', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext('new Map()') as Map<unknown, unknown>;
    stream.on('payload', () => {
      Object.defineProperty(Object.getPrototypeOf(payload) as object, 'retained', {
        value: 'x'.repeat(5 * 1024 * 1024),
      });
    });

    stream.emitPayload(payload);

    expect(stream.controller.signal.aborted).toBe(true);
    await expect(iterator.next()).rejects.toThrow(/iterator buffer limit/iu);
  });

  test.each(['Map.prototype', 'Object.prototype'] as const)(
    'preserves safe data added to foreign %s and the queued payload identity',
    async (prototype) => {
      const stream = new TestStream();
      const iterator = stream.events('payload');
      const payload = runInNewContext(
        `Object.defineProperty(${prototype}, 'safe', { value: 'small' }); new Map()`,
      ) as Map<unknown, unknown>;

      stream.emitPayload(payload);

      const result = await iterator.next();
      expect(result.value?.[0]).toBe(payload);
      expect(stream.controller.signal.aborted).toBe(false);
      stream.end();
    },
  );

  test('preserves safe custom prototype data on a genuine cross-realm Map', async () => {
    const stream = new TestStream();
    const iterator = stream.events('payload');
    const payload = runInNewContext("new Map([['safe', 'value']])") as Map<string, string>;
    const prototype = Object.create(Object.getPrototypeOf(payload) as object) as object;
    Object.defineProperty(prototype, 'safe', { value: 'small' });
    Object.setPrototypeOf(payload, prototype);

    stream.emitPayload(payload);

    const result = await iterator.next();
    expect(result.value?.[0]).toBe(payload);
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
