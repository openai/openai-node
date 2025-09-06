// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as Shared from '../shared';
import * as CompletionsAPI from './completions/completions';
import {
  ChatCompletion,
  ChatCompletionAllowedToolChoice,
  ChatCompletionAllowedTools,
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
  ChatCompletionCustomTool,
  ChatCompletionDeleted,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionFunctionCallOption,
  ChatCompletionFunctionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionListParams,
  ChatCompletionMessage,
  ChatCompletionMessageCustomToolCall,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionModality,
  ChatCompletionNamedToolChoice,
  ChatCompletionNamedToolChoiceCustom,
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
  Completions,
} from './completions/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export type ChatModel = Shared.ChatModel;

Chat.Completions = Completions;

export declare namespace Chat {
  export { type ChatModel as ChatModel };

  export {
    Completions as Completions,
    type ChatCompletion as ChatCompletion,
    type ChatCompletionAllowedToolChoice as ChatCompletionAllowedToolChoice,
    type ChatCompletionAssistantMessageParam as ChatCompletionAssistantMessageParam,
    type ChatCompletionAudio as ChatCompletionAudio,
    type ChatCompletionAudioParam as ChatCompletionAudioParam,
    type ChatCompletionChunk as ChatCompletionChunk,
    type ChatCompletionContentPart as ChatCompletionContentPart,
    type ChatCompletionContentPartImage as ChatCompletionContentPartImage,
    type ChatCompletionContentPartInputAudio as ChatCompletionContentPartInputAudio,
    type ChatCompletionContentPartRefusal as ChatCompletionContentPartRefusal,
    type ChatCompletionContentPartText as ChatCompletionContentPartText,
    type ChatCompletionCustomTool as ChatCompletionCustomTool,
    type ChatCompletionDeleted as ChatCompletionDeleted,
    type ChatCompletionDeveloperMessageParam as ChatCompletionDeveloperMessageParam,
    type ChatCompletionFunctionCallOption as ChatCompletionFunctionCallOption,
    type ChatCompletionFunctionMessageParam as ChatCompletionFunctionMessageParam,
    type ChatCompletionFunctionTool as ChatCompletionFunctionTool,
    type ChatCompletionMessage as ChatCompletionMessage,
    type ChatCompletionMessageCustomToolCall as ChatCompletionMessageCustomToolCall,
    type ChatCompletionMessageFunctionToolCall as ChatCompletionMessageFunctionToolCall,
    type ChatCompletionMessageParam as ChatCompletionMessageParam,
    type ChatCompletionMessageToolCall as ChatCompletionMessageToolCall,
    type ChatCompletionModality as ChatCompletionModality,
    type ChatCompletionNamedToolChoice as ChatCompletionNamedToolChoice,
    type ChatCompletionNamedToolChoiceCustom as ChatCompletionNamedToolChoiceCustom,
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
    type ChatCompletionAllowedTools as ChatCompletionAllowedTools,
    type ChatCompletionReasoningEffort as ChatCompletionReasoningEffort,
    type ChatCompletionsPage as ChatCompletionsPage,
    type ChatCompletionCreateParams as ChatCompletionCreateParams,
    type ChatCompletionCreateParamsNonStreaming as ChatCompletionCreateParamsNonStreaming,
    type ChatCompletionCreateParamsStreaming as ChatCompletionCreateParamsStreaming,
    type ChatCompletionUpdateParams as ChatCompletionUpdateParams,
    type ChatCompletionListParams as ChatCompletionListParams,
  };
}
