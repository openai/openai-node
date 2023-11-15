// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { ChatCompletionRunner, ChatCompletionFunctionRunnerParams } from 'openai/lib/ChatCompletionRunner';
export { ChatCompletionRunner, ChatCompletionFunctionRunnerParams } from 'openai/lib/ChatCompletionRunner';
import {
  ChatCompletionStreamingRunner,
  ChatCompletionStreamingFunctionRunnerParams,
} from 'openai/lib/ChatCompletionStreamingRunner';
export {
  ChatCompletionStreamingRunner,
  ChatCompletionStreamingFunctionRunnerParams,
} from 'openai/lib/ChatCompletionStreamingRunner';
import { BaseFunctionsArgs } from 'openai/lib/RunnableFunction';
export {
  RunnableFunction,
  RunnableFunctions,
  RunnableFunctionWithParse,
  RunnableFunctionWithoutParse,
  ParsingFunction,
} from 'openai/lib/RunnableFunction';
import { ChatCompletionToolRunnerParams } from 'openai/lib/ChatCompletionRunner';
export { ChatCompletionToolRunnerParams } from 'openai/lib/ChatCompletionRunner';
import { ChatCompletionStreamingToolRunnerParams } from 'openai/lib/ChatCompletionStreamingRunner';
export { ChatCompletionStreamingToolRunnerParams } from 'openai/lib/ChatCompletionStreamingRunner';
import { ChatCompletionStream, type ChatCompletionStreamParams } from 'openai/lib/ChatCompletionStream';
export { ChatCompletionStream, type ChatCompletionStreamParams } from 'openai/lib/ChatCompletionStream';

export class Completions extends APIResource {
  /**
   * A convenience helper for using function calls with the /chat/completions
   * endpoint which automatically calls the JavaScript functions you provide and
   * sends their results back to the /chat/completions endpoint, looping as long as
   * the model requests function calls.
   *
   * For more details and examples, see
   * [the docs](https://github.com/openai/openai-node#automated-function-calls)
   */
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner;
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionStreamingRunner;
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body:
      | ChatCompletionFunctionRunnerParams<FunctionsArgs>
      | ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner | ChatCompletionStreamingRunner {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runFunctions(
        this._client.chat.completions,
        body as ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
        options,
      );
    }
    return ChatCompletionRunner.runFunctions(
      this._client.chat.completions,
      body as ChatCompletionFunctionRunnerParams<FunctionsArgs>,
      options,
    );
  }

  /**
   * A convenience helper for using tool calls with the /chat/completions endpoint
   * which automatically calls the JavaScript functions you provide and sends their
   * results back to the /chat/completions endpoint, looping as long as the model
   * requests function calls.
   *
   * For more details and examples, see
   * [the docs](https://github.com/openai/openai-node#automated-function-calls)
   */
  runTools<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionToolRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner;
  runTools<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionStreamingToolRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionStreamingRunner;
  runTools<FunctionsArgs extends BaseFunctionsArgs>(
    body:
      | ChatCompletionToolRunnerParams<FunctionsArgs>
      | ChatCompletionStreamingToolRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner | ChatCompletionStreamingRunner {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runTools(
        this._client.chat.completions,
        body as ChatCompletionStreamingToolRunnerParams<FunctionsArgs>,
        options,
      );
    }
    return ChatCompletionRunner.runTools(
      this._client.chat.completions,
      body as ChatCompletionToolRunnerParams<FunctionsArgs>,
      options,
    );
  }

  /**
   * Creates a chat completion stream
   */
  stream(body: ChatCompletionStreamParams, options?: Core.RequestOptions): ChatCompletionStream {
    return ChatCompletionStream.createChatCompletion(this._client.chat.completions, body, options);
  }
}
