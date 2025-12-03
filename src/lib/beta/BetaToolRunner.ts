import { OpenAI } from '../..';
import { OpenAIError } from '../../core/error';
import { buildHeaders } from '../../internal/headers';
import type { RequestOptions } from '../../internal/request-options';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionStream,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from '../../resources/chat/completions';
import type { BetaRunnableTool } from './BetaRunnableTool';

/**
 * Just Promise.withResolvers(), which is not available in all environments.
 */
function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * A ToolRunner handles the automatic conversation loop between the assistant and tools.
 *
 * A ToolRunner is an async iterable that yields either BetaMessage or BetaMessageStream objects
 * depending on the streaming configuration.
 */
export class BetaToolRunner<Stream extends boolean> {
  /** Whether the async iterator has been consumed */
  #consumed = false;
  /** Whether parameters have been mutated since the last API call */
  #mutated = false;
  /** Current state containing the request parameters */
  #state: { params: BetaToolRunnerParams };
  #options: BetaToolRunnerRequestOptions;
  /**
   * Promise for the last message received from the assistant.
   *
   * This resolves to undefined in non-streaming mode if there are no choices provided.
   */
  #message?: Promise<ChatCompletionMessage> | undefined;
  /**
   * Resolves to the last (entire) chat completion received from the assistant.
   * We want to return an attribute of ourself so that the promise keeps running
   * after the yield, and we can access it later.
   */
  #chatCompletion?: Promise<ChatCompletion>;
  /** Cached tool response to avoid redundant executions */
  #toolResponse?: Promise<null | ChatCompletionToolMessageParam[]> | undefined;
  /** Promise resolvers for waiting on completion */
  #completion: {
    promise: Promise<ChatCompletionMessage>;
    resolve: (value: ChatCompletionMessage) => void;
    reject: (reason?: any) => void;
  };
  /** Number of iterations (API requests) made so far */
  #iterationCount = 0;

  constructor(
    private client: OpenAI,
    params: BetaToolRunnerParams,
    options?: BetaToolRunnerRequestOptions,
  ) {
    params.n ??= 1;
    if (params && params.n > 1) {
      throw new Error('BetaToolRunner does not support n > 1');
    }

    this.#state = {
      params: {
        // You can't clone the entire params since there are functions as handlers.
        // You also don't really need to clone params.messages, but it probably will prevent a foot gun
        // somewhere.
        ...params,
        messages: structuredClone(params.messages),
      },
    };

    this.#options = {
      ...options,
      headers: buildHeaders([{ 'x-stainless-helper': 'BetaToolRunner' }, options?.headers]),
    };
    this.#completion = promiseWithResolvers();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<
    Stream extends true ?
      ChatCompletionStream // TODO: for now!
    : ChatCompletion | undefined
  > {
    if (this.#consumed) {
      throw new OpenAIError('Cannot iterate over a consumed stream');
    }

    this.#consumed = true;
    this.#mutated = true;
    this.#toolResponse = undefined;

    try {
      while (true) {
        let stream: ChatCompletionStream<null> | undefined;
        try {
          if (
            this.#state.params.max_iterations &&
            this.#iterationCount >= this.#state.params.max_iterations
          ) {
            break;
          }

          this.#mutated = false;
          this.#message = undefined;
          this.#toolResponse = undefined;
          this.#iterationCount++;

          const { ...params } = this.#state.params;
          const apiParams = { ...params };
          delete apiParams.max_iterations; // our own param

          if (params.stream) {
            stream = this.client.beta.chat.completions.stream({ ...apiParams, stream: true }, this.#options);
            this.#message = stream.finalMessage();

            // Make sure that this promise doesn't throw before we get the option to do something about it.
            // Error will be caught when we call await this.#message ultimately
            this.#message?.catch(() => {});
            yield stream as any;
          } else {
            this.#chatCompletion = this.client.beta.chat.completions.create(
              {
                ...apiParams, // spread and explicit so we get better types
                stream: false,
                tools: params.tools,
                messages: params.messages,
                model: params.model,
              },
              this.#options,
            );

            this.#message = this.#chatCompletion.then((resp) => resp.choices.at(0)!.message).catch(() => {});

            yield this.#chatCompletion as any;
          }

          const prevMessage = await this.#message;

          if (!prevMessage) {
            throw new OpenAIError('ToolRunner concluded without a message from the server');
          }

          if (!this.#mutated) {
            // TODO: what if it is empty?
            if (prevMessage) {
              this.#state.params.messages.push(prevMessage);
            }
          }

          const toolMessages = await this.#generateToolResponse(prevMessage);
          if (toolMessages) {
            for (const toolMessage of toolMessages) {
              this.#state.params.messages.push(toolMessage);
            }
          }

          // TODO: make sure this is correct?
          if (!toolMessages && !this.#mutated) {
            break;
          }
        } finally {
          if (stream) {
            stream.abort();
          }
        }
      }

      if (!this.#message) {
        throw new OpenAIError('ToolRunner concluded without a message from the server');
      }

      this.#completion.resolve(await this.#message);
    } catch (error) {
      this.#consumed = false;
      // Silence unhandled promise errors
      this.#completion.promise.catch(() => {});
      this.#completion.reject(error);
      this.#completion = promiseWithResolvers();
      throw error;
    }
  }

  /**
   * Update the parameters for the next API call. This invalidates any cached tool responses.
   *
   * @param paramsOrMutator - Either new parameters or a function to mutate existing parameters
   *
   * @example
   * // Direct parameter update
   * runner.setMessagesParams({
   *   model: 'gpt-4o',
   *   max_tokens: 500,
   * });
   *
   * @example
   * // Using a mutator function
   * runner.setMessagesParams((params) => ({
   *   ...params,
   *   max_tokens: 100,
   * }));
   */
  setMessagesParams(params: BetaToolRunnerParams): void;
  setMessagesParams(mutator: (prevParams: BetaToolRunnerParams) => BetaToolRunnerParams): void;
  setMessagesParams(
    paramsOrMutator: BetaToolRunnerParams | ((prevParams: BetaToolRunnerParams) => BetaToolRunnerParams),
  ) {
    if (typeof paramsOrMutator === 'function') {
      this.#state.params = paramsOrMutator(this.#state.params);
    } else {
      this.#state.params = paramsOrMutator;
    }
    this.#mutated = true;
    // Invalidate cached tool response since parameters changed
    this.#toolResponse = undefined;
  }

  /**
   * Get the tool response for the last message from the assistant.
   * Avoids redundant tool executions by caching results.
   *
   * @returns A promise that resolves to a BetaMessageParam containing tool results, or null if no tools need to be executed
   *
   * @example
   * const toolResponse = await runner.generateToolResponse();
   * if (toolResponse) {
   *   console.log('Tool results:', toolResponse.content);
   * }
   */
  async generateToolResponse() {
    // The most recent message from the assistant. TODO: do we want || this.params.messages.at(-1)?
    const message = await this.#message;
    if (!message) {
      return null;
    }
    return this.#generateToolResponse(message);
  }

  async #generateToolResponse(lastMessage: ChatCompletionMessage) {
    if (this.#toolResponse) {
      return this.#toolResponse;
    }
    const toolsResponse = generateToolResponse(
      lastMessage,
      this.#state.params.tools.filter((tool): tool is BetaRunnableTool<any> => 'run' in tool),
    );
    this.#toolResponse = toolsResponse;
    return toolsResponse;
  }

  /**
   * Wait for the async iterator to complete. This works even if the async iterator hasn't yet started, and
   * will wait for an instance to start and go to completion.
   *
   * @returns A promise that resolves to the final BetaMessage when the iterator completes
   *
   * @example
   * // Start consuming the iterator
   * for await (const message of runner) {
   *   console.log('Message:', message.content);
   * }
   *
   * // Meanwhile, wait for completion from another part of the code
   * const finalMessage = await runner.done();
   * console.log('Final response:', finalMessage.content);
   */
  done(): Promise<ChatCompletionMessage> {
    return this.#completion.promise; // TODO: find a more type safe way to do this
  }

  /**
   * Returns a promise indicating that the stream is done. Unlike .done(), this will eagerly read the stream:
   * * If the iterator has not been consumed, consume the entire iterator and return the final message from the
   * assistant.
   * * If the iterator has been consumed, waits for it to complete and returns the final message.
   *
   * @returns A promise that resolves to the final BetaMessage from the conversation
   * @throws {OpenAIError} If no messages were processed during the conversation
   *
   * @example
   * const finalMessage = await runner.runUntilDone();
   * console.log('Final response:', finalMessage.content);
   */
  async runUntilDone(): Promise<ChatCompletionMessage> {
    // If not yet consumed, start consuming and wait for completion
    if (!this.#consumed) {
      for await (const _ of this) {
        // Iterator naturally populates this.#message
      }
    }

    // If consumed but not completed, wait for completion
    return this.done();
  }

  /**
   * Get the current parameters being used by the ToolRunner.
   *
   * @returns A readonly view of the current ToolRunnerParams
   *
   * @example
   * const currentParams = runner.params;
   * console.log('Current model:', currentParams.model);
   * console.log('Message count:', currentParams.messages.length);
   */
  get params(): Readonly<BetaToolRunnerParams> {
    return this.#state.params as Readonly<BetaToolRunnerParams>;
  }

  /**
   * Add one or more messages to the conversation history.
   *
   * @param messages - One or more BetaMessageParam objects to add to the conversation
   *
   * @example
   * runner.pushMessages(
   *   { role: 'user', content: 'Also, what about the weather in NYC?' }
   * );
   *
   * @example
   * // Adding multiple messages
   * runner.pushMessages(
   *   { role: 'user', content: 'What about NYC?' },
   *   { role: 'user', content: 'And Boston?' }
   * );
   */
  pushMessages(...messages: ChatCompletionMessageParam[]) {
    this.setMessagesParams((params) => ({
      ...params,
      messages: [...params.messages, ...messages],
    }));
  }

  /**
   * Makes the ToolRunner directly awaitable, equivalent to calling .runUntilDone()
   * This allows using `await runner` instead of `await runner.runUntilDone()`
   */
  then<TResult1 = ChatCompletionMessage, TResult2 = never>( // TODO: make sure these types are OK
    onfulfilled?: ((value: ChatCompletionMessage) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.runUntilDone().then(onfulfilled, onrejected);
  }
}

async function generateToolResponse(
  lastMessage: ChatCompletionMessage,
  tools: BetaRunnableTool<any>[],
): Promise<null | ChatCompletionToolMessageParam[]> {
  // Only process if the last message is from the assistant and has tool use blocks
  if (
    !lastMessage ||
    lastMessage.role !== 'assistant' ||
    // !lastMessage.content || TODO: openai doesn't give content at the same time. ensure this is really always true though
    typeof lastMessage.content === 'string'
  ) {
    return null;
  }

  const { tool_calls: prevToolCalls = [] } = lastMessage;

  if ((lastMessage.tool_calls ?? []).length === 0) {
    return null;
  }

  return (
    await Promise.all(
      prevToolCalls.map(async (toolUse) => {
        if (toolUse.type !== 'function') return; // TODO: what about other calls?

        const tool = tools.find(
          (t) => t.type === 'function' && toolUse.function.name === t.function.name,
        ) as BetaRunnableTool;

        if (!tool || !('run' in tool)) {
          return {
            type: 'tool_result' as const,
            tool_call_id: toolUse.id,
            content: `Error: Tool '${toolUse.function.name}' not found`,
            is_error: true,
          };
        }

        try {
          let input = toolUse.function.arguments;
          // TODO: is this always safe?
          if (typeof input === 'string') {
            input = JSON.parse(input);
          }
          input = tool.parse(input);

          const result = await tool.run(input);
          return {
            type: 'tool_result' as const,
            tool_call_id: toolUse.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          };
        } catch (error) {
          return {
            type: 'tool_result' as const,
            tool_call_id: toolUse.id,
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true,
          };
        }
      }),
    )
  )
    .filter((result): result is NonNullable<typeof result> => result != null)
    .map((toolResult) => ({
      role: 'tool' as const,
      content: toolResult.content,
      tool_call_id: toolResult.tool_call_id,
    }));
}

// vendored from typefest just to make things look a bit nicer on hover
type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

/**
 * Parameters for creating a ToolRunner, extending MessageCreateParams with runnable tools.
 */
export type BetaToolRunnerParams = Simplify<
  Omit<ChatCompletionCreateParams, 'tools'> & {
    tools: (ChatCompletionTool | BetaRunnableTool<any>)[];
    /**
     * Maximum number of iterations (API requests) to make in the tool execution loop.
     * Each iteration consists of: assistant response → tool execution → tool results.
     * When exceeded, the loop will terminate even if tools are still being requested.
     */
    max_iterations?: number;
  }
>;

export type BetaToolRunnerRequestOptions = Pick<RequestOptions, 'headers'>;
