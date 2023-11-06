import {
  Completions,
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { RunnerOptions, type AbstractChatCompletionRunnerEvents } from './AbstractChatCompletionRunner';
import { type ReadableStream } from 'openai/_shims/index';
import { RunnableTools, type BaseFunctionsArgs, type RunnableFunctions } from './RunnableFunction';
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

export type ChatCompletionStreamingToolRunnerParams<FunctionsArgs extends BaseFunctionsArgs> = Omit<
  ChatCompletionCreateParamsStreaming,
  'tools'
> & {
  tools: RunnableTools<FunctionsArgs>;
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
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner {
    const runner = new ChatCompletionStreamingRunner();
    runner._run(() => runner._runFunctions(completions, params, options));
    return runner;
  }

  static runTools<T extends (string | object)[]>(
    completions: Completions,
    params: ChatCompletionStreamingToolRunnerParams<T>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner {
    const runner = new ChatCompletionStreamingRunner();
    runner._run(() => runner._runTools(completions, params, options));
    return runner;
  }
}
