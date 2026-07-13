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
    const pushQueue: ChatCompletionReadableStreamItem[] = [];
    const readQueue: {
      resolve: (event: ChatCompletionReadableStreamItem | undefined) => void;
      reject: (err: unknown) => void;
    }[] = [];
    let done = false;
    let lastChunk: ChatCompletionChunk | undefined;
    let toolCallIds: string[] | undefined;

    const pushEvent = (event: ChatCompletionReadableStreamItem) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    };

    this.on('chunk', (chunk) => {
      lastChunk = chunk;
      pushEvent(chunk);
    });
    this.on('message', (message: ChatCompletionMessageParam) => {
      if (isAssistantMessage(message)) {
        toolCallIds = message.tool_calls?.map((toolCall) => toolCall.id);
        return;
      }

      if (isToolMessage(message)) {
        if (!lastChunk) {
          throw new OpenAIError('cannot serialize a tool message before receiving any chunks');
        }
        pushEvent(makeChatCompletionReadableStreamMessageChunk(lastChunk, message, toolCallIds));
      }
    });

    this.on('end', () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(undefined);
      }
      readQueue.length = 0;
    });

    this.on('abort', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    this.on('error', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    const iterator = (): AsyncIterator<ChatCompletionReadableStreamItem> => ({
      next: async (): Promise<IteratorResult<ChatCompletionReadableStreamItem>> => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise<ChatCompletionReadableStreamItem | undefined>((resolve, reject) =>
            readQueue.push({ resolve, reject }),
          ).then((event) => (event ? { value: event, done: false } : { value: undefined, done: true }));
        }
        const event = pushQueue.shift();
        if (!event) {
          return { value: undefined, done: true };
        }
        return { value: event, done: false };
      },
      return: async () => {
        this.abort();
        return { value: undefined, done: true };
      },
    });

    const stream = new Stream(iterator, this.controller);
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
