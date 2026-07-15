import OpenAI, { ChatCompletionStream, Stream } from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

const expectType = <T>(_value: T): void => {};

describe('stream exports', () => {
  test('exports Stream and ChatCompletionStream from the top level', () => {
    expectType<typeof Stream>(Stream);
    expectType<typeof ChatCompletionStream>(ChatCompletionStream);

    expect(Stream).toBeDefined();
    expect(ChatCompletionStream).toBeDefined();
  });

  test('exposes stream types on the OpenAI namespace', () => {
    type ChatStream = OpenAI.Stream<ChatCompletionChunk>;
    type ChatRunner = OpenAI.ChatCompletionStream;

    expectType<ChatStream | null>(null);
    expectType<ChatRunner | null>(null);

    expect(true).toBe(true);
  });
});
