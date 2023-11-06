import {
  type Completions,
  type ChatCompletionMessageParam,
  type ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { type RunnableFunctions, type BaseFunctionsArgs, RunnableTools } from './RunnableFunction';
import {
  AbstractChatCompletionRunner,
  AbstractChatCompletionRunnerEvents,
  RunnerOptions,
} from './AbstractChatCompletionRunner';
import { isAssistantMessage } from './chatCompletionUtils';

export interface ChatCompletionRunnerEvents extends AbstractChatCompletionRunnerEvents {
  content: (content: string) => void;
}

export type ChatCompletionFunctionRunnerParams<FunctionsArgs extends BaseFunctionsArgs> = Omit<
  ChatCompletionCreateParamsNonStreaming,
  'functions'
> & {
  functions: RunnableFunctions<FunctionsArgs>;
};

export type ChatCompletionToolRunnerParams<FunctionsArgs extends BaseFunctionsArgs> = Omit<
  ChatCompletionCreateParamsNonStreaming,
  'tools'
> & {
  tools: RunnableTools<FunctionsArgs>;
};

export class ChatCompletionRunner extends AbstractChatCompletionRunner<ChatCompletionRunnerEvents> {
  static runFunctions(
    completions: Completions,
    params: ChatCompletionFunctionRunnerParams<any[]>,
    options?: RunnerOptions,
  ): ChatCompletionRunner {
    const runner = new ChatCompletionRunner();
    runner._run(() => runner._runFunctions(completions, params, options));
    return runner;
  }

  static runTools(
    completions: Completions,
    params: ChatCompletionToolRunnerParams<any[]>,
    options?: RunnerOptions,
  ): ChatCompletionRunner {
    const runner = new ChatCompletionRunner();
    runner._run(() => runner._runTools(completions, params, options));
    return runner;
  }

  override _addMessage(message: ChatCompletionMessageParam) {
    super._addMessage(message);
    if (isAssistantMessage(message) && message.content) {
      this._emit('content', message.content as string);
    }
  }
}
