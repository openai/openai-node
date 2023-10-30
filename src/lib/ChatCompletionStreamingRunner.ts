import * as Core from 'openai/core';
import {
  Completions,
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { type AbstractChatCompletionRunnerEvents } from './AbstractChatCompletionRunner';
import { type ReadableStream } from 'openai/_shims/index';
import { type BaseFunctionsArgs, type RunnableFunctions } from './RunnableFunction';
import { ChatCompletionSnapshot, ChatCompletionStream } from './ChatCompletionStream';

export interface ChatCompletionStreamEvents extends AbstractChatCompletionRunnerEvents {
  content: (contentDelta: string, contentSnapshot: string) => void;
  chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;
}

export type ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs extends BaseFunctionsArgs> = Omit<
  ChatCompletionCreateParamsStreaming,
  'functions'
> & {
  functions: RunnableFunctions<FunctionsArgs>;
};

export class ChatCompletionStreamingRunner
  extends ChatCompletionStream
  implements AsyncIterable<ChatCompletionChunk>
{
  static override fromReadableStream(stream: ReadableStream): ChatCompletionStreamingRunner {
    const runner = new ChatCompletionStreamingRunner();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  static runFunctions<T extends (string | object)[]>(
    completions: Completions,
    params: ChatCompletionStreamingFunctionRunnerParams<T>,
    options?: Core.RequestOptions & { maxChatCompletions?: number },
  ): ChatCompletionStreamingRunner {
    const runner = new ChatCompletionStreamingRunner();
    runner._run(() => runner._runFunctions(completions, params, options));
    return runner;
  }
}
