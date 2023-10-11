// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as CompletionsAPI from 'openai/resources/chat/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this.client);
}

export namespace Chat {
  export import Completions = CompletionsAPI.Completions;
  export import ChatCompletion = CompletionsAPI.ChatCompletion;
  export import ChatCompletionChunk = CompletionsAPI.ChatCompletionChunk;
  export import ChatCompletionMessage = CompletionsAPI.ChatCompletionMessage;
  export import ChatCompletionMessageParam = CompletionsAPI.ChatCompletionMessageParam;
  export import ChatCompletionRole = CompletionsAPI.ChatCompletionRole;
  export import CreateChatCompletionRequestMessage = CompletionsAPI.CreateChatCompletionRequestMessage;
  export import ChatCompletionCreateParams = CompletionsAPI.ChatCompletionCreateParams;
  export import CompletionCreateParams = CompletionsAPI.CompletionCreateParams;
  export import ChatCompletionCreateParamsNonStreaming = CompletionsAPI.ChatCompletionCreateParamsNonStreaming;
  export import CompletionCreateParamsNonStreaming = CompletionsAPI.CompletionCreateParamsNonStreaming;
  export import ChatCompletionCreateParamsStreaming = CompletionsAPI.ChatCompletionCreateParamsStreaming;
  export import CompletionCreateParamsStreaming = CompletionsAPI.CompletionCreateParamsStreaming;
}
