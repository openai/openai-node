import { vi } from 'vitest';
import type OpenAI from 'openai';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { EventStream } from 'openai/lib/EventStream';
import type { BaseEvents } from 'openai/lib/EventStream';

const QUEUE_SIZE = 4096;

interface QueueEvents extends BaseEvents {
  value: (value: unknown) => void;
  empty: () => void;
}

class QueueTestStream extends EventStream<QueueEvents> {
  emitValue(value: unknown): void {
    this._emit('value', value);
  }

  emitEmpty(): void {
    this._emit('empty');
  }

  emitError(error: OpenAIError): void {
    this._emit('error', error);
  }

  emitAbort(error: APIUserAbortError): void {
    this._emit('abort', error);
  }

  end(): void {
    this._emit('end');
  }

  hasListener(event: keyof QueueEvents): boolean {
    return this._hasListeners(event);
  }

  values(): AsyncIterableIterator<unknown> {
    return this._createIterator((push) => {
      this.on('value', push);
      return () => this.off('value', push);
    });
  }
}

function measureArrayMovement<T>(operation: () => T): { result: T; elementMoves: number } {
  const originalShift = Array.prototype.shift;
  const originalSlice = Array.prototype.slice;
  let elementMoves = 0;

  function trackedShift(this: unknown[]) {
    elementMoves += Math.max(this.length - 1, 0);
    return originalShift.call(this);
  }

  function trackedSlice(this: unknown[], start?: number, end?: number) {
    const result = originalSlice.call(this, start, end);
    elementMoves += result.length;
    return result;
  }

  Reflect.set(Array.prototype, 'shift', trackedShift);
  Reflect.set(Array.prototype, 'slice', trackedSlice);

  try {
    const result = operation();
    return { result, elementMoves };
  } finally {
    Reflect.set(Array.prototype, 'slice', originalSlice);
    Reflect.set(Array.prototype, 'shift', originalShift);
  }
}

function createChatStream(chunks: OpenAI.Chat.ChatCompletionChunk[]): ChatCompletionStream {
  const client = {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          controller: new AbortController(),
          async *[Symbol.asyncIterator]() {
            yield* chunks;
          },
        })),
      },
    },
  } as unknown as OpenAI;

  return ChatCompletionStream.createChatCompletion(client, {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'test queue performance' }],
  });
}

describe('EventStream iterator queue performance', () => {
  test('drains buffered events with linear array movement', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');

    for (let index = 0; index < QUEUE_SIZE; index += 1) {
      stream.emitValue(index);
    }

    const { result: pending, elementMoves } = measureArrayMovement(() =>
      Array.from({ length: QUEUE_SIZE }, () => iterator.next()),
    );
    const received = await Promise.all(pending);

    expect(received).toHaveLength(QUEUE_SIZE);
    expect(received.every((result, index) => !result.done && result.value[0] === index)).toBe(true);
    expect(elementMoves).toBeLessThanOrEqual(QUEUE_SIZE * 8);

    stream.end();
  });

  test('serves many pending readers in FIFO order with linear array movement', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');
    const pending = Array.from({ length: QUEUE_SIZE }, () => iterator.next());

    const { elementMoves } = measureArrayMovement(() => {
      for (let index = 0; index < QUEUE_SIZE; index += 1) {
        stream.emitValue(index);
      }
    });
    const received = await Promise.all(pending);

    expect(received.every((result, index) => !result.done && result.value[0] === index)).toBe(true);
    expect(elementMoves).toBeLessThanOrEqual(QUEUE_SIZE * 8);

    stream.end();
  });

  test('finishes many pending readers with linear array movement', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');
    const pending = Array.from({ length: QUEUE_SIZE }, () => iterator.next());

    const { elementMoves } = measureArrayMovement(() => stream.end());
    const received = await Promise.all(pending);

    expect(received.every((result) => result.done && result.value === undefined)).toBe(true);
    expect(elementMoves).toBeLessThanOrEqual(QUEUE_SIZE * 8);
  });

  test('preserves order when producers and consumers alternate', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');
    const pending: Promise<IteratorResult<[unknown]>>[] = [];

    for (let index = 0; index < QUEUE_SIZE; index += 1) {
      pending.push(iterator.next());
      stream.emitValue(index);
    }

    const received = await Promise.all(pending);

    expect(received.every((result, index) => !result.done && result.value[0] === index)).toBe(true);

    stream.end();
  });

  test('bounds queue storage while maintaining a large steady backlog', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');
    const queueMarker = Symbol('event-stream queue');
    const backlog = 2048;
    const cycles = 8192;
    const pending: Promise<IteratorResult<[unknown]>>[] = [];
    const originalPush = Array.prototype.push;
    let maximumQueueLength = 0;

    function trackedPush(this: unknown[], ...values: unknown[]) {
      const result = originalPush.apply(this, values);
      const [tuple] = values;

      if (
        values.length === 1 &&
        Array.isArray(tuple) &&
        tuple.length === 1 &&
        typeof tuple[0] === 'object' &&
        tuple[0] !== null &&
        'marker' in tuple[0] &&
        tuple[0].marker === queueMarker
      ) {
        maximumQueueLength = Math.max(maximumQueueLength, this.length);
      }

      return result;
    }

    Reflect.set(Array.prototype, 'push', trackedPush);

    try {
      for (let index = 0; index < backlog; index += 1) {
        stream.emitValue({ marker: queueMarker, index });
      }

      for (let index = 0; index < cycles; index += 1) {
        pending.push(iterator.next());
        stream.emitValue({ marker: queueMarker, index: backlog + index });
      }
    } finally {
      Reflect.set(Array.prototype, 'push', originalPush);
    }

    expect(maximumQueueLength).toBeLessThanOrEqual(backlog * 2);
    await expect(Promise.all(pending)).resolves.toHaveLength(cycles);

    await iterator.return?.();
  });

  test('immediately releases references to consumed buffered values', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.events('value');
    const consumed = { marker: Symbol('consumed queue entry') };
    const retained = { marker: Symbol('retained queue entry') };
    const originalPush = Array.prototype.push;
    const queues: unknown[][] = [];

    function trackedPush(this: unknown[], ...values: unknown[]) {
      if (values.length === 1 && Array.isArray(values[0]) && values[0][0] === consumed) {
        originalPush.call(queues, this);
      }

      return originalPush.apply(this, values);
    }

    Reflect.set(Array.prototype, 'push', trackedPush);

    try {
      stream.emitValue(consumed);
      stream.emitValue(retained);
    } finally {
      Reflect.set(Array.prototype, 'push', originalPush);
    }

    const [queue] = queues;
    expect(queue).toBeDefined();

    const next = iterator.next();

    expect(queue?.some((value) => Array.isArray(value) && value[0] === consumed)).toBe(false);
    await expect(next).resolves.toEqual({ done: false, value: [consumed] });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: [retained] });
    expect(queue?.every((value) => value === undefined)).toBe(true);

    stream.end();
  });

  test('drains the real public chat-completion iterator with linear array movement', async () => {
    const chunks = Array.from({ length: QUEUE_SIZE }, (_, index): OpenAI.Chat.ChatCompletionChunk => {
      const choices: OpenAI.Chat.ChatCompletionChunk.Choice[] = [];

      if (index === 0) {
        choices.push({
          index: 0,
          delta: { role: 'assistant', content: 'x' },
          finish_reason: null,
          logprobs: null,
        });
      } else if (index === QUEUE_SIZE - 1) {
        choices.push({ index: 0, delta: {}, finish_reason: 'stop', logprobs: null });
      }

      return {
        id: 'chatcmpl-queue-performance',
        object: 'chat.completion.chunk',
        created: index,
        model: 'gpt-test',
        choices,
      };
    });
    const stream = createChatStream(chunks);
    const iterator = stream[Symbol.asyncIterator]();

    await stream.done();

    const { result: pending, elementMoves } = measureArrayMovement(() =>
      Array.from({ length: QUEUE_SIZE }, () => iterator.next()),
    );
    const received = await Promise.all(pending);

    expect(received.every((result, index) => !result.done && result.value.created === index)).toBe(true);
    expect(elementMoves).toBeLessThanOrEqual(QUEUE_SIZE * 8);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });
});

describe('EventStream iterator queue lifecycle', () => {
  test.each(['error', 'abort'] as const)(
    'delivers buffered values before exactly one %s rejection',
    async (termination) => {
      const stream = new QueueTestStream();
      const iterator = stream.events('value');
      const failure = termination === 'abort' ? new APIUserAbortError() : new OpenAIError('queue failed');

      stream.emitValue('first');
      stream.emitValue('second');

      if (failure instanceof APIUserAbortError) {
        stream.emitAbort(failure);
      } else {
        stream.emitError(failure);
      }

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => iterator.next()));

      expect(results).toEqual([
        { status: 'fulfilled', value: { done: false, value: ['first'] } },
        { status: 'fulfilled', value: { done: false, value: ['second'] } },
        { status: 'rejected', reason: failure },
        { status: 'fulfilled', value: { done: true, value: undefined } },
        { status: 'fulfilled', value: { done: true, value: undefined } },
      ]);
    },
  );

  test.each(['error', 'abort'] as const)(
    'rejects only the first pending reader on %s and finishes the others',
    async (termination) => {
      const stream = new QueueTestStream();
      const iterator = stream.events('value');
      const pending = Promise.allSettled(Array.from({ length: 4 }, () => iterator.next()));
      const failure = termination === 'abort' ? new APIUserAbortError() : new OpenAIError('pending failed');

      if (failure instanceof APIUserAbortError) {
        stream.emitAbort(failure);
      } else {
        stream.emitError(failure);
      }

      await expect(pending).resolves.toEqual([
        { status: 'rejected', reason: failure },
        { status: 'fulfilled', value: { done: true, value: undefined } },
        { status: 'fulfilled', value: { done: true, value: undefined } },
        { status: 'fulfilled', value: { done: true, value: undefined } },
      ]);
    },
  );

  test.each(['return', 'end', 'error', 'abort'] as const)(
    'cleans up producer and lifecycle listeners on %s',
    async (termination) => {
      const stream = new QueueTestStream();
      const iterator = stream.events('value');

      expect(
        ['value', 'end', 'error', 'abort'].every((event) => stream.hasListener(event as keyof QueueEvents)),
      ).toBe(true);

      if (termination === 'return') {
        await iterator.return?.();
      } else if (termination === 'end') {
        stream.end();
      } else if (termination === 'error') {
        stream.emitError(new OpenAIError('listener cleanup'));
        await expect(iterator.next()).rejects.toThrow('listener cleanup');
      } else {
        stream.emitAbort(new APIUserAbortError());
        await expect(iterator.next()).rejects.toBeInstanceOf(APIUserAbortError);
      }

      for (const event of ['value', 'end', 'error', 'abort'] as const) {
        expect(stream.hasListener(event)).toBe(false);
      }
    },
  );

  test('immediately finishes an iterator created after the stream ends', async () => {
    const stream = new QueueTestStream();
    stream.end();
    const register = vi.spyOn(stream, 'on');
    const iterator = stream.events('value');

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(register).not.toHaveBeenCalled();
  });

  test('preserves empty event arguments and undefined payloads', async () => {
    const stream = new QueueTestStream();
    const empty = stream.events('empty');
    const undefinedValue = stream.events('value');
    const missing = new Map<string, unknown>().get('missing');

    stream.emitEmpty();
    stream.emitValue(missing);
    stream.end();

    await expect(empty.next()).resolves.toEqual({ done: false, value: [] });
    await expect(undefinedValue.next()).resolves.toEqual({ done: false, value: [missing] });
    await expect(Promise.all([empty.next(), undefinedValue.next()])).resolves.toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ]);
  });

  test('preserves undefined and other falsy values from the shared iterator adapter', async () => {
    const stream = new QueueTestStream();
    const iterator = stream.values();
    const missing = new Map<string, unknown>().get('missing');
    const values = [missing, null, false, 0, ''];

    for (const value of values) {
      stream.emitValue(value);
    }
    stream.end();

    const results = await Promise.all(Array.from({ length: values.length }, () => iterator.next()));

    expect(results.map((result) => result.value)).toEqual(values);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  test('maintains independent queues for multiple iterators on one stream', async () => {
    const stream = new QueueTestStream();
    const first = stream.events('value');
    const second = stream.events('value');

    stream.emitValue('first');
    stream.emitValue('second');
    stream.end();

    const results = await Promise.all([first.next(), first.next(), second.next(), second.next()]);

    expect(results).toEqual([
      { done: false, value: ['first'] },
      { done: false, value: ['second'] },
      { done: false, value: ['first'] },
      { done: false, value: ['second'] },
    ]);
    await expect(Promise.all([first.next(), second.next()])).resolves.toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ]);
  });
});
