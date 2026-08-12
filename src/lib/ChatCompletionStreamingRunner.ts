import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from '../resources/chat/completions';
import type { AbstractChatCompletionRunnerEvents, RunnerOptions } from './AbstractChatCompletionRunner';
import type { ReadableStream } from '../internal/shim-types';
import type { BaseFunctionsArgs, RunnableTools } from './RunnableFunction';
import { ChatCompletionStream, makeChatCompletionReadableStreamMessageChunk } from './ChatCompletionStream';
import type { ChatCompletionReadableStreamItem, ChatCompletionSnapshot } from './ChatCompletionStream';
import { OpenAIError } from '../error';
import type OpenAI from '../index';
import type { AutoParseableTool } from '../lib/parser';
import { Stream } from '../streaming';
import { isAssistantMessage, isToolMessage } from './chatCompletionUtils';

/** Conversation and chunk events emitted by a streaming chat completion tool runner. */
export interface ChatCompletionStreamEvents extends AbstractChatCompletionRunnerEvents {
  /** Called with each assistant-text fragment and the text accumulated so far. */
  content: (contentDelta: string, contentSnapshot: string) => void;
  /** Called with each raw API chunk and its accumulated completion snapshot. */
  chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;
}

/** Streaming chat completion request fields shared by all tool-runner overloads. */
type ChatCompletionStreamingToolRunnerParamsBase = Omit<ChatCompletionCreateParamsStreaming, 'tools'>;

/**
 * Parameters for tools that do not require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs extends BaseFunctionsArgs> =
  ChatCompletionStreamingToolRunnerParamsBase & {
    /** Runnable function tools or auto-parseable tools with an attached callback. */
    tools: RunnableTools<FunctionsArgs> | AutoParseableTool<any, true>[];
    /** Context is unavailable for the no-context runner overload. */
    toolContext?: never;
  };

/**
 * Parameters for tools that require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithContext<
  FunctionsArgs extends BaseFunctionsArgs,
  ToolContext,
> = ChatCompletionStreamingToolRunnerParamsBase & {
  /** Runnable function tools or auto-parseable tools that receive `toolContext`. */
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
> = [ToolContext] extends [never]
  ? ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs>
  : ChatCompletionStreamingToolRunnerParamsWithContext<FunctionsArgs, ToolContext>;

/** Executes function tools while streaming every intermediate chat completion. */
export class ChatCompletionStreamingRunner<ParsedT = null>
  extends ChatCompletionStream<ParsedT>
  implements AsyncIterable<ChatCompletionChunk>
{
  /** Restores a serialized tool run, including intermediate completions and tool-result messages. */
  static override fromReadableStream(stream: ReadableStream): ChatCompletionStreamingRunner<null> {
    const runner = new ChatCompletionStreamingRunner(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  /** Serializes completion chunks and tool-result messages for replay in another runtime. */
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

  /** Runs streaming function tools, passing the supplied context to each callback. */
  static runTools<T extends (string | object)[], ParsedT = null, ToolContext = unknown>(
    client: OpenAI,
    params: ChatCompletionStreamingToolRunnerParamsWithContext<T, ToolContext>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner<ParsedT>;

  /** Runs streaming function tools until the model produces a final assistant message. */
  static runTools<T extends (string | object)[], ParsedT = null>(
    client: OpenAI,
    params: ChatCompletionStreamingToolRunnerParamsWithoutContext<T>,
    options?: RunnerOptions,
  ): ChatCompletionStreamingRunner<ParsedT>;
  /** Starts a streaming tool loop and returns its event-driven conversation runner. */
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
      __metadata: { ...options?.__metadata, helperMethod: 'runTools' },
    };
    runner._run(() => runner._runTools(client, params, runner, opts));
    return runner;
  }
}
