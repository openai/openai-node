// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as Shared from '../shared';
import * as CompletionsAPI from './completions/completions';
import {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionAudio,
  ChatCompletionAudioParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartInputAudio,
  ChatCompletionContentPartRefusal,
  ChatCompletionContentPartText,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionDeleted,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionFunctionCallOption,
  ChatCompletionFunctionMessageParam,
  ChatCompletionListParams,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionModality,
  ChatCompletionNamedToolChoice,
  ChatCompletionPredictionContent,
  ChatCompletionReasoningEffort,
  ChatCompletionRole,
  ChatCompletionStoreMessage,
  ChatCompletionStreamOptions,
  ChatCompletionSystemMessageParam,
  ChatCompletionTokenLogprob,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionToolMessageParam,
  ChatCompletionUpdateParams,
  ChatCompletionUserMessageParam,
  ChatCompletionsPage,
  CompletionCreateParams,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  CompletionListParams,
  CompletionUpdateParams,
  Completions,
  CreateChatCompletionRequestMessage,
} from './completions/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export type ChatModel = Shared.ChatModel;

Chat.Completions = Completions;
Chat.ChatCompletionsPage = ChatCompletionsPage;

export declare namespace Chat {
  export { type ChatModel as ChatModel };

  export {
    Completions as Completions,
    type ChatCompletion as ChatCompletion,
    type ChatCompletionAssistantMessageParam as ChatCompletionAssistantMessageParam,
    type ChatCompletionAudio as ChatCompletionAudio,
    type ChatCompletionAudioParam as ChatCompletionAudioParam,
    type ChatCompletionChunk as ChatCompletionChunk,
    type ChatCompletionContentPart as ChatCompletionContentPart,
    type ChatCompletionContentPartImage as ChatCompletionContentPartImage,
    type ChatCompletionContentPartInputAudio as ChatCompletionContentPartInputAudio,
    type ChatCompletionContentPartRefusal as ChatCompletionContentPartRefusal,
    type ChatCompletionContentPartText as ChatCompletionContentPartText,
    type ChatCompletionDeleted as ChatCompletionDeleted,
    type ChatCompletionDeveloperMessageParam as ChatCompletionDeveloperMessageParam,
    type ChatCompletionFunctionCallOption as ChatCompletionFunctionCallOption,
    type ChatCompletionFunctionMessageParam as ChatCompletionFunctionMessageParam,
    type ChatCompletionMessage as ChatCompletionMessage,
    type ChatCompletionMessageParam as ChatCompletionMessageParam,
    type ChatCompletionMessageToolCall as ChatCompletionMessageToolCall,
    type ChatCompletionModality as ChatCompletionModality,
    type ChatCompletionNamedToolChoice as ChatCompletionNamedToolChoice,
    type ChatCompletionPredictionContent as ChatCompletionPredictionContent,
    type ChatCompletionRole as ChatCompletionRole,
    type ChatCompletionStoreMessage as ChatCompletionStoreMessage,
    type ChatCompletionStreamOptions as ChatCompletionStreamOptions,
    type ChatCompletionSystemMessageParam as ChatCompletionSystemMessageParam,
    type ChatCompletionTokenLogprob as ChatCompletionTokenLogprob,
    type ChatCompletionTool as ChatCompletionTool,
    type ChatCompletionToolChoiceOption as ChatCompletionToolChoiceOption,
    type ChatCompletionToolMessageParam as ChatCompletionToolMessageParam,
    type ChatCompletionUserMessageParam as ChatCompletionUserMessageParam,
    type CreateChatCompletionRequestMessage as CreateChatCompletionRequestMessage,
    type ChatCompletionReasoningEffort as ChatCompletionReasoningEffort,
    ChatCompletionsPage as ChatCompletionsPage,
    type ChatCompletionCreateParams as ChatCompletionCreateParams,
    type CompletionCreateParams as CompletionCreateParams,
    type ChatCompletionCreateParamsNonStreaming as ChatCompletionCreateParamsNonStreaming,
    type CompletionCreateParamsNonStreaming as CompletionCreateParamsNonStreaming,
    type ChatCompletionCreateParamsStreaming as ChatCompletionCreateParamsStreaming,
    type CompletionCreateParamsStreaming as CompletionCreateParamsStreaming,
    type ChatCompletionUpdateParams as ChatCompletionUpdateParams,
    type CompletionUpdateParams as CompletionUpdateParams,
    type ChatCompletionListParams as ChatCompletionListParams,
    type CompletionListParams as CompletionListParams,
  };
}
