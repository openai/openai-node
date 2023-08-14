// File generated from our OpenAPI spec by Stainless.

import { APIResource } from "../../resource.ts";
import { Completions } from "./completions.ts";
import * as API from "./mod.ts";

export class Chat extends APIResource {
  completions: Completions = new Completions(this.client);
}

export namespace Chat {
  export type Completions = API.Completions;
  export type ChatCompletion = API.ChatCompletion;
  export type ChatCompletionChunk = API.ChatCompletionChunk;
  export type ChatCompletionMessage = API.ChatCompletionMessage;
  export type CreateChatCompletionRequestMessage =
    API.CreateChatCompletionRequestMessage;
  export type CompletionCreateParams = API.CompletionCreateParams;
  export type CompletionCreateParamsNonStreaming =
    API.CompletionCreateParamsNonStreaming;
  export type CompletionCreateParamsStreaming =
    API.CompletionCreateParamsStreaming;
}
