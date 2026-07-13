import {
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
} from '../resources/chat/completions';
import { RunnerOptions, type AbstractChatCompletionRunnerEvents } from './AbstractChatCompletionRunner';
import { type ReadableStream } from '../internal/shim-types';
import { RunnableTools, type BaseFunctionsArgs } from './RunnableFunction';
import { ChatCompletionSnapshot, ChatCompletionStream } from './ChatCompletionStream';
import OpenAI from '../index';
import { AutoParseableTool } from '../lib/parser';

export interface ChatCompletionStreamEvents extends AbstractChatCompletionRunnerEvents {
  content: (contentDelta: string, contentSnapshot: string) => void;
  chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;
}

type ChatCompletionStreamingToolRunnerParamsBase = Omit<ChatCompletionCreateParamsStreaming, 'tools'>;

/**
 * Parameters for tools that do not require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs extends BaseFunctionsArgs> =
  ChatCompletionStreamingToolRunnerParamsBase & {
    tools: RunnableTools<FunctionsArgs> | AutoParseableTool<any, true>[];
    toolContext?: never;
  };

/**
 * Parameters for tools that require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithContext<
  FunctionsArgs extends BaseFunctionsArgs,
  ToolContext,
> = ChatCompletionStreamingToolRunnerParamsBase & {
  tools: RunnableTools<FunctionsArgs, ToolContext> | AutoParseableTool<any, true>[];
  /**
   * Context to pass to each tool callback during this run.
   */
  toolContext: ToolContext;
};

/**
 * Parameters for running streaming tools. Supplying a context type makes
 * `toolContext` required; omitting it preserves the existing no-context form.
 */
export type ChatCompletionStreamingToolRunnerParams<
  FunctionsArgs extends BaseFunctionsArgs,
  ToolContext = never,
> = [ToolContext] extends [never] ? ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs>
: ChatCompletionStreamingToolRunnerParamsWithContext<FunctionsArgs, ToolContext>;

export class ChatCompletionStreamingRunner<ParsedT = null>
  extends ChatCompletionStream<ParsedT>
  implements AsyncIterable<ChatCompletionChunk>
{
  static override fromReadableStream(stream: ReadableStream): ChatCompletionStreamingRunner<null> {
    const runner = new ChatCompletionStreamingRunner(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  static runTools<T extends (string | object)[], ParsedT = null, ToolContext = unknown>(
    client: OpenAI,
    params: ChatCompletionStreamingToolRunnerParamsWithContext<T, ToolContext>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner<ParsedT>;
  static runTools<T extends (string | object)[], ParsedT = null>(
    client: OpenAI,
    params: ChatCompletionStreamingToolRunnerParamsWithoutContext<T>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner<ParsedT>;
  static runTools<T extends (string | object)[], ParsedT = null, ToolContext = unknown>(
    client: OpenAI,
    params:
      | ChatCompletionStreamingToolRunnerParamsWithContext<T, ToolContext>
      | ChatCompletionStreamingToolRunnerParamsWithoutContext<T>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner<ParsedT> {
    const runner = new ChatCompletionStreamingRunner<ParsedT>(
      // @ts-expect-error TODO these types are incompatible
      params,
    );
    const opts = {
      ...options,
      headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
    };
    runner._run(() => runner._runTools(client, params, runner, opts));
    return runner;
  }
}
