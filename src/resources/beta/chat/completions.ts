// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as Core from '../../../core';
import {
  ChatCompletionFunctionRunnerParams,
  ChatCompletionRunner,
  ChatCompletionToolRunnerParams,
} from '../../../lib/ChatCompletionRunner';
import { ChatCompletionStream, type ChatCompletionStreamParams } from '../../../lib/ChatCompletionStream';
import {
  ChatCompletionStreamingFunctionRunnerParams,
  ChatCompletionStreamingRunner,
  ChatCompletionStreamingToolRunnerParams,
} from '../../../lib/ChatCompletionStreamingRunner';
import { ExtractParsedContentFromParams, parseChatCompletion, validateInputTools } from '../../../lib/parser';
import { BaseFunctionsArgs } from '../../../lib/RunnableFunction';
import { APIResource } from '../../../resource';
import {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall,
} from '../../chat/completions';
export {
  ChatCompletionFunctionRunnerParams,
  ChatCompletionRunner,
  ChatCompletionToolRunnerParams,
} from '../../../lib/ChatCompletionRunner';
export { ChatCompletionStream, type ChatCompletionStreamParams } from '../../../lib/ChatCompletionStream';
export {
  ChatCompletionStreamingFunctionRunnerParams,
  ChatCompletionStreamingRunner,
  ChatCompletionStreamingToolRunnerParams,
} from '../../../lib/ChatCompletionStreamingRunner';
export {
  ParsingFunction,
  ParsingToolFunction,
  RunnableFunction,
  RunnableFunctions,
  RunnableFunctionWithoutParse,
  RunnableFunctionWithParse,
} from '../../../lib/RunnableFunction';

export interface ParsedFunction extends ChatCompletionMessageToolCall.Function {
  parsed_arguments?: unknown;
}

export interface ParsedFunctionToolCall extends ChatCompletionMessageToolCall {
  function: ParsedFunction;
}

export interface ParsedChatCompletionMessage<ParsedT> extends ChatCompletionMessage {
  parsed: ParsedT | null;
  tool_calls: Array<ParsedFunctionToolCall>;
}

export interface ParsedChoice<ParsedT> extends ChatCompletion.Choice {
  message: ParsedChatCompletionMessage<ParsedT>;
}

export interface ParsedChatCompletion<ParsedT> extends ChatCompletion {
  choices: Array<ParsedChoice<ParsedT>>;
}

export type ChatCompletionParseParams = ChatCompletionCreateParamsNonStreaming;

export class Completions extends APIResource {
  async parse<Params extends ChatCompletionParseParams, ParsedT = ExtractParsedContentFromParams<Params>>(
    body: Params,
    options?: Core.RequestOptions,
  ): Promise<ParsedChatCompletion<ParsedT>> {
    validateInputTools(body.tools);

    const completion = await this._client.chat.completions.create(body, {
      ...options,
      headers: {
        ...options?.headers,
        'X-Stainless-Helper-Method': 'beta.chat.completions.parse',
      },
    });

    return parseChatCompletion(completion, body);
  }

  async parseWithResponse<
    Params extends ChatCompletionParseParams,
    ParsedT = ExtractParsedContentFromParams<Params>,
  >(
    body: Params,
    options?: Core.RequestOptions,
  ): Promise<{ parsedCompletion: ParsedChatCompletion<ParsedT>; response: Core.Response }> {
    validateInputTools(body.tools);

    const { data: completion, response } = await this._client.chat.completions
      .create(body, {
        ...options,
        headers: {
          ...options?.headers,
          'X-Stainless-Helper-Method': 'beta.chat.completions.parse',
        },
      })
      .withResponse();

    return { parsedCompletion: parseChatCompletion(completion, body), response };
  }

  /**
   * @deprecated - use `runTools` instead.
   */
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner<null>;
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body: ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionStreamingRunner<null>;
  runFunctions<FunctionsArgs extends BaseFunctionsArgs>(
    body:
      | ChatCompletionFunctionRunnerParams<FunctionsArgs>
      | ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner<null> | ChatCompletionStreamingRunner<null> {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runFunctions(
        this._client,
        body as ChatCompletionStreamingFunctionRunnerParams<FunctionsArgs>,
        options,
      );
    }
    return ChatCompletionRunner.runFunctions(
      this._client,
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
  runTools<
    Params extends ChatCompletionToolRunnerParams<any>,
    ParsedT = ExtractParsedContentFromParams<Params>,
  >(body: Params, options?: Core.RequestOptions): ChatCompletionRunner<ParsedT>;

  runTools<
    Params extends ChatCompletionStreamingToolRunnerParams<any>,
    ParsedT = ExtractParsedContentFromParams<Params>,
  >(body: Params, options?: Core.RequestOptions): ChatCompletionStreamingRunner<ParsedT>;

  runTools<
    Params extends ChatCompletionToolRunnerParams<any> | ChatCompletionStreamingToolRunnerParams<any>,
    ParsedT = ExtractParsedContentFromParams<Params>,
  >(
    body: Params,
    options?: Core.RequestOptions,
  ): ChatCompletionRunner<ParsedT> | ChatCompletionStreamingRunner<ParsedT> {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runTools(
        this._client,
        body as ChatCompletionStreamingToolRunnerParams<any>,
        options,
      );
    }

    return ChatCompletionRunner.runTools(this._client, body as ChatCompletionToolRunnerParams<any>, options);
  }

  /**
   * Creates a chat completion stream
   */
  stream<Params extends ChatCompletionStreamParams, ParsedT = ExtractParsedContentFromParams<Params>>(
    body: Params,
    options?: Core.RequestOptions,
  ): ChatCompletionStream<ParsedT> {
    return ChatCompletionStream.createChatCompletion(this._client, body, options);
  }
}
