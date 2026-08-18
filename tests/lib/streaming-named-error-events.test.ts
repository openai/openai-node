import { vi } from 'vitest';

import OpenAI, { APIError } from 'openai';
import { Stream } from 'openai/streaming';

const encoder = new TextEncoder();
const requestID = 'req_synthetic_named_stream_error';
const providerError = {
  message: 'The synthetic provider rejected this streamed request.',
  code: 'provider_error',
  param: 'input',
  type: 'server_error',
};

const publicSurfaces = [
  { name: 'Chat Completions', surface: 'chat' },
  { name: 'Responses', surface: 'responses' },
  { name: 'Assistants', surface: 'assistants' },
] as const;

type PublicSurface = (typeof publicSurfaces)[number];
type PublicStream = AsyncIterable<unknown> & { controller: AbortController };

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function record(event: string | undefined, data: unknown): string {
  const eventLine = event === undefined ? '' : `event: ${event}\n`;

  return `${eventLine}data: ${JSON.stringify(data)}\n\n`;
}

function responseForWire(wire: string): Response {
  return new Response(wire, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-request-id': requestID,
    },
  });
}

async function publicStream(
  surface: PublicSurface,
  response: Response,
  logger = createLogger(),
): Promise<PublicStream> {
  const client = new OpenAI({
    apiKey: 'sk-synthetic-named-stream-error',
    maxRetries: 0,
    logLevel: 'off',
    logger,
    fetch: async () => response,
  });

  if (surface.surface === 'assistants') {
    return await client.beta.threads.runs.create('thread_synthetic', {
      assistant_id: 'asst_synthetic',
      stream: true,
    });
  }

  if (surface.surface === 'responses') {
    return await client.responses.create({
      model: 'gpt-synthetic',
      input: 'hello',
      stream: true,
    });
  }

  return await client.chat.completions.create({
    model: 'gpt-synthetic',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

async function rejection(stream: AsyncIterable<unknown>): Promise<unknown> {
  return await collect(stream).then(
    () => null,
    (error: unknown) => error,
  );
}

function expectProviderError(error: unknown, response: Response): asserts error is APIError {
  expect(error).toBeInstanceOf(APIError);
  expect(error).toMatchObject({
    message: providerError.message,
    code: providerError.code,
    param: providerError.param,
    type: providerError.type,
    requestID,
    error: providerError,
  });

  const apiError = error as APIError;
  expect(apiError.status).toBeUndefined();
  expect(apiError.headers).toBe(response.headers);
}

describe('named SSE provider errors', () => {
  it.each(publicSurfaces)(
    'rejects flat named provider errors on the public $name streaming API',
    async (surface) => {
      const logger = createLogger();
      const response = responseForWire(record('error', providerError));
      const stream = await publicStream(surface, response, logger);
      const error = await rejection(stream);

      expectProviderError(error, response);
      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'rejects flat named errors from the exported stream with event synthesis set to %s',
    async (synthesizeEventData) => {
      const response = responseForWire(record('error', providerError));
      const controller = new AbortController();
      const stream = Stream.fromSSEResponse(response, controller, undefined, synthesizeEventData);
      const error = await rejection(stream);

      expectProviderError(error, response);
      expect(controller.signal.aborted).toBe(true);
    },
  );

  it('cancels and releases an open response body before propagating a named error', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode(record('error', providerError)));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': requestID },
    });
    const controller = new AbortController();
    const iterator = Stream.fromSSEResponse(response, controller)[Symbol.asyncIterator]();

    try {
      const caught = await iterator.next().then(
        () => null,
        (error: unknown) => error,
      );

      expectProviderError(caught, response);
      expect(controller.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally {
      await iterator.return?.();
      controller.abort();
    }
  });

  it('never yields a named error after delivering an earlier successful event', async () => {
    const successfulEvent = { id: 'safe-event', content: 'safe content' };
    const response = responseForWire(
      record('response.output_text.delta', successfulEvent) + record('error', providerError),
    );
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);
    const received: unknown[] = [];

    const caught = await (async () => {
      for await (const event of stream) {
        received.push(event);
      }
    })().then(
      () => null,
      (error: unknown) => error,
    );

    expectProviderError(caught, response);
    expect(received).toEqual([successfulEvent]);
    expect(controller.signal.aborted).toBe(true);
  });

  it.each([
    { name: 'named', event: 'error' },
    { name: 'unnamed', event: undefined },
  ])('preserves existing $name nested provider error metadata and headers', async ({ event }) => {
    const response = responseForWire(record(event, { error: providerError }));
    const controller = new AbortController();
    const error = await rejection(Stream.fromSSEResponse(response, controller));

    expectProviderError(error, response);
    expect(controller.signal.aborted).toBe(true);
  });

  it('preserves existing nested-error formatting when its wrapper supplies a message', async () => {
    const nested = { code: 'nested_provider_error', param: 'input', type: 'server_error' };
    const wrapper = { message: 'The wrapper supplied the provider failure.', error: nested };
    const response = responseForWire(record('error', wrapper));
    const controller = new AbortController();
    const error = await rejection(Stream.fromSSEResponse(response, controller));

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({
      message: JSON.stringify(nested),
      code: nested.code,
      param: nested.param,
      type: nested.type,
      requestID,
      error: nested,
    });
    expect((error as APIError).headers).toBe(response.headers);
    expect(controller.signal.aborted).toBe(true);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'string', value: 'a provider failed without structured metadata' },
    { name: 'number', value: 42 },
  ])('raises a typed named error even when its payload is $name', async ({ value }) => {
    const response = responseForWire(record('error', value));
    const controller = new AbortController();
    const error = await rejection(Stream.fromSSEResponse(response, controller));

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ requestID, error: value });
    expect((error as APIError).headers).toBe(response.headers);
    expect(controller.signal.aborted).toBe(true);
  });

  it.each([false, true])(
    'preserves ordinary named nonerror events with event synthesis set to %s',
    async (synthesizeEventData) => {
      const data = { delta: 'hello' };
      const event = 'response.output_text.delta';
      const response = responseForWire(record(event, data));
      const controller = new AbortController();
      const stream = Stream.fromSSEResponse(response, controller, undefined, synthesizeEventData);

      await expect(collect(stream)).resolves.toEqual([synthesizeEventData ? { event, data } : data]);
      expect(controller.signal.aborted).toBe(false);
    },
  );

  it.each(['thread.message.delta', 'thread.error'])(
    'preserves the existing %s Assistant event envelope',
    async (event) => {
      const data = { id: 'safe-thread-event' };
      const response = responseForWire(record(event, data));
      const controller = new AbortController();

      await expect(collect(Stream.fromSSEResponse(response, controller))).resolves.toEqual([{ event, data }]);
      expect(controller.signal.aborted).toBe(false);
    },
  );

  it('continues ignoring named errors after the completion sentinel', async () => {
    const response = responseForWire(`data: [DONE]\n\n${record('error', providerError)}`);
    const controller = new AbortController();

    await expect(collect(Stream.fromSSEResponse(response, controller))).resolves.toEqual([]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('preserves malformed named-error diagnostic privacy and disabled logging', async () => {
    const credential = 'sk-synthetic-malformed-named-error-secret';
    const logger = createLogger();
    const response = responseForWire(`event: error\ndata: {"credential":"${credential}"\n\n`);
    const stream = await publicStream(publicSurfaces[0], response, logger);
    const error = await rejection(stream);

    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as SyntaxError).message).toBe('Could not parse server-sent event data as JSON.');
    expect((error as SyntaxError).message).not.toContain(credential);
    expect((error as SyntaxError).stack).not.toContain(credential);
    expect((error as SyntaxError & { cause?: unknown }).cause).toBeUndefined();
    expect(stream.controller.signal.aborted).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
