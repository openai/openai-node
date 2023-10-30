import * as Core from 'openai/core';
import {
  type Completions,
  type ChatCompletionMessage,
  type ChatCompletionMessageParam,
  type ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { type RunnableFunctions, type BaseFunctionsArgs } from './RunnableFunction';
import {
  AbstractChatCompletionRunner,
  AbstractChatCompletionRunnerEvents,
} from './AbstractChatCompletionRunner';

export interface ChatCompletionRunnerEvents extends AbstractChatCompletionRunnerEvents {
  content: (content: string) => void;
}

export type ChatCompletionFunctionRunnerParams<FunctionsArgs extends BaseFunctionsArgs> = Omit<
  ChatCompletionCreateParamsNonStreaming,
  'functions'
> & {
  functions: RunnableFunctions<FunctionsArgs>;
};

export class ChatCompletionRunner extends AbstractChatCompletionRunner<ChatCompletionRunnerEvents> {
  static runFunctions(
    completions: Completions,
    params: ChatCompletionFunctionRunnerParams<any[]>,
    options?: Core.RequestOptions & { maxChatCompletions?: number },
  ): ChatCompletionRunner {
    const runner = new ChatCompletionRunner();
    runner._run(() => runner._runFunctions(completions, params, options));
    return runner;
  }

  override _addMessage(message: ChatCompletionMessage | ChatCompletionMessageParam) {
    super._addMessage(message);
    if (message.role === 'assistant' && message.content) {
      this._emit('content', message.content);
    }
  }
}
