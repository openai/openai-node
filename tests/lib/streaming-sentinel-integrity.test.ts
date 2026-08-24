import { vi } from 'vitest';

import OpenAI, { APIError } from 'openai';
import { Stream } from 'openai/core/streaming';

const encoder = new TextEncoder();
const patient = 'synthetic-patient-ALICE-314';
const credential = 'sk-synthetic-sentinel-secret-721';
const safeSyntaxMessage = 'Error reading response: malformed server-sent event JSON.';

const publicSurfaces = [
  { name: 'Chat Completions', kind: 'chat', event: undefined },
  { name: 'Responses', kind: 'responses', event: 'response.output_text.delta' },
  { name: 'Assistants', kind: 'assistants', event: 'thread.message.delta' },
] as const;

type PublicSurface = (typeof publicSurfaces)[number];
type PublicStream = AsyncIterable<unknown> & { controller: AbortController };

function record(
  data: string,
  { event, ending = '\n', space = ' ' }: { event?: string | undefined; ending?: string; space?: string } = {},
): string {
  const eventLine = event === undefined ? '' : `event: ${event}${ending}`;
  return `${eventLine}data:${space}${data}${ending}${ending}`;
}

function responseFor(wire: string | ReadableStream<Uint8Array>): Response {
  return new Response(wire, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-request-id': 'req_synthetic_sentinel_integrity',
    },
  });
}

async function createPublicStream(
  surface: PublicSurface,
  wire: string | ReadableStream<Uint8Array>,
): Promise<{ stream: PublicStream; logger: { error: ReturnType<typeof vi.fn> } }> {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const client = new OpenAI({
    apiKey: 'sk-synthetic-client-credential',
    maxRetries: 0,
    logLevel: 'off',
    logger,
    fetch: async () => responseFor(wire),
  });

  if (surface.kind === 'assistants') {
    const stream = await client.beta.threads.runs.create('thread_synthetic', {
      assistant_id: 'asst_synthetic',
      stream: true,
    });
    return { stream, logger };
  }

  if (surface.kind === 'responses') {
    const stream = await client.responses.create({
      model: 'gpt-synthetic',
      input: 'hello',
      stream: true,
    });
    return { stream, logger };
  }

  const stream = await client.chat.completions.create({
    model: 'gpt-synthetic',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
  return { stream, logger };
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}

async function rejection(source: AsyncIterable<unknown>): Promise<unknown> {
  return await collect(source).then(
    () => {},
    (error: unknown) => error,
  );
}

function expectPrivateSyntaxError(value: unknown): asserts value is SyntaxError & { cause?: unknown } {
  expect(value).toBeInstanceOf(SyntaxError);
  const error = value as SyntaxError & { cause?: unknown };
  expect(error.message).toBe(safeSyntaxMessage);
  expect(error.cause).toBeUndefined();

  for (const secret of [patient, credential]) {
    expect(error.message).not.toContain(secret);
    expect(error.stack).not.toContain(secret);
  }
}

describe('SSE completion sentinel integrity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(publicSurfaces)(
    'rejects a fake completion prefix on the real public $name streaming API',
    async (surface) => {
      const payload = `[DONE]${patient}:${credential}`;
      const { stream, logger } = await createPublicStream(surface, record(payload, { event: surface.event }));
      const error = await rejection(stream);

      expectPrivateSyntaxError(error);
      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'does not report a successful $name completion when a fake sentinel precedes a provider error',
    async (surface) => {
      const fake = record(`[DONE]${credential}`, { event: surface.event });
      const providerFailure = record(
        JSON.stringify({ error: { message: 'The provider rejected this request.', code: 'provider_error' } }),
        { event: 'error' },
      );
      const { stream, logger } = await createPublicStream(surface, fake + providerFailure);

      expectPrivateSyntaxError(await rejection(stream));
      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'rejects multiline $name events whose first data line impersonates completion',
    async (surface) => {
      const eventLine = surface.event === undefined ? '' : `event: ${surface.event}\n`;
      const continuation = JSON.stringify({ patient, credential });
      const wire = `${eventLine}data: [DONE]\ndata: ${continuation}\n\n`;
      const { stream, logger } = await createPublicStream(surface, wire);

      expectPrivateSyntaxError(await rejection(stream));
      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: 'appended text', suffix: 'malicious' },
    { name: 'trailing space', suffix: ' ' },
    { name: 'trailing tab', suffix: '\t' },
    { name: 'sensitive response contents', suffix: `${patient}:${credential}` },
  ])('rejects $name after the exact public Stream completion marker', async ({ suffix }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(record(`[DONE]${suffix}`)), controller);

    expectPrivateSyntaxError(await rejection(stream));
    expect(controller.signal.aborted).toBe(true);
  });

  it.each(
    publicSurfaces.flatMap((surface) => [
      { surface, framing: 'without an optional field space', space: '', ending: '\n' },
      { surface, framing: 'with an optional field space', space: ' ', ending: '\n' },
      { surface, framing: 'with CRLF framing', space: ' ', ending: '\r\n' },
    ]),
  )('keeps exact $surface.name completion $framing', async ({ surface, space, ending }) => {
    const { stream, logger } = await createPublicStream(
      surface,
      record('[DONE]', { event: surface.event, space, ending }),
    );

    await expect(collect(stream)).resolves.toEqual([]);
    expect(stream.controller.signal.aborted).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'ordinary', event: undefined },
    { name: 'thread', event: 'thread.message.delta' },
    { name: 'provider error', event: 'error' },
  ])('retains exact completion semantics even for a named $name event', async ({ event }) => {
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(record('[DONE]', { event })), controller);

    await expect(collect(stream)).resolves.toEqual([]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('cancels and unlocks an open response as soon as a forged sentinel is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode(record(`[DONE]${credential}`)));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(body), controller);

    expectPrivateSyntaxError(await rejection(stream));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it('finishes an exact sentinel immediately without waiting for physical response EOF', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode(record(JSON.stringify({ id: 'safe' })) + record('[DONE]')));
        },
        pull() {
          throw new Error('The response was read beyond its exact completion sentinel.');
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(body), controller);

    await expect(collect(stream)).resolves.toEqual([{ id: 'safe' }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('continues suppressing cleanup errors after genuine completion', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('response cancellation failed'));
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(encoder.encode(record('[DONE]')));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(body), controller);

    await expect(collect(stream)).resolves.toEqual([]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it('ignores malformed and named provider-error frames after genuine completion', async () => {
    const successful = record(JSON.stringify({ id: 'safe' }));
    const providerFailure = record(JSON.stringify({ error: { message: 'too late' } }), { event: 'error' });
    const wire = successful + record('[DONE]') + providerFailure + record('[DONE]' + credential);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(wire), controller);

    await expect(collect(stream)).resolves.toEqual([{ id: 'safe' }]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('preserves fragmented CRLF records and optional named-event synthesis', async () => {
    const wire =
      record(JSON.stringify({ delta: 'safe' }), { event: 'response.output_text.delta', ending: '\r\n' }) +
      record('[DONE]', { ending: '\r\n' });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const character of wire) {
          controller.enqueue(encoder.encode(character));
        }
        controller.close();
      },
    });
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(responseFor(body), controller, undefined, true);

    await expect(collect(stream)).resolves.toEqual([
      { event: 'response.output_text.delta', data: { delta: 'safe' } },
    ]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('continues rejecting real named provider errors as typed APIError instances', async () => {
    const failure = { message: 'The synthetic provider rejected this stream.', code: 'provider_error' };
    const response = responseFor(record(JSON.stringify({ error: failure }), { event: 'error' }));
    const controller = new AbortController();
    const error = await rejection(Stream.fromSSEResponse(response, controller));

    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ message: failure.message, code: failure.code, error: failure });
    expect(controller.signal.aborted).toBe(true);
  });

  it('keeps ordinary malformed SSE diagnostics private and cause-free', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const payload = `{"patient":"${patient}","credential":"${credential}"`;
    const stream = Stream.fromSSEResponse(responseFor(record(payload)), controller);

    expectPrivateSyntaxError(await rejection(stream));
    expect(controller.signal.aborted).toBe(true);
  });

  it('leaves malformed NDJSON diagnostics sanitized', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(`["${patient}","${credential}",]\n`));
        stream.close();
      },
    });
    const stream = Stream.fromReadableStream(body, controller);
    const error = await rejection(stream);

    expect(error).toBeInstanceOf(SyntaxError);
    const failure = error as SyntaxError & { cause?: unknown };
    expect(failure.message).toBe('Error reading response: malformed newline-delimited JSON.');
    expect(failure.cause).toBeUndefined();
    expect(failure.message).not.toContain(patient);
    expect(failure.stack).not.toContain(credential);
    expect(controller.signal.aborted).toBe(true);
  });

  it('continues rejecting a second attempt to consume the same public stream', async () => {
    const stream = Stream.fromSSEResponse(responseFor(record('[DONE]')), new AbortController());

    await expect(collect(stream)).resolves.toEqual([]);
    await expect(collect(stream)).rejects.toThrow('Cannot iterate over a consumed stream');
  });
});
