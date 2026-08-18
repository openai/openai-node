import { vi } from 'vitest';

import OpenAI from 'openai';
import { Stream } from 'openai/streaming';

const SYNTHETIC_CREDENTIAL = 'sk-synthetic-malformed-sse-secret-74f1';
const SYNTHETIC_PATIENT = 'synthetic-patient-record-123-45-6789';
const MALFORMED_DATA = JSON.stringify({
  patient: SYNTHETIC_PATIENT,
  credential: SYNTHETIC_CREDENTIAL,
  authorization: `Bearer ${SYNTHETIC_CREDENTIAL}`,
}).slice(0, -1);

const streamSurfaces = [
  { name: 'Assistants thread events', surface: 'assistants', event: 'thread.message.delta' },
  { name: 'Responses events', surface: 'responses', event: 'response.output_text.delta' },
  { name: 'Chat Completions events', surface: 'chat', event: undefined },
] as const;

type StreamSurface = (typeof streamSurfaces)[number];
type PublicStream = AsyncIterable<unknown> & { controller: AbortController };

function createLogger() {
  return {
    error: vi.fn((..._arguments: unknown[]) => null),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function createResponse(surface: StreamSurface, data = MALFORMED_DATA): Response {
  const event = surface.event ? `event: ${surface.event}\n` : '';

  return new Response(`${event}data: ${data}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function createPublicStream(
  surface: StreamSurface,
  options: {
    logger?: ReturnType<typeof createLogger>;
    logLevel?: 'error' | 'off';
    data?: string;
  } = {},
): Promise<PublicStream> {
  const client = new OpenAI({
    apiKey: 'sk-synthetic-client-credential',
    maxRetries: 0,
    logLevel: options.logLevel ?? 'error',
    ...(options.logger ? { logger: options.logger } : {}),
    fetch: async () => createResponse(surface, options.data),
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

function expectPrivateDiagnostics(calls: unknown[][]): void {
  expect(calls).toEqual([['Could not parse message into JSON:'], ['From chunk:']]);

  const loggedArguments = JSON.stringify(calls);

  expect(loggedArguments).not.toContain(SYNTHETIC_CREDENTIAL);
  expect(loggedArguments).not.toContain(SYNTHETIC_PATIENT);
}

describe('malformed SSE diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(streamSurfaces)(
    'never passes sensitive $name payloads to a configured variadic logger',
    async (surface) => {
      const logger = createLogger();
      const stream = await createPublicStream(surface, { logger });

      await expect(collect(stream)).rejects.toThrow(SyntaxError);

      expect(stream.controller.signal.aborted).toBe(true);
      expectPrivateDiagnostics(logger.error.mock.calls);
    },
  );

  it('never passes sensitive public-stream payloads to the default console logger', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const streams = await Promise.all(streamSurfaces.map((surface) => createPublicStream(surface)));

    await Promise.all(
      streams.map(async (stream) => {
        await expect(collect(stream)).rejects.toThrow(SyntaxError);

        expect(stream.controller.signal.aborted).toBe(true);
      }),
    );

    for (const index of streams.keys()) {
      expectPrivateDiagnostics(consoleError.mock.calls.slice(index * 2, index * 2 + 2));
    }
  });

  it.each(streamSurfaces)('preserves disabled logging for malformed $name payloads', async (surface) => {
    const logger = createLogger();
    const stream = await createPublicStream(surface, { logger, logLevel: 'off' });

    await expect(collect(stream)).rejects.toThrow(SyntaxError);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'ordinary', event: undefined },
    { name: 'thread', event: 'thread.message.delta' },
  ])('never exposes malformed $name payloads from the exported SSE helper', async ({ event }) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const surface = streamSurfaces.find((candidate) => candidate.event === event);

    if (!surface) {
      throw new Error('Expected a matching public stream surface.');
    }
    const stream = Stream.fromSSEResponse(createResponse(surface), controller);

    await expect(collect(stream)).rejects.toThrow(SyntaxError);

    expect(controller.signal.aborted).toBe(true);
    expectPrivateDiagnostics(consoleError.mock.calls);
  });

  it.each(streamSurfaces)('preserves valid $name payloads without writing diagnostics', async (surface) => {
    const logger = createLogger();
    const stream = await createPublicStream(surface, {
      logger,
      data: JSON.stringify({ id: 'safe-event', content: 'safe payload' }),
    });

    await expect(collect(stream)).resolves.toHaveLength(1);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
