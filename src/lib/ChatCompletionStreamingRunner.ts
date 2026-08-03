import {
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
  type ChatCompletionMessageParam,
} from '../resources/chat/completions';
import { RunnerOptions, type AbstractChatCompletionRunnerEvents } from './AbstractChatCompletionRunner';
import { type ReadableStream } from '../internal/shim-types';
import { RunnableTools, type BaseFunctionsArgs } from './RunnableFunction';
import {
  type ChatCompletionReadableStreamItem,
  ChatCompletionSnapshot,
  ChatCompletionStream,
  makeChatCompletionReadableStreamMessageChunk,
} from './ChatCompletionStream';
import { OpenAIError } from '../error';
import OpenAI from '../index';
import { AutoParseableTool } from '../lib/parser';
import { Stream } from '../streaming';
import { isAssistantMessage, isToolMessage } from './chatCompletionUtils';

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

  override toReadableStream(): ReadableStream {
    let lastChunk: ChatCompletionChunk | undefined;
    let toolCallIds: string[] | undefined;

    const iterator = this._createIterator<ChatCompletionReadableStreamItem>(
      (push) => {
        const onChunk = (chunk: ChatCompletionChunk) => {
          lastChunk = chunk;
          push(chunk);
        };
        const onMessage = (message: ChatCompletionMessageParam) => {
          if (isAssistantMessage(message)) {
            toolCallIds = message.tool_calls?.map((toolCall) => toolCall.id);
            return;
          }

          if (isToolMessage(message)) {
            if (!lastChunk) {
              throw new OpenAIError('cannot serialize a tool message before receiving any chunks');
            }
            push(makeChatCompletionReadableStreamMessageChunk(lastChunk, message, toolCallIds));
          }
        };
        this.on('chunk', onChunk);
        this.on('message', onMessage);
        return () => {
          this.off('chunk', onChunk);
          this.off('message', onMessage);
        };
      },
      { onReturn: () => this.abort() },
    );

    const stream = new Stream(() => iterator, this.controller);
    return stream.toReadableStream();
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
