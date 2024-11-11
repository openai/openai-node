// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as ChatAPI from './chat';
import * as CompletionsAPI from './completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export type ChatModel =
  | 'o1-preview'
  | 'o1-preview-2024-09-12'
  | 'o1-mini'
  | 'o1-mini-2024-09-12'
  | 'gpt-4o'
  | 'gpt-4o-2024-08-06'
  | 'gpt-4o-2024-05-13'
  | 'gpt-4o-realtime-preview'
  | 'gpt-4o-realtime-preview-2024-10-01'
  | 'gpt-4o-audio-preview'
  | 'gpt-4o-audio-preview-2024-10-01'
  | 'chatgpt-4o-latest'
  | 'gpt-4o-mini'
  | 'gpt-4o-mini-2024-07-18'
  | 'gpt-4-turbo'
  | 'gpt-4-turbo-2024-04-09'
  | 'gpt-4-0125-preview'
  | 'gpt-4-turbo-preview'
  | 'gpt-4-1106-preview'
  | 'gpt-4-vision-preview'
  | 'gpt-4'
  | 'gpt-4-0314'
  | 'gpt-4-0613'
  | 'gpt-4-32k'
  | 'gpt-4-32k-0314'
  | 'gpt-4-32k-0613'
  | 'gpt-3.5-turbo'
  | 'gpt-3.5-turbo-16k'
  | 'gpt-3.5-turbo-0301'
  | 'gpt-3.5-turbo-0613'
  | 'gpt-3.5-turbo-1106'
  | 'gpt-3.5-turbo-0125'
  | 'gpt-3.5-turbo-16k-0613';

export namespace Chat {
  export type ChatModel = ChatAPI.ChatModel;
  export import Completions = CompletionsAPI.Completions;
  export type ChatCompletion = CompletionsAPI.ChatCompletion;
  export type ChatCompletionAssistantMessageParam = CompletionsAPI.ChatCompletionAssistantMessageParam;
  export type ChatCompletionAudio = CompletionsAPI.ChatCompletionAudio;
  export type ChatCompletionAudioParam = CompletionsAPI.ChatCompletionAudioParam;
  export type ChatCompletionChunk = CompletionsAPI.ChatCompletionChunk;
  export type ChatCompletionContentPart = CompletionsAPI.ChatCompletionContentPart;
  export type ChatCompletionContentPartImage = CompletionsAPI.ChatCompletionContentPartImage;
  export type ChatCompletionContentPartInputAudio = CompletionsAPI.ChatCompletionContentPartInputAudio;
  export type ChatCompletionContentPartRefusal = CompletionsAPI.ChatCompletionContentPartRefusal;
  export type ChatCompletionContentPartText = CompletionsAPI.ChatCompletionContentPartText;
  export type ChatCompletionFunctionCallOption = CompletionsAPI.ChatCompletionFunctionCallOption;
  export type ChatCompletionFunctionMessageParam = CompletionsAPI.ChatCompletionFunctionMessageParam;
  export type ChatCompletionMessage = CompletionsAPI.ChatCompletionMessage;
  export type ChatCompletionMessageParam = CompletionsAPI.ChatCompletionMessageParam;
  export type ChatCompletionMessageToolCall = CompletionsAPI.ChatCompletionMessageToolCall;
  export type ChatCompletionModality = CompletionsAPI.ChatCompletionModality;
  export type ChatCompletionNamedToolChoice = CompletionsAPI.ChatCompletionNamedToolChoice;
  export type ChatCompletionRole = CompletionsAPI.ChatCompletionRole;
  export type ChatCompletionStreamOptions = CompletionsAPI.ChatCompletionStreamOptions;
  export type ChatCompletionSystemMessageParam = CompletionsAPI.ChatCompletionSystemMessageParam;
  export type ChatCompletionTokenLogprob = CompletionsAPI.ChatCompletionTokenLogprob;
  export type ChatCompletionTool = CompletionsAPI.ChatCompletionTool;
  export type ChatCompletionToolChoiceOption = CompletionsAPI.ChatCompletionToolChoiceOption;
  export type ChatCompletionToolMessageParam = CompletionsAPI.ChatCompletionToolMessageParam;
  export type ChatCompletionUserMessageParam = CompletionsAPI.ChatCompletionUserMessageParam;
  export type ChatCompletionCreateParams = CompletionsAPI.ChatCompletionCreateParams;
  export type CompletionCreateParams = CompletionsAPI.CompletionCreateParams;
  export type ChatCompletionCreateParamsNonStreaming = CompletionsAPI.ChatCompletionCreateParamsNonStreaming;
  export type CompletionCreateParamsNonStreaming = CompletionsAPI.CompletionCreateParamsNonStreaming;
  export type ChatCompletionCreateParamsStreaming = CompletionsAPI.ChatCompletionCreateParamsStreaming;
  export type CompletionCreateParamsStreaming = CompletionsAPI.CompletionCreateParamsStreaming;
}
