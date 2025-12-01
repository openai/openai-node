import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionStream,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from '../../resources/chat/completions';
import type { OpenAI } from '../..';
import { OpenAIError } from '../../core/error';
import type { BetaRunnableTool } from './BetaRunnableTool';
// BetaMessage, BetaMessageParam, BetaToolUnion, MessageCreateParams
// import { BetaMessageStream } from '../BetaMessageStream';

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
  /** Promise for the last message received from the assistant */
  #message?: Promise<ChatCompletion> | undefined;
  /** Cached tool response to avoid redundant executions */
  #toolResponse?: Promise<null | ChatCompletionToolMessageParam[]> | undefined;
  /** Promise resolvers for waiting on completion */
  #completion: {
    promise: Promise<ChatCompletion>;
    resolve: (value: ChatCompletion) => void;
    reject: (reason?: any) => void;
  };
  /** Number of iterations (API requests) made so far */
  #iterationCount = 0;

  constructor(
    private client: OpenAI,
    params: BetaToolRunnerParams,
  ) {
    this.#state = {
      params: {
        // You can't clone the entire params since there are functions as handlers.
        // You also don't really need to clone params.messages, but it probably will prevent a foot gun
        // somewhere.
        ...params,
        messages: structuredClone(params.messages),
      },
    };

    this.#completion = promiseWithResolvers();
  }

  get #firstChoiceInCurrentMessage(): ChatCompletionMessageParam | null {
    const lastMessage = this.#state.params.messages[this.#state.params.messages.length - 1];
    return lastMessage ?? null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<
    Stream extends true ?
      ChatCompletionStream // TODO: for now!
    : Stream extends false ? ChatCompletion
    : ChatCompletionCreateParams | ChatCompletionCreateParams
  > {
    if (this.#consumed) {
      throw new OpenAIError('Cannot iterate over a consumed stream');
    }

    this.#consumed = true;
    this.#mutated = true;
    this.#toolResponse = undefined;

    try {
      while (true) {
        let stream: any;
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
          if (params.stream) {
            stream = this.client.beta.chat.completions.stream({ ...params, stream: true });
            this.#message = stream.finalMessage();
            // Make sure that this promise doesn't throw before we get the option to do something about it.
            // Error will be caught when we call await this.#message ultimately
            this.#message?.catch(() => {});
            yield stream as any;
          } else {
            this.#message = this.client.beta.chat.completions.create({
              stream: false,
              tools: params.tools,
              messages: params.messages,
              model: params.model,
            });
            yield this.#message as any;
          }

          if (!this.#message) {
            throw new Error('No message created'); // TODO: use better error
          }

          // TODO: we should probably hit the user with a callback or somehow offer for them to choice between the choices
          if (!this.#firstChoiceInCurrentMessage) {
            throw new Error('No choices found in message'); // TODO: use better error
          }

          if (!this.#mutated) {
            // this.#state.params.messages.push({ role, content }); TODO: we want to add all
            this.#state.params.messages.push(this.#firstChoiceInCurrentMessage);
          }

          const toolMessages = await this.#generateToolResponse(await this.#message);
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
    const message = (await this.#message) ?? this.params.messages.at(-1);
    if (!message) {
      return null;
    }
    return this.#generateToolResponse(message);
  }

  async #generateToolResponse(lastMessage: ChatCompletion | ChatCompletionMessageParam) {
    if (this.#toolResponse !== undefined) {
      return this.#toolResponse;
    }
    this.#toolResponse = generateToolResponse(
      lastMessage,
      this.#state.params.tools.filter((tool): tool is BetaRunnableTool<any> => 'run' in tool),
    );
    return this.#toolResponse;
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
  done(): Promise<ChatCompletion> {
    return this.#completion.promise;
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
  async runUntilDone(): Promise<ChatCompletion> {
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
  then<TResult1 = ChatCompletion, TResult2 = never>(
    onfulfilled?: ((value: ChatCompletion) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.runUntilDone().then(onfulfilled, onrejected);
  }
}

async function generateToolResponse(
  params: ChatCompletion | ChatCompletionMessageParam,
  tools: BetaRunnableTool<any>[],
): Promise<null | ChatCompletionToolMessageParam[]> {
  if (!('choices' in params)) {
    return null;
  }
  const { choices } = params;
  const lastMessage = choices[0]?.message;
  if (!lastMessage) {
    return null;
  }

  // Only process if the last message is from the assistant and has tool use blocks
  if (
    !lastMessage ||
    lastMessage.role !== 'assistant' ||
    !lastMessage.content ||
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
