import { vi } from 'vitest';
import OpenAI, { APIError } from 'openai';

const syntheticPatient = 'synthetic-patient-123-45-6789';
const syntheticCredential = 'synthetic-private-token-7f3e';
const malformedData = `{"patient":"${syntheticPatient}","credential":"${syntheticCredential}"`;

function createLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function createClient({
  event,
  data = malformedData,
  logger,
  logLevel,
}: {
  event: string;
  data?: string;
  logger?: ReturnType<typeof createLogger>;
  logLevel?: 'off' | 'error';
}) {
  return new OpenAI({
    apiKey: 'synthetic-client-api-key',
    maxRetries: 0,
    ...(logger ? { logger } : {}),
    ...(logLevel ? { logLevel } : {}),
    fetch: async () =>
      new Response(`event: ${event}\ndata: ${data}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  });
}

async function createRun(client: OpenAI) {
  return client.beta.threads.runs.create('thread_synthetic', {
    assistant_id: 'asst_synthetic',
    stream: true,
  });
}

async function collect(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('Assistants streaming diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(['thread.message.delta', 'thread.run.created'])(
    'honors disabled logging for malformed %s events',
    async (event) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = createLogger();
      const stream = await createRun(createClient({ event, logger, logLevel: 'off' }));

      await expect(collect(stream)).rejects.toThrow(SyntaxError);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  test.each(['thread.message.delta', 'thread.run.created'])(
    'routes malformed %s events through the configured redacting logger',
    async (event) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const redactedMessages: string[] = [];
      const logger = createLogger();
      logger.error.mockImplementation((message) => {
        redactedMessages.push(String(message));
      });

      const stream = await createRun(createClient({ event, logger, logLevel: 'error' }));

      await expect(collect(stream)).rejects.toThrow(SyntaxError);

      expect(stream.controller.signal.aborted).toBe(true);
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(redactedMessages).toEqual(['Could not parse message into JSON:', 'From chunk:']);
      expect(redactedMessages.join('\n')).not.toContain(syntheticPatient);
      expect(redactedMessages.join('\n')).not.toContain(syntheticCredential);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  test('continues to honor disabled logging for ordinary response events', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger();
    const stream = await createRun(
      createClient({ event: 'response.output_text.delta', logger, logLevel: 'off' }),
    );

    await expect(collect(stream)).rejects.toThrow(SyntaxError);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('continues to route ordinary response events through a configured logger', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger();
    const stream = await createRun(
      createClient({ event: 'response.output_text.delta', logger, logLevel: 'error' }),
    );

    await expect(collect(stream)).rejects.toThrow(SyntaxError);

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('preserves the default console logger and its two diagnostic messages', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = await createRun(createClient({ event: 'thread.message.delta', logLevel: 'error' }));

    await expect(collect(stream)).rejects.toThrow(SyntaxError);

    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  test.each(['thread.message.delta', 'thread.run.created'])(
    'preserves valid %s event envelopes',
    async (event) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = createLogger();
      const stream = await createRun(
        createClient({ event, data: '{"id":"event_synthetic"}', logger, logLevel: 'error' }),
      );

      await expect(collect(stream)).resolves.toEqual([{ event, data: { id: 'event_synthetic' } }]);

      expect(logger.error).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  test('preserves typed stream errors and request cancellation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger();
    const stream = await createRun(
      createClient({
        event: 'response.error',
        data: '{"error":{"message":"synthetic upstream failure","code":"invalid_request"}}',
        logger,
        logLevel: 'error',
      }),
    );

    await expect(collect(stream)).rejects.toThrow(APIError);

    expect(stream.controller.signal.aborted).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
