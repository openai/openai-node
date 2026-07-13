import { OpenAIError } from '../error';
import type OpenAI from '../index';
import type { RequestOptions } from '../internal/request-options';
import { uuid4 } from '../internal/utils/uuid';
import { isAutoParsableTool, parseChatCompletion } from '../lib/parser';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ParsedChatCompletion,
} from '../resources/chat/completions';
import type { CompletionUsage } from '../resources/completions';
import type {
  ChatCompletionRunner,
  ChatCompletionToolRunnerParamsWithContext,
  ChatCompletionToolRunnerParamsWithoutContext,
} from './ChatCompletionRunner';
import type {
  ChatCompletionStreamingRunner,
  ChatCompletionStreamingToolRunnerParamsWithContext,
  ChatCompletionStreamingToolRunnerParamsWithoutContext,
} from './ChatCompletionStreamingRunner';
import { isAssistantMessage, isToolMessage } from './chatCompletionUtils';
import { BaseEvents, EventStream } from './EventStream';
import {
  isRunnableFunctionWithParse,
  type BaseFunctionsArgs,
  type RunnableFunction,
  type RunnableToolFunction,
} from './RunnableFunction';

const DEFAULT_MAX_CHAT_COMPLETIONS = 10;

function normalizeToolCallIds(chatCompletion: ChatCompletion): void {
  for (const choice of chatCompletion.choices) {
    for (const toolCall of choice.message.tool_calls ?? []) {
      // Some OpenAI-compatible providers omit tool call IDs or return an empty string.
      // Generate a unique ID before the completion is stored or emitted so the assistant
      // tool call and its result message always reference the same value.
      if (!toolCall.id) {
        toolCall.id = `call_${uuid4()}`;
      }
    }
  }
}

export interface ChatCompletionRunnerContext {
  messages: ChatCompletionMessageParam[];
  abort(): void;
}

export interface RunnerOptions extends RequestOptions {
  /** How many requests to make before canceling. Default 10. */
  maxChatCompletions?: number;
  /**
   * A callback that runs after each chat completion and after any tool calls from
   * that completion have finished. The callback is awaited before the next
   * request starts or before the runner ends. The runner's mutable `messages`
   * array can be used to add context for the next request.
   */
  afterCompletion?: (completion: ChatCompletion, runner: ChatCompletionRunnerContext) => void | Promise<void>;
}

export class AbstractChatCompletionRunner<
  EventTypes extends AbstractChatCompletionRunnerEvents,
  ParsedT,
> extends EventStream<EventTypes> {
  protected _chatCompletions: ParsedChatCompletion<ParsedT>[] = [];
  messages: ChatCompletionMessageParam[] = [];

  protected _addChatCompletion(
    this: AbstractChatCompletionRunner<AbstractChatCompletionRunnerEvents, ParsedT>,
    chatCompletion: ParsedChatCompletion<ParsedT>,
  ): ParsedChatCompletion<ParsedT> {
    normalizeToolCallIds(chatCompletion);
    this._chatCompletions.push(chatCompletion);
    this._emit('chatCompletion', chatCompletion);
    const message = chatCompletion.choices[0]?.message;
    if (message) this._addMessage(message as ChatCompletionMessageParam);
    return chatCompletion;
  }

  protected _addMessage(
    this: AbstractChatCompletionRunner<AbstractChatCompletionRunnerEvents, ParsedT>,
    message: ChatCompletionMessageParam,
    emit = true,
  ) {
    if (!('content' in message)) message.content = null;

    this.messages.push(message);

    if (emit) {
      this._emit('message', message);
      if (isToolMessage(message) && message.content) {
        // Note, this assumes that {role: 'tool', content: …} is always the result of a call of tool of type=function.
        this._emit('functionToolCallResult', message.content as string);
      } else if (isAssistantMessage(message) && message.tool_calls) {
        for (const tool_call of message.tool_calls) {
          if (tool_call.type === 'function') {
            this._emit('functionToolCall', tool_call.function);
          }
        }
      }
    }
  }

  /**
   * @returns a promise that resolves with the final ChatCompletion, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
   */
  async finalChatCompletion(): Promise<ParsedChatCompletion<ParsedT>> {
    await this.done();
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (!completion) throw new OpenAIError('stream ended without producing a ChatCompletion');
    return completion;
  }

  #getFinalContent(): string | null {
    return this.#getFinalMessage().content ?? null;
  }

  /**
   * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalContent(): Promise<string | null> {
    await this.done();
    return this.#getFinalContent();
  }

  #getFinalMessage(): ChatCompletionMessage {
    let i = this.messages.length;
    while (i-- > 0) {
      const message = this.messages[i];
      if (isAssistantMessage(message)) {
        // TODO: support audio here
        const ret: Omit<ChatCompletionMessage, 'audio'> = {
          ...message,
          content: (message as ChatCompletionMessage).content ?? null,
          refusal: (message as ChatCompletionMessage).refusal ?? null,
        };
        return ret;
      }
    }
    throw new OpenAIError('stream ended without producing a ChatCompletionMessage with role=assistant');
  }

  /**
   * @returns a promise that resolves with the final assistant ChatCompletionMessage response,
   * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalMessage(): Promise<ChatCompletionMessage> {
    await this.done();
    return this.#getFinalMessage();
  }

  #getFinalFunctionToolCall(): ChatCompletionMessageFunctionToolCall.Function | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (isAssistantMessage(message) && message?.tool_calls?.length) {
        for (let j = message.tool_calls.length - 1; j >= 0; j--) {
          const toolCall = message.tool_calls[j];
          if (toolCall?.type === 'function') {
            return toolCall.function;
          }
        }
      }
    }

    return;
  }

  /**
   * @returns a promise that resolves with the content of the final FunctionCall, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalFunctionToolCall(): Promise<ChatCompletionMessageFunctionToolCall.Function | undefined> {
    await this.done();
    return this.#getFinalFunctionToolCall();
  }

  #getFinalFunctionToolCallResult(): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (
        isToolMessage(message) &&
        message.content != null &&
        typeof message.content === 'string' &&
        this.messages.some(
          (x) =>
            x.role === 'assistant' &&
            x.tool_calls?.some((y) => y.type === 'function' && y.id === message.tool_call_id),
        )
      ) {
        return message.content;
      }
    }

    return;
  }

  async finalFunctionToolCallResult(): Promise<string | undefined> {
    await this.done();
    return this.#getFinalFunctionToolCallResult();
  }

  #calculateTotalUsage(): CompletionUsage {
    const total: CompletionUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    };
    for (const { usage } of this._chatCompletions) {
      if (usage) {
        total.completion_tokens += usage.completion_tokens;
        total.prompt_tokens += usage.prompt_tokens;
        total.total_tokens += usage.total_tokens;
      }
    }
    return total;
  }

  async totalUsage(): Promise<CompletionUsage> {
    await this.done();
    return this.#calculateTotalUsage();
  }

  allChatCompletions(): ChatCompletion[] {
    return [...this._chatCompletions];
  }

  protected override _emitFinal(
    this: AbstractChatCompletionRunner<AbstractChatCompletionRunnerEvents, ParsedT>,
  ) {
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (completion) this._emit('finalChatCompletion', completion);
    const finalMessage = this.#getFinalMessage();
    if (finalMessage) this._emit('finalMessage', finalMessage);
    const finalContent = this.#getFinalContent();
    if (finalContent) this._emit('finalContent', finalContent);

    const finalFunctionCall = this.#getFinalFunctionToolCall();
    if (finalFunctionCall) this._emit('finalFunctionToolCall', finalFunctionCall);

    const finalFunctionCallResult = this.#getFinalFunctionToolCallResult();
    if (finalFunctionCallResult != null) this._emit('finalFunctionToolCallResult', finalFunctionCallResult);

    if (this._chatCompletions.some((c) => c.usage)) {
      this._emit('totalUsage', this.#calculateTotalUsage());
    }
  }

  #validateParams(params: ChatCompletionCreateParams): void {
    if (params.n != null && params.n > 1) {
      throw new OpenAIError(
        'ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.',
      );
    }
  }

  protected async _createChatCompletion(
    client: OpenAI,
    params: ChatCompletionCreateParams,
    options?: RequestOptions,
  ): Promise<ParsedChatCompletion<ParsedT>> {
    this._listenForAbort(options?.signal);
    this.#validateParams(params);

    const chatCompletion = await client.chat.completions.create(
      { ...params, stream: false },
      { ...options, signal: this.controller.signal },
    );
    this._connected();
    return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
  }

  protected async _runChatCompletion(
    client: OpenAI,
    params: ChatCompletionCreateParams,
    options?: RequestOptions,
  ): Promise<ChatCompletion> {
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    return await this._createChatCompletion(client, params, options);
  }

  protected async _runTools<FunctionsArgs extends BaseFunctionsArgs, ToolContext>(
    client: OpenAI,
    params:
      | ChatCompletionToolRunnerParamsWithContext<FunctionsArgs, ToolContext>
      | ChatCompletionToolRunnerParamsWithoutContext<FunctionsArgs>
      | ChatCompletionStreamingToolRunnerParamsWithContext<FunctionsArgs, ToolContext>
      | ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs>,
    runner: ChatCompletionRunner<any> | ChatCompletionStreamingRunner<any>,
    options?: RunnerOptions,
  ) {
    const role = 'tool' as const;
    const { tool_choice = 'auto', stream, toolContext: inputToolContext, ...restParams } = params;
    const toolContext = inputToolContext as ToolContext;
    const singleFunctionToCall =
      typeof tool_choice !== 'string' && tool_choice.type === 'function' && tool_choice?.function?.name;
    const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS, afterCompletion } = options || {};

    // TODO(someday): clean this logic up
    const inputTools = params.tools.map((tool): RunnableToolFunction<any> => {
      if (isAutoParsableTool(tool)) {
        if (!tool.$callback) {
          throw new OpenAIError('Tool given to `.runTools()` that does not have an associated function');
        }

        return {
          type: 'function',
          function: {
            function: tool.$callback,
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters as any,
            parse: tool.$parseRaw,
            strict: true,
          },
        };
      }

      return tool as any as RunnableToolFunction<any>;
    });

    const functionsByName: Record<string, RunnableFunction<any, ToolContext>> = {};
    for (const f of inputTools) {
      if (f.type === 'function') {
        functionsByName[f.function.name || f.function.function.name] = f.function;
      }
    }

    const tools: ChatCompletionTool[] =
      'tools' in params ?
        inputTools.map((t) =>
          t.type === 'function' ?
            {
              type: 'function',
              function: {
                name: t.function.name || t.function.function.name,
                parameters: t.function.parameters as Record<string, unknown>,
                description: t.function.description,
                strict: t.function.strict,
              },
            }
          : (t as unknown as ChatCompletionTool),
        )
      : (undefined as any);

    for (const message of params.messages) {
      this._addMessage(message, false);
    }

    type ToolCallResult = {
      message: ChatCompletionToolMessageParam | undefined;
      functionCalled: boolean;
    };

    const runToolCall = async (toolCall: ChatCompletionMessageToolCall): Promise<ToolCallResult> => {
      if (toolCall.type !== 'function') return { message: undefined, functionCalled: false };

      const tool_call_id = toolCall.id;
      const { name, arguments: args } = toolCall.function;
      const fn = functionsByName[name];

      if (!fn) {
        const content = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(
          functionsByName,
        )
          .map((name) => JSON.stringify(name))
          .join(', ')}. Please try again`;

        return { message: { role, tool_call_id, content }, functionCalled: false };
      }

      if (singleFunctionToCall && singleFunctionToCall !== name) {
        const content = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(
          singleFunctionToCall,
        )} requested. Please try again`;

        return { message: { role, tool_call_id, content }, functionCalled: false };
      }

      let rawContent: unknown;
      if (isRunnableFunctionWithParse(fn)) {
        let parsed;
        try {
          parsed = await fn.parse(args);
        } catch (error) {
          const content = error instanceof Error ? error.message : String(error);
          return { message: { role, tool_call_id, content }, functionCalled: false };
        }
        rawContent = await fn.function(parsed, runner, toolContext);
      } else {
        rawContent = await fn.function(args, runner, toolContext);
      }

      const content = this.#stringifyFunctionCallResult(rawContent);
      return { message: { role, tool_call_id, content }, functionCalled: true };
    };

    for (let i = 0; i < maxChatCompletions; ++i) {
      const chatCompletion: ChatCompletion = await this._createChatCompletion(
        client,
        {
          ...restParams,
          tool_choice,
          tools,
          messages: [...this.messages],
        },
        options,
      );
      const message = chatCompletion.choices[0]?.message;
      if (!message) {
        throw new OpenAIError(`missing message in ChatCompletion response`);
      }
      if (!message.tool_calls?.length) {
        await afterCompletion?.(chatCompletion, runner);
        return;
      }

      if (singleFunctionToCall || params.parallel_tool_calls === false) {
        for (const toolCall of message.tool_calls) {
          const result = await runToolCall(toolCall);
          if (result.message) this._addMessage(result.message);

          if (singleFunctionToCall && result.functionCalled) {
            await afterCompletion?.(chatCompletion, runner);
            return;
          }
        }
      } else {
        const results = await Promise.allSettled(message.tool_calls.map(runToolCall));

        // Wait for every concurrently running tool to settle before surfacing an
        // error so tool side effects cannot continue after the runner has ended.
        for (const result of results) {
          if (result.status === 'rejected') throw result.reason;
        }

        // Promise.allSettled preserves input order, so the next request receives
        // tool result messages in the same order as the assistant's tool calls.
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.message) {
            this._addMessage(result.value.message);
          }
        }
      }

      await afterCompletion?.(chatCompletion, runner);
    }

    return;
  }

  #stringifyFunctionCallResult(rawContent: unknown): string {
    return (
      typeof rawContent === 'string' ? rawContent
      : rawContent === undefined ? 'undefined'
      : JSON.stringify(rawContent)
    );
  }
}

export interface AbstractChatCompletionRunnerEvents extends BaseEvents {
  functionToolCall: (functionCall: ChatCompletionMessageFunctionToolCall.Function) => void;
  message: (message: ChatCompletionMessageParam) => void;
  chatCompletion: (completion: ChatCompletion) => void;
  finalContent: (contentSnapshot: string) => void;
  finalMessage: (message: ChatCompletionMessageParam) => void;
  finalChatCompletion: (completion: ChatCompletion) => void;
  finalFunctionToolCall: (functionCall: ChatCompletionMessageFunctionToolCall.Function) => void;
  functionToolCallResult: (content: string) => void;
  finalFunctionToolCallResult: (content: string) => void;
  totalUsage: (usage: CompletionUsage) => void;
}
