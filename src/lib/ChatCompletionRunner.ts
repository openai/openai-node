import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from '../resources/chat/completions';
import type { BaseFunctionsArgs, RunnableTools } from './RunnableFunction';
import type { AbstractChatCompletionRunnerEvents, RunnerOptions } from './AbstractChatCompletionRunner';
import { AbstractChatCompletionRunner } from './AbstractChatCompletionRunner';
import { isAssistantMessage } from './chatCompletionUtils';
import type OpenAI from '../index';
import type { AutoParseableTool } from '../lib/parser';

/** Events emitted while executing a non-streaming chat completion tool run. */
export interface ChatCompletionRunnerEvents extends AbstractChatCompletionRunnerEvents {
  /** Called when an assistant message with nonempty text content is received. */
  content: (content: string) => void;
}

/** Non-streaming chat completion request fields shared by all tool-runner overloads. */
type ChatCompletionToolRunnerParamsBase = Omit<ChatCompletionCreateParamsNonStreaming, 'tools'>;

/**
 * Parameters for tools that do not require a context value.
 */
export type ChatCompletionToolRunnerParamsWithoutContext<FunctionsArgs extends BaseFunctionsArgs> =
  ChatCompletionToolRunnerParamsBase & {
    /** Runnable function tools or auto-parseable tools with an attached callback. */
    tools: RunnableTools<FunctionsArgs> | AutoParseableTool<any, true>[];
    /** Context is unavailable for the no-context runner overload. */
    toolContext?: never;
  };

/**
 * Parameters for tools that require a context value.
 */
export type ChatCompletionToolRunnerParamsWithContext<
  FunctionsArgs extends BaseFunctionsArgs,
  ToolContext,
> = ChatCompletionToolRunnerParamsBase & {
  /** Runnable function tools or auto-parseable tools that receive `toolContext`. */
  tools: RunnableTools<FunctionsArgs, ToolContext> | AutoParseableTool<any, true>[];
  /**
   * Context to pass to each tool callback during this run.
   */
  toolContext: ToolContext;
};

/**
 * Parameters for running tools. Supplying a context type makes `toolContext`
 * required; omitting it preserves the existing no-context form.
 */
export type ChatCompletionToolRunnerParams<FunctionsArgs extends BaseFunctionsArgs, ToolContext = never> = [
  ToolContext,
] extends [never]
  ? ChatCompletionToolRunnerParamsWithoutContext<FunctionsArgs>
  : ChatCompletionToolRunnerParamsWithContext<FunctionsArgs, ToolContext>;

/** Executes function tools and follows up with non-streaming chat completion requests. */
export class ChatCompletionRunner<ParsedT = null> extends AbstractChatCompletionRunner<
  ChatCompletionRunnerEvents,
  ParsedT
> {
  /** Runs function tools, passing the supplied context to each tool callback. */
  static runTools<ParsedT, ToolContext = unknown>(
    client: OpenAI,
    params: ChatCompletionToolRunnerParamsWithContext<any[], ToolContext>,
    options?: RunnerOptions,
  ): ChatCompletionRunner<ParsedT>;
  /** Runs function tools until the model produces a final assistant message. */
  static runTools<ParsedT>(
    client: OpenAI,
    params: ChatCompletionToolRunnerParamsWithoutContext<any[]>,
    options?: RunnerOptions,
  ): ChatCompletionRunner<ParsedT>;
  /** Starts a non-streaming tool loop and returns its event-driven conversation runner. */
  static runTools<ParsedT, ToolContext = unknown>(
    client: OpenAI,
    params:
      | ChatCompletionToolRunnerParamsWithContext<any[], ToolContext>
      | ChatCompletionToolRunnerParamsWithoutContext<any[]>,
    options?: RunnerOptions,
  ): ChatCompletionRunner<ParsedT> {
    const runner = new ChatCompletionRunner<ParsedT>();
    const opts = {
      ...options,
      __metadata: { ...options?.__metadata, helperMethod: 'runTools' },
    };
    runner._run(() => runner._runTools(client, params, runner, opts));
    return runner;
  }

  /** Appends a conversation message and emits text content for assistant replies. */
  override _addMessage(
    this: ChatCompletionRunner<ParsedT>,
    message: ChatCompletionMessageParam,
    emit = true,
  ) {
    super._addMessage(message, emit);
    if (isAssistantMessage(message) && message.content) {
      this._emit('content', message.content as string);
    }
  }
}
