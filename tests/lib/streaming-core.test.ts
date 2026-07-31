import { vi } from 'vitest';
import { APIError, OpenAIError } from 'openai/core/error';
import { Stream, _iterSSEMessages } from 'openai/core/streaming';
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

describe('Stream.fromSSEResponse', () => {
  test('parses data events and ignores events after the completion sentinel', async () => {
    const response = responseForSSE('data: {"id":1}\n\ndata: {"id":2}\n\ndata: [DONE]\n\ndata: not-json\n\n');
    const stream = Stream.fromSSEResponse<{ id: number }>(response, new AbortController());

    await expect(collect(stream)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
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
        (async function* () {
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
        (async function* () {
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

  test('ignores an SSE message that ends without its required blank-line delimiter', async () => {
    const response = responseForSSE('data: {"flushed":true}\n');

    await expect(collect(_iterSSEMessages(response, new AbortController()))).resolves.toEqual([]);
  });
});
