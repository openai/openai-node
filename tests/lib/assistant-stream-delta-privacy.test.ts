import { vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAIError } from 'openai/core/error';
import { AssistantStream } from 'openai/lib/AssistantStream';
import { assistantStream } from './assistant-stream-test-utils';

const syntheticCredential = 'sk-synthetic-private-assistant-token-7f3e';
const syntheticPatient = 'synthetic-patient-123-45-6789';
const missingIndexMessage = 'Expected array delta entry to have an `index` property';

function sensitiveToolCall(): Record<string, unknown> {
  return {
    type: 'function',
    id: 'call_sensitive',
    function: {
      arguments: JSON.stringify({
        api_key: syntheticCredential,
        patient: syntheticPatient,
      }),
    },
  };
}

function createRunStepEvents() {
  const initialStep = {
    id: 'step_synthetic',
    status: 'in_progress',
    step_details: {
      type: 'tool_calls',
      tool_calls: [
        {
          index: 0,
          type: 'function',
          id: 'call_original',
          function: { arguments: 'original' },
        },
      ],
    },
  };

  return [
    { event: 'thread.run.step.created', data: initialStep },
    {
      event: 'thread.run.step.delta',
      data: {
        id: initialStep.id,
        delta: {
          step_details: {
            type: 'tool_calls',
            tool_calls: [sensitiveToolCall()],
          },
        },
      },
    },
  ];
}

function createRedactingLogger() {
  const redactedMessages: string[] = [];

  return {
    redactedMessages,
    logger: {
      error: vi.fn((message: unknown) => {
        redactedMessages.push(
          String(message)
            .split(syntheticCredential)
            .join('[REDACTED]')
            .split(syntheticPatient)
            .join('[REDACTED]'),
        );
      }),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  };
}

function expectStaticFailure(accumulator: Record<string, unknown>, delta: Record<string, unknown>) {
  let failure: unknown;

  try {
    AssistantStream.accumulateDelta(accumulator, delta);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(OpenAIError);
  expect((failure as Error).constructor).toBe(Error);
  expect((failure as Error).message).toBe(missingIndexMessage);
}

async function expectStreamFailure(stream: AssistantStream) {
  let failure: unknown;

  try {
    await stream.done();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(OpenAIError);
  expect((failure as OpenAIError).message).toBe(missingIndexMessage);

  const { cause } = failure as OpenAIError & { cause?: unknown };
  expect(cause).toBeInstanceOf(Error);
  expect((cause as Error).constructor).toBe(Error);
  expect((cause as Error).message).toBe(missingIndexMessage);

  expect(stream.ended).toBe(true);
  expect(stream.errored).toBe(true);
  expect(stream.aborted).toBe(false);
}

describe('AssistantStream malformed delta diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['undefined', undefined],
  ])('does not print sensitive static array entries with a %s index', (kind, index) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sensitiveEntry = sensitiveToolCall();

    if (kind !== 'missing') {
      sensitiveEntry['index'] = index;
    }

    const accumulator = {
      tool_calls: [
        {
          index: 0,
          type: 'function',
          id: 'call_original',
          function: { arguments: 'original' },
        },
      ],
    };
    const originalSnapshot = structuredClone(accumulator);

    expectStaticFailure(accumulator, { tool_calls: [sensitiveEntry] });

    expect(accumulator).toEqual(originalSnapshot);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('does not print sensitive entries if their index changes between validation and application', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sensitiveEntry = sensitiveToolCall();
    let indexReads = 0;

    Object.defineProperty(sensitiveEntry, 'index', {
      configurable: true,
      enumerable: false,
      get: () => {
        indexReads += 1;
        return indexReads === 1 ? 0 : undefined;
      },
    });

    const accumulator = {
      tool_calls: [
        {
          index: 0,
          type: 'function',
          id: 'call_original',
          function: { arguments: 'original' },
        },
      ],
    };
    const originalSnapshot = structuredClone(accumulator);

    expectStaticFailure(accumulator, { tool_calls: [sensitiveEntry] });

    expect(indexReads).toBe(2);
    expect(accumulator).toEqual(originalSnapshot);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('does not print sensitive tool-call deltas from public readable-stream restoration', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = createRunStepEvents();
    const originalSnapshot = structuredClone(events[0]?.data);
    const stream = assistantStream(events);

    await expectStreamFailure(stream);

    expect(stream.currentRunStepSnapshot()).toEqual(originalSnapshot);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test.each(['off', 'error'] as const)(
    'does not bypass a configured %s logger for public assistant run streams',
    async (logLevel) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const events = createRunStepEvents();
      const originalSnapshot = structuredClone(events[0]?.data);
      const { logger, redactedMessages } = createRedactingLogger();
      const body = events
        .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join('');
      const fetch = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      );
      const client = new OpenAI({
        apiKey: 'sk-synthetic-client-key',
        maxRetries: 0,
        logger,
        logLevel,
        fetch,
      });
      const stream = client.beta.threads.runs.stream('thread_synthetic', {
        assistant_id: 'assistant_synthetic',
      });

      await expectStreamFailure(stream);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(stream.currentRunStepSnapshot()).toEqual(originalSnapshot);
      expect(logger.error).not.toHaveBeenCalled();
      expect(redactedMessages).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  test('continues to accumulate valid indexed tool-call deltas without diagnostics', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const accumulator = {
      tool_calls: [
        {
          index: 0,
          type: 'function',
          id: 'call_original',
          function: { arguments: 'original' },
        },
      ],
    };

    const result = AssistantStream.accumulateDelta(accumulator, {
      tool_calls: [{ index: 0, function: { arguments: ' updated' } }],
    });

    expect(result).toBe(accumulator);
    expect(accumulator.tool_calls[0]?.function.arguments).toBe('original updated');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
