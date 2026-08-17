import { vi } from 'vitest';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

const WAITER_COUNT = 4096;

interface EmittedEvents extends BaseEvents {
  value: (value: number) => void;
  other: (value: string) => void;
  pair: (left: string, right: number) => void;
  __proto__: (value: number) => void;
}

class EmittedTestStream extends EventStream<EmittedEvents> {
  emitValue(value: number): void {
    this._emit('value', value);
  }

  emitOther(value: string): void {
    this._emit('other', value);
  }

  emitPair(left: string, right: number): void {
    this._emit('pair', left, right);
  }

  emitPrototype(value: number): void {
    this._emit('__proto__', value);
  }

  emitFailure(error: OpenAIError): void {
    this._emit('error', error);
  }

  emitAbort(error: APIUserAbortError): void {
    this._emit('abort', error);
  }

  end(): void {
    this._emit('end');
  }

  hasListener(event: keyof EmittedEvents): boolean {
    return this._hasListeners(event);
  }
}

function measureListenerMovement<T>(operation: () => T): {
  result: T;
  elementMoves: number;
  spliceCalls: number;
} {
  const originalSplice = Array.prototype.splice;
  const originalFilter = Array.prototype.filter;
  let elementMoves = 0;
  let spliceCalls = 0;

  function trackedSplice(this: unknown[], start: number, deleteCount?: number, ...items: unknown[]) {
    if (deleteCount === 1 && items.length === 0) {
      elementMoves += Math.max(this.length - start - deleteCount, 0);
      spliceCalls += 1;
    }
    if (deleteCount === undefined) {
      return Reflect.apply(originalSplice, this, [start]);
    }
    return originalSplice.call(this, start, deleteCount, ...items);
  }

  function trackedFilter(
    this: unknown[],
    predicate: (value: unknown, index: number, values: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    const result = originalFilter.call(this, predicate, thisArg);
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'splice', trackedSplice);
  Reflect.set(Array.prototype, 'filter', trackedFilter);
  try {
    return { result: operation(), elementMoves, spliceCalls };
  } finally {
    Reflect.set(Array.prototype, 'filter', originalFilter);
    Reflect.set(Array.prototype, 'splice', originalSplice);
  }
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('EventStream.emitted companion-listener performance', () => {
  test('settles concurrent event waiters with linear listener movement', async () => {
    const stream = new EmittedTestStream();
    const pending = Array.from({ length: WAITER_COUNT }, () => stream.emitted('value'));

    const { elementMoves, spliceCalls } = measureListenerMovement(() => stream.emitValue(42));

    await expect(Promise.all(pending)).resolves.toEqual(Array.from({ length: WAITER_COUNT }, () => 42));
    expect(elementMoves).toBeLessThanOrEqual(WAITER_COUNT * 4);
    expect(spliceCalls).toBe(0);
    expect(stream.hasListener('value')).toBe(false);
    expect(stream.hasListener('error')).toBe(false);
  });

  test('rejects concurrent event waiters with linear listener movement when an error arrives first', async () => {
    const stream = new EmittedTestStream();
    const failure = new OpenAIError('stream failed');
    const pending = Array.from({ length: WAITER_COUNT }, () => captureRejection(stream.emitted('value')));

    const { elementMoves, spliceCalls } = measureListenerMovement(() => stream.emitFailure(failure));

    const rejected = await Promise.all(pending);
    expect(rejected).toHaveLength(WAITER_COUNT);
    expect(rejected.every((error) => error === failure)).toBe(true);
    expect(elementMoves).toBeLessThanOrEqual(WAITER_COUNT * 4);
    expect(spliceCalls).toBe(0);
    expect(stream.hasListener('value')).toBe(false);
    expect(stream.hasListener('error')).toBe(false);
  });

  test('cleans only settled companions while preserving mixed events and user error listeners', async () => {
    const stream = new EmittedTestStream();
    const userError = vi.fn();
    stream.on('error', userError);
    const first = stream.emitted('value');
    const second = stream.emitted('other');
    const third = stream.emitted('value');

    stream.emitValue(7);

    await expect(Promise.all([first, third])).resolves.toEqual([7, 7]);
    expect(stream.hasListener('value')).toBe(false);
    expect(stream.hasListener('other')).toBe(true);
    expect(stream.hasListener('error')).toBe(true);

    stream.emitOther('ready');
    await expect(second).resolves.toBe('ready');
    expect(stream.hasListener('other')).toBe(false);
    expect(stream.hasListener('error')).toBe(true);

    stream.off('error', userError);
    expect(stream.hasListener('error')).toBe(false);
    expect(userError).not.toHaveBeenCalled();
  });

  test('preserves error callback registration order across mixed pending events', async () => {
    const stream = new EmittedTestStream();
    const order: string[] = [];
    const failure = new OpenAIError('failure');
    stream.on('error', () => {
      order.push('first');
    });
    const first = captureRejection(stream.emitted('value'));
    stream.on('error', () => {
      order.push('second');
    });
    const second = captureRejection(stream.emitted('other'));

    stream.emitFailure(failure);

    await expect(Promise.all([first, second])).resolves.toEqual([failure, failure]);
    expect(order).toEqual(['first', 'second']);
    expect(stream.hasListener('value')).toBe(false);
    expect(stream.hasListener('other')).toBe(false);
  });

  test('preserves observable public once and off hooks for companion listeners', async () => {
    const stream = new EmittedTestStream();
    const register = vi.spyOn(stream, 'once');
    const remove = vi.spyOn(stream, 'off');
    const pending = stream.emitted('value');

    expect(register).toHaveBeenCalledWith('error', expect.any(Function));
    expect(register).toHaveBeenCalledWith('value', expect.any(Function));

    stream.emitValue(13);

    await expect(pending).resolves.toBe(13);
    expect(remove).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('preserves duplicate user callbacks, once listeners, and immediate off semantics', async () => {
    const stream = new EmittedTestStream();
    const duplicate = vi.fn();
    stream.on('value', duplicate);
    stream.on('value', duplicate);
    stream.once('value', duplicate);
    const pending = stream.emitted('value');

    stream.off('value', duplicate);
    stream.emitValue(1);
    await expect(pending).resolves.toBe(1);
    expect(duplicate).toHaveBeenCalledTimes(2);

    stream.emitValue(2);
    expect(duplicate).toHaveBeenCalledTimes(3);
    stream.off('value', duplicate);
    expect(stream.hasListener('value')).toBe(false);
  });

  test('preserves listener snapshots, nested emits, and registrations during dispatch', async () => {
    const stream = new EmittedTestStream();
    const order: string[] = [];
    const removed = () => {
      order.push('removed');
    };
    const added = () => {
      order.push('added');
    };
    stream.on('value', (value) => {
      order.push('first');
      if (value === 1) {
        stream.off('value', removed);
        stream.on('value', added);
        stream.emitOther('nested');
      }
    });
    stream.on('value', removed);
    const value = stream.emitted('value');
    const nested = stream.emitted('other');

    stream.emitValue(1);

    await expect(value).resolves.toBe(1);
    await expect(nested).resolves.toBe('nested');
    expect(order).toEqual(['first', 'removed']);
    expect(stream.hasListener('error')).toBe(false);

    stream.emitValue(2);
    expect(order).toEqual(['first', 'removed', 'first', 'added']);
  });

  test('preserves event and error settlement order across nested emissions', async () => {
    const rejectedStream = new EmittedTestStream();
    const failure = new OpenAIError('nested failure');
    rejectedStream.on('value', () => {
      rejectedStream.emitFailure(failure);
    });
    const rejected = captureRejection(rejectedStream.emitted('value'));

    rejectedStream.emitValue(1);

    await expect(rejected).resolves.toBe(failure);
    expect(rejectedStream.hasListener('value')).toBe(true);
    expect(rejectedStream.hasListener('error')).toBe(false);

    const resolvedStream = new EmittedTestStream();
    resolvedStream.on('error', () => {
      resolvedStream.emitValue(2);
    });
    const resolved = resolvedStream.emitted('value');

    resolvedStream.emitFailure(failure);

    await expect(resolved).resolves.toBe(2);
    expect(resolvedStream.hasListener('value')).toBe(false);
  });

  test('keeps earlier settled promises resolved when a later event fails', async () => {
    const stream = new EmittedTestStream();
    const resolved = stream.emitted('value');
    const failure = new OpenAIError('later failure');
    const rejected = captureRejection(stream.emitted('other'));

    stream.emitValue(3);
    stream.emitFailure(failure);

    await expect(resolved).resolves.toBe(3);
    await expect(rejected).resolves.toBe(failure);
    expect(stream.hasListener('value')).toBe(false);
    expect(stream.hasListener('other')).toBe(false);
  });

  test('preserves multi-argument, error-event, abort, and end promise semantics', async () => {
    const paired = new EmittedTestStream();
    const pair = paired.emitted('pair');
    paired.emitPair('left', 9);
    await expect(pair).resolves.toEqual(['left', 9]);
    expect(paired.hasListener('error')).toBe(false);

    const errored = new EmittedTestStream();
    const failure = new OpenAIError('event value');
    const error = errored.emitted('error');
    errored.emitFailure(failure);
    await expect(error).resolves.toBe(failure);

    const aborted = new EmittedTestStream();
    const reason = new APIUserAbortError();
    const abort = aborted.emitted('abort');
    aborted.emitAbort(reason);
    await expect(abort).resolves.toBe(reason);
    expect(aborted.hasListener('error')).toBe(false);

    const ended = new EmittedTestStream();
    const done = ended.emitted('end');
    ended.end();
    await expect(done).resolves.toBeUndefined();
    expect(ended.hasListener('error')).toBe(false);
  });

  test('cleans settled companions if a subsequent user listener throws', async () => {
    const stream = new EmittedTestStream();
    const pending = stream.emitted('value');
    const failure = new Error('listener failed');
    stream.on('value', () => {
      throw failure;
    });

    expect(() => stream.emitValue(5)).toThrow(failure);
    await expect(pending).resolves.toBe(5);
    expect(stream.hasListener('error')).toBe(false);
  });

  test('supports prototype-like event names without listener collisions', async () => {
    const stream = new EmittedTestStream();
    const pending = stream.emitted('__proto__');

    stream.emitPrototype(11);

    await expect(pending).resolves.toBe(11);
    expect(stream.hasListener('__proto__')).toBe(false);
    expect(stream.hasListener('error')).toBe(false);
  });

  test('continues reporting genuinely unhandled stream errors', () => {
    const stream = new EmittedTestStream();
    const failure = new OpenAIError('unhandled');
    const reject = vi.spyOn(Promise, 'reject').mockImplementation(() => Promise.resolve() as Promise<never>);

    try {
      stream.emitFailure(failure);
      expect(reject).toHaveBeenCalledWith(failure);
    } finally {
      reject.mockRestore();
    }
  });
});
