import { vi } from 'vitest';

import OpenAI, { OpenAIError } from 'openai';
import { AssistantStream } from 'openai/lib/AssistantStream';

const syntheticCredential = 'sk-synthetic-private-assistant-token-91a7';
const syntheticPatient = 'synthetic-patient-123-45-6789';
const syntheticPrompt = 'synthetic confidential assistant conversation';
const sensitiveText = `${syntheticCredential} ${syntheticPatient} ${syntheticPrompt}`;
const sensitiveToolArguments = JSON.stringify({
  api_key: syntheticCredential,
  patient: syntheticPatient,
  transcript: syntheticPrompt,
});
const invalidArrayEntryMessage = 'Expected array delta entry to be an object but got an invalid value';
const invalidArrayIndexTypeMessage =
  'Expected array delta entry `index` property to be a number but got an invalid value';

interface AssistantEventFixture {
  event: string;
  data: Record<string, unknown>;
}

interface StreamingScenario {
  name: string;
  events: () => AssistantEventFixture[];
  expectedMessage: string;
  snapshot: 'message' | 'run-step';
  cause: 'Error' | 'TypeError' | undefined;
}

function messageEvents(
  value: unknown = true,
  index: unknown = 0,
  initialValue: unknown = sensitiveText,
): AssistantEventFixture[] {
  return [
    {
      event: 'thread.message.created',
      data: {
        id: 'msg_synthetic_private',
        object: 'thread.message',
        role: 'assistant',
        content: [{ index: 0, type: 'text', text: { value: initialValue, annotations: [] } }],
      },
    },
    {
      event: 'thread.message.delta',
      data: {
        id: 'msg_synthetic_private',
        delta: {
          content: [{ index, type: 'text', text: { value } }],
        },
      },
    },
  ];
}

function runStepEvents(
  value: unknown = true,
  index: unknown = 0,
  primitiveEntry = false,
): AssistantEventFixture[] {
  return [
    {
      event: 'thread.run.step.created',
      data: {
        id: 'step_synthetic_private',
        status: 'in_progress',
        step_details: {
          type: 'tool_calls',
          tool_calls: [
            {
              index: 0,
              type: 'function',
              id: 'call_synthetic_private',
              function: {
                name: 'retrieve_private_patient',
                arguments: sensitiveToolArguments,
              },
            },
          ],
        },
      },
    },
    {
      event: 'thread.run.step.delta',
      data: {
        id: 'step_synthetic_private',
        delta: {
          step_details: {
            type: 'tool_calls',
            tool_calls: [
              primitiveEntry ? sensitiveText : { index, type: 'function', function: { arguments: value } },
            ],
          },
        },
      },
    },
  ];
}

const streamingScenarios: StreamingScenario[] = [
  {
    name: 'sensitive assistant text already in the message snapshot',
    events: () => messageEvents(),
    expectedMessage: 'Unhandled record type: value',
    snapshot: 'message',
    cause: 'TypeError',
  },
  {
    name: 'sensitive function arguments already in the run-step snapshot',
    events: () => runStepEvents(),
    expectedMessage: 'Unhandled record type: arguments',
    snapshot: 'run-step',
    cause: 'TypeError',
  },
  {
    name: 'a sensitive incoming message record value',
    events: () => messageEvents(sensitiveText, 0, true),
    expectedMessage: 'Unhandled record type: value',
    snapshot: 'message',
    cause: 'TypeError',
  },
  {
    name: 'a sensitive primitive run-step array entry',
    events: () => runStepEvents(true, 0, true),
    expectedMessage: invalidArrayEntryMessage,
    snapshot: 'run-step',
    cause: 'Error',
  },
  {
    name: 'a sensitive content index',
    events: () => messageEvents(true, sensitiveText),
    expectedMessage: 'Assistant stream delta contains an invalid content index: unknown',
    snapshot: 'message',
    cause: undefined,
  },
  {
    name: 'a sensitive run-step array index',
    events: () => runStepEvents(true, sensitiveText),
    expectedMessage: invalidArrayIndexTypeMessage,
    snapshot: 'run-step',
    cause: 'TypeError',
  },
];

function makeReadableStream(events: AssistantEventFixture[]): ReadableStream<Uint8Array> {
  const serialized = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(serialized));
      controller.close();
    },
  });
}

function createPublicStream(events: AssistantEventFixture[], logLevel: 'off' | 'error') {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  const fetch = vi.fn(
    async () =>
      new Response(
        events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
  );
  const client = new OpenAI({
    apiKey: 'sk-synthetic-client-key',
    fetch,
    logger,
    logLevel,
    maxRetries: 0,
  });
  const stream = client.beta.threads.runs.stream('thread_synthetic_private', {
    assistant_id: 'assistant_synthetic_private',
  });

  return { stream, logger, fetch };
}

function expectPrivateError(error: Error, expectedMessage: string): void {
  expect(error.message).toBe(expectedMessage);
  expect(error.message).not.toContain('\n');
  expect(error.message).not.toContain('\r');

  for (const secret of [syntheticCredential, syntheticPatient, syntheticPrompt]) {
    expect(error.message).not.toContain(secret);
    expect(error.stack).not.toContain(secret);
  }
}

function captureStaticFailure(accumulator: Record<string, unknown>, delta: Record<string, unknown>): Error {
  let failure: unknown;

  try {
    AssistantStream.accumulateDelta(accumulator, delta);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

async function expectPrivateStreamFailure(
  stream: AssistantStream,
  scenario: StreamingScenario,
  originalSnapshot: Record<string, unknown>,
): Promise<void> {
  const errors = vi.fn();
  stream.on('error', errors);

  const results = await Promise.allSettled([
    stream.done(),
    stream.finalRun(),
    stream.finalMessages(),
    stream.finalRunSteps(),
  ]);
  const [first] = results;
  if (!first || first.status !== 'rejected') {
    throw new Error('Expected every public assistant-stream completion to reject.');
  }

  const failure = first.reason as unknown;
  expect(failure).toBeInstanceOf(OpenAIError);
  expect((failure as Error).constructor).toBe(OpenAIError);

  for (const result of results) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe(failure);
    }
  }

  const sdkError = failure as OpenAIError & { cause?: unknown };
  expectPrivateError(sdkError, scenario.expectedMessage);
  if (scenario.cause) {
    expect(sdkError.cause).toBeInstanceOf(Error);
    expect((sdkError.cause as Error).constructor.name).toBe(scenario.cause);
    expectPrivateError(sdkError.cause as Error, scenario.expectedMessage);
  } else {
    expect(sdkError.cause).toBeUndefined();
  }

  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledWith(sdkError);
  expect(
    scenario.snapshot === 'message' ? stream.currentMessageSnapshot() : stream.currentRunStepSnapshot(),
  ).toEqual(originalSnapshot);
  expect(stream.ended).toBe(true);
  expect(stream.errored).toBe(true);
  expect(stream.aborted).toBe(false);
}

describe('AssistantStream malformed-delta diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(streamingScenarios)(
    'redacts $name through public readable-stream restoration',
    async (scenario) => {
      const events = scenario.events();
      const originalSnapshot = structuredClone(events[0]?.data ?? {});
      const stream = AssistantStream.fromReadableStream(makeReadableStream(events));

      await expectPrivateStreamFailure(stream, scenario, originalSnapshot);
    },
  );

  test.each(
    streamingScenarios.flatMap((scenario) =>
      (['off', 'error'] as const).map((logLevel) => ({ ...scenario, logLevel })),
    ),
  )('redacts $name for the real public client with logLevel=$logLevel', async (scenario) => {
    const events = scenario.events();
    const originalSnapshot = structuredClone(events[0]?.data ?? {});
    const { stream, logger, fetch } = createPublicStream(events, scenario.logLevel);

    await expectPrivateStreamFailure(stream, scenario, originalSnapshot);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'sensitive previously accumulated text',
      accumulator: () => ({ value: sensitiveText }),
      delta: () => ({ value: true }),
      expectedMessage: 'Unhandled record type: value',
      expectedClass: 'TypeError',
    },
    {
      name: 'a sensitive incoming text value',
      accumulator: () => ({ value: true }),
      delta: () => ({ value: sensitiveText }),
      expectedMessage: 'Unhandled record type: value',
      expectedClass: 'TypeError',
    },
    {
      name: 'sensitive accumulated function arguments',
      accumulator: () => ({ arguments: sensitiveToolArguments }),
      delta: () => ({ arguments: false }),
      expectedMessage: 'Unhandled record type: arguments',
      expectedClass: 'TypeError',
    },
    {
      name: 'sensitive accumulated custom-tool input',
      accumulator: () => ({ input: sensitiveText }),
      delta: () => ({ input: false }),
      expectedMessage: 'Unhandled record type: input',
      expectedClass: 'TypeError',
    },
    {
      name: 'a sensitive indexed-array primitive',
      accumulator: () => ({ entries: [{ index: 0 }] }),
      delta: () => ({ entries: [sensitiveText] }),
      expectedMessage: invalidArrayEntryMessage,
      expectedClass: 'Error',
    },
    {
      name: 'a sensitive indexed-array discriminator',
      accumulator: () => ({ entries: [{ index: 0 }] }),
      delta: () => ({ entries: [{ index: sensitiveText }] }),
      expectedMessage: invalidArrayIndexTypeMessage,
      expectedClass: 'TypeError',
    },
  ])('keeps the public static accumulator private for $name', (scenario) => {
    const accumulator = scenario.accumulator();
    const original = structuredClone(accumulator);
    const failure = captureStaticFailure(accumulator, scenario.delta());

    expect(failure.constructor.name).toBe(scenario.expectedClass);
    expectPrivateError(failure, scenario.expectedMessage);
    expect(accumulator).toEqual(original);
  });

  test.each([
    syntheticCredential,
    'patient_ssn_123_45_6789',
    'password_hunter2',
    `value\n${syntheticCredential}`,
    `\u001B[31m${syntheticCredential}`,
    'x'.repeat(1024),
  ])('never exposes an untrusted mismatched field name', (field) => {
    const accumulator = { [field]: true };
    const failure = captureStaticFailure(accumulator, { [field]: sensitiveText });

    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, 'Unhandled record type: unknown');
    expect(failure.message).not.toContain(field);
    expect(accumulator).toEqual({ [field]: true });
  });

  test.each([
    'value',
    'arguments',
    'input',
    'text',
    'content',
    'annotations',
    'metadata',
    'name',
    'role',
    'status',
    'tool_calls',
    'step_details',
  ])('preserves the trusted protocol field diagnostic for %s', (field) => {
    const failure = captureStaticFailure({ [field]: true }, { [field]: sensitiveText });

    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, `Unhandled record type: ${field}`);
  });

  test.each([
    { name: 'a Symbol description', value: Symbol(syntheticCredential) },
    { name: 'a BigInt', value: 42n },
    { name: 'a sensitive string', value: sensitiveText },
  ])('rejects $name as an array entry without coercion', ({ value }) => {
    const accumulator = { entries: [{ index: 0 }] };
    const failure = captureStaticFailure(accumulator, { entries: [value] });

    expect(failure.constructor).toBe(Error);
    expectPrivateError(failure, invalidArrayEntryMessage);
    expect(accumulator).toEqual({ entries: [{ index: 0 }] });
  });

  test.each([
    { name: 'a Symbol description', value: Symbol(syntheticCredential) },
    { name: 'a BigInt', value: 42n },
    { name: 'a sensitive string', value: sensitiveText },
  ])('rejects $name as an indexed-array discriminator without coercion', ({ value }) => {
    const accumulator = { entries: [{ index: 0 }] };
    const failure = captureStaticFailure(accumulator, { entries: [{ index: value }] });

    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, invalidArrayIndexTypeMessage);
    expect(accumulator).toEqual({ entries: [{ index: 0 }] });
  });

  test('never invokes a throwing indexed-array discriminator conversion hook', () => {
    const convert = vi.fn(() => {
      throw new Error(`conversion disclosed ${sensitiveText}`);
    });
    const invalidIndex = {
      [Symbol.toPrimitive]: convert,
      toString: convert,
      valueOf: convert,
    };
    const failure = captureStaticFailure({ entries: [{ index: 0 }] }, { entries: [{ index: invalidIndex }] });

    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, invalidArrayIndexTypeMessage);
    expect(convert).not.toHaveBeenCalled();
  });

  test.each(['accumulator', 'delta'] as const)('never coerces a throwing %s record value', (side) => {
    const convert = vi.fn(() => {
      throw new Error(`record conversion disclosed ${sensitiveText}`);
    });
    const adversarial = {
      [Symbol.toPrimitive]: convert,
      toString: convert,
      valueOf: convert,
    };
    const accumulator: Record<string, unknown> =
      side === 'accumulator' ? { value: adversarial } : { value: true };
    const delta: Record<string, unknown> =
      side === 'accumulator' ? { value: sensitiveText } : { value: adversarial };
    const failure = captureStaticFailure(accumulator, delta);

    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, 'Unhandled record type: value');
    expect(convert).not.toHaveBeenCalled();
  });

  test('redacts an array entry that changes after preflight validation', () => {
    let reads = 0;
    const delta: unknown[] = [];
    Object.defineProperty(delta, 0, {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return reads >= 4 ? sensitiveText : { index: 0, value: 'safe' };
      },
    });
    const accumulator = { entries: [{ index: 0, value: 'safe' }] };
    const failure = captureStaticFailure(accumulator, { entries: delta });

    expect(reads).toBe(5);
    expect(failure.constructor).toBe(Error);
    expectPrivateError(failure, invalidArrayEntryMessage);
    expect(accumulator).toEqual({ entries: [{ index: 0, value: 'safe' }] });
  });

  test('redacts an index that changes after preflight validation', () => {
    let reads = 0;
    const entry = { value: ' updated' };
    Object.defineProperty(entry, 'index', {
      configurable: true,
      enumerable: false,
      get() {
        reads += 1;
        return reads === 1 ? 0 : sensitiveText;
      },
    });
    const accumulator = { entries: [{ index: 0, value: 'safe' }] };
    const failure = captureStaticFailure(accumulator, { entries: [entry] });

    expect(reads).toBe(2);
    expect(failure.constructor).toBe(TypeError);
    expectPrivateError(failure, invalidArrayIndexTypeMessage);
    expect(accumulator).toEqual({ entries: [{ index: 0, value: 'safe' }] });
  });

  test.each([-1, 1.5, 1024, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains the existing safe numeric array-index diagnostic for %s',
    (index) => {
      const accumulator = { entries: [] };
      const failure = captureStaticFailure(accumulator, { entries: [{ index }] });

      expect(failure.constructor).toBe(OpenAIError);
      expectPrivateError(failure, `Assistant stream delta contains an invalid array index: ${index}`);
      expect(accumulator).toEqual({ entries: [] });
    },
  );

  test('preserves normal sensitive assistant text and function-argument accumulation', () => {
    const accumulator = {
      text: { value: syntheticPrompt },
      tool_calls: [{ index: 0, function: { arguments: syntheticCredential } }],
    };

    const result = AssistantStream.accumulateDelta(accumulator, {
      text: { value: ` ${syntheticPatient}` },
      tool_calls: [{ index: 0, function: { arguments: ' continued' } }],
    });

    expect(result).toBe(accumulator);
    expect(accumulator.text.value).toBe(`${syntheticPrompt} ${syntheticPatient}`);
    expect(accumulator.tool_calls[0]?.function.arguments).toBe(`${syntheticCredential} continued`);
  });
});
