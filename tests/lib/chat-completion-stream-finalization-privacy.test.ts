import { vi } from 'vitest';

import OpenAI, { OpenAIError } from 'openai';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';

const syntheticCredential = 'sk-synthetic-private-chat-token-91a7';
const syntheticPatient = 'synthetic-patient-123-45-6789';
const syntheticPrompt = 'synthetic confidential customer conversation';
const syntheticToolArguments = JSON.stringify({
  api_key: syntheticCredential,
  patient: syntheticPatient,
  transcript: syntheticPrompt,
});

type FailureKind =
  | 'missing-type'
  | 'missing-custom-name'
  | 'missing-function-name'
  | 'missing-function-arguments';

interface FailureCase {
  name: string;
  kind: FailureKind;
  expectedMessage: string;
}

const failureCases: FailureCase[] = [
  {
    name: 'missing tool-call type',
    kind: 'missing-type',
    expectedMessage: 'missing choices[0].tool_calls[0].type',
  },
  {
    name: 'missing custom tool-call name',
    kind: 'missing-custom-name',
    expectedMessage: 'missing choices[0].tool_calls[0].custom.name',
  },
  {
    name: 'missing function tool-call name',
    kind: 'missing-function-name',
    expectedMessage: 'missing choices[0].tool_calls[0].function.name',
  },
  {
    name: 'missing function tool-call arguments',
    kind: 'missing-function-arguments',
    expectedMessage: 'missing choices[0].tool_calls[0].function.arguments',
  },
];

function sensitiveToolCall(kind: FailureKind): Record<string, unknown> {
  const providerMetadata = {
    authorization: `Bearer ${syntheticCredential}`,
    patient: syntheticPatient,
    transcript: syntheticPrompt,
  };

  switch (kind) {
    case 'missing-type': {
      return {
        index: 0,
        id: 'call_synthetic_private',
        provider_metadata: providerMetadata,
        function: {
          name: 'lookup_private_patient',
          arguments: syntheticToolArguments,
        },
      };
    }
    case 'missing-custom-name': {
      return {
        index: 0,
        id: 'call_synthetic_private',
        type: 'custom',
        provider_metadata: providerMetadata,
      };
    }
    case 'missing-function-name':
    case 'missing-function-arguments': {
      return {
        index: 0,
        id: 'call_synthetic_private',
        type: 'function',
        provider_metadata: providerMetadata,
        function: {
          name: 'lookup_private_patient',
          arguments: syntheticToolArguments,
        },
      };
    }
    default: {
      throw new Error('Unexpected malformed tool-call fixture.');
    }
  }
}

function makeSensitiveChunk(kind: FailureKind): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chatcmpl_synthetic_private',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        logprobs: null,
        delta: {
          role: 'assistant',
          content: `${syntheticPrompt}: ${syntheticPatient}; ${syntheticCredential}`,
          tool_calls: [sensitiveToolCall(kind)],
        },
      },
    ],
  } as unknown as OpenAI.Chat.ChatCompletionChunk;
}

function makeReadableStream(chunk: OpenAI.Chat.ChatCompletionChunk): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${JSON.stringify(chunk)}\n`));
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

function createPublicStream(chunk: OpenAI.Chat.ChatCompletionChunk, logLevel: 'off' | 'error') {
  const logger = createLogger();
  const fetch = vi.fn(
    async () =>
      new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  const client = new OpenAI({
    apiKey: 'sk-synthetic-client-key',
    fetch,
    logger,
    logLevel,
    maxRetries: 0,
  });
  const stream = client.chat.completions.stream({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'synthetic safe request' }],
  });

  return { stream, logger, fetch };
}

function attachSnapshot(
  stream: ChatCompletionStream<null>,
  kind: FailureKind,
): { snapshot?: ChatCompletionSnapshot; original?: ChatCompletionSnapshot } {
  const captured: { snapshot?: ChatCompletionSnapshot; original?: ChatCompletionSnapshot } = {};

  stream.on('chunk', (_chunk, snapshot) => {
    const tool = snapshot.choices[0]?.message.tool_calls?.[0];
    if (!tool) {
      throw new Error('Expected a sensitive tool-call snapshot.');
    }

    if (kind === 'missing-function-name' || kind === 'missing-function-arguments') {
      const record = tool as unknown as Record<string, unknown>;
      const fn = record['function'] as Record<string, unknown>;
      const key = kind === 'missing-function-name' ? 'name' : 'arguments';
      Reflect.deleteProperty(fn, key);
    }

    captured.snapshot = snapshot;
    captured.original = structuredClone(snapshot);
  });

  return captured;
}

function expectPrivateError(error: unknown, expectedMessage: string): asserts error is OpenAIError {
  expect(error).toBeInstanceOf(OpenAIError);
  expect((error as OpenAIError).constructor).toBe(OpenAIError);
  expect((error as OpenAIError).message).toBe(expectedMessage);
  expect((error as OpenAIError).message).not.toContain('\n');
  expect((error as OpenAIError).message).not.toContain('{');

  for (const secret of [syntheticCredential, syntheticPatient, syntheticPrompt]) {
    expect((error as OpenAIError).message).not.toContain(secret);
    expect((error as OpenAIError).stack).not.toContain(secret);
  }
}

async function collectPublicFailures(stream: ChatCompletionStream<null>): Promise<unknown[]> {
  const results = await Promise.allSettled([
    stream.done(),
    stream.finalChatCompletion(),
    stream.finalMessage(),
  ]);

  return results.map((result) => (result.status === 'rejected' ? result.reason : null));
}

describe('chat completion tool-finalization diagnostic privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(failureCases)(
    'redacts the whole restored completion snapshot for $name',
    async ({ kind, expectedMessage }) => {
      const chunk = makeSensitiveChunk(kind);
      const stream = ChatCompletionStream.fromReadableStream(makeReadableStream(chunk));
      const captured = attachSnapshot(stream, kind);
      const errors = vi.fn();
      stream.on('error', errors);

      const failures = await collectPublicFailures(stream);
      const [failure] = failures;

      expectPrivateError(failure, expectedMessage);
      expect(failures.every((error) => error === failure)).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(failure);
      expect(captured.snapshot).toEqual(captured.original);
      expect(stream.ended).toBe(true);
      expect(stream.errored).toBe(true);
      expect(stream.aborted).toBe(false);
    },
  );

  test.each(
    failureCases.flatMap((failure) =>
      (['off', 'error'] as const).map((logLevel) => ({ ...failure, logLevel })),
    ),
  )(
    'keeps the real public client $logLevel logger private for $name',
    async ({ kind, expectedMessage, logLevel }) => {
      const chunk = makeSensitiveChunk(kind);
      const { stream, logger, fetch } = createPublicStream(chunk, logLevel);
      const captured = attachSnapshot(stream, kind);
      const errors = vi.fn();
      stream.on('error', errors);

      const failures = await collectPublicFailures(stream);
      const [failure] = failures;

      expectPrivateError(failure, expectedMessage);
      expect(failures.every((error) => error === failure)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(failure);
      expect(logger.error).not.toHaveBeenCalled();
      expect(captured.snapshot).toEqual(captured.original);
      expect(stream.ended).toBe(true);
      expect(stream.errored).toBe(true);
      expect(stream.aborted).toBe(false);
    },
  );

  test.each([
    [
      'a cyclic snapshot value',
      (snapshot: Record<string, unknown>) => {
        snapshot['cycle'] = snapshot;
      },
    ],
    [
      'a BigInt snapshot value',
      (snapshot: Record<string, unknown>) => {
        snapshot['count'] = 42n;
      },
    ],
  ])('preserves the original SDK diagnostic for %s', async (_label, mutateSnapshot) => {
    const stream = ChatCompletionStream.fromReadableStream(
      makeReadableStream(makeSensitiveChunk('missing-type')),
    );
    stream.on('chunk', (_chunk, snapshot) => {
      mutateSnapshot(snapshot as unknown as Record<string, unknown>);
    });

    const [failure] = await collectPublicFailures(stream);
    expectPrivateError(failure, 'missing choices[0].tool_calls[0].type');
    expect(failure).not.toBeInstanceOf(TypeError);
  });

  test('never evaluates a private snapshot toJSON getter', async () => {
    const stream = ChatCompletionStream.fromReadableStream(
      makeReadableStream(makeSensitiveChunk('missing-type')),
    );
    const getter = vi.fn(() => {
      throw new Error(`synthetic toJSON secret: ${syntheticCredential}`);
    });
    stream.on('chunk', (_chunk, snapshot) => {
      Object.defineProperty(snapshot, 'toJSON', {
        configurable: true,
        get: getter,
      });
    });

    const [failure] = await collectPublicFailures(stream);

    expectPrivateError(failure, 'missing choices[0].tool_calls[0].type');
    expect(getter).not.toHaveBeenCalled();
  });

  test.each(['function', 'custom'] as const)(
    'preserves valid completed $name tool calls and confidential content',
    async (type) => {
      const chunk = makeSensitiveChunk(type === 'function' ? 'missing-function-name' : 'missing-custom-name');
      const toolCall = chunk.choices[0]?.delta.tool_calls?.[0] as unknown as Record<string, unknown>;
      if (type === 'custom') {
        toolCall['custom'] = { name: 'trusted_custom_tool', input: syntheticToolArguments };
      }
      const stream = ChatCompletionStream.fromReadableStream(makeReadableStream(chunk));

      const completion = await stream.finalChatCompletion();
      const [choice] = completion.choices;

      expect(choice?.message.role).toBe('assistant');
      expect(choice?.message.content).toContain(syntheticPrompt);
      expect(choice?.message.content).toContain(syntheticCredential);
      expect(choice?.finish_reason).toBe('tool_calls');
      expect(choice?.message.tool_calls?.[0]).toMatchObject(
        type === 'function'
          ? {
              type: 'function',
              function: {
                name: 'lookup_private_patient',
                arguments: syntheticToolArguments,
              },
            }
          : {
              type: 'custom',
              custom: {
                name: 'trusted_custom_tool',
                input: syntheticToolArguments,
              },
            },
      );
    },
  );
});
