import { vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAIError } from 'openai/core/error';
import { Stream } from 'openai/core/streaming';
import { AssistantStream } from 'openai/lib/AssistantStream';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';

const encoder = new TextEncoder();
const patient = 'ALICE';
const credential = 'sk-X12';
const malformedLine = `["${patient}","${credential}",]`;
const safeErrorMessage = 'Error reading response: malformed newline-delimited JSON.';

interface ReaderSource {
  body: ReadableStream<Uint8Array>;
  cancel: ReturnType<typeof vi.fn>;
}

function readable(
  chunks: readonly (string | Uint8Array)[],
  { close = true, cancellationError }: { close?: boolean; cancellationError?: Error } = {},
): ReaderSource {
  const cancel = vi.fn(async () => {
    if (cancellationError) {
      throw cancellationError;
    }
  });

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        }
        if (close) {
          controller.close();
        }
      },
      cancel,
    },
    { highWaterMark: 0 },
  );

  return { body, cancel };
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of source) {
    result.push(value);
  }
  return result;
}

function assertSafeSyntaxError(value: unknown): asserts value is SyntaxError & { cause?: unknown } {
  expect(value).toBeInstanceOf(SyntaxError);
  const failure = value as SyntaxError & { cause?: unknown };

  expect(failure.message).toBe(safeErrorMessage);
  expect(failure.cause).toBeUndefined();

  for (const sensitive of [patient, credential, malformedLine]) {
    expect(failure.message).not.toContain(sensitive);
    expect(failure.stack).not.toContain(sensitive);
  }
}

interface WrapperHandle {
  controller: AbortController;
  done: () => Promise<void>;
  final: () => Promise<unknown>;
  onError: (listener: (error: OpenAIError) => void) => void;
}

interface WrapperSurface {
  title: string;
  start: (body: ReadableStream<Uint8Array>) => WrapperHandle;
}

const wrapperSurfaces: WrapperSurface[] = [
  {
    title: 'ChatCompletionStream.fromReadableStream',
    start(body) {
      const runner = ChatCompletionStream.fromReadableStream(body);
      return {
        controller: runner.controller,
        done: () => runner.done(),
        final: () => runner.finalChatCompletion(),
        onError: (listener) => {
          runner.on('error', listener);
        },
      };
    },
  },
  {
    title: 'AssistantStream.fromReadableStream',
    start(body) {
      const runner = AssistantStream.fromReadableStream(body);
      return {
        controller: runner.controller,
        done: () => runner.done(),
        final: () => runner.finalRun(),
        onError: (listener) => {
          runner.on('error', listener);
        },
      };
    },
  },
  {
    title: 'ResponseStream.fromReadableStream',
    start(body) {
      const runner = ResponseStream.fromReadableStream(body);
      return {
        controller: runner.controller,
        done: () => runner.done(),
        final: () => runner.finalResponse(),
        onError: (listener) => {
          runner.on('error', listener);
        },
      };
    },
  },
];

describe('newline-delimited stream diagnostic privacy', () => {
  test('the public Stream rejects a sanitized SyntaxError and cancels its reader', async () => {
    const { body, cancel } = readable([`${malformedLine}\n`], { close: false });
    const controller = new AbortController();
    const stream = Stream.fromReadableStream(body, controller);

    let failure: unknown;
    try {
      await collect(stream);
    } catch (error) {
      failure = error;
    }

    assertSafeSyntaxError(failure);
    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test.each(wrapperSurfaces)(
    '$title keeps its existing error wrapper and sanitizes the nested cause',
    async ({ start }) => {
      const { body, cancel } = readable([`${malformedLine}\n`], { close: false });
      const stream = start(body);
      const emitted = vi.fn();
      stream.onError(emitted);

      let failure: unknown;
      try {
        await stream.done();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(OpenAIError);
      const wrapped = failure as OpenAIError & { cause?: unknown };
      expect(wrapped.message).toBe(safeErrorMessage);
      assertSafeSyntaxError(wrapped.cause);

      for (const sensitive of [patient, credential, malformedLine]) {
        expect(wrapped.message).not.toContain(sensitive);
        expect(wrapped.stack).not.toContain(sensitive);
      }

      expect(emitted).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveBeenCalledWith(wrapped);
      await expect(stream.final()).rejects.toBe(wrapped);
      expect(stream.controller.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    },
  );

  test('sanitizes malformed input while preserving disabled client logging', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const client = new OpenAI({
      apiKey: 'sk-synthetic-client-key',
      logLevel: 'off',
      logger,
      fetch: async () => Response.json({}),
    });
    const { body } = readable([`${malformedLine}\n`]);
    const stream = Stream.fromReadableStream(body, new AbortController(), client);

    let failure: unknown;
    try {
      await collect(stream);
    } catch (error) {
      failure = error;
    }

    assertSafeSyntaxError(failure);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('preserves CRLF, blank lines, falsey values, and an unterminated final line', async () => {
    const { body, cancel } = readable(['\r\nnull\r\nfalse\n0\r\n""\n\n', '{"ok":true}']);
    const controller = new AbortController();

    await expect(collect(Stream.fromReadableStream(body, controller))).resolves.toEqual([
      null,
      false,
      0,
      '',
      { ok: true },
    ]);

    expect(controller.signal.aborted).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  test('preserves UTF-8 code points split across incoming chunks', async () => {
    const encoded = encoder.encode('{"message":"hello 😺"}\r\n');
    const emojiOffset = encoded.indexOf(0xf0);
    const { body } = readable([encoded.subarray(0, emojiOffset + 2), encoded.subarray(emojiOffset + 2)]);

    await expect(collect(Stream.fromReadableStream(body, new AbortController()))).resolves.toEqual([
      { message: 'hello 😺' },
    ]);
  });

  test('preserves the exact identity of non-syntax JSON parser failures', async () => {
    const originalFailure = new TypeError('The runtime JSON parser failed unexpectedly.');
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw originalFailure;
    });
    const { body, cancel } = readable(['{"ok":true}\n'], { close: false });
    const controller = new AbortController();

    try {
      await expect(collect(Stream.fromReadableStream(body, controller))).rejects.toBe(originalFailure);
      expect(controller.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally {
      parse.mockRestore();
    }
  });

  test('preserves the exact identity of upstream reader failures', async () => {
    const originalFailure = new TypeError('The response transport failed before decoding.');
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw originalFailure;
      },
    });
    const controller = new AbortController();

    await expect(collect(Stream.fromReadableStream(body, controller))).rejects.toBe(originalFailure);
    expect(controller.signal.aborted).toBe(true);
    expect(body.locked).toBe(false);
  });

  test('retains the sanitized parser error when reader cancellation also fails', async () => {
    const cancellationError = new Error('The upstream reader refused cancellation.');
    const { body, cancel } = readable([`${malformedLine}\n`], {
      close: false,
      cancellationError,
    });
    const controller = new AbortController();

    let failure: unknown;
    try {
      await collect(Stream.fromReadableStream(body, controller));
    } catch (error) {
      failure = error;
    }

    assertSafeSyntaxError(failure);
    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test('preserves configured newline size errors without replacing them', async () => {
    vi.stubEnv('OPENAI_MAX_NDJSON_LINE_BYTES', '12');
    const { body, cancel } = readable(['{"sensitive":"too long"}\n'], { close: false });
    const controller = new AbortController();

    try {
      let failure: unknown;
      try {
        await collect(Stream.fromReadableStream(body, controller));
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(OpenAIError);
      expect((failure as Error).message).toBe('Line exceeds the maximum size of 12 bytes.');
      expect(controller.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('preserves pre-aborted reader cancellation without parsing any data', async () => {
    const { body, cancel } = readable([`${malformedLine}\n`], { close: false });
    const controller = new AbortController();
    controller.abort();

    await expect(collect(Stream.fromReadableStream(body, controller))).resolves.toEqual([]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test('preserves early consumer cancellation after a valid parsed value', async () => {
    const { body, cancel } = readable(['{"ok":true}\n{"next":true}\n'], { close: false });
    const controller = new AbortController();

    const iterator = Stream.fromReadableStream(body, controller)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: { ok: true }, done: false });
    await iterator.return?.();

    expect(controller.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test('does not alter existing sanitized server-sent event failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = readable([`data: ${malformedLine}\n\n`]);
    const stream = Stream.fromSSEResponse(new Response(body), new AbortController());

    try {
      let failure: unknown;
      try {
        await collect(stream);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(SyntaxError);
      expect((failure as SyntaxError).message).toBe(
        'Error reading response: malformed server-sent event JSON.',
      );
      expect((failure as SyntaxError & { cause?: unknown }).cause).toBeUndefined();
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
