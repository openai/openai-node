// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from 'openai/resource';
import * as CompletionsAPI from 'openai/resources/chat/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export namespace Chat {
  export import Completions = CompletionsAPI.Completions;
  export import ChatCompletion = CompletionsAPI.ChatCompletion;
  export import ChatCompletionAssistantMessageParam = CompletionsAPI.ChatCompletionAssistantMessageParam;
  export import ChatCompletionChunk = CompletionsAPI.ChatCompletionChunk;
  export import ChatCompletionContentPart = CompletionsAPI.ChatCompletionContentPart;
  export import ChatCompletionContentPartImage = CompletionsAPI.ChatCompletionContentPartImage;
  export import ChatCompletionContentPartText = CompletionsAPI.ChatCompletionContentPartText;
  export import ChatCompletionFunctionCallOption = CompletionsAPI.ChatCompletionFunctionCallOption;
  export import ChatCompletionFunctionMessageParam = CompletionsAPI.ChatCompletionFunctionMessageParam;
  export import ChatCompletionMessage = CompletionsAPI.ChatCompletionMessage;
  export import ChatCompletionMessageParam = CompletionsAPI.ChatCompletionMessageParam;
  export import ChatCompletionMessageToolCall = CompletionsAPI.ChatCompletionMessageToolCall;
  export import ChatCompletionNamedToolChoice = CompletionsAPI.ChatCompletionNamedToolChoice;
  export import ChatCompletionRole = CompletionsAPI.ChatCompletionRole;
  export import ChatCompletionSystemMessageParam = CompletionsAPI.ChatCompletionSystemMessageParam;
  export import ChatCompletionTokenLogprob = CompletionsAPI.ChatCompletionTokenLogprob;
  export import ChatCompletionTool = CompletionsAPI.ChatCompletionTool;
  export import ChatCompletionToolChoiceOption = CompletionsAPI.ChatCompletionToolChoiceOption;
  export import ChatCompletionToolMessageParam = CompletionsAPI.ChatCompletionToolMessageParam;
  export import ChatCompletionUserMessageParam = CompletionsAPI.ChatCompletionUserMessageParam;
  /**
   * @deprecated ChatCompletionMessageParam should be used instead
   */
  export import CreateChatCompletionRequestMessage = CompletionsAPI.CreateChatCompletionRequestMessage;
  export import ChatCompletionCreateParams = CompletionsAPI.ChatCompletionCreateParams;
  export import CompletionCreateParams = CompletionsAPI.CompletionCreateParams;
  export import ChatCompletionCreateParamsNonStreaming = CompletionsAPI.ChatCompletionCreateParamsNonStreaming;
  export import CompletionCreateParamsNonStreaming = CompletionsAPI.CompletionCreateParamsNonStreaming;
  export import ChatCompletionCreateParamsStreaming = CompletionsAPI.ChatCompletionCreateParamsStreaming;
  export import CompletionCreateParamsStreaming = CompletionsAPI.CompletionCreateParamsStreaming;
}
