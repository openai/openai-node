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
  #toolResponse?: Promise<ChatCompletionToolMessageParam | null> | undefined;
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

          const { max_iterations, ...params } = this.#state.params;
          if (params.stream) {
            throw new Error('TODO'); // TODO
            // stream = this.client.beta.chat.completions.stream({ ...params });
            // this.#message = stream.finalMessage();
            // // Make sure that this promise doesn't throw before we get the option to do something about it.
            // // Error will be caught when we call await this.#message ultimately
            // this.#message.catch(() => {});
            // yield stream as any;
          } else {
            this.#message = this.client.beta.chat.completions.create({ ...params, stream: false });
            yield this.#message as any;
          }

          if (!this.#mutated) {
            const { choices } = await this.#message;
            const { role, content } = choices[0]!.message; // TODO: ensure there's at least one choice
            // this.#state.params.messages.push({ role, content }); TODO: we want to add all
            this.#state.params.messages.push({ role, content });
          }

          const toolMessage = await this.#generateToolResponse(this.#state.params.messages.at(-1)!);
          if (toolMessage) {
            this.#state.params.messages.push(toolMessage);
          }

          if (!toolMessage && !this.#mutated) {
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
    // TODO: this cast is probably bad
    return this.#generateToolResponse(message as ChatCompletionMessageParam);
  }

  async #generateToolResponse(lastMessage: ChatCompletionMessageParam) {
    if (this.#toolResponse !== undefined) {
      return this.#toolResponse;
    }
    this.#toolResponse = generateToolResponse(this.#state.params, lastMessage);
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
  params: BetaToolRunnerParams,
  lastMessage = params.messages.at(-1),
): Promise<ChatCompletionToolMessageParam | null> {
  // Only process if the last message is from the assistant and has tool use blocks
  if (
    !lastMessage ||
    lastMessage.role !== 'assistant' ||
    !lastMessage.tool_calls ||
    lastMessage.tool_calls.length === 0
  ) {
    return null;
  }

  const toolUseBlocks = lastMessage.tool_calls.filter((toolCall) => toolCall.type === 'function');
  if (toolUseBlocks.length === 0) {
    return null;
  }

  const toolResults = await Promise.all(
    toolUseBlocks.map(async (toolUse) => {
      // TODO: we should be able to infer that toolUseBlocks is FunctionDefinition[] or can cast it (maybe!)
      const tool = params.tools.find(
        (t) =>
          ('name' in t && 'function' in t ? t.function.name
          : 'name' in t ? t.name
          : undefined) === toolUse.function.name,
      );
      if (!tool || !('run' in tool)) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: `Error: Tool '${toolUse.function.name}' not found`,
          is_error: true,
        };
      }

      try {
        let input = JSON.parse(toolUse.function.arguments);
        if ('parse' in tool && tool.parse) {
          input = tool.parse(input);
        }

        const result = await tool.run(input);
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      } catch (error) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        };
      }
    }),
  );

  return {
    role: 'tool' as const,
    content: JSON.stringify(toolResults),
    tool_call_id: toolUseBlocks[0]!.id,
  };
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
