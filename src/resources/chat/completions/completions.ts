// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import { isRequestOptions } from '../../../core';
import { APIPromise } from '../../../core';
import * as Core from '../../../core';
import * as CompletionsCompletionsAPI from './completions';
import * as CompletionsAPI from '../../completions';
import * as Shared from '../../shared';
import * as MessagesAPI from './messages';
import { MessageListParams, Messages } from './messages';
import { CursorPage, type CursorPageParams } from '../../../pagination';
import { Stream } from '../../../streaming';

export class Completions extends APIResource {
  messages: MessagesAPI.Messages = new MessagesAPI.Messages(this._client);

  /**
   * **Starting a new project?** We recommend trying
   * [Responses](https://platform.openai.com/docs/api-reference/responses) to take
   * advantage of the latest OpenAI platform features. Compare
   * [Chat Completions with Responses](https://platform.openai.com/docs/guides/responses-vs-chat-completions?api-mode=responses).
   *
   * ---
   *
   * Creates a model response for the given chat conversation. Learn more in the
   * [text generation](https://platform.openai.com/docs/guides/text-generation),
   * [vision](https://platform.openai.com/docs/guides/vision), and
   * [audio](https://platform.openai.com/docs/guides/audio) guides.
   *
   * Parameter support can differ depending on the model used to generate the
   * response, particularly for newer reasoning models. Parameters that are only
   * supported for reasoning models are noted below. For the current state of
   * unsupported parameters in reasoning models,
   * [refer to the reasoning guide](https://platform.openai.com/docs/guides/reasoning).
   */
  create(
    body: ChatCompletionCreateParamsNonStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<ChatCompletion>;
  create(
    body: ChatCompletionCreateParamsStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<ChatCompletionChunk>>;
  create(
    body: ChatCompletionCreateParamsBase,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<ChatCompletionChunk> | ChatCompletion>;
  create(
    body: ChatCompletionCreateParams,
    options?: Core.RequestOptions,
  ): APIPromise<ChatCompletion> | APIPromise<Stream<ChatCompletionChunk>> {
    return this._client.post('/chat/completions', { body, ...options, stream: body.stream ?? false }) as
      | APIPromise<ChatCompletion>
      | APIPromise<Stream<ChatCompletionChunk>>;
  }

  /**
   * Get a stored chat completion. Only Chat Completions that have been created with
   * the `store` parameter set to `true` will be returned.
   */
  retrieve(completionId: string, options?: Core.RequestOptions): Core.APIPromise<ChatCompletion> {
    return this._client.get(`/chat/completions/${completionId}`, options);
  }

  /**
   * Modify a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be modified. Currently, the only
   * supported modification is to update the `metadata` field.
   */
  update(
    completionId: string,
    body: ChatCompletionUpdateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<ChatCompletion> {
    return this._client.post(`/chat/completions/${completionId}`, { body, ...options });
  }

  /**
   * List stored Chat Completions. Only Chat Completions that have been stored with
   * the `store` parameter set to `true` will be returned.
   */
  list(
    query?: ChatCompletionListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<ChatCompletionsPage, ChatCompletion>;
  list(options?: Core.RequestOptions): Core.PagePromise<ChatCompletionsPage, ChatCompletion>;
  list(
    query: ChatCompletionListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<ChatCompletionsPage, ChatCompletion> {
    if (isRequestOptions(query)) {
      return this.list({}, query);
    }
    return this._client.getAPIList('/chat/completions', ChatCompletionsPage, { query, ...options });
  }

  /**
   * Delete a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be deleted.
   */
  del(completionId: string, options?: Core.RequestOptions): Core.APIPromise<ChatCompletionDeleted> {
    return this._client.delete(`/chat/completions/${completionId}`, options);
  }
}

export class ChatCompletionsPage extends CursorPage<ChatCompletion> {}

export class ChatCompletionStoreMessagesPage extends CursorPage<ChatCompletionStoreMessage> {}

/**
 * Represents a chat completion response returned by model, based on the provided
 * input.
 */
export interface ChatCompletion {
  /**
   * A unique identifier for the chat completion.
   */
  id: string;

  /**
   * A list of chat completion choices. Can be more than one if `n` is greater
   * than 1.
   */
  choices: Array<ChatCompletion.Choice>;

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created.
   */
  created: number;

  /**
   * The model used for the chat completion.
   */
  model: string;

  /**
   * The object type, which is always `chat.completion`.
   */
  object: 'chat.completion';

  /**
   * The service tier used for processing the request.
   */
  service_tier?: 'scale' | 'default' | null;

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   *
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;

  /**
   * Usage statistics for the completion request.
   */
  usage?: CompletionsAPI.CompletionUsage;
}

export namespace ChatCompletion {
  export interface Choice {
    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, `tool_calls` if the
     * model called a tool, or `function_call` (deprecated) if the model called a
     * function.
     */
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';

    /**
     * The index of the choice in the list of choices.
     */
    index: number;

    /**
     * Log probability information for the choice.
     */
    logprobs: Choice.Logprobs | null;

    /**
     * A chat completion message generated by the model.
     */
    message: CompletionsCompletionsAPI.ChatCompletionMessage;
  }

  export namespace Choice {
    /**
     * Log probability information for the choice.
     */
    export interface Logprobs {
      /**
       * A list of message content tokens with log probability information.
       */
      content: Array<CompletionsCompletionsAPI.ChatCompletionTokenLogprob> | null;

      /**
       * A list of message refusal tokens with log probability information.
       */
      refusal: Array<CompletionsCompletionsAPI.ChatCompletionTokenLogprob> | null;
    }
  }
}

/**
 * Messages sent by the model in response to user messages.
 */
export interface ChatCompletionAssistantMessageParam {
  /**
   * The role of the messages author, in this case `assistant`.
   */
  role: 'assistant';

  /**
   * Data about a previous audio response from the model.
   * [Learn more](https://platform.openai.com/docs/guides/audio).
   */
  audio?: ChatCompletionAssistantMessageParam.Audio | null;

  /**
   * The contents of the assistant message. Required unless `tool_calls` or
   * `function_call` is specified.
   */
  content?: string | Array<ChatCompletionContentPartText | ChatCompletionContentPartRefusal> | null;

  /**
   * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
   * function that should be called, as generated by the model.
   */
  function_call?: ChatCompletionAssistantMessageParam.FunctionCall | null;

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;

  /**
   * The refusal message by the assistant.
   */
  refusal?: string | null;

  /**
   * The tool calls generated by the model, such as function calls.
   */
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

export namespace ChatCompletionAssistantMessageParam {
  /**
   * Data about a previous audio response from the model.
   * [Learn more](https://platform.openai.com/docs/guides/audio).
   */
  export interface Audio {
    /**
     * Unique identifier for a previous audio response from the model.
     */
    id: string;
  }

  /**
   * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
   * function that should be called, as generated by the model.
   */
  export interface FunctionCall {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;

    /**
     * The name of the function to call.
     */
    name: string;
  }
}

/**
 * If the audio output modality is requested, this object contains data about the
 * audio response from the model.
 * [Learn more](https://platform.openai.com/docs/guides/audio).
 */
export interface ChatCompletionAudio {
  /**
   * Unique identifier for this audio response.
   */
  id: string;

  /**
   * Base64 encoded audio bytes generated by the model, in the format specified in
   * the request.
   */
  data: string;

  /**
   * The Unix timestamp (in seconds) for when this audio response will no longer be
   * accessible on the server for use in multi-turn conversations.
   */
  expires_at: number;

  /**
   * Transcript of the audio generated by the model.
   */
  transcript: string;
}

/**
 * Parameters for audio output. Required when audio output is requested with
 * `modalities: ["audio"]`.
 * [Learn more](https://platform.openai.com/docs/guides/audio).
 */
export interface ChatCompletionAudioParam {
  /**
   * Specifies the output audio format. Must be one of `wav`, `mp3`, `flac`, `opus`,
   * or `pcm16`.
   */
  format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';

  /**
   * The voice the model uses to respond. Supported voices are `alloy`, `ash`,
   * `ballad`, `coral`, `echo`, `sage`, and `shimmer`.
   */
  voice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
}

/**
 * Represents a streamed chunk of a chat completion response returned by the model,
 * based on the provided input.
 * [Learn more](https://platform.openai.com/docs/guides/streaming-responses).
 */
export interface ChatCompletionChunk {
  /**
   * A unique identifier for the chat completion. Each chunk has the same ID.
   */
  id: string;

  /**
   * A list of chat completion choices. Can contain more than one elements if `n` is
   * greater than 1. Can also be empty for the last chunk if you set
   * `stream_options: {"include_usage": true}`.
   */
  choices: Array<ChatCompletionChunk.Choice>;

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created. Each
   * chunk has the same timestamp.
   */
  created: number;

  /**
   * The model to generate the completion.
   */
  model: string;

  /**
   * The object type, which is always `chat.completion.chunk`.
   */
  object: 'chat.completion.chunk';

  /**
   * The service tier used for processing the request.
   */
  service_tier?: 'scale' | 'default' | null;

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;

  /**
   * An optional field that will only be present when you set
   * `stream_options: {"include_usage": true}` in your request. When present, it
   * contains a null value **except for the last chunk** which contains the token
   * usage statistics for the entire request.
   *
   * **NOTE:** If the stream is interrupted or cancelled, you may not receive the
   * final usage chunk which contains the total token usage for the request.
   */
  usage?: CompletionsAPI.CompletionUsage | null;
}

export namespace ChatCompletionChunk {
  export interface Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    delta: Choice.Delta;

    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, `tool_calls` if the
     * model called a tool, or `function_call` (deprecated) if the model called a
     * function.
     */
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;

    /**
     * The index of the choice in the list of choices.
     */
    index: number;

    /**
     * Log probability information for the choice.
     */
    logprobs?: Choice.Logprobs | null;
  }

  export namespace Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    export interface Delta {
      /**
       * The contents of the chunk message.
       */
      content?: string | null;

      /**
       * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
       * function that should be called, as generated by the model.
       */
      function_call?: Delta.FunctionCall;

      /**
       * The refusal message generated by the model.
       */
      refusal?: string | null;

      /**
       * The role of the author of this message.
       */
      role?: 'developer' | 'system' | 'user' | 'assistant' | 'tool';

      tool_calls?: Array<Delta.ToolCall>;
    }

    export namespace Delta {
      /**
       * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
       * function that should be called, as generated by the model.
       */
      export interface FunctionCall {
        /**
         * The arguments to call the function with, as generated by the model in JSON
         * format. Note that the model does not always generate valid JSON, and may
         * hallucinate parameters not defined by your function schema. Validate the
         * arguments in your code before calling your function.
         */
        arguments?: string;

        /**
         * The name of the function to call.
         */
        name?: string;
      }

      export interface ToolCall {
        index: number;

        /**
         * The ID of the tool call.
         */
        id?: string;

        function?: ToolCall.Function;

        /**
         * The type of the tool. Currently, only `function` is supported.
         */
        type?: 'function';
      }

      export namespace ToolCall {
        export interface Function {
          /**
           * The arguments to call the function with, as generated by the model in JSON
           * format. Note that the model does not always generate valid JSON, and may
           * hallucinate parameters not defined by your function schema. Validate the
           * arguments in your code before calling your function.
           */
          arguments?: string;

          /**
           * The name of the function to call.
           */
          name?: string;
        }
      }
    }

    /**
     * Log probability information for the choice.
     */
    export interface Logprobs {
      /**
       * A list of message content tokens with log probability information.
       */
      content: Array<CompletionsCompletionsAPI.ChatCompletionTokenLogprob> | null;

      /**
       * A list of message refusal tokens with log probability information.
       */
      refusal: Array<CompletionsCompletionsAPI.ChatCompletionTokenLogprob> | null;
    }
  }
}

/**
 * Learn about
 * [text inputs](https://platform.openai.com/docs/guides/text-generation).
 */
export type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage
  | ChatCompletionContentPartInputAudio
  | ChatCompletionContentPart.File;

export namespace ChatCompletionContentPart {
  /**
   * Learn about [file inputs](https://platform.openai.com/docs/guides/text) for text
   * generation.
   */
  export interface File {
    file: File.File;

    /**
     * The type of the content part. Always `file`.
     */
    type: 'file';
  }

  export namespace File {
    export interface File {
      /**
       * The base64 encoded file data, used when passing the file to the model as a
       * string.
       */
      file_data?: string;

      /**
       * The ID of an uploaded file to use as input.
       */
      file_id?: string;

      /**
       * The name of the file, used when passing the file to the model as a string.
       */
      filename?: string;
    }
  }
}

/**
 * Learn about [image inputs](https://platform.openai.com/docs/guides/vision).
 */
export interface ChatCompletionContentPartImage {
  image_url: ChatCompletionContentPartImage.ImageURL;

  /**
   * The type of the content part.
   */
  type: 'image_url';
}

export namespace ChatCompletionContentPartImage {
  export interface ImageURL {
    /**
     * Either a URL of the image or the base64 encoded image data.
     */
    url: string;

    /**
     * Specifies the detail level of the image. Learn more in the
     * [Vision guide](https://platform.openai.com/docs/guides/vision#low-or-high-fidelity-image-understanding).
     */
    detail?: 'auto' | 'low' | 'high';
  }
}

/**
 * Learn about [audio inputs](https://platform.openai.com/docs/guides/audio).
 */
export interface ChatCompletionContentPartInputAudio {
  input_audio: ChatCompletionContentPartInputAudio.InputAudio;

  /**
   * The type of the content part. Always `input_audio`.
   */
  type: 'input_audio';
}

export namespace ChatCompletionContentPartInputAudio {
  export interface InputAudio {
    /**
     * Base64 encoded audio data.
     */
    data: string;

    /**
     * The format of the encoded audio data. Currently supports "wav" and "mp3".
     */
    format: 'wav' | 'mp3';
  }
}

export interface ChatCompletionContentPartRefusal {
  /**
   * The refusal message generated by the model.
   */
  refusal: string;

  /**
   * The type of the content part.
   */
  type: 'refusal';
}

/**
 * Learn about
 * [text inputs](https://platform.openai.com/docs/guides/text-generation).
 */
export interface ChatCompletionContentPartText {
  /**
   * The text content.
   */
  text: string;

  /**
   * The type of the content part.
   */
  type: 'text';
}

export interface ChatCompletionDeleted {
  /**
   * The ID of the chat completion that was deleted.
   */
  id: string;

  /**
   * Whether the chat completion was deleted.
   */
  deleted: boolean;

  /**
   * The type of object being deleted.
   */
  object: 'chat.completion.deleted';
}

/**
 * Developer-provided instructions that the model should follow, regardless of
 * messages sent by the user. With o1 models and newer, `developer` messages
 * replace the previous `system` messages.
 */
export interface ChatCompletionDeveloperMessageParam {
  /**
   * The contents of the developer message.
   */
  content: string | Array<ChatCompletionContentPartText>;

  /**
   * The role of the messages author, in this case `developer`.
   */
  role: 'developer';

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;
}

/**
 * Specifying a particular function via `{"name": "my_function"}` forces the model
 * to call that function.
 */
export interface ChatCompletionFunctionCallOption {
  /**
   * The name of the function to call.
   */
  name: string;
}

/**
 * @deprecated
 */
export interface ChatCompletionFunctionMessageParam {
  /**
   * The contents of the function message.
   */
  content: string | null;

  /**
   * The name of the function to call.
   */
  name: string;

  /**
   * The role of the messages author, in this case `function`.
   */
  role: 'function';
}

/**
 * A chat completion message generated by the model.
 */
export interface ChatCompletionMessage {
  /**
   * The contents of the message.
   */
  content: string | null;

  /**
   * The refusal message generated by the model.
   */
  refusal: string | null;

  /**
   * The role of the author of this message.
   */
  role: 'assistant';

  /**
   * Annotations for the message, when applicable, as when using the
   * [web search tool](https://platform.openai.com/docs/guides/tools-web-search?api-mode=chat).
   */
  annotations?: Array<ChatCompletionMessage.Annotation>;

  /**
   * If the audio output modality is requested, this object contains data about the
   * audio response from the model.
   * [Learn more](https://platform.openai.com/docs/guides/audio).
   */
  audio?: ChatCompletionAudio | null;

  /**
   * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
   * function that should be called, as generated by the model.
   */
  function_call?: ChatCompletionMessage.FunctionCall | null;

  /**
   * The tool calls generated by the model, such as function calls.
   */
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

export namespace ChatCompletionMessage {
  /**
   * A URL citation when using web search.
   */
  export interface Annotation {
    /**
     * The type of the URL citation. Always `url_citation`.
     */
    type: 'url_citation';

    /**
     * A URL citation when using web search.
     */
    url_citation: Annotation.URLCitation;
  }

  export namespace Annotation {
    /**
     * A URL citation when using web search.
     */
    export interface URLCitation {
      /**
       * The index of the last character of the URL citation in the message.
       */
      end_index: number;

      /**
       * The index of the first character of the URL citation in the message.
       */
      start_index: number;

      /**
       * The title of the web resource.
       */
      title: string;

      /**
       * The URL of the web resource.
       */
      url: string;
    }
  }

  /**
   * @deprecated Deprecated and replaced by `tool_calls`. The name and arguments of a
   * function that should be called, as generated by the model.
   */
  export interface FunctionCall {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;

    /**
     * The name of the function to call.
     */
    name: string;
  }
}

/**
 * Developer-provided instructions that the model should follow, regardless of
 * messages sent by the user. With o1 models and newer, `developer` messages
 * replace the previous `system` messages.
 */
export type ChatCompletionMessageParam =
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam
  | ChatCompletionFunctionMessageParam;

export interface ChatCompletionMessageToolCall {
  /**
   * The ID of the tool call.
   */
  id: string;

  /**
   * The function that the model called.
   */
  function: ChatCompletionMessageToolCall.Function;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}

export namespace ChatCompletionMessageToolCall {
  /**
   * The function that the model called.
   */
  export interface Function {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;

    /**
     * The name of the function to call.
     */
    name: string;
  }
}

export type ChatCompletionModality = 'text' | 'audio';

/**
 * Specifies a tool the model should use. Use to force the model to call a specific
 * function.
 */
export interface ChatCompletionNamedToolChoice {
  function: ChatCompletionNamedToolChoice.Function;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}

export namespace ChatCompletionNamedToolChoice {
  export interface Function {
    /**
     * The name of the function to call.
     */
    name: string;
  }
}

/**
 * Static predicted output content, such as the content of a text file that is
 * being regenerated.
 */
export interface ChatCompletionPredictionContent {
  /**
   * The content that should be matched when generating a model response. If
   * generated tokens would match this content, the entire model response can be
   * returned much more quickly.
   */
  content: string | Array<ChatCompletionContentPartText>;

  /**
   * The type of the predicted content you want to provide. This type is currently
   * always `content`.
   */
  type: 'content';
}

/**
 * The role of the author of a message
 */
export type ChatCompletionRole = 'developer' | 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * A chat completion message generated by the model.
 */
export interface ChatCompletionStoreMessage extends ChatCompletionMessage {
  /**
   * The identifier of the chat message.
   */
  id: string;
}

/**
 * Options for streaming response. Only set this when you set `stream: true`.
 */
export interface ChatCompletionStreamOptions {
  /**
   * If set, an additional chunk will be streamed before the `data: [DONE]` message.
   * The `usage` field on this chunk shows the token usage statistics for the entire
   * request, and the `choices` field will always be an empty array.
   *
   * All other chunks will also include a `usage` field, but with a null value.
   * **NOTE:** If the stream is interrupted, you may not receive the final usage
   * chunk which contains the total token usage for the request.
   */
  include_usage?: boolean;
}

/**
 * Developer-provided instructions that the model should follow, regardless of
 * messages sent by the user. With o1 models and newer, use `developer` messages
 * for this purpose instead.
 */
export interface ChatCompletionSystemMessageParam {
  /**
   * The contents of the system message.
   */
  content: string | Array<ChatCompletionContentPartText>;

  /**
   * The role of the messages author, in this case `system`.
   */
  role: 'system';

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;
}

export interface ChatCompletionTokenLogprob {
  /**
   * The token.
   */
  token: string;

  /**
   * A list of integers representing the UTF-8 bytes representation of the token.
   * Useful in instances where characters are represented by multiple tokens and
   * their byte representations must be combined to generate the correct text
   * representation. Can be `null` if there is no bytes representation for the token.
   */
  bytes: Array<number> | null;

  /**
   * The log probability of this token, if it is within the top 20 most likely
   * tokens. Otherwise, the value `-9999.0` is used to signify that the token is very
   * unlikely.
   */
  logprob: number;

  /**
   * List of the most likely tokens and their log probability, at this token
   * position. In rare cases, there may be fewer than the number of requested
   * `top_logprobs` returned.
   */
  top_logprobs: Array<ChatCompletionTokenLogprob.TopLogprob>;
}

export namespace ChatCompletionTokenLogprob {
  export interface TopLogprob {
    /**
     * The token.
     */
    token: string;

    /**
     * A list of integers representing the UTF-8 bytes representation of the token.
     * Useful in instances where characters are represented by multiple tokens and
     * their byte representations must be combined to generate the correct text
     * representation. Can be `null` if there is no bytes representation for the token.
     */
    bytes: Array<number> | null;

    /**
     * The log probability of this token, if it is within the top 20 most likely
     * tokens. Otherwise, the value `-9999.0` is used to signify that the token is very
     * unlikely.
     */
    logprob: number;
  }
}

export interface ChatCompletionTool {
  function: Shared.FunctionDefinition;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}

/**
 * Controls which (if any) tool is called by the model. `none` means the model will
 * not call any tool and instead generates a message. `auto` means the model can
 * pick between generating a message or calling one or more tools. `required` means
 * the model must call one or more tools. Specifying a particular tool via
 * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
 * call that tool.
 *
 * `none` is the default when no tools are present. `auto` is the default if tools
 * are present.
 */
export type ChatCompletionToolChoiceOption = 'none' | 'auto' | 'required' | ChatCompletionNamedToolChoice;

export interface ChatCompletionToolMessageParam {
  /**
   * The contents of the tool message.
   */
  content: string | Array<ChatCompletionContentPartText>;

  /**
   * The role of the messages author, in this case `tool`.
   */
  role: 'tool';

  /**
   * Tool call that this message is responding to.
   */
  tool_call_id: string;
}

/**
 * Messages sent by an end user, containing prompts or additional context
 * information.
 */
export interface ChatCompletionUserMessageParam {
  /**
   * The contents of the user message.
   */
  content: string | Array<ChatCompletionContentPart>;

  /**
   * The role of the messages author, in this case `user`.
   */
  role: 'user';

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;
}

/**
 * @deprecated ChatCompletionMessageParam should be used instead
 */
export type CreateChatCompletionRequestMessage = ChatCompletionMessageParam;

export type ChatCompletionReasoningEffort = Shared.ReasoningEffort | null;

export type ChatCompletionCreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

export interface ChatCompletionCreateParamsBase {
  /**
   * A list of messages comprising the conversation so far. Depending on the
   * [model](https://platform.openai.com/docs/models) you use, different message
   * types (modalities) are supported, like
   * [text](https://platform.openai.com/docs/guides/text-generation),
   * [images](https://platform.openai.com/docs/guides/vision), and
   * [audio](https://platform.openai.com/docs/guides/audio).
   */
  messages: Array<ChatCompletionMessageParam>;

  /**
   * Model ID used to generate the response, like `gpt-4o` or `o1`. OpenAI offers a
   * wide range of models with different capabilities, performance characteristics,
   * and price points. Refer to the
   * [model guide](https://platform.openai.com/docs/models) to browse and compare
   * available models.
   */
  model: (string & {}) | Shared.ChatModel;

  /**
   * Parameters for audio output. Required when audio output is requested with
   * `modalities: ["audio"]`.
   * [Learn more](https://platform.openai.com/docs/guides/audio).
   */
  audio?: ChatCompletionAudioParam | null;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on their
   * existing frequency in the text so far, decreasing the model's likelihood to
   * repeat the same line verbatim.
   */
  frequency_penalty?: number | null;

  /**
   * Deprecated in favor of `tool_choice`.
   *
   * Controls which (if any) function is called by the model.
   *
   * `none` means the model will not call a function and instead generates a message.
   *
   * `auto` means the model can pick between generating a message or calling a
   * function.
   *
   * Specifying a particular function via `{"name": "my_function"}` forces the model
   * to call that function.
   *
   * `none` is the default when no functions are present. `auto` is the default if
   * functions are present.
   */
  function_call?: 'none' | 'auto' | ChatCompletionFunctionCallOption;

  /**
   * Deprecated in favor of `tools`.
   *
   * A list of functions the model may generate JSON inputs for.
   */
  functions?: Array<ChatCompletionCreateParams.Function>;

  /**
   * Modify the likelihood of specified tokens appearing in the completion.
   *
   * Accepts a JSON object that maps tokens (specified by their token ID in the
   * tokenizer) to an associated bias value from -100 to 100. Mathematically, the
   * bias is added to the logits generated by the model prior to sampling. The exact
   * effect will vary per model, but values between -1 and 1 should decrease or
   * increase likelihood of selection; values like -100 or 100 should result in a ban
   * or exclusive selection of the relevant token.
   */
  logit_bias?: Record<string, number> | null;

  /**
   * Whether to return log probabilities of the output tokens or not. If true,
   * returns the log probabilities of each output token returned in the `content` of
   * `message`.
   */
  logprobs?: boolean | null;

  /**
   * An upper bound for the number of tokens that can be generated for a completion,
   * including visible output tokens and
   * [reasoning tokens](https://platform.openai.com/docs/guides/reasoning).
   */
  max_completion_tokens?: number | null;

  /**
   * The maximum number of [tokens](/tokenizer) that can be generated in the chat
   * completion. This value can be used to control
   * [costs](https://openai.com/api/pricing/) for text generated via API.
   *
   * This value is now deprecated in favor of `max_completion_tokens`, and is not
   * compatible with
   * [o1 series models](https://platform.openai.com/docs/guides/reasoning).
   */
  max_tokens?: number | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata?: Shared.Metadata | null;

  /**
   * Output types that you would like the model to generate. Most models are capable
   * of generating text, which is the default:
   *
   * `["text"]`
   *
   * The `gpt-4o-audio-preview` model can also be used to
   * [generate audio](https://platform.openai.com/docs/guides/audio). To request that
   * this model generate both text and audio responses, you can use:
   *
   * `["text", "audio"]`
   */
  modalities?: Array<'text' | 'audio'> | null;

  /**
   * How many chat completion choices to generate for each input message. Note that
   * you will be charged based on the number of generated tokens across all of the
   * choices. Keep `n` as `1` to minimize costs.
   */
  n?: number | null;

  /**
   * Whether to enable
   * [parallel function calling](https://platform.openai.com/docs/guides/function-calling#configuring-parallel-function-calling)
   * during tool use.
   */
  parallel_tool_calls?: boolean;

  /**
   * Static predicted output content, such as the content of a text file that is
   * being regenerated.
   */
  prediction?: ChatCompletionPredictionContent | null;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * whether they appear in the text so far, increasing the model's likelihood to
   * talk about new topics.
   */
  presence_penalty?: number | null;

  /**
   * **o-series models only**
   *
   * Constrains effort on reasoning for
   * [reasoning models](https://platform.openai.com/docs/guides/reasoning). Currently
   * supported values are `low`, `medium`, and `high`. Reducing reasoning effort can
   * result in faster responses and fewer tokens used on reasoning in a response.
   */
  reasoning_effort?: Shared.ReasoningEffort | null;

  /**
   * An object specifying the format that the model must output.
   *
   * Setting to `{ "type": "json_schema", "json_schema": {...} }` enables Structured
   * Outputs which ensures the model will match your supplied JSON schema. Learn more
   * in the
   * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
   *
   * Setting to `{ "type": "json_object" }` enables the older JSON mode, which
   * ensures the message the model generates is valid JSON. Using `json_schema` is
   * preferred for models that support it.
   */
  response_format?:
    | Shared.ResponseFormatText
    | Shared.ResponseFormatJSONSchema
    | Shared.ResponseFormatJSONObject;

  /**
   * This feature is in Beta. If specified, our system will make a best effort to
   * sample deterministically, such that repeated requests with the same `seed` and
   * parameters should return the same result. Determinism is not guaranteed, and you
   * should refer to the `system_fingerprint` response parameter to monitor changes
   * in the backend.
   */
  seed?: number | null;

  /**
   * Specifies the latency tier to use for processing the request. This parameter is
   * relevant for customers subscribed to the scale tier service:
   *
   * - If set to 'auto', and the Project is Scale tier enabled, the system will
   *   utilize scale tier credits until they are exhausted.
   * - If set to 'auto', and the Project is not Scale tier enabled, the request will
   *   be processed using the default service tier with a lower uptime SLA and no
   *   latency guarentee.
   * - If set to 'default', the request will be processed using the default service
   *   tier with a lower uptime SLA and no latency guarentee.
   * - When not set, the default behavior is 'auto'.
   *
   * When this parameter is set, the response body will include the `service_tier`
   * utilized.
   */
  service_tier?: 'auto' | 'default' | null;

  /**
   * Up to 4 sequences where the API will stop generating further tokens. The
   * returned text will not contain the stop sequence.
   */
  stop?: string | null | Array<string>;

  /**
   * Whether or not to store the output of this chat completion request for use in
   * our [model distillation](https://platform.openai.com/docs/guides/distillation)
   * or [evals](https://platform.openai.com/docs/guides/evals) products.
   */
  store?: boolean | null;

  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/chat/streaming)
   * for more information, along with the
   * [streaming responses](https://platform.openai.com/docs/guides/streaming-responses)
   * guide for more information on how to handle the streaming events.
   */
  stream?: boolean | null;

  /**
   * Options for streaming response. Only set this when you set `stream: true`.
   */
  stream_options?: ChatCompletionStreamOptions | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic. We generally recommend altering this or `top_p` but
   * not both.
   */
  temperature?: number | null;

  /**
   * Controls which (if any) tool is called by the model. `none` means the model will
   * not call any tool and instead generates a message. `auto` means the model can
   * pick between generating a message or calling one or more tools. `required` means
   * the model must call one or more tools. Specifying a particular tool via
   * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
   * call that tool.
   *
   * `none` is the default when no tools are present. `auto` is the default if tools
   * are present.
   */
  tool_choice?: ChatCompletionToolChoiceOption;

  /**
   * A list of tools the model may call. Currently, only functions are supported as a
   * tool. Use this to provide a list of functions the model may generate JSON inputs
   * for. A max of 128 functions are supported.
   */
  tools?: Array<ChatCompletionTool>;

  /**
   * An integer between 0 and 20 specifying the number of most likely tokens to
   * return at each token position, each with an associated log probability.
   * `logprobs` must be set to `true` if this parameter is used.
   */
  top_logprobs?: number | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p?: number | null;

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://platform.openai.com/docs/guides/safety-best-practices#end-user-ids).
   */
  user?: string;

  /**
   * This tool searches the web for relevant results to use in a response. Learn more
   * about the
   * [web search tool](https://platform.openai.com/docs/guides/tools-web-search?api-mode=chat).
   */
  web_search_options?: ChatCompletionCreateParams.WebSearchOptions;
}

export namespace ChatCompletionCreateParams {
  /**
   * @deprecated
   */
  export interface Function {
    /**
     * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain
     * underscores and dashes, with a maximum length of 64.
     */
    name: string;

    /**
     * A description of what the function does, used by the model to choose when and
     * how to call the function.
     */
    description?: string;

    /**
     * The parameters the functions accepts, described as a JSON Schema object. See the
     * [guide](https://platform.openai.com/docs/guides/function-calling) for examples,
     * and the
     * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
     * documentation about the format.
     *
     * Omitting `parameters` defines a function with an empty parameter list.
     */
    parameters?: Shared.FunctionParameters;
  }

  /**
   * This tool searches the web for relevant results to use in a response. Learn more
   * about the
   * [web search tool](https://platform.openai.com/docs/guides/tools-web-search?api-mode=chat).
   */
  export interface WebSearchOptions {
    /**
     * High level guidance for the amount of context window space to use for the
     * search. One of `low`, `medium`, or `high`. `medium` is the default.
     */
    search_context_size?: 'low' | 'medium' | 'high';

    /**
     * Approximate location parameters for the search.
     */
    user_location?: WebSearchOptions.UserLocation | null;
  }

  export namespace WebSearchOptions {
    /**
     * Approximate location parameters for the search.
     */
    export interface UserLocation {
      /**
       * Approximate location parameters for the search.
       */
      approximate: UserLocation.Approximate;

      /**
       * The type of location approximation. Always `approximate`.
       */
      type: 'approximate';
    }

    export namespace UserLocation {
      /**
       * Approximate location parameters for the search.
       */
      export interface Approximate {
        /**
         * Free text input for the city of the user, e.g. `San Francisco`.
         */
        city?: string;

        /**
         * The two-letter [ISO country code](https://en.wikipedia.org/wiki/ISO_3166-1) of
         * the user, e.g. `US`.
         */
        country?: string;

        /**
         * Free text input for the region of the user, e.g. `California`.
         */
        region?: string;

        /**
         * The [IANA timezone](https://timeapi.io/documentation/iana-timezones) of the
         * user, e.g. `America/Los_Angeles`.
         */
        timezone?: string;
      }
    }
  }

  export type ChatCompletionCreateParamsNonStreaming =
    CompletionsCompletionsAPI.ChatCompletionCreateParamsNonStreaming;
  export type ChatCompletionCreateParamsStreaming =
    CompletionsCompletionsAPI.ChatCompletionCreateParamsStreaming;
}

/**
 * @deprecated Use ChatCompletionCreateParams instead
 */
export type CompletionCreateParams = ChatCompletionCreateParams;

export interface ChatCompletionCreateParamsNonStreaming extends ChatCompletionCreateParamsBase {
  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/chat/streaming)
   * for more information, along with the
   * [streaming responses](https://platform.openai.com/docs/guides/streaming-responses)
   * guide for more information on how to handle the streaming events.
   */
  stream?: false | null;
}

/**
 * @deprecated Use ChatCompletionCreateParamsNonStreaming instead
 */
export type CompletionCreateParamsNonStreaming = ChatCompletionCreateParamsNonStreaming;

export interface ChatCompletionCreateParamsStreaming extends ChatCompletionCreateParamsBase {
  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/chat/streaming)
   * for more information, along with the
   * [streaming responses](https://platform.openai.com/docs/guides/streaming-responses)
   * guide for more information on how to handle the streaming events.
   */
  stream: true;
}

/**
 * @deprecated Use ChatCompletionCreateParamsStreaming instead
 */
export type CompletionCreateParamsStreaming = ChatCompletionCreateParamsStreaming;

export interface ChatCompletionUpdateParams {
  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata: Shared.Metadata | null;
}

/**
 * @deprecated Use ChatCompletionUpdateParams instead
 */
export type CompletionUpdateParams = ChatCompletionUpdateParams;

export interface ChatCompletionListParams extends CursorPageParams {
  /**
   * A list of metadata keys to filter the Chat Completions by. Example:
   *
   * `metadata[key1]=value1&metadata[key2]=value2`
   */
  metadata?: Shared.Metadata | null;

  /**
   * The model used to generate the Chat Completions.
   */
  model?: string;

  /**
   * Sort order for Chat Completions by timestamp. Use `asc` for ascending order or
   * `desc` for descending order. Defaults to `asc`.
   */
  order?: 'asc' | 'desc';
}

/**
 * @deprecated Use ChatCompletionListParams instead
 */
export type CompletionListParams = ChatCompletionListParams;

Completions.ChatCompletionsPage = ChatCompletionsPage;
Completions.Messages = Messages;

export declare namespace Completions {
  export {
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

  export { Messages as Messages, type MessageListParams as MessageListParams };
}
