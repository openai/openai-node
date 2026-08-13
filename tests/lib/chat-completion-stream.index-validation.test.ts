import { vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { Stream } from 'openai/streaming';

type StreamIndexKind = 'choice' | 'tool call';

function createChunk(
  index: unknown,
  kind: StreamIndexKind,
  additionalFields: Record<string, unknown> = {},
): OpenAI.Chat.ChatCompletionChunk {
  const choice =
    kind === 'choice'
      ? {
          index,
          delta: { role: 'assistant', content: 'content' },
          finish_reason: 'stop',
          logprobs: null,
          ...additionalFields,
        }
      : {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index,
                id: 'call_test',
                type: 'function',
                function: { name: 'test', arguments: '{}' },
                ...additionalFields,
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
        };

  return {
    id: 'chatcmpl-index-validation',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: [choice],
  } as OpenAI.Chat.ChatCompletionChunk;
}

function createStream(chunks: OpenAI.Chat.ChatCompletionChunk[], n?: number | null): ChatCompletionStream {
  const client = {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          controller: new AbortController(),
          async *[Symbol.asyncIterator]() {
            yield* chunks;
          },
        })),
      },
    },
  } as unknown as OpenAI;

  return ChatCompletionStream.createChatCompletion(client, {
    model: 'gpt-test',
    messages: [],
    ...(n === undefined ? {} : { n }),
  });
}

function getSnapshotArray(stream: ChatCompletionStream, kind: StreamIndexKind): unknown[] | undefined {
  return kind === 'choice'
    ? stream.currentChatCompletionSnapshot?.choices
    : stream.currentChatCompletionSnapshot?.choices[0]?.message.tool_calls;
}

function toReadableStream(chunks: OpenAI.Chat.ChatCompletionChunk[]): ReadableStream {
  return new Stream(async function* streamChunks() {
    yield* chunks;
  }, new AbortController()).toReadableStream();
}

const invalidIndices = [
  '__proto__',
  'constructor',
  'toString',
  '0',
  'not-an-index',
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  128,
  100_000_000,
  2 ** 32 - 2,
  2 ** 32 - 1,
  2 ** 32,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 1,
];

describe('ChatCompletionStream index validation', () => {
  describe.each<StreamIndexKind>(['choice', 'tool call'])('%s indices', (kind) => {
    it('rejects an index that would pollute the global Array prototype', async () => {
      const pollutionKey = `sdk${kind.replace(' ', '')}PrototypePolluted`;
      const prototype = Array.prototype as unknown as Record<string, unknown>;
      const stream = createStream([createChunk('__proto__', kind, { [pollutionKey]: 'owned' })]);

      try {
        await expect(stream.done()).rejects.toThrow(`invalid ${kind} index: __proto__`);
        expect(([] as unknown as Record<string, unknown>)[pollutionKey]).toBeUndefined();
        expect(getSnapshotArray(stream, kind)).toEqual([]);
      } finally {
        Reflect.deleteProperty(prototype, pollutionKey);
      }
    });

    it.each(invalidIndices)('rejects invalid index %s before indexing the snapshot', async (index) => {
      const stream = createStream([createChunk(index, kind)]);

      await expect(stream.done()).rejects.toThrow(OpenAIError);
      expect(stream.errored).toBe(true);
      expect(getSnapshotArray(stream, kind)).toEqual([]);
    });

    it('accepts the final index within the defensive protocol-sized bound', async () => {
      const stream = createStream([createChunk(127, kind), createChunk(128, kind)]);
      const snapshots: unknown[][] = [];
      stream.on('chunk', () => {
        const snapshot = getSnapshotArray(stream, kind);
        if (snapshot) {
          snapshots.push(snapshot);
        }
      });

      await expect(stream.done()).rejects.toThrow(`invalid ${kind} index: 128`);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.length).toBe(128);
      expect(snapshots[0]?.[127]).toBeDefined();
    });

    it('rejects the first index beyond the defensive protocol-sized bound', async () => {
      const stream = createStream([createChunk(128, kind)]);
      const emittedChunks = vi.fn();
      stream.on('chunk', emittedChunks);

      await expect(stream.done()).rejects.toThrow(
        `Chat completion stream contains an invalid ${kind} index: 128`,
      );
      expect(getSnapshotArray(stream, kind)).toEqual([]);
      expect(emittedChunks).not.toHaveBeenCalled();
    });
  });

  it('accepts the final choice index requested by n', async () => {
    const stream = createStream([createChunk(1, 'choice'), createChunk(0, 'choice')], 2);

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[1]?.index).toBe(1);
  });

  it('rejects the first choice index beyond the requested n before updating event state', async () => {
    const stream = createStream([createChunk(2, 'choice')], 2);
    const emittedChunks = vi.fn();
    stream.on('chunk', emittedChunks);

    await expect(stream.done()).rejects.toThrow('invalid choice index: 2');
    expect(stream.currentChatCompletionSnapshot?.choices).toEqual([]);
    expect(emittedChunks).not.toHaveBeenCalled();
  });

  it('limits choices to the explicitly requested default of one', async () => {
    const stream = createStream([createChunk(1, 'choice')], 1);

    await expect(stream.done()).rejects.toThrow('invalid choice index: 1');
    expect(stream.currentChatCompletionSnapshot?.choices).toEqual([]);
  });

  it('retains the defensive ceiling when the requested choice count exceeds it', async () => {
    const stream = createStream([createChunk(128, 'choice')], 2 ** 32 - 1);

    await expect(stream.done()).rejects.toThrow('invalid choice index: 128');
    expect(stream.currentChatCompletionSnapshot?.choices).toEqual([]);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'retains the defensive ceiling for the invalid requested choice count %s',
    async (n) => {
      const stream = createStream([createChunk(128, 'choice')], n);

      await expect(stream.done()).rejects.toThrow('invalid choice index: 128');
      expect(stream.currentChatCompletionSnapshot?.choices).toEqual([]);
    },
  );

  it.each<StreamIndexKind>(['choice', 'tool call'])(
    'rejects replayed %s indices beyond the defensive ceiling without request parameters',
    async (kind) => {
      const stream = ChatCompletionStream.fromReadableStream(toReadableStream([createChunk(128, kind)]));

      await expect(stream.done()).rejects.toThrow(`invalid ${kind} index: 128`);
      expect(getSnapshotArray(stream, kind)).toEqual([]);
    },
  );

  it('preserves valid tool-call indices that arrive out of order', async () => {
    const secondToolCall = createChunk(1, 'tool call');
    const firstToolCall = createChunk(0, 'tool call');
    const [firstToolChoice] = firstToolCall.choices;
    if (!firstToolChoice) {
      throw new Error('Expected a chat completion choice');
    }
    firstToolChoice.finish_reason = 'tool_calls';
    const stream = createStream([secondToolCall, firstToolCall]);

    const completion = await stream.finalChatCompletion();

    expect(completion.choices[0]?.message.tool_calls).toHaveLength(2);
    expect(completion.choices[0]?.message.tool_calls?.map((toolCall) => toolCall.type)).toEqual([
      'function',
      'function',
    ]);
  });

  it('preserves valid choice indices that arrive out of order during replay', async () => {
    const secondChoice = createChunk(1, 'choice');
    const firstChoice = createChunk(0, 'choice');
    const [secondChoiceSnapshot] = secondChoice.choices;
    const [firstChoiceSnapshot] = firstChoice.choices;
    if (!secondChoiceSnapshot || !firstChoiceSnapshot) {
      throw new Error('Expected two chat completion choices');
    }
    secondChoiceSnapshot.delta.content = 'second';
    firstChoiceSnapshot.delta.content = 'first';
    const stream = ChatCompletionStream.fromReadableStream(toReadableStream([secondChoice, firstChoice]));

    const completion = await stream.finalChatCompletion();

    expect(completion.choices.map((choice) => choice.index)).toEqual([0, 1]);
    expect(completion.choices.map((choice) => choice.message.content)).toEqual(['first', 'second']);
  });
});
