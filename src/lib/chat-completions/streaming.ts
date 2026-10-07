import type { Stream } from '../../core/streaming';
import type { ChatCompletionChunk } from '../../resources/chat/completions/completions';

/** Wire chunks can omit the finish reason, including the final audio expiry update. */
export type ChatCompletionWireChunk = Omit<ChatCompletionChunk, 'choices'> & {
  choices: (Omit<ChatCompletionChunk.Choice, 'finish_reason'> & {
    finish_reason?: ChatCompletionChunk.Choice['finish_reason'];
  })[];
};

export function normalizeChatCompletionChunk(chunk: ChatCompletionWireChunk): ChatCompletionChunk {
  if (!Array.isArray(chunk?.choices)) {
    // SAFETY: This is an opaque provider record, with no choices to normalize.
    // Preserve the existing SSE pass-through; the SDK does not validate these records.
    return chunk as ChatCompletionChunk;
  }
  return {
    ...chunk,
    choices: chunk.choices.map((choice) => ({ ...choice, finish_reason: choice.finish_reason ?? null })),
  };
}

export function normalizeChatCompletionStream(
  stream: Stream<ChatCompletionWireChunk>,
): Stream<ChatCompletionChunk> {
  const iterator = stream[Symbol.asyncIterator].bind(stream);
  stream[Symbol.asyncIterator] = async function* normalizedChunks() {
    const source = { [Symbol.asyncIterator]: iterator };
    for await (const chunk of source) {
      yield normalizeChatCompletionChunk(chunk);
    }
  };
  // SAFETY: The installed iterator normalizes every wire chunk before exposing it.
  return stream as Stream<ChatCompletionChunk>;
}
