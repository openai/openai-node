import { vi } from 'vitest';
import OpenAI from 'openai';
import { APIError, APIUserAbortError, OpenAIError } from 'openai/core/error';
import { Stream, _iterSSEMessages } from 'openai/core/streaming';
import * as lineDecoders from 'openai/internal/decoders/line';
import { ReadableStreamFrom } from 'openai/internal/shims';

const encoder = new TextEncoder();

function responseForSSE(value: string): Response {
  return new Response(ReadableStreamFrom([encoder.encode(value)]));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

function settlesSoon<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // oxlint-disable-next-line promise/avoid-new -- Bound regression fixtures that intentionally never settle.
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Aborted SSE stream did not settle')), 1500);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

describe('Stream.fromSSEResponse', () => {
  test('parses data events and ignores events after the completion sentinel', async () => {
    const response = responseForSSE('data: {"id":1}\n\ndata: {"id":2}\n\ndata: [DONE]\n\ndata: not-json\n\n');
    const stream = Stream.fromSSEResponse<{ id: number }>(response, new AbortController());

    await expect(collect(stream)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  test.each(['before', 'registration', 'buffered'])('hides data after %s abort', async (stage) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(encoder.encode('data: {"id":1}\n\ndata: {"private":"never expose"}\n\n'));
      },
      cancel,
    });
    const controller = new AbortController();
    const reason = new Error('private abort reason');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    if (stage === 'registration') {
      const addListener = controller.signal.addEventListener.bind(controller.signal);
      vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
        controller.abort(reason);
        addListener(...args);
      });
    }
    const iterator = Stream.fromSSEResponse(new Response(body), controller)[Symbol.asyncIterator]();
    if (stage === 'buffered') {
      await expect(iterator.next()).resolves.toEqual({ value: { id: 1 }, done: false });
    }
    if (stage !== 'registration') {
      controller.abort(reason);
    }

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(cancel).toHaveBeenCalledWith(undefined);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(body.locked).toBe(false);
  });

  test.each([
    ['rejects', () => Promise.reject(new Error('private cancellation failure'))],
    ['never resolves', () => Promise.race([])],
  ])('settles an aborted pending response read when source cancellation %s', async (_, cancellation) => {
    const cancel = vi.fn(cancellation);
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const iterator = Stream.fromSSEResponse(new Response(body), controller)[Symbol.asyncIterator]();
    const pending = settlesSoon(iterator.next());
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort(new Error('private abort reason'));

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(cancel.mock.calls).toEqual([[undefined]]);
    expect(body.locked).toBe(false);
  });

  test.each(['raw', 'helper'])('settles public %s Responses aborts', async (kind) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    const caller = new AbortController();
    const onabort = vi.fn();
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Existing caller handlers must survive streaming.
    caller.signal.onabort = onabort;
    const params = { model: 'gpt-4o', input: 'hello' };
    const completion: Promise<unknown> =
      kind === 'raw'
        ? client.responses
            .create({ ...params, stream: true }, { signal: caller.signal })
            .then((stream) => stream[Symbol.asyncIterator]().next())
        : client.responses.stream(params, { signal: caller.signal }).finalResponse();
    const assertion =
      kind === 'raw'
        ? expect(settlesSoon(completion)).resolves.toEqual({ value: undefined, done: true })
        : expect(settlesSoon(completion)).rejects.toBeInstanceOf(APIUserAbortError);
    const reason = new Error('private caller abort reason');

    await vi.waitFor(() => expect(body.locked).toBe(true));
    caller.abort(reason);

    await assertion;
    expect(caller.signal.reason).toBe(reason);
    expect(caller.signal.onabort).toBe(onabort);
    expect(cancel).toHaveBeenCalledWith(undefined);
    expect(body.locked).toBe(false);
  });

  test('finishes at the completion sentinel without waiting for the response body to close', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":1}\n\ndata: [DONE]\n\n'));
        },
        pull() {
          throw new Error('Attempted to read past the [DONE] completion sentinel');
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const iterator = Stream.fromSSEResponse<{ id: number }>(new Response(body), controller)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({ value: { id: 1 }, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  test('finishes at the completion sentinel and aborts when response cancellation rejects', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('Response body cancellation failed'));
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":1}\n\ndata: [DONE]\n\n'));
        },
        pull() {
          throw new Error('Attempted to read past the [DONE] completion sentinel');
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const iterator = Stream.fromSSEResponse<{ id: number }>(new Response(body), controller)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({ value: { id: 1 }, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  test('optionally preserves the event name alongside its parsed data', async () => {
    const response = responseForSSE('event: response.output_text.delta\ndata: {"delta":"hello"}\n\n');
    const stream = Stream.fromSSEResponse(response, new AbortController(), undefined, true);

    await expect(collect(stream)).resolves.toEqual([
      { event: 'response.output_text.delta', data: { delta: 'hello' } },
    ]);
  });

  test('preserves thread events as event/data envelopes', async () => {
    const response = responseForSSE('event: thread.run.completed\ndata: {"id":"run_123"}\n\n');
    const stream = Stream.fromSSEResponse(response, new AbortController());

    await expect(collect(stream)).resolves.toEqual([
      { event: 'thread.run.completed', data: { id: 'run_123' } },
    ]);
  });

  test('raises typed API errors embedded in streamed data', async () => {
    const response = responseForSSE('data: {"error":{"message":"stream failed","code":"bad_request"}}\n\n');
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    await expect(collect(stream)).rejects.toThrow(APIError);
    expect(controller.signal.aborted).toBe(true);
  });

  test('reports malformed JSON from normal and thread events', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const ordinary = Stream.fromSSEResponse(responseForSSE('data: {bad-json}\n\n'), new AbortController());
      const thread = Stream.fromSSEResponse(
        responseForSSE('event: thread.message.delta\ndata: {bad-json}\n\n'),
        new AbortController(),
      );

      await expect(collect(ordinary)).rejects.toThrow(SyntaxError);
      await expect(collect(thread)).rejects.toThrow(SyntaxError);
      expect(consoleError).toHaveBeenCalledTimes(4);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('prevents iterating over an already consumed response stream', async () => {
    const stream = Stream.fromSSEResponse(responseForSSE('data: {"id":1}\n\n'), new AbortController());

    await collect(stream);

    await expect(collect(stream)).rejects.toThrow('Cannot iterate over a consumed stream');
  });

  test('aborts the request if the caller stops consuming early', async () => {
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseForSSE('data: {"id":1}\n\ndata: {"id":2}\n\n'), controller);

    for await (const _item of stream) {
      break;
    }

    expect(controller.signal.aborted).toBe(true);
  });
});

describe('Stream.fromReadableStream', () => {
  test('parses newline-separated JSON while ignoring blank lines and flushing the final line', async () => {
    const readable = ReadableStreamFrom([encoder.encode('{"id":1}\n\n'), encoder.encode('{"id":2}')]);
    const stream = Stream.fromReadableStream<{ id: number }>(readable, new AbortController());

    await expect(collect(stream)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('prevents reading the same newline-delimited stream twice', async () => {
    const stream = Stream.fromReadableStream(
      ReadableStreamFrom([encoder.encode('{"id":1}\n')]),
      new AbortController(),
    );

    await collect(stream);

    await expect(collect(stream)).rejects.toThrow('Cannot iterate over a consumed stream');
  });

  test('cancels readers that were already aborted before consumption', async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = {
      read: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const stream = Stream.fromReadableStream({ getReader: () => reader } as any, controller);

    await expect(collect(stream)).resolves.toEqual([]);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(reader.read).not.toHaveBeenCalled();
  });

  test('cancels readers when an abort arrives while a chunk is being read', async () => {
    const controller = new AbortController();
    const reader = {
      read: vi.fn().mockImplementation(async () => {
        controller.abort();
        return { done: false, value: encoder.encode('{"ignored":true}\n') };
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const stream = Stream.fromReadableStream({ getReader: () => reader } as any, controller);

    await expect(collect(stream)).resolves.toEqual([]);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  test('aborts and reports malformed newline-delimited JSON', async () => {
    const controller = new AbortController();
    const stream = Stream.fromReadableStream(
      ReadableStreamFrom([encoder.encode('{not-json}\n')]),
      controller,
    );

    await expect(collect(stream)).rejects.toThrow(SyntaxError);
    expect(controller.signal.aborted).toBe(true);
  });

  test('cancels and aborts the source if iteration is interrupted', async () => {
    const controller = new AbortController();
    const stream = Stream.fromReadableStream(
      ReadableStreamFrom([encoder.encode('{"id":1}\n{"id":2}\n')]),
      controller,
    );

    for await (const _item of stream) {
      break;
    }

    expect(controller.signal.aborted).toBe(true);
  });
});

describe('Stream.tee', () => {
  test('lets both readers consume every item at independent speeds', async () => {
    const controller = new AbortController();
    const source = new Stream(
      () =>
        (async function* sourceItems() {
          yield 1;
          yield 2;
          yield 3;
        })(),
      controller,
    );
    const [left, right] = source.tee();
    const leftIterator = left[Symbol.asyncIterator]();
    const rightIterator = right[Symbol.asyncIterator]();

    await expect(leftIterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(leftIterator.next()).resolves.toEqual({ value: 2, done: false });
    await expect(rightIterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(rightIterator.next()).resolves.toEqual({ value: 2, done: false });
    await expect(rightIterator.next()).resolves.toEqual({ value: 3, done: false });
    await expect(leftIterator.next()).resolves.toEqual({ value: 3, done: false });
    await expect(leftIterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(rightIterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(left.controller).toBe(controller);
    expect(right.controller).toBe(controller);
  });
});

describe('Stream.toReadableStream', () => {
  test('round-trips structured values as newline-delimited JSON', async () => {
    const original = new Stream(
      () =>
        (async function* originalItems() {
          yield { id: 1 };
          yield { id: 2 };
        })(),
      new AbortController(),
    );
    const roundTripped = Stream.fromReadableStream<{ id: number }>(
      original.toReadableStream(),
      new AbortController(),
    );

    await expect(collect(roundTripped)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('closes the source iterator when the readable stream is canceled', async () => {
    const returned = vi.fn().mockResolvedValue({ done: true, value: undefined });
    const source = new Stream(
      () => ({
        next: vi.fn().mockResolvedValue({ done: false, value: { id: 1 } }),
        return: returned,
      }),
      new AbortController(),
    );
    const reader = source.toReadableStream().getReader();

    await reader.read();
    await reader.cancel();

    expect(returned).toHaveBeenCalledTimes(1);
  });

  test('propagates iterator failures through the readable stream', async () => {
    const failure = new OpenAIError('source failed');
    const source = new Stream(() => ({ next: vi.fn().mockRejectedValue(failure) }), new AbortController());

    await expect(source.toReadableStream().getReader().read()).rejects.toBe(failure);
  });
});

describe('_iterSSEMessages', () => {
  test('rejects responses without readable bodies and aborts their controller', async () => {
    const controller = new AbortController();

    await expect(collect(_iterSSEMessages(new Response(null), controller))).rejects.toThrow(
      'Attempted to iterate over a response with no body',
    );
    expect(controller.signal.aborted).toBe(true);
  });

  test.each([
    ['rejects', () => Promise.reject(new Error('private iterable cancellation failure'))],
    [
      'throws',
      () => {
        throw new Error('private iterable cancellation failure');
      },
    ],
    ['never resolves', () => Promise.race<IteratorResult<Uint8Array>>([])],
  ])('settles an aborted async-only response when iterator cancellation %s', async (_, cancellation) => {
    const returned = vi.fn(cancellation);
    const source: AsyncIterableIterator<Uint8Array> = {
      next: vi
        .fn()
        .mockResolvedValueOnce({ value: encoder.encode('data: {"id":1}\n\n'), done: false })
        .mockImplementation(() => Promise.race<IteratorResult<Uint8Array>>([])),
      return: returned,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const body = new ReadableStream<Uint8Array>();
    const response = new Response(body);
    Object.defineProperties(body, {
      getReader: { value: undefined },
      [Symbol.asyncIterator]: { value: () => source },
    });
    const controller = new AbortController();
    const events = _iterSSEMessages(response, controller);
    await expect(events.next()).resolves.toMatchObject({ value: { data: '{"id":1}' }, done: false });
    const pending = settlesSoon(events.next());

    await vi.waitFor(() => expect(source.next).toHaveBeenCalledTimes(2));
    controller.abort(new Error('private iterable abort reason'));

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(returned.mock.calls).toEqual([[]]);
  });

  test('preserves a primary reader failure when cancellation and lock release also fail', async () => {
    const primary = new Error('original response read failure');
    const body = new ReadableStream<Uint8Array>();
    const response = new Response(body);
    const reader = body.getReader();
    Object.defineProperty(body, 'getReader', { value: () => reader });
    vi.spyOn(reader, 'read').mockRejectedValue(primary);
    const cancel = vi.spyOn(reader, 'cancel').mockRejectedValue(new Error('secondary cancellation failure'));
    const release = vi.spyOn(reader, 'releaseLock').mockImplementation(() => {
      throw new Error('secondary lock-release failure');
    });

    await expect(collect(_iterSSEMessages(response, new AbortController()))).rejects.toBe(primary);
    expect(cancel.mock.calls).toEqual([[]]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('ignores comments and handles CRLF-delimited multiline data', async () => {
    const response = responseForSSE(': keepalive\r\nevent: update\r\ndata: first\r\ndata: second\r\n\r\n');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toEqual([
      {
        event: 'update',
        data: 'first\nsecond',
        raw: [': keepalive', 'event: update', 'data: first', 'data: second'],
      },
    ]);
  });

  test.each(
    ['\n', '\r', '\r\n'].flatMap((firstEnding) =>
      ['\n', '\r', '\r\n']
        .filter((secondEnding) => firstEnding !== '\r' || secondEnding !== '\n')
        .map((secondEnding) => [firstEnding, secondEnding]),
    ),
  )(
    'decodes byte-fragmented %j + %j separators before the stream ends',
    async (firstEnding, secondEnding) => {
      const delimiter = firstEnding + secondEnding;
      const firstEvent = encoder.encode(`data: first${delimiter}`);
      const secondEvent = encoder.encode(`data: second${delimiter}`);
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
      );
      const events = _iterSSEMessages(response, new AbortController());
      const first = events.next();

      for (const byte of firstEvent) {
        streamController?.enqueue(Uint8Array.of(byte));
      }

      await expect(first).resolves.toMatchObject({ done: false, value: { event: null, data: 'first' } });

      const second = events.next();
      for (const byte of secondEvent) {
        streamController?.enqueue(Uint8Array.of(byte));
      }

      await expect(second).resolves.toMatchObject({
        done: false,
        value: { event: null, data: 'second' },
      });

      streamController?.close();
      await expect(events.next()).resolves.toMatchObject({ done: true });
    },
  );

  test('decodes carriage-return separators split into individual bytes', async () => {
    const events = encoder.encode('data: first\r\rdata: second\r\r');
    const response = new Response(ReadableStreamFrom(Array.from(events, (byte) => Uint8Array.of(byte))));

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'first' },
      { event: null, data: 'second' },
    ]);
  });

  test('delivers LF followed by CRLF before the stream closes', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
    );
    const events = _iterSSEMessages(response, new AbortController());
    const first = events.next();

    streamController?.enqueue(encoder.encode('data: first\n\r\n'));
    await expect(first).resolves.toMatchObject({ done: false, value: { event: null, data: 'first' } });

    const second = events.next();
    streamController?.enqueue(encoder.encode('data: second\r\n\n'));
    await expect(second).resolves.toMatchObject({
      done: false,
      value: { event: null, data: 'second' },
    });

    streamController?.close();
    await expect(events.next()).resolves.toMatchObject({ done: true });
  });

  test('does not emit a phantom event when CRLF is split after an immediate CR delimiter', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
    );
    const events = _iterSSEMessages(response, new AbortController());
    const first = events.next();

    streamController?.enqueue(encoder.encode('data: first\r\r'));
    await expect(first).resolves.toMatchObject({ done: false, value: { event: null, data: 'first' } });

    const second = events.next();
    streamController?.enqueue(encoder.encode('\ndata: second\r\r'));
    await expect(second).resolves.toMatchObject({
      done: false,
      value: { event: null, data: 'second' },
    });

    streamController?.enqueue(encoder.encode('\n'));
    streamController?.close();
    await expect(events.next()).resolves.toMatchObject({ done: true });
  });

  test.each([
    ['\r', '\n', '\r'],
    ['\r\n', '\r', '\r\n'],
    ['\n', '\r\n', '\r'],
  ])('preserves byte-fragmented multiline data with %j, %j, and %j endings', async (first, second, third) => {
    const bytes = encoder.encode(`data: first${first}data: second${second}${third}`);
    const response = new Response(ReadableStreamFrom(Array.from(bytes, (byte) => Uint8Array.of(byte))));

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'first\nsecond' },
    ]);
  });

  test('finds consecutive events after scanning an earlier fragmented prefix', async () => {
    const response = new Response(
      ReadableStreamFrom([
        encoder.encode('data: first with a fragmented prefix'),
        encoder.encode('\r\n\r\ndata: second\r\n\r\ndata: third\r\n\r\n'),
      ]),
    );

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'first with a fragmented prefix' },
      { event: null, data: 'second' },
      { event: null, data: 'third' },
    ]);
  });

  test('retains the longest partial separator between separately scanned chunks', async () => {
    const response = new Response(
      ReadableStreamFrom([
        encoder.encode('data: first\r\n\r'),
        encoder.encode('\ndata: second\r\n'),
        encoder.encode('\r\n'),
      ]),
    );

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: 'first' },
      { event: null, data: 'second' },
    ]);
  });

  test('only rescans delimiter overlap when receiving one byte at a time', async () => {
    const findDelimiter = vi.spyOn(lineDecoders, 'findDoubleNewlineIndex');
    const payload = 'x'.repeat(256);
    const event = encoder.encode(`data: ${payload}\n\n`);
    const response = new Response(ReadableStreamFrom(Array.from(event, (byte) => Uint8Array.of(byte))));

    try {
      await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
        { event: null, data: payload },
      ]);

      expect(findDelimiter).toHaveBeenCalled();
      const scannedBytes = findDelimiter.mock.calls.reduce((total, [buffer]) => total + buffer.byteLength, 0);
      expect(scannedBytes).toBeLessThan(event.byteLength * 5);
    } finally {
      findDelimiter.mockRestore();
    }
  });

  test('copies fragmented SSE data a linear number of times', async () => {
    const payload = 'x'.repeat(4096);
    const event = encoder.encode(`data: ${payload}\n\n`);
    const response = new Response(ReadableStreamFrom(Array.from(event, (byte) => Uint8Array.of(byte))));
    const copyBytes = vi.spyOn(Uint8Array.prototype, 'set');

    try {
      await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
        { event: null, data: payload },
      ]);

      const copiedBytes = copyBytes.mock.calls.reduce((total, [source]) => total + source.length, 0);
      expect(copiedBytes).toBeLessThan(event.byteLength * 8);
    } finally {
      copyBytes.mockRestore();
    }
  });

  test('compacts consumed prefixes without overwriting retained SSE frames', async () => {
    const firstFrame = encoder.encode('data: first\r\n\r\n');
    const response = new Response(
      ReadableStreamFrom([
        encoder.encode('data: first\r\n\r\ndata: second\r\n\r'),
        encoder.encode('\n'),
        encoder.encode('data: third\r\n\r\n'),
      ]),
    );
    const compactBytes = vi.spyOn(Uint8Array.prototype, 'copyWithin');
    const decodeLines = vi.spyOn(lineDecoders.LineDecoder.prototype, 'decode');

    try {
      await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
        { event: null, data: 'first' },
        { event: null, data: 'second' },
        { event: null, data: 'third' },
      ]);

      expect(compactBytes).toHaveBeenCalled();
      expect(decodeLines.mock.calls[0]?.[0]).toEqual(firstFrame);
    } finally {
      decodeLines.mockRestore();
      compactBytes.mockRestore();
    }
  });

  test('does not compact a large live event to reclaim a small consumed prefix', async () => {
    const payload = 'x'.repeat(4096);
    const response = new Response(
      ReadableStreamFrom([encoder.encode(`data: first\n\ndata: ${payload}`), encoder.encode('\n\n')]),
    );
    const compactBytes = vi.spyOn(Uint8Array.prototype, 'copyWithin');

    try {
      await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
        { event: null, data: 'first' },
        { event: null, data: payload },
      ]);

      expect(compactBytes).not.toHaveBeenCalled();
    } finally {
      compactBytes.mockRestore();
    }
  });

  test('ignores an SSE message that ends without its required blank-line delimiter', async () => {
    const response = responseForSSE('data: {"flushed":true}\n');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toEqual([]);
  });

  test('ignores an SSE message that ends with only a single carriage return', async () => {
    const response = responseForSSE('data: {"flushed":true}\r');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toEqual([]);
  });

  test('ignores an SSE message that ends with only a single CRLF line ending', async () => {
    const response = responseForSSE('data: {"flushed":true}\r\n');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toEqual([]);
  });

  test('emits exactly one SSE message that ends with two carriage returns', async () => {
    const response = responseForSSE('data: {"flushed":true}\r\r');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toMatchObject([
      { event: null, data: '{"flushed":true}' },
    ]);
  });
});
