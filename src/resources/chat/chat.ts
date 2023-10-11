// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as CompletionsAPI from 'openai/resources/chat/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this.client);
}

export namespace Chat {
  export import Completions = CompletionsAPI.Completions;
  export type ChatCompletion = CompletionsAPI.ChatCompletion;
  export type ChatCompletionChunk = CompletionsAPI.ChatCompletionChunk;
  export type ChatCompletionMessage = CompletionsAPI.ChatCompletionMessage;
  export type ChatCompletionMessageParam = CompletionsAPI.ChatCompletionMessageParam;
  export type ChatCompletionRole = CompletionsAPI.ChatCompletionRole;
  export type CreateChatCompletionRequestMessage = CompletionsAPI.CreateChatCompletionRequestMessage;
  export type ChatCompletionCreateParams = CompletionsAPI.ChatCompletionCreateParams;
  export type CompletionCreateParams = CompletionsAPI.CompletionCreateParams;
  export type ChatCompletionCreateParamsNonStreaming = CompletionsAPI.ChatCompletionCreateParamsNonStreaming;
  export type CompletionCreateParamsNonStreaming = CompletionsAPI.CompletionCreateParamsNonStreaming;
  export type ChatCompletionCreateParamsStreaming = CompletionsAPI.ChatCompletionCreateParamsStreaming;
  export type CompletionCreateParamsStreaming = CompletionsAPI.CompletionCreateParamsStreaming;
}
