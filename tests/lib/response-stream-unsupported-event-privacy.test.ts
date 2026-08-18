import { vi } from 'vitest';

import OpenAI, { APIError, OpenAIError } from 'openai';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type { Response as APIResponse, ResponseStreamEvent } from 'openai/resources/responses/responses';

const syntheticCredential = 'sk-synthetic-private-response-token-7f3e';
const syntheticPatient = 'synthetic-patient-123-45-6789';
const syntheticPrompt = 'synthetic confidential customer transcript';
const syntheticPassword = 'hunter2';
const unsupportedPrefix = 'Unhandled response stream event: ';
const futureEventType = 'response.future_feature.delta';

function makeResponse(): APIResponse {
  return {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  } as APIResponse;
}

function createdEvent(): ResponseStreamEvent {
  return {
    type: 'response.created',
    sequence_number: 0,
    response: makeResponse(),
  } as ResponseStreamEvent;
}

function unsupportedEvent(type: unknown = futureEventType): Record<string, unknown> {
  return {
    type,
    sequence_number: 1,
    tool_call: {
      id: 'call_sensitive',
      function: {
        arguments: JSON.stringify({
          api_key: syntheticCredential,
          patient: syntheticPatient,
          transcript: syntheticPrompt,
        }),
      },
    },
    headers: {
      authorization: `Bearer ${syntheticCredential}`,
      cookie: `session=${syntheticCredential}`,
    },
  };
}

function createSnapshot(): APIResponse {
  return accumulateResponse(createdEvent());
}

function expectPrivateFailure(error: unknown, expectedType: string): asserts error is OpenAIError {
  expect(error).toBeInstanceOf(OpenAIError);
  expect((error as OpenAIError).constructor).toBe(OpenAIError);
  expect((error as OpenAIError).message).toBe(unsupportedPrefix + expectedType);
  expect((error as OpenAIError).message).not.toContain(syntheticCredential);
  expect((error as OpenAIError).message).not.toContain(syntheticPatient);
  expect((error as OpenAIError).message).not.toContain(syntheticPrompt);
  expect((error as OpenAIError).message).not.toContain(syntheticPassword);
  expect((error as OpenAIError).message).not.toContain('{');
  expect((error as OpenAIError).stack).not.toContain(syntheticCredential);
  expect((error as OpenAIError).stack).not.toContain(syntheticPatient);
  expect((error as OpenAIError).stack).not.toContain(syntheticPrompt);
  expect((error as OpenAIError).stack).not.toContain(syntheticPassword);
}

function applyUnsupported(event: unknown, snapshot?: APIResponse): unknown {
  try {
    accumulateResponse(event as ResponseStreamEvent, snapshot);
  } catch (error) {
    return error;
  }

  throw new Error('Expected an unsupported response event to be rejected.');
}

function readableStream(events: Record<string, unknown>[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
}

function createLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe('unsupported Responses event diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('does not expose nested credentials or patient data through the public accumulator', () => {
    const snapshot = createSnapshot();
    const originalSnapshot = structuredClone(snapshot);
    const event = unsupportedEvent();

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
    expect(snapshot).toEqual(originalSnapshot);
  });

  test.each(['first', 'subsequent'] as const)(
    'redacts namespace-matching private discriminators in a %s frame',
    (position) => {
      for (const type of ['response.patient.ssn123456789', `response.password.${syntheticPassword}`]) {
        const snapshot = position === 'first' ? undefined : createSnapshot();
        const failure = applyUnsupported(unsupportedEvent(type), snapshot);

        expectPrivateFailure(failure, 'unknown');
        expect((failure as OpenAIError).message).not.toContain('ssn123456789');
        expect((failure as OpenAIError).stack).not.toContain('ssn123456789');
      }
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'never invokes a credential-throwing discriminator getter in a %s frame',
    (position) => {
      const event = unsupportedEvent();
      const getter = vi.fn(() => {
        throw new Error(`sensitive discriminator getter: ${syntheticCredential}`);
      });
      Object.defineProperty(event, 'type', {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      const snapshot = position === 'first' ? undefined : createSnapshot();
      const failure = applyUnsupported(event, snapshot);

      expectPrivateFailure(failure, 'unknown');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'never invokes a credential-throwing discriminator proxy get trap in a %s frame',
    (position) => {
      const getter = vi.fn(() => {
        throw new Error(`sensitive discriminator proxy: ${syntheticCredential}`);
      });
      const event = new Proxy(unsupportedEvent(), {
        get(target, property, receiver) {
          if (property === 'type') {
            return getter();
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const snapshot = position === 'first' ? undefined : createSnapshot();
      const failure = applyUnsupported(event, snapshot);

      expectPrivateFailure(failure, 'unknown');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'normalizes a throwing descriptor trap before any %s-frame dispatch',
    (position) => {
      const descriptorFailure = new Error(`sensitive descriptor: ${syntheticCredential}`);
      const event = new Proxy(unsupportedEvent(), {
        getOwnPropertyDescriptor(target, property) {
          if (property === 'type') {
            throw descriptorFailure;
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });

      const snapshot = position === 'first' ? undefined : createSnapshot();
      const failure = applyUnsupported(event, snapshot);

      expectPrivateFailure(failure, 'unknown');
      expect(failure).not.toBe(descriptorFailure);
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'dispatches a supported %s-frame data discriminator without invoking its proxy getter',
    (position) => {
      const snapshot = position === 'first' ? undefined : createSnapshot();
      const original =
        position === 'first' ? createdEvent() : ({ type: 'keepalive', sequence_number: 1 } as const);
      const getter = vi.fn(() => {
        throw new Error(`sensitive supported discriminator: ${syntheticCredential}`);
      });
      const event = new Proxy(original, {
        get(target, property, receiver) {
          if (property === 'type') {
            return getter();
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = accumulateResponse(event, snapshot);

      expect(getter).not.toHaveBeenCalled();
      if (snapshot) {
        expect(result).toBe(snapshot);
      } else {
        expect(result.id).toBe('resp_synthetic');
      }
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'preserves the original receiver for a %s-frame own response accessor',
    (position) => {
      const response = makeResponse();
      const event =
        position === 'first'
          ? { type: 'response.created' as const, sequence_number: 0, response }
          : { type: 'response.completed' as const, sequence_number: 1, response };
      const receivedOriginalEvent: boolean[] = [];
      const getter = vi.fn(function recordOriginalEventReceiver(this: typeof event) {
        receivedOriginalEvent.push(this === event);
        return response;
      });

      Object.defineProperty(event, 'response', {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      const snapshot = position === 'first' ? undefined : createSnapshot();

      expect(accumulateResponse(event, snapshot).id).toBe('resp_synthetic');
      expect(getter).toHaveBeenCalledTimes(1);
      expect(receivedOriginalEvent).toEqual([true]);
    },
  );

  test.each(['first', 'subsequent'] as const)(
    'preserves a %s-frame private-field response accessor',
    (position) => {
      class ReceiverSensitiveEvent<Type extends 'response.created' | 'response.completed'> {
        readonly type: Type;
        readonly sequence_number = 0;
        #response = makeResponse();

        constructor(type: Type) {
          this.type = type;
        }

        get response(): APIResponse {
          return this.#response;
        }
      }

      const event =
        position === 'first'
          ? new ReceiverSensitiveEvent('response.created')
          : new ReceiverSensitiveEvent('response.completed');
      const snapshot = position === 'first' ? undefined : createSnapshot();

      expect(accumulateResponse(event, snapshot).id).toBe('resp_synthetic');
    },
  );

  test.each(['response.mcp_list_tools.failed', 'response.audio.transcript.done'] as const)(
    'continues dispatching the generated %s discriminator',
    (type) => {
      const snapshot = createSnapshot();
      const event = { type, sequence_number: 1 } as ResponseStreamEvent;

      expect(accumulateResponse(event, snapshot)).toBe(snapshot);
    },
  );

  test.each([
    [
      'a circular event payload',
      (event: Record<string, unknown>) => {
        event['self'] = event;
      },
    ],
    [
      'a BigInt event payload',
      (event: Record<string, unknown>) => {
        event['count'] = 42n;
      },
    ],
  ])('preserves the SDK error for %s', (_name, addPayload) => {
    const snapshot = createSnapshot();
    const event = unsupportedEvent();
    addPayload(event);

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
    expect(failure).not.toBeInstanceOf(TypeError);
  });

  test('does not inspect or invoke an attacker-controlled toJSON getter', () => {
    const snapshot = createSnapshot();
    const event = unsupportedEvent();
    const getter = vi.fn(() => {
      throw new Error(`sensitive toJSON getter: ${syntheticCredential}`);
    });

    Object.defineProperty(event, 'toJSON', {
      configurable: true,
      get: getter,
    });

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
    expect(getter).not.toHaveBeenCalled();
  });

  test('does not invoke an attacker-controlled toJSON function', () => {
    const snapshot = createSnapshot();
    const event = unsupportedEvent();
    const toJSON = vi.fn(() => {
      throw new Error(`sensitive toJSON callback: ${syntheticCredential}`);
    });

    Object.defineProperty(event, 'toJSON', {
      configurable: true,
      value: toJSON,
    });

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
    expect(toJSON).not.toHaveBeenCalled();
  });

  test('does not expose a throwing proxy descriptor trap', () => {
    const snapshot = createSnapshot();
    const descriptorFailure = new Error(`sensitive descriptor: ${syntheticCredential}`);
    const event = new Proxy(unsupportedEvent(), {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'type') {
          throw descriptorFailure;
        }

        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
    expect(failure).not.toBe(descriptorFailure);
  });

  test('does not trust an inherited discriminator for diagnostic output', () => {
    const snapshot = createSnapshot();
    const event = Object.create({ type: futureEventType }) as Record<string, unknown>;
    event['sequence_number'] = 1;
    event['private_data'] = syntheticCredential;

    const failure = applyUnsupported(event, snapshot);

    expectPrivateFailure(failure, 'unknown');
  });

  test.each([
    ['a credential', syntheticCredential],
    ['a bearer value', `Bearer ${syntheticCredential}`],
    ['a newline', `response.future\n${syntheticCredential}`],
    ['a carriage return', `response.future\r${syntheticPatient}`],
    ['an ANSI escape', 'response.future\u001B[31m'],
    ['Unicode', 'response.futur\u00E9'],
    ['a URL', `https://attacker.invalid/${syntheticCredential}`],
    ['a hyphenated token segment', 'response.sk-synthetic-secret'],
    ['an uppercase segment', 'response.Future'],
    ['a numeric segment', 'response.123'],
    ['a missing namespace', 'future_feature'],
    ['an empty discriminator', ''],
    ['a null discriminator', null],
    ['a numeric discriminator', 42],
    ['a boolean discriminator', true],
    ['a noncoercible discriminator', { toString: null, valueOf: null }],
    ['an array discriminator', ['response.future_feature']],
    ['an oversized discriminator', `response.${'a'.repeat(120)}`],
  ])('replaces %s with a generic diagnostic', (_name, type) => {
    const snapshot = createSnapshot();

    const failure = applyUnsupported(unsupportedEvent(type), snapshot);

    expectPrivateFailure(failure, 'unknown');
  });

  test('redacts even a syntactically valid maximum-length unsupported discriminator', () => {
    const type = `response.${'a'.repeat(119)}`;
    const snapshot = createSnapshot();

    const failure = applyUnsupported(unsupportedEvent(type), snapshot);

    expect(type).toHaveLength(128);
    expectPrivateFailure(failure, 'unknown');
  });

  test.each(['response.patient.ssn123456789', `response.password.${syntheticPassword}`] as const)(
    'keeps a first-frame readable-stream discriminator %s private',
    async (type) => {
      const stream = ResponseStream.fromReadableStream(readableStream([unsupportedEvent(type)]));
      const events = vi.fn();
      const errors = vi.fn();
      stream.on('event', events);
      stream.on('error', errors);

      const failure = await stream.finalResponse().then(
        () => {
          throw new Error('Expected the first response event to be rejected.');
        },
        (error: unknown) => error,
      );

      expectPrivateFailure(failure, 'unknown');
      expect((failure as OpenAIError).message).not.toContain('ssn123456789');
      expect(events).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(failure);
    },
  );

  test.each(['done', 'finalResponse'] as const)(
    'keeps restored readable-stream %s failures private',
    async (completionMethod) => {
      const created = createdEvent();
      const event = unsupportedEvent();
      const stream = ResponseStream.fromReadableStream(
        readableStream([created as unknown as Record<string, unknown>, event]),
      );
      const events = vi.fn();
      const errors = vi.fn();

      stream.on('event', events);
      stream.on('error', errors);

      const completion = completionMethod === 'done' ? stream.done() : stream.finalResponse();
      const failure = await completion.then(
        () => {
          throw new Error('Expected the restored stream to reject.');
        },
        (error: unknown) => error,
      );

      expectPrivateFailure(failure, 'unknown');
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(created);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(failure);
      expect(stream.ended).toBe(true);
      expect(stream.errored).toBe(true);
      expect(stream.aborted).toBe(false);
    },
  );

  test.each([
    ['off', 'done', futureEventType],
    ['off', 'finalResponse', 'response.patient.ssn123456789'],
    ['error', 'done', `response.password.${syntheticPassword}`],
    ['error', 'finalResponse', futureEventType],
  ] as const)(
    'keeps public client %s logger / %s failures private for %s',
    async (logLevel, completionMethod, type) => {
      const created = createdEvent();
      const event = unsupportedEvent(type);
      const body = `${[created, event]
        .map((streamEvent) => `data: ${JSON.stringify(streamEvent)}`)
        .join('\n\n')}\n\ndata: [DONE]\n\n`;
      const fetch = vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      );
      const logger = createLogger();
      const client = new OpenAI({
        apiKey: 'sk-synthetic-client-key',
        fetch,
        logger,
        logLevel,
        maxRetries: 0,
      });
      const stream = client.responses.stream({
        model: 'gpt-5',
        input: 'synthetic request',
      });
      const events = vi.fn();
      const errors = vi.fn();

      stream.on('event', events);
      stream.on('error', errors);

      const completion = completionMethod === 'done' ? stream.done() : stream.finalResponse();
      const failure = await completion.then(
        () => {
          throw new Error('Expected the public response stream to reject.');
        },
        (error: unknown) => error,
      );

      expectPrivateFailure(failure, 'unknown');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(created);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(failure);
      expect(logger.error).not.toHaveBeenCalled();
      expect(stream.ended).toBe(true);
      expect(stream.errored).toBe(true);
      expect(stream.aborted).toBe(false);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('ssn123456789');
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(syntheticPassword);
    },
  );

  test('preserves documented provider API-error diagnostics', async () => {
    const payload = {
      type: 'invalid_request_error',
      code: 'rate_limit_exceeded',
      message: 'The provider rejected the streamed response.',
      param: 'input',
    };
    const stream = ResponseStream.fromReadableStream(
      readableStream([
        createdEvent() as unknown as Record<string, unknown>,
        { type: 'error', sequence_number: 1, error: payload },
      ]),
    );

    const failure = await stream.finalResponse().then(
      () => {
        throw new Error('Expected the provider API error to reject.');
      },
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(APIError);
    expect(failure).toMatchObject({
      message: payload.message,
      code: payload.code,
      param: payload.param,
      type: payload.type,
      error: payload,
    });
  });
});
