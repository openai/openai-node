// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import {
  type ExtractParsedContentFromParams,
  parseResponse,
  type ResponseCreateParamsWithTools,
  addOutputText,
} from '../../lib/ResponsesParser';
import * as Core from '../../core';
import { APIPromise, isRequestOptions } from '../../core';
import { APIResource } from '../../resource';
import * as Shared from '../shared';
import * as InputItemsAPI from './input-items';
import { InputItemListParams, InputItems, ResponseItemList } from './input-items';
import * as ResponsesAPI from './responses';
import { ResponseStream, ResponseStreamParams } from '../../lib/responses/ResponseStream';
import { CursorPage } from '../../pagination';
import { Stream } from '../../streaming';

export interface ParsedResponseOutputText<ParsedT> extends ResponseOutputText {
  parsed: ParsedT | null;
}

export type ParsedContent<ParsedT> = ParsedResponseOutputText<ParsedT> | ResponseOutputRefusal;

export interface ParsedResponseOutputMessage<ParsedT> extends ResponseOutputMessage {
  content: ParsedContent<ParsedT>[];
}

export interface ParsedResponseFunctionToolCall extends ResponseFunctionToolCall {
  parsed_arguments: any;
}

export type ParsedResponseOutputItem<ParsedT> =
  | ParsedResponseOutputMessage<ParsedT>
  | ParsedResponseFunctionToolCall
  | ResponseFileSearchToolCall
  | ResponseFunctionWebSearch
  | ResponseComputerToolCall
  | ResponseReasoningItem;

export interface ParsedResponse<ParsedT> extends Response {
  output: Array<ParsedResponseOutputItem<ParsedT>>;

  output_parsed: ParsedT | null;
}

export type ResponseParseParams = ResponseCreateParamsNonStreaming;
export class Responses extends APIResource {
  inputItems: InputItemsAPI.InputItems = new InputItemsAPI.InputItems(this._client);

  /**
   * Creates a model response. Provide
   * [text](https://platform.openai.com/docs/guides/text) or
   * [image](https://platform.openai.com/docs/guides/images) inputs to generate
   * [text](https://platform.openai.com/docs/guides/text) or
   * [JSON](https://platform.openai.com/docs/guides/structured-outputs) outputs. Have
   * the model call your own
   * [custom code](https://platform.openai.com/docs/guides/function-calling) or use
   * built-in [tools](https://platform.openai.com/docs/guides/tools) like
   * [web search](https://platform.openai.com/docs/guides/tools-web-search) or
   * [file search](https://platform.openai.com/docs/guides/tools-file-search) to use
   * your own data as input for the model's response.
   */
  create(body: ResponseCreateParamsNonStreaming, options?: Core.RequestOptions): APIPromise<Response>;
  create(
    body: ResponseCreateParamsStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<ResponseStreamEvent>>;
  create(
    body: ResponseCreateParamsBase,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<ResponseStreamEvent> | Response>;
  create(
    body: ResponseCreateParams,
    options?: Core.RequestOptions,
  ): APIPromise<Response> | APIPromise<Stream<ResponseStreamEvent>> {
    return (
      this._client.post('/responses', { body, ...options, stream: body.stream ?? false }) as
        | APIPromise<Response>
        | APIPromise<Stream<ResponseStreamEvent>>
    )._thenUnwrap((rsp) => {
      if ('object' in rsp && rsp.object === 'response') {
        addOutputText(rsp as Response);
      }

      return rsp;
    }) as APIPromise<Response> | APIPromise<Stream<ResponseStreamEvent>>;
  }

  /**
   * Retrieves a model response with the given ID.
   */
  retrieve(
    responseId: string,
    query?: ResponseRetrieveParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Response>;
  retrieve(responseId: string, options?: Core.RequestOptions): Core.APIPromise<Response>;
  retrieve(
    responseId: string,
    query: ResponseRetrieveParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.APIPromise<Response> {
    if (isRequestOptions(query)) {
      return this.retrieve(responseId, {}, query);
    }
    return this._client.get(`/responses/${responseId}`, { query, ...options });
  }

  /**
   * Deletes a model response with the given ID.
   */
  del(responseId: string, options?: Core.RequestOptions): Core.APIPromise<void> {
    return this._client.delete(`/responses/${responseId}`, {
      ...options,
      headers: { Accept: '*/*', ...options?.headers },
    });
  }

  parse<Params extends ResponseCreateParamsWithTools, ParsedT = ExtractParsedContentFromParams<Params>>(
    body: Params,
    options?: Core.RequestOptions,
  ): Core.APIPromise<ParsedResponse<ParsedT>> {
    return this._client.responses
      .create(body, options)
      ._thenUnwrap((response) => parseResponse(response as Response, body));
  }

  /**
   * Creates a chat completion stream
   */
  stream<Params extends ResponseStreamParams, ParsedT = ExtractParsedContentFromParams<Params>>(
    body: Params,
    options?: Core.RequestOptions,
  ): ResponseStream<ParsedT> {
    return ResponseStream.createResponse<ParsedT>(this._client, body, options);
  }
}

export class ResponseItemsPage extends CursorPage<ResponseItem> {}

/**
 * A tool that controls a virtual computer. Learn more about the
 * [computer tool](https://platform.openai.com/docs/guides/tools-computer-use).
 */
export interface ComputerTool {
  /**
   * The height of the computer display.
   */
  display_height: number;

  /**
   * The width of the computer display.
   */
  display_width: number;

  /**
   * The type of computer environment to control.
   */
  environment: 'mac' | 'windows' | 'ubuntu' | 'browser';

  /**
   * The type of the computer use tool. Always `computer_use_preview`.
   */
  type: 'computer-preview';
}

/**
 * A message input to the model with a role indicating instruction following
 * hierarchy. Instructions given with the `developer` or `system` role take
 * precedence over instructions given with the `user` role. Messages with the
 * `assistant` role are presumed to have been generated by the model in previous
 * interactions.
 */
export interface EasyInputMessage {
  /**
   * Text, image, or audio input to the model, used to generate a response. Can also
   * contain previous assistant responses.
   */
  content: string | ResponseInputMessageContentList;

  /**
   * The role of the message input. One of `user`, `assistant`, `system`, or
   * `developer`.
   */
  role: 'user' | 'assistant' | 'system' | 'developer';

  /**
   * The type of the message input. Always `message`.
   */
  type?: 'message';
}

/**
 * A tool that searches for relevant content from uploaded files. Learn more about
 * the
 * [file search tool](https://platform.openai.com/docs/guides/tools-file-search).
 */
export interface FileSearchTool {
  /**
   * The type of the file search tool. Always `file_search`.
   */
  type: 'file_search';

  /**
   * The IDs of the vector stores to search.
   */
  vector_store_ids: Array<string>;

  /**
   * A filter to apply based on file attributes.
   */
  filters?: Shared.ComparisonFilter | Shared.CompoundFilter;

  /**
   * The maximum number of results to return. This number should be between 1 and 50
   * inclusive.
   */
  max_num_results?: number;

  /**
   * Ranking options for search.
   */
  ranking_options?: FileSearchTool.RankingOptions;
}

export namespace FileSearchTool {
  /**
   * Ranking options for search.
   */
  export interface RankingOptions {
    /**
     * The ranker to use for the file search.
     */
    ranker?: 'auto' | 'default-2024-11-15';

    /**
     * The score threshold for the file search, a number between 0 and 1. Numbers
     * closer to 1 will attempt to return only the most relevant results, but may
     * return fewer results.
     */
    score_threshold?: number;
  }
}

/**
 * Defines a function in your own code the model can choose to call. Learn more
 * about
 * [function calling](https://platform.openai.com/docs/guides/function-calling).
 */
export interface FunctionTool {
  /**
   * The name of the function to call.
   */
  name: string;

  /**
   * A JSON schema object describing the parameters of the function.
   */
  parameters: Record<string, unknown>;

  /**
   * Whether to enforce strict parameter validation. Default `true`.
   */
  strict: boolean;

  /**
   * The type of the function tool. Always `function`.
   */
  type: 'function';

  /**
   * A description of the function. Used by the model to determine whether or not to
   * call the function.
   */
  description?: string | null;
}

export interface Response {
  /**
   * Unique identifier for this Response.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) of when this Response was created.
   */
  created_at: number;

  output_text: string;

  /**
   * An error object returned when the model fails to generate a Response.
   */
  error: ResponseError | null;

  /**
   * Details about why the response is incomplete.
   */
  incomplete_details: Response.IncompleteDetails | null;

  /**
   * Inserts a system (or developer) message as the first item in the model's
   * context.
   *
   * When using along with `previous_response_id`, the instructions from a previous
   * response will not be carried over to the next response. This makes it simple to
   * swap out system (or developer) messages in new responses.
   */
  instructions: string | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata: Shared.Metadata | null;

  /**
   * Model ID used to generate the response, like `gpt-4o` or `o1`. OpenAI offers a
   * wide range of models with different capabilities, performance characteristics,
   * and price points. Refer to the
   * [model guide](https://platform.openai.com/docs/models) to browse and compare
   * available models.
   */
  model: Shared.ResponsesModel;

  /**
   * The object type of this resource - always set to `response`.
   */
  object: 'response';

  /**
   * An array of content items generated by the model.
   *
   * - The length and order of items in the `output` array is dependent on the
   *   model's response.
   * - Rather than accessing the first item in the `output` array and assuming it's
   *   an `assistant` message with the content generated by the model, you might
   *   consider using the `output_text` property where supported in SDKs.
   */
  output: Array<ResponseOutputItem>;

  /**
   * Whether to allow the model to run tool calls in parallel.
   */
  parallel_tool_calls: boolean;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic. We generally recommend altering this or `top_p` but
   * not both.
   */
  temperature: number | null;

  /**
   * How the model should select which tool (or tools) to use when generating a
   * response. See the `tools` parameter to see how to specify which tools the model
   * can call.
   */
  tool_choice: ToolChoiceOptions | ToolChoiceTypes | ToolChoiceFunction;

  /**
   * An array of tools the model may call while generating a response. You can
   * specify which tool to use by setting the `tool_choice` parameter.
   *
   * The two categories of tools you can provide the model are:
   *
   * - **Built-in tools**: Tools that are provided by OpenAI that extend the model's
   *   capabilities, like
   *   [web search](https://platform.openai.com/docs/guides/tools-web-search) or
   *   [file search](https://platform.openai.com/docs/guides/tools-file-search).
   *   Learn more about
   *   [built-in tools](https://platform.openai.com/docs/guides/tools).
   * - **Function calls (custom tools)**: Functions that are defined by you, enabling
   *   the model to call your own code. Learn more about
   *   [function calling](https://platform.openai.com/docs/guides/function-calling).
   */
  tools: Array<Tool>;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p: number | null;

  /**
   * An upper bound for the number of tokens that can be generated for a response,
   * including visible output tokens and
   * [reasoning tokens](https://platform.openai.com/docs/guides/reasoning).
   */
  max_output_tokens?: number | null;

  /**
   * The unique ID of the previous response to the model. Use this to create
   * multi-turn conversations. Learn more about
   * [conversation state](https://platform.openai.com/docs/guides/conversation-state).
   */
  previous_response_id?: string | null;

  /**
   * **o-series models only**
   *
   * Configuration options for
   * [reasoning models](https://platform.openai.com/docs/guides/reasoning).
   */
  reasoning?: Shared.Reasoning | null;

  /**
   * The status of the response generation. One of `completed`, `failed`,
   * `in_progress`, or `incomplete`.
   */
  status?: ResponseStatus;

  /**
   * Configuration options for a text response from the model. Can be plain text or
   * structured JSON data. Learn more:
   *
   * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
   * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
   */
  text?: ResponseTextConfig;

  /**
   * The truncation strategy to use for the model response.
   *
   * - `auto`: If the context of this response and previous ones exceeds the model's
   *   context window size, the model will truncate the response to fit the context
   *   window by dropping input items in the middle of the conversation.
   * - `disabled` (default): If a model response will exceed the context window size
   *   for a model, the request will fail with a 400 error.
   */
  truncation?: 'auto' | 'disabled' | null;

  /**
   * Represents token usage details including input tokens, output tokens, a
   * breakdown of output tokens, and the total tokens used.
   */
  usage?: ResponseUsage;

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://platform.openai.com/docs/guides/safety-best-practices#end-user-ids).
   */
  user?: string;
}

export namespace Response {
  /**
   * Details about why the response is incomplete.
   */
  export interface IncompleteDetails {
    /**
     * The reason why the response is incomplete.
     */
    reason?: 'max_output_tokens' | 'content_filter';
  }
}

/**
 * Emitted when there is a partial audio response.
 */
export interface ResponseAudioDeltaEvent {
  /**
   * A chunk of Base64 encoded response audio bytes.
   */
  delta: string;

  /**
   * The type of the event. Always `response.audio.delta`.
   */
  type: 'response.audio.delta';
}

/**
 * Emitted when the audio response is complete.
 */
export interface ResponseAudioDoneEvent {
  /**
   * The type of the event. Always `response.audio.done`.
   */
  type: 'response.audio.done';
}

/**
 * Emitted when there is a partial transcript of audio.
 */
export interface ResponseAudioTranscriptDeltaEvent {
  /**
   * The partial transcript of the audio response.
   */
  delta: string;

  /**
   * The type of the event. Always `response.audio.transcript.delta`.
   */
  type: 'response.audio.transcript.delta';
}

/**
 * Emitted when the full audio transcript is completed.
 */
export interface ResponseAudioTranscriptDoneEvent {
  /**
   * The type of the event. Always `response.audio.transcript.done`.
   */
  type: 'response.audio.transcript.done';
}

/**
 * Emitted when a partial code snippet is added by the code interpreter.
 */
export interface ResponseCodeInterpreterCallCodeDeltaEvent {
  /**
   * The partial code snippet added by the code interpreter.
   */
  delta: string;

  /**
   * The index of the output item that the code interpreter call is in progress.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.code_interpreter_call.code.delta`.
   */
  type: 'response.code_interpreter_call.code.delta';
}

/**
 * Emitted when code snippet output is finalized by the code interpreter.
 */
export interface ResponseCodeInterpreterCallCodeDoneEvent {
  /**
   * The final code snippet output by the code interpreter.
   */
  code: string;

  /**
   * The index of the output item that the code interpreter call is in progress.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.code_interpreter_call.code.done`.
   */
  type: 'response.code_interpreter_call.code.done';
}

/**
 * Emitted when the code interpreter call is completed.
 */
export interface ResponseCodeInterpreterCallCompletedEvent {
  /**
   * A tool call to run code.
   */
  code_interpreter_call: ResponseCodeInterpreterToolCall;

  /**
   * The index of the output item that the code interpreter call is in progress.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.code_interpreter_call.completed`.
   */
  type: 'response.code_interpreter_call.completed';
}

/**
 * Emitted when a code interpreter call is in progress.
 */
export interface ResponseCodeInterpreterCallInProgressEvent {
  /**
   * A tool call to run code.
   */
  code_interpreter_call: ResponseCodeInterpreterToolCall;

  /**
   * The index of the output item that the code interpreter call is in progress.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.code_interpreter_call.in_progress`.
   */
  type: 'response.code_interpreter_call.in_progress';
}

/**
 * Emitted when the code interpreter is actively interpreting the code snippet.
 */
export interface ResponseCodeInterpreterCallInterpretingEvent {
  /**
   * A tool call to run code.
   */
  code_interpreter_call: ResponseCodeInterpreterToolCall;

  /**
   * The index of the output item that the code interpreter call is in progress.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.code_interpreter_call.interpreting`.
   */
  type: 'response.code_interpreter_call.interpreting';
}

/**
 * A tool call to run code.
 */
export interface ResponseCodeInterpreterToolCall {
  /**
   * The unique ID of the code interpreter tool call.
   */
  id: string;

  /**
   * The code to run.
   */
  code: string;

  /**
   * The results of the code interpreter tool call.
   */
  results: Array<ResponseCodeInterpreterToolCall.Logs | ResponseCodeInterpreterToolCall.Files>;

  /**
   * The status of the code interpreter tool call.
   */
  status: 'in_progress' | 'interpreting' | 'completed';

  /**
   * The type of the code interpreter tool call. Always `code_interpreter_call`.
   */
  type: 'code_interpreter_call';
}

export namespace ResponseCodeInterpreterToolCall {
  /**
   * The output of a code interpreter tool call that is text.
   */
  export interface Logs {
    /**
     * The logs of the code interpreter tool call.
     */
    logs: string;

    /**
     * The type of the code interpreter text output. Always `logs`.
     */
    type: 'logs';
  }

  /**
   * The output of a code interpreter tool call that is a file.
   */
  export interface Files {
    files: Array<Files.File>;

    /**
     * The type of the code interpreter file output. Always `files`.
     */
    type: 'files';
  }

  export namespace Files {
    export interface File {
      /**
       * The ID of the file.
       */
      file_id: string;

      /**
       * The MIME type of the file.
       */
      mime_type: string;
    }
  }
}

/**
 * Emitted when the model response is complete.
 */
export interface ResponseCompletedEvent {
  /**
   * Properties of the completed response.
   */
  response: Response;

  /**
   * The type of the event. Always `response.completed`.
   */
  type: 'response.completed';
}

/**
 * A tool call to a computer use tool. See the
 * [computer use guide](https://platform.openai.com/docs/guides/tools-computer-use)
 * for more information.
 */
export interface ResponseComputerToolCall {
  /**
   * The unique ID of the computer call.
   */
  id: string;

  /**
   * A click action.
   */
  action:
    | ResponseComputerToolCall.Click
    | ResponseComputerToolCall.DoubleClick
    | ResponseComputerToolCall.Drag
    | ResponseComputerToolCall.Keypress
    | ResponseComputerToolCall.Move
    | ResponseComputerToolCall.Screenshot
    | ResponseComputerToolCall.Scroll
    | ResponseComputerToolCall.Type
    | ResponseComputerToolCall.Wait;

  /**
   * An identifier used when responding to the tool call with output.
   */
  call_id: string;

  /**
   * The pending safety checks for the computer call.
   */
  pending_safety_checks: Array<ResponseComputerToolCall.PendingSafetyCheck>;

  /**
   * The status of the item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status: 'in_progress' | 'completed' | 'incomplete';

  /**
   * The type of the computer call. Always `computer_call`.
   */
  type: 'computer_call';
}

export namespace ResponseComputerToolCall {
  /**
   * A click action.
   */
  export interface Click {
    /**
     * Indicates which mouse button was pressed during the click. One of `left`,
     * `right`, `wheel`, `back`, or `forward`.
     */
    button: 'left' | 'right' | 'wheel' | 'back' | 'forward';

    /**
     * Specifies the event type. For a click action, this property is always set to
     * `click`.
     */
    type: 'click';

    /**
     * The x-coordinate where the click occurred.
     */
    x: number;

    /**
     * The y-coordinate where the click occurred.
     */
    y: number;
  }

  /**
   * A double click action.
   */
  export interface DoubleClick {
    /**
     * Specifies the event type. For a double click action, this property is always set
     * to `double_click`.
     */
    type: 'double_click';

    /**
     * The x-coordinate where the double click occurred.
     */
    x: number;

    /**
     * The y-coordinate where the double click occurred.
     */
    y: number;
  }

  /**
   * A drag action.
   */
  export interface Drag {
    /**
     * An array of coordinates representing the path of the drag action. Coordinates
     * will appear as an array of objects, eg
     *
     * ```
     * [
     *   { x: 100, y: 200 },
     *   { x: 200, y: 300 }
     * ]
     * ```
     */
    path: Array<Drag.Path>;

    /**
     * Specifies the event type. For a drag action, this property is always set to
     * `drag`.
     */
    type: 'drag';
  }

  export namespace Drag {
    /**
     * A series of x/y coordinate pairs in the drag path.
     */
    export interface Path {
      /**
       * The x-coordinate.
       */
      x: number;

      /**
       * The y-coordinate.
       */
      y: number;
    }
  }

  /**
   * A collection of keypresses the model would like to perform.
   */
  export interface Keypress {
    /**
     * The combination of keys the model is requesting to be pressed. This is an array
     * of strings, each representing a key.
     */
    keys: Array<string>;

    /**
     * Specifies the event type. For a keypress action, this property is always set to
     * `keypress`.
     */
    type: 'keypress';
  }

  /**
   * A mouse move action.
   */
  export interface Move {
    /**
     * Specifies the event type. For a move action, this property is always set to
     * `move`.
     */
    type: 'move';

    /**
     * The x-coordinate to move to.
     */
    x: number;

    /**
     * The y-coordinate to move to.
     */
    y: number;
  }

  /**
   * A screenshot action.
   */
  export interface Screenshot {
    /**
     * Specifies the event type. For a screenshot action, this property is always set
     * to `screenshot`.
     */
    type: 'screenshot';
  }

  /**
   * A scroll action.
   */
  export interface Scroll {
    /**
     * The horizontal scroll distance.
     */
    scroll_x: number;

    /**
     * The vertical scroll distance.
     */
    scroll_y: number;

    /**
     * Specifies the event type. For a scroll action, this property is always set to
     * `scroll`.
     */
    type: 'scroll';

    /**
     * The x-coordinate where the scroll occurred.
     */
    x: number;

    /**
     * The y-coordinate where the scroll occurred.
     */
    y: number;
  }

  /**
   * An action to type in text.
   */
  export interface Type {
    /**
     * The text to type.
     */
    text: string;

    /**
     * Specifies the event type. For a type action, this property is always set to
     * `type`.
     */
    type: 'type';
  }

  /**
   * A wait action.
   */
  export interface Wait {
    /**
     * Specifies the event type. For a wait action, this property is always set to
     * `wait`.
     */
    type: 'wait';
  }

  /**
   * A pending safety check for the computer call.
   */
  export interface PendingSafetyCheck {
    /**
     * The ID of the pending safety check.
     */
    id: string;

    /**
     * The type of the pending safety check.
     */
    code: string;

    /**
     * Details about the pending safety check.
     */
    message: string;
  }
}

export interface ResponseComputerToolCallOutputItem {
  /**
   * The unique ID of the computer call tool output.
   */
  id: string;

  /**
   * The ID of the computer tool call that produced the output.
   */
  call_id: string;

  /**
   * A computer screenshot image used with the computer use tool.
   */
  output: ResponseComputerToolCallOutputScreenshot;

  /**
   * The type of the computer tool call output. Always `computer_call_output`.
   */
  type: 'computer_call_output';

  /**
   * The safety checks reported by the API that have been acknowledged by the
   * developer.
   */
  acknowledged_safety_checks?: Array<ResponseComputerToolCallOutputItem.AcknowledgedSafetyCheck>;

  /**
   * The status of the message input. One of `in_progress`, `completed`, or
   * `incomplete`. Populated when input items are returned via API.
   */
  status?: 'in_progress' | 'completed' | 'incomplete';
}

export namespace ResponseComputerToolCallOutputItem {
  /**
   * A pending safety check for the computer call.
   */
  export interface AcknowledgedSafetyCheck {
    /**
     * The ID of the pending safety check.
     */
    id: string;

    /**
     * The type of the pending safety check.
     */
    code: string;

    /**
     * Details about the pending safety check.
     */
    message: string;
  }
}

/**
 * A computer screenshot image used with the computer use tool.
 */
export interface ResponseComputerToolCallOutputScreenshot {
  /**
   * Specifies the event type. For a computer screenshot, this property is always set
   * to `computer_screenshot`.
   */
  type: 'computer_screenshot';

  /**
   * The identifier of an uploaded file that contains the screenshot.
   */
  file_id?: string;

  /**
   * The URL of the screenshot image.
   */
  image_url?: string;
}

/**
 * Multi-modal input and output contents.
 */
export type ResponseContent =
  | ResponseInputText
  | ResponseInputImage
  | ResponseInputFile
  | ResponseOutputText
  | ResponseOutputRefusal;

/**
 * Emitted when a new content part is added.
 */
export interface ResponseContentPartAddedEvent {
  /**
   * The index of the content part that was added.
   */
  content_index: number;

  /**
   * The ID of the output item that the content part was added to.
   */
  item_id: string;

  /**
   * The index of the output item that the content part was added to.
   */
  output_index: number;

  /**
   * The content part that was added.
   */
  part: ResponseOutputText | ResponseOutputRefusal;

  /**
   * The type of the event. Always `response.content_part.added`.
   */
  type: 'response.content_part.added';
}

/**
 * Emitted when a content part is done.
 */
export interface ResponseContentPartDoneEvent {
  /**
   * The index of the content part that is done.
   */
  content_index: number;

  /**
   * The ID of the output item that the content part was added to.
   */
  item_id: string;

  /**
   * The index of the output item that the content part was added to.
   */
  output_index: number;

  /**
   * The content part that is done.
   */
  part: ResponseOutputText | ResponseOutputRefusal;

  /**
   * The type of the event. Always `response.content_part.done`.
   */
  type: 'response.content_part.done';
}

/**
 * An event that is emitted when a response is created.
 */
export interface ResponseCreatedEvent {
  /**
   * The response that was created.
   */
  response: Response;

  /**
   * The type of the event. Always `response.created`.
   */
  type: 'response.created';
}

/**
 * An error object returned when the model fails to generate a Response.
 */
export interface ResponseError {
  /**
   * The error code for the response.
   */
  code:
    | 'server_error'
    | 'rate_limit_exceeded'
    | 'invalid_prompt'
    | 'vector_store_timeout'
    | 'invalid_image'
    | 'invalid_image_format'
    | 'invalid_base64_image'
    | 'invalid_image_url'
    | 'image_too_large'
    | 'image_too_small'
    | 'image_parse_error'
    | 'image_content_policy_violation'
    | 'invalid_image_mode'
    | 'image_file_too_large'
    | 'unsupported_image_media_type'
    | 'empty_image_file'
    | 'failed_to_download_image'
    | 'image_file_not_found';

  /**
   * A human-readable description of the error.
   */
  message: string;
}

/**
 * Emitted when an error occurs.
 */
export interface ResponseErrorEvent {
  /**
   * The error code.
   */
  code: string | null;

  /**
   * The error message.
   */
  message: string;

  /**
   * The error parameter.
   */
  param: string | null;

  /**
   * The type of the event. Always `error`.
   */
  type: 'error';
}

/**
 * An event that is emitted when a response fails.
 */
export interface ResponseFailedEvent {
  /**
   * The response that failed.
   */
  response: Response;

  /**
   * The type of the event. Always `response.failed`.
   */
  type: 'response.failed';
}

/**
 * Emitted when a file search call is completed (results found).
 */
export interface ResponseFileSearchCallCompletedEvent {
  /**
   * The ID of the output item that the file search call is initiated.
   */
  item_id: string;

  /**
   * The index of the output item that the file search call is initiated.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.file_search_call.completed`.
   */
  type: 'response.file_search_call.completed';
}

/**
 * Emitted when a file search call is initiated.
 */
export interface ResponseFileSearchCallInProgressEvent {
  /**
   * The ID of the output item that the file search call is initiated.
   */
  item_id: string;

  /**
   * The index of the output item that the file search call is initiated.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.file_search_call.in_progress`.
   */
  type: 'response.file_search_call.in_progress';
}

/**
 * Emitted when a file search is currently searching.
 */
export interface ResponseFileSearchCallSearchingEvent {
  /**
   * The ID of the output item that the file search call is initiated.
   */
  item_id: string;

  /**
   * The index of the output item that the file search call is searching.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.file_search_call.searching`.
   */
  type: 'response.file_search_call.searching';
}

/**
 * The results of a file search tool call. See the
 * [file search guide](https://platform.openai.com/docs/guides/tools-file-search)
 * for more information.
 */
export interface ResponseFileSearchToolCall {
  /**
   * The unique ID of the file search tool call.
   */
  id: string;

  /**
   * The queries used to search for files.
   */
  queries: Array<string>;

  /**
   * The status of the file search tool call. One of `in_progress`, `searching`,
   * `incomplete` or `failed`,
   */
  status: 'in_progress' | 'searching' | 'completed' | 'incomplete' | 'failed';

  /**
   * The type of the file search tool call. Always `file_search_call`.
   */
  type: 'file_search_call';

  /**
   * The results of the file search tool call.
   */
  results?: Array<ResponseFileSearchToolCall.Result> | null;
}

export namespace ResponseFileSearchToolCall {
  export interface Result {
    /**
     * Set of 16 key-value pairs that can be attached to an object. This can be useful
     * for storing additional information about the object in a structured format, and
     * querying for objects via API or the dashboard. Keys are strings with a maximum
     * length of 64 characters. Values are strings with a maximum length of 512
     * characters, booleans, or numbers.
     */
    attributes?: Record<string, string | number | boolean> | null;

    /**
     * The unique ID of the file.
     */
    file_id?: string;

    /**
     * The name of the file.
     */
    filename?: string;

    /**
     * The relevance score of the file - a value between 0 and 1.
     */
    score?: number;

    /**
     * The text that was retrieved from the file.
     */
    text?: string;
  }
}

/**
 * An object specifying the format that the model must output.
 *
 * Configuring `{ "type": "json_schema" }` enables Structured Outputs, which
 * ensures the model will match your supplied JSON schema. Learn more in the
 * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
 *
 * The default format is `{ "type": "text" }` with no additional options.
 *
 * **Not recommended for gpt-4o and newer models:**
 *
 * Setting to `{ "type": "json_object" }` enables the older JSON mode, which
 * ensures the message the model generates is valid JSON. Using `json_schema` is
 * preferred for models that support it.
 */
export type ResponseFormatTextConfig =
  | Shared.ResponseFormatText
  | ResponseFormatTextJSONSchemaConfig
  | Shared.ResponseFormatJSONObject;

/**
 * JSON Schema response format. Used to generate structured JSON responses. Learn
 * more about
 * [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs).
 */
export interface ResponseFormatTextJSONSchemaConfig {
  /**
   * The name of the response format. Must be a-z, A-Z, 0-9, or contain underscores
   * and dashes, with a maximum length of 64.
   */
  name: string;

  /**
   * The schema for the response format, described as a JSON Schema object. Learn how
   * to build JSON schemas [here](https://json-schema.org/).
   */
  schema: Record<string, unknown>;

  /**
   * The type of response format being defined. Always `json_schema`.
   */
  type: 'json_schema';

  /**
   * A description of what the response format is for, used by the model to determine
   * how to respond in the format.
   */
  description?: string;

  /**
   * Whether to enable strict schema adherence when generating the output. If set to
   * true, the model will always follow the exact schema defined in the `schema`
   * field. Only a subset of JSON Schema is supported when `strict` is `true`. To
   * learn more, read the
   * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
   */
  strict?: boolean | null;
}

/**
 * Emitted when there is a partial function-call arguments delta.
 */
export interface ResponseFunctionCallArgumentsDeltaEvent {
  /**
   * The function-call arguments delta that is added.
   */
  delta: string;

  /**
   * The ID of the output item that the function-call arguments delta is added to.
   */
  item_id: string;

  /**
   * The index of the output item that the function-call arguments delta is added to.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.function_call_arguments.delta`.
   */
  type: 'response.function_call_arguments.delta';
}

/**
 * Emitted when function-call arguments are finalized.
 */
export interface ResponseFunctionCallArgumentsDoneEvent {
  /**
   * The function-call arguments.
   */
  arguments: string;

  /**
   * The ID of the item.
   */
  item_id: string;

  /**
   * The index of the output item.
   */
  output_index: number;

  type: 'response.function_call_arguments.done';
}

/**
 * A tool call to run a function. See the
 * [function calling guide](https://platform.openai.com/docs/guides/function-calling)
 * for more information.
 */
export interface ResponseFunctionToolCall {
  /**
   * A JSON string of the arguments to pass to the function.
   */
  arguments: string;

  /**
   * The unique ID of the function tool call generated by the model.
   */
  call_id: string;

  /**
   * The name of the function to run.
   */
  name: string;

  /**
   * The type of the function tool call. Always `function_call`.
   */
  type: 'function_call';

  /**
   * The unique ID of the function tool call.
   */
  id?: string;

  /**
   * The status of the item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * A tool call to run a function. See the
 * [function calling guide](https://platform.openai.com/docs/guides/function-calling)
 * for more information.
 */
export interface ResponseFunctionToolCallItem extends ResponseFunctionToolCall {
  /**
   * The unique ID of the function tool call.
   */
  id: string;
}

export interface ResponseFunctionToolCallOutputItem {
  /**
   * The unique ID of the function call tool output.
   */
  id: string;

  /**
   * The unique ID of the function tool call generated by the model.
   */
  call_id: string;

  /**
   * A JSON string of the output of the function tool call.
   */
  output: string;

  /**
   * The type of the function tool call output. Always `function_call_output`.
   */
  type: 'function_call_output';

  /**
   * The status of the item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * The results of a web search tool call. See the
 * [web search guide](https://platform.openai.com/docs/guides/tools-web-search) for
 * more information.
 */
export interface ResponseFunctionWebSearch {
  /**
   * The unique ID of the web search tool call.
   */
  id: string;

  /**
   * The status of the web search tool call.
   */
  status: 'in_progress' | 'searching' | 'completed' | 'failed';

  /**
   * The type of the web search tool call. Always `web_search_call`.
   */
  type: 'web_search_call';
}

/**
 * Emitted when the response is in progress.
 */
export interface ResponseInProgressEvent {
  /**
   * The response that is in progress.
   */
  response: Response;

  /**
   * The type of the event. Always `response.in_progress`.
   */
  type: 'response.in_progress';
}

/**
 * Specify additional output data to include in the model response. Currently
 * supported values are:
 *
 * - `file_search_call.results`: Include the search results of the file search tool
 *   call.
 * - `message.input_image.image_url`: Include image urls from the input message.
 * - `computer_call_output.output.image_url`: Include image urls from the computer
 *   call output.
 */
export type ResponseIncludable =
  | 'file_search_call.results'
  | 'message.input_image.image_url'
  | 'computer_call_output.output.image_url';

/**
 * An event that is emitted when a response finishes as incomplete.
 */
export interface ResponseIncompleteEvent {
  /**
   * The response that was incomplete.
   */
  response: Response;

  /**
   * The type of the event. Always `response.incomplete`.
   */
  type: 'response.incomplete';
}

/**
 * A list of one or many input items to the model, containing different content
 * types.
 */
export type ResponseInput = Array<ResponseInputItem>;

/**
 * An audio input to the model.
 */
export interface ResponseInputAudio {
  /**
   * Base64-encoded audio data.
   */
  data: string;

  /**
   * The format of the audio data. Currently supported formats are `mp3` and `wav`.
   */
  format: 'mp3' | 'wav';

  /**
   * The type of the input item. Always `input_audio`.
   */
  type: 'input_audio';
}

/**
 * A text input to the model.
 */
export type ResponseInputContent = ResponseInputText | ResponseInputImage | ResponseInputFile;

/**
 * A file input to the model.
 */
export interface ResponseInputFile {
  /**
   * The type of the input item. Always `input_file`.
   */
  type: 'input_file';

  /**
   * The content of the file to be sent to the model.
   */
  file_data?: string;

  /**
   * The ID of the file to be sent to the model.
   */
  file_id?: string;

  /**
   * The name of the file to be sent to the model.
   */
  filename?: string;
}

/**
 * An image input to the model. Learn about
 * [image inputs](https://platform.openai.com/docs/guides/vision).
 */
export interface ResponseInputImage {
  /**
   * The detail level of the image to be sent to the model. One of `high`, `low`, or
   * `auto`. Defaults to `auto`.
   */
  detail: 'high' | 'low' | 'auto';

  /**
   * The type of the input item. Always `input_image`.
   */
  type: 'input_image';

  /**
   * The ID of the file to be sent to the model.
   */
  file_id?: string | null;

  /**
   * The URL of the image to be sent to the model. A fully qualified URL or base64
   * encoded image in a data URL.
   */
  image_url?: string | null;
}

/**
 * A message input to the model with a role indicating instruction following
 * hierarchy. Instructions given with the `developer` or `system` role take
 * precedence over instructions given with the `user` role. Messages with the
 * `assistant` role are presumed to have been generated by the model in previous
 * interactions.
 */
export type ResponseInputItem =
  | EasyInputMessage
  | ResponseInputItem.Message
  | ResponseOutputMessage
  | ResponseFileSearchToolCall
  | ResponseComputerToolCall
  | ResponseInputItem.ComputerCallOutput
  | ResponseFunctionWebSearch
  | ResponseFunctionToolCall
  | ResponseInputItem.FunctionCallOutput
  | ResponseReasoningItem
  | ResponseInputItem.ItemReference;

export namespace ResponseInputItem {
  /**
   * A message input to the model with a role indicating instruction following
   * hierarchy. Instructions given with the `developer` or `system` role take
   * precedence over instructions given with the `user` role.
   */
  export interface Message {
    /**
     * A list of one or many input items to the model, containing different content
     * types.
     */
    content: ResponsesAPI.ResponseInputMessageContentList;

    /**
     * The role of the message input. One of `user`, `system`, or `developer`.
     */
    role: 'user' | 'system' | 'developer';

    /**
     * The status of item. One of `in_progress`, `completed`, or `incomplete`.
     * Populated when items are returned via API.
     */
    status?: 'in_progress' | 'completed' | 'incomplete';

    /**
     * The type of the message input. Always set to `message`.
     */
    type?: 'message';
  }

  /**
   * The output of a computer tool call.
   */
  export interface ComputerCallOutput {
    /**
     * The ID of the computer tool call that produced the output.
     */
    call_id: string;

    /**
     * A computer screenshot image used with the computer use tool.
     */
    output: ResponsesAPI.ResponseComputerToolCallOutputScreenshot;

    /**
     * The type of the computer tool call output. Always `computer_call_output`.
     */
    type: 'computer_call_output';

    /**
     * The ID of the computer tool call output.
     */
    id?: string;

    /**
     * The safety checks reported by the API that have been acknowledged by the
     * developer.
     */
    acknowledged_safety_checks?: Array<ComputerCallOutput.AcknowledgedSafetyCheck>;

    /**
     * The status of the message input. One of `in_progress`, `completed`, or
     * `incomplete`. Populated when input items are returned via API.
     */
    status?: 'in_progress' | 'completed' | 'incomplete';
  }

  export namespace ComputerCallOutput {
    /**
     * A pending safety check for the computer call.
     */
    export interface AcknowledgedSafetyCheck {
      /**
       * The ID of the pending safety check.
       */
      id: string;

      /**
       * The type of the pending safety check.
       */
      code: string;

      /**
       * Details about the pending safety check.
       */
      message: string;
    }
  }

  /**
   * The output of a function tool call.
   */
  export interface FunctionCallOutput {
    /**
     * The unique ID of the function tool call generated by the model.
     */
    call_id: string;

    /**
     * A JSON string of the output of the function tool call.
     */
    output: string;

    /**
     * The type of the function tool call output. Always `function_call_output`.
     */
    type: 'function_call_output';

    /**
     * The unique ID of the function tool call output. Populated when this item is
     * returned via API.
     */
    id?: string;

    /**
     * The status of the item. One of `in_progress`, `completed`, or `incomplete`.
     * Populated when items are returned via API.
     */
    status?: 'in_progress' | 'completed' | 'incomplete';
  }

  /**
   * An internal identifier for an item to reference.
   */
  export interface ItemReference {
    /**
     * The ID of the item to reference.
     */
    id: string;

    /**
     * The type of item to reference. Always `item_reference`.
     */
    type: 'item_reference';
  }
}

/**
 * A list of one or many input items to the model, containing different content
 * types.
 */
export type ResponseInputMessageContentList = Array<ResponseInputContent>;

export interface ResponseInputMessageItem {
  /**
   * The unique ID of the message input.
   */
  id: string;

  /**
   * A list of one or many input items to the model, containing different content
   * types.
   */
  content: ResponseInputMessageContentList;

  /**
   * The role of the message input. One of `user`, `system`, or `developer`.
   */
  role: 'user' | 'system' | 'developer';

  /**
   * The status of item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status?: 'in_progress' | 'completed' | 'incomplete';

  /**
   * The type of the message input. Always set to `message`.
   */
  type?: 'message';
}

/**
 * A text input to the model.
 */
export interface ResponseInputText {
  /**
   * The text input to the model.
   */
  text: string;

  /**
   * The type of the input item. Always `input_text`.
   */
  type: 'input_text';
}

/**
 * Content item used to generate a response.
 */
export type ResponseItem =
  | ResponseInputMessageItem
  | ResponseOutputMessage
  | ResponseFileSearchToolCall
  | ResponseComputerToolCall
  | ResponseComputerToolCallOutputItem
  | ResponseFunctionWebSearch
  | ResponseFunctionToolCallItem
  | ResponseFunctionToolCallOutputItem;

/**
 * An audio output from the model.
 */
export interface ResponseOutputAudio {
  /**
   * Base64-encoded audio data from the model.
   */
  data: string;

  /**
   * The transcript of the audio data from the model.
   */
  transcript: string;

  /**
   * The type of the output audio. Always `output_audio`.
   */
  type: 'output_audio';
}

/**
 * An output message from the model.
 */
export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseFileSearchToolCall
  | ResponseFunctionToolCall
  | ResponseFunctionWebSearch
  | ResponseComputerToolCall
  | ResponseReasoningItem;

/**
 * Emitted when a new output item is added.
 */
export interface ResponseOutputItemAddedEvent {
  /**
   * The output item that was added.
   */
  item: ResponseOutputItem;

  /**
   * The index of the output item that was added.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.output_item.added`.
   */
  type: 'response.output_item.added';
}

/**
 * Emitted when an output item is marked done.
 */
export interface ResponseOutputItemDoneEvent {
  /**
   * The output item that was marked done.
   */
  item: ResponseOutputItem;

  /**
   * The index of the output item that was marked done.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.output_item.done`.
   */
  type: 'response.output_item.done';
}

/**
 * An output message from the model.
 */
export interface ResponseOutputMessage {
  /**
   * The unique ID of the output message.
   */
  id: string;

  /**
   * The content of the output message.
   */
  content: Array<ResponseOutputText | ResponseOutputRefusal>;

  /**
   * The role of the output message. Always `assistant`.
   */
  role: 'assistant';

  /**
   * The status of the message input. One of `in_progress`, `completed`, or
   * `incomplete`. Populated when input items are returned via API.
   */
  status: 'in_progress' | 'completed' | 'incomplete';

  /**
   * The type of the output message. Always `message`.
   */
  type: 'message';
}

/**
 * A refusal from the model.
 */
export interface ResponseOutputRefusal {
  /**
   * The refusal explanationfrom the model.
   */
  refusal: string;

  /**
   * The type of the refusal. Always `refusal`.
   */
  type: 'refusal';
}

/**
 * A text output from the model.
 */
export interface ResponseOutputText {
  /**
   * The annotations of the text output.
   */
  annotations: Array<
    ResponseOutputText.FileCitation | ResponseOutputText.URLCitation | ResponseOutputText.FilePath
  >;

  /**
   * The text output from the model.
   */
  text: string;

  /**
   * The type of the output text. Always `output_text`.
   */
  type: 'output_text';
}

export namespace ResponseOutputText {
  /**
   * A citation to a file.
   */
  export interface FileCitation {
    /**
     * The ID of the file.
     */
    file_id: string;

    /**
     * The index of the file in the list of files.
     */
    index: number;

    /**
     * The type of the file citation. Always `file_citation`.
     */
    type: 'file_citation';
  }

  /**
   * A citation for a web resource used to generate a model response.
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
     * The type of the URL citation. Always `url_citation`.
     */
    type: 'url_citation';

    /**
     * The URL of the web resource.
     */
    url: string;
  }

  /**
   * A path to a file.
   */
  export interface FilePath {
    /**
     * The ID of the file.
     */
    file_id: string;

    /**
     * The index of the file in the list of files.
     */
    index: number;

    /**
     * The type of the file path. Always `file_path`.
     */
    type: 'file_path';
  }
}

/**
 * A description of the chain of thought used by a reasoning model while generating
 * a response.
 */
export interface ResponseReasoningItem {
  /**
   * The unique identifier of the reasoning content.
   */
  id: string;

  /**
   * Reasoning text contents.
   */
  summary: Array<ResponseReasoningItem.Summary>;

  /**
   * The type of the object. Always `reasoning`.
   */
  type: 'reasoning';

  /**
   * The status of the item. One of `in_progress`, `completed`, or `incomplete`.
   * Populated when items are returned via API.
   */
  status?: 'in_progress' | 'completed' | 'incomplete';
}

export namespace ResponseReasoningItem {
  export interface Summary {
    /**
     * A short summary of the reasoning used by the model when generating the response.
     */
    text: string;

    /**
     * The type of the object. Always `summary_text`.
     */
    type: 'summary_text';
  }
}

/**
 * Emitted when there is a partial refusal text.
 */
export interface ResponseRefusalDeltaEvent {
  /**
   * The index of the content part that the refusal text is added to.
   */
  content_index: number;

  /**
   * The refusal text that is added.
   */
  delta: string;

  /**
   * The ID of the output item that the refusal text is added to.
   */
  item_id: string;

  /**
   * The index of the output item that the refusal text is added to.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.refusal.delta`.
   */
  type: 'response.refusal.delta';
}

/**
 * Emitted when refusal text is finalized.
 */
export interface ResponseRefusalDoneEvent {
  /**
   * The index of the content part that the refusal text is finalized.
   */
  content_index: number;

  /**
   * The ID of the output item that the refusal text is finalized.
   */
  item_id: string;

  /**
   * The index of the output item that the refusal text is finalized.
   */
  output_index: number;

  /**
   * The refusal text that is finalized.
   */
  refusal: string;

  /**
   * The type of the event. Always `response.refusal.done`.
   */
  type: 'response.refusal.done';
}

/**
 * The status of the response generation. One of `completed`, `failed`,
 * `in_progress`, or `incomplete`.
 */
export type ResponseStatus = 'completed' | 'failed' | 'in_progress' | 'incomplete';

/**
 * Emitted when there is a partial audio response.
 */
export type ResponseStreamEvent =
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseCodeInterpreterCallCodeDeltaEvent
  | ResponseCodeInterpreterCallCodeDoneEvent
  | ResponseCodeInterpreterCallCompletedEvent
  | ResponseCodeInterpreterCallInProgressEvent
  | ResponseCodeInterpreterCallInterpretingEvent
  | ResponseCompletedEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseCreatedEvent
  | ResponseErrorEvent
  | ResponseFileSearchCallCompletedEvent
  | ResponseFileSearchCallInProgressEvent
  | ResponseFileSearchCallSearchingEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseInProgressEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseRefusalDeltaEvent
  | ResponseRefusalDoneEvent
  | ResponseTextAnnotationDeltaEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseWebSearchCallCompletedEvent
  | ResponseWebSearchCallInProgressEvent
  | ResponseWebSearchCallSearchingEvent;

/**
 * Emitted when a text annotation is added.
 */
export interface ResponseTextAnnotationDeltaEvent {
  /**
   * A citation to a file.
   */
  annotation:
    | ResponseTextAnnotationDeltaEvent.FileCitation
    | ResponseTextAnnotationDeltaEvent.URLCitation
    | ResponseTextAnnotationDeltaEvent.FilePath;

  /**
   * The index of the annotation that was added.
   */
  annotation_index: number;

  /**
   * The index of the content part that the text annotation was added to.
   */
  content_index: number;

  /**
   * The ID of the output item that the text annotation was added to.
   */
  item_id: string;

  /**
   * The index of the output item that the text annotation was added to.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.output_text.annotation.added`.
   */
  type: 'response.output_text.annotation.added';
}

export namespace ResponseTextAnnotationDeltaEvent {
  /**
   * A citation to a file.
   */
  export interface FileCitation {
    /**
     * The ID of the file.
     */
    file_id: string;

    /**
     * The index of the file in the list of files.
     */
    index: number;

    /**
     * The type of the file citation. Always `file_citation`.
     */
    type: 'file_citation';
  }

  /**
   * A citation for a web resource used to generate a model response.
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
     * The type of the URL citation. Always `url_citation`.
     */
    type: 'url_citation';

    /**
     * The URL of the web resource.
     */
    url: string;
  }

  /**
   * A path to a file.
   */
  export interface FilePath {
    /**
     * The ID of the file.
     */
    file_id: string;

    /**
     * The index of the file in the list of files.
     */
    index: number;

    /**
     * The type of the file path. Always `file_path`.
     */
    type: 'file_path';
  }
}

/**
 * Configuration options for a text response from the model. Can be plain text or
 * structured JSON data. Learn more:
 *
 * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
 * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
 */
export interface ResponseTextConfig {
  /**
   * An object specifying the format that the model must output.
   *
   * Configuring `{ "type": "json_schema" }` enables Structured Outputs, which
   * ensures the model will match your supplied JSON schema. Learn more in the
   * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
   *
   * The default format is `{ "type": "text" }` with no additional options.
   *
   * **Not recommended for gpt-4o and newer models:**
   *
   * Setting to `{ "type": "json_object" }` enables the older JSON mode, which
   * ensures the message the model generates is valid JSON. Using `json_schema` is
   * preferred for models that support it.
   */
  format?: ResponseFormatTextConfig;
}

/**
 * Emitted when there is an additional text delta.
 */
export interface ResponseTextDeltaEvent {
  /**
   * The index of the content part that the text delta was added to.
   */
  content_index: number;

  /**
   * The text delta that was added.
   */
  delta: string;

  /**
   * The ID of the output item that the text delta was added to.
   */
  item_id: string;

  /**
   * The index of the output item that the text delta was added to.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.output_text.delta`.
   */
  type: 'response.output_text.delta';
}

/**
 * Emitted when text content is finalized.
 */
export interface ResponseTextDoneEvent {
  /**
   * The index of the content part that the text content is finalized.
   */
  content_index: number;

  /**
   * The ID of the output item that the text content is finalized.
   */
  item_id: string;

  /**
   * The index of the output item that the text content is finalized.
   */
  output_index: number;

  /**
   * The text content that is finalized.
   */
  text: string;

  /**
   * The type of the event. Always `response.output_text.done`.
   */
  type: 'response.output_text.done';
}

/**
 * Represents token usage details including input tokens, output tokens, a
 * breakdown of output tokens, and the total tokens used.
 */
export interface ResponseUsage {
  /**
   * The number of input tokens.
   */
  input_tokens: number;

  /**
   * A detailed breakdown of the input tokens.
   */
  input_tokens_details: ResponseUsage.InputTokensDetails;

  /**
   * The number of output tokens.
   */
  output_tokens: number;

  /**
   * A detailed breakdown of the output tokens.
   */
  output_tokens_details: ResponseUsage.OutputTokensDetails;

  /**
   * The total number of tokens used.
   */
  total_tokens: number;
}

export namespace ResponseUsage {
  /**
   * A detailed breakdown of the input tokens.
   */
  export interface InputTokensDetails {
    /**
     * The number of tokens that were retrieved from the cache.
     * [More on prompt caching](https://platform.openai.com/docs/guides/prompt-caching).
     */
    cached_tokens: number;
  }

  /**
   * A detailed breakdown of the output tokens.
   */
  export interface OutputTokensDetails {
    /**
     * The number of reasoning tokens.
     */
    reasoning_tokens: number;
  }
}

/**
 * Emitted when a web search call is completed.
 */
export interface ResponseWebSearchCallCompletedEvent {
  /**
   * Unique ID for the output item associated with the web search call.
   */
  item_id: string;

  /**
   * The index of the output item that the web search call is associated with.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.web_search_call.completed`.
   */
  type: 'response.web_search_call.completed';
}

/**
 * Emitted when a web search call is initiated.
 */
export interface ResponseWebSearchCallInProgressEvent {
  /**
   * Unique ID for the output item associated with the web search call.
   */
  item_id: string;

  /**
   * The index of the output item that the web search call is associated with.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.web_search_call.in_progress`.
   */
  type: 'response.web_search_call.in_progress';
}

/**
 * Emitted when a web search call is executing.
 */
export interface ResponseWebSearchCallSearchingEvent {
  /**
   * Unique ID for the output item associated with the web search call.
   */
  item_id: string;

  /**
   * The index of the output item that the web search call is associated with.
   */
  output_index: number;

  /**
   * The type of the event. Always `response.web_search_call.searching`.
   */
  type: 'response.web_search_call.searching';
}

/**
 * A tool that searches for relevant content from uploaded files. Learn more about
 * the
 * [file search tool](https://platform.openai.com/docs/guides/tools-file-search).
 */
export type Tool = FileSearchTool | FunctionTool | ComputerTool | WebSearchTool;

/**
 * Use this option to force the model to call a specific function.
 */
export interface ToolChoiceFunction {
  /**
   * The name of the function to call.
   */
  name: string;

  /**
   * For function calling, the type is always `function`.
   */
  type: 'function';
}

/**
 * Controls which (if any) tool is called by the model.
 *
 * `none` means the model will not call any tool and instead generates a message.
 *
 * `auto` means the model can pick between generating a message or calling one or
 * more tools.
 *
 * `required` means the model must call one or more tools.
 */
export type ToolChoiceOptions = 'none' | 'auto' | 'required';

/**
 * Indicates that the model should use a built-in tool to generate a response.
 * [Learn more about built-in tools](https://platform.openai.com/docs/guides/tools).
 */
export interface ToolChoiceTypes {
  /**
   * The type of hosted tool the model should to use. Learn more about
   * [built-in tools](https://platform.openai.com/docs/guides/tools).
   *
   * Allowed values are:
   *
   * - `file_search`
   * - `web_search_preview`
   * - `computer_use_preview`
   */
  type: 'file_search' | 'web_search_preview' | 'computer_use_preview' | 'web_search_preview_2025_03_11';
}

/**
 * This tool searches the web for relevant results to use in a response. Learn more
 * about the
 * [web search tool](https://platform.openai.com/docs/guides/tools-web-search).
 */
export interface WebSearchTool {
  /**
   * The type of the web search tool. One of:
   *
   * - `web_search_preview`
   * - `web_search_preview_2025_03_11`
   */
  type: 'web_search_preview' | 'web_search_preview_2025_03_11';

  /**
   * High level guidance for the amount of context window space to use for the
   * search. One of `low`, `medium`, or `high`. `medium` is the default.
   */
  search_context_size?: 'low' | 'medium' | 'high';

  user_location?: WebSearchTool.UserLocation | null;
}

export namespace WebSearchTool {
  export interface UserLocation {
    /**
     * The type of location approximation. Always `approximate`.
     */
    type: 'approximate';

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

export type ResponseCreateParams = ResponseCreateParamsNonStreaming | ResponseCreateParamsStreaming;

export interface ResponseCreateParamsBase {
  /**
   * Text, image, or file inputs to the model, used to generate a response.
   *
   * Learn more:
   *
   * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
   * - [Image inputs](https://platform.openai.com/docs/guides/images)
   * - [File inputs](https://platform.openai.com/docs/guides/pdf-files)
   * - [Conversation state](https://platform.openai.com/docs/guides/conversation-state)
   * - [Function calling](https://platform.openai.com/docs/guides/function-calling)
   */
  input: string | ResponseInput;

  /**
   * Model ID used to generate the response, like `gpt-4o` or `o1`. OpenAI offers a
   * wide range of models with different capabilities, performance characteristics,
   * and price points. Refer to the
   * [model guide](https://platform.openai.com/docs/models) to browse and compare
   * available models.
   */
  model: Shared.ResponsesModel;

  /**
   * Specify additional output data to include in the model response. Currently
   * supported values are:
   *
   * - `file_search_call.results`: Include the search results of the file search tool
   *   call.
   * - `message.input_image.image_url`: Include image urls from the input message.
   * - `computer_call_output.output.image_url`: Include image urls from the computer
   *   call output.
   */
  include?: Array<ResponseIncludable> | null;

  /**
   * Inserts a system (or developer) message as the first item in the model's
   * context.
   *
   * When using along with `previous_response_id`, the instructions from a previous
   * response will not be carried over to the next response. This makes it simple to
   * swap out system (or developer) messages in new responses.
   */
  instructions?: string | null;

  /**
   * An upper bound for the number of tokens that can be generated for a response,
   * including visible output tokens and
   * [reasoning tokens](https://platform.openai.com/docs/guides/reasoning).
   */
  max_output_tokens?: number | null;

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
   * Whether to allow the model to run tool calls in parallel.
   */
  parallel_tool_calls?: boolean | null;

  /**
   * The unique ID of the previous response to the model. Use this to create
   * multi-turn conversations. Learn more about
   * [conversation state](https://platform.openai.com/docs/guides/conversation-state).
   */
  previous_response_id?: string | null;

  /**
   * **o-series models only**
   *
   * Configuration options for
   * [reasoning models](https://platform.openai.com/docs/guides/reasoning).
   */
  reasoning?: Shared.Reasoning | null;

  /**
   * Whether to store the generated model response for later retrieval via API.
   */
  store?: boolean | null;

  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/responses-streaming)
   * for more information.
   */
  stream?: boolean | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic. We generally recommend altering this or `top_p` but
   * not both.
   */
  temperature?: number | null;

  /**
   * Configuration options for a text response from the model. Can be plain text or
   * structured JSON data. Learn more:
   *
   * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
   * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
   */
  text?: ResponseTextConfig;

  /**
   * How the model should select which tool (or tools) to use when generating a
   * response. See the `tools` parameter to see how to specify which tools the model
   * can call.
   */
  tool_choice?: ToolChoiceOptions | ToolChoiceTypes | ToolChoiceFunction;

  /**
   * An array of tools the model may call while generating a response. You can
   * specify which tool to use by setting the `tool_choice` parameter.
   *
   * The two categories of tools you can provide the model are:
   *
   * - **Built-in tools**: Tools that are provided by OpenAI that extend the model's
   *   capabilities, like
   *   [web search](https://platform.openai.com/docs/guides/tools-web-search) or
   *   [file search](https://platform.openai.com/docs/guides/tools-file-search).
   *   Learn more about
   *   [built-in tools](https://platform.openai.com/docs/guides/tools).
   * - **Function calls (custom tools)**: Functions that are defined by you, enabling
   *   the model to call your own code. Learn more about
   *   [function calling](https://platform.openai.com/docs/guides/function-calling).
   */
  tools?: Array<Tool>;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p?: number | null;

  /**
   * The truncation strategy to use for the model response.
   *
   * - `auto`: If the context of this response and previous ones exceeds the model's
   *   context window size, the model will truncate the response to fit the context
   *   window by dropping input items in the middle of the conversation.
   * - `disabled` (default): If a model response will exceed the context window size
   *   for a model, the request will fail with a 400 error.
   */
  truncation?: 'auto' | 'disabled' | null;

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://platform.openai.com/docs/guides/safety-best-practices#end-user-ids).
   */
  user?: string;
}

export namespace ResponseCreateParams {
  export type ResponseCreateParamsNonStreaming = ResponsesAPI.ResponseCreateParamsNonStreaming;
  export type ResponseCreateParamsStreaming = ResponsesAPI.ResponseCreateParamsStreaming;
}

export interface ResponseCreateParamsNonStreaming extends ResponseCreateParamsBase {
  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/responses-streaming)
   * for more information.
   */
  stream?: false | null;
}

export interface ResponseCreateParamsStreaming extends ResponseCreateParamsBase {
  /**
   * If set to true, the model response data will be streamed to the client as it is
   * generated using
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format).
   * See the
   * [Streaming section below](https://platform.openai.com/docs/api-reference/responses-streaming)
   * for more information.
   */
  stream: true;
}

export interface ResponseRetrieveParams {
  /**
   * Additional fields to include in the response. See the `include` parameter for
   * Response creation above for more information.
   */
  include?: Array<ResponseIncludable>;
}

Responses.InputItems = InputItems;

export declare namespace Responses {
  export {
    type ComputerTool as ComputerTool,
    type EasyInputMessage as EasyInputMessage,
    type FileSearchTool as FileSearchTool,
    type FunctionTool as FunctionTool,
    type Response as Response,
    type ResponseAudioDeltaEvent as ResponseAudioDeltaEvent,
    type ResponseAudioDoneEvent as ResponseAudioDoneEvent,
    type ResponseAudioTranscriptDeltaEvent as ResponseAudioTranscriptDeltaEvent,
    type ResponseAudioTranscriptDoneEvent as ResponseAudioTranscriptDoneEvent,
    type ResponseCodeInterpreterCallCodeDeltaEvent as ResponseCodeInterpreterCallCodeDeltaEvent,
    type ResponseCodeInterpreterCallCodeDoneEvent as ResponseCodeInterpreterCallCodeDoneEvent,
    type ResponseCodeInterpreterCallCompletedEvent as ResponseCodeInterpreterCallCompletedEvent,
    type ResponseCodeInterpreterCallInProgressEvent as ResponseCodeInterpreterCallInProgressEvent,
    type ResponseCodeInterpreterCallInterpretingEvent as ResponseCodeInterpreterCallInterpretingEvent,
    type ResponseCodeInterpreterToolCall as ResponseCodeInterpreterToolCall,
    type ResponseCompletedEvent as ResponseCompletedEvent,
    type ResponseComputerToolCall as ResponseComputerToolCall,
    type ResponseComputerToolCallOutputItem as ResponseComputerToolCallOutputItem,
    type ResponseComputerToolCallOutputScreenshot as ResponseComputerToolCallOutputScreenshot,
    type ResponseContent as ResponseContent,
    type ResponseContentPartAddedEvent as ResponseContentPartAddedEvent,
    type ResponseContentPartDoneEvent as ResponseContentPartDoneEvent,
    type ResponseCreatedEvent as ResponseCreatedEvent,
    type ResponseError as ResponseError,
    type ResponseErrorEvent as ResponseErrorEvent,
    type ResponseFailedEvent as ResponseFailedEvent,
    type ResponseFileSearchCallCompletedEvent as ResponseFileSearchCallCompletedEvent,
    type ResponseFileSearchCallInProgressEvent as ResponseFileSearchCallInProgressEvent,
    type ResponseFileSearchCallSearchingEvent as ResponseFileSearchCallSearchingEvent,
    type ResponseFileSearchToolCall as ResponseFileSearchToolCall,
    type ResponseFormatTextConfig as ResponseFormatTextConfig,
    type ResponseFormatTextJSONSchemaConfig as ResponseFormatTextJSONSchemaConfig,
    type ResponseFunctionCallArgumentsDeltaEvent as ResponseFunctionCallArgumentsDeltaEvent,
    type ResponseFunctionCallArgumentsDoneEvent as ResponseFunctionCallArgumentsDoneEvent,
    type ResponseFunctionToolCall as ResponseFunctionToolCall,
    type ResponseFunctionToolCallItem as ResponseFunctionToolCallItem,
    type ResponseFunctionToolCallOutputItem as ResponseFunctionToolCallOutputItem,
    type ResponseFunctionWebSearch as ResponseFunctionWebSearch,
    type ResponseInProgressEvent as ResponseInProgressEvent,
    type ResponseIncludable as ResponseIncludable,
    type ResponseIncompleteEvent as ResponseIncompleteEvent,
    type ResponseInput as ResponseInput,
    type ResponseInputAudio as ResponseInputAudio,
    type ResponseInputContent as ResponseInputContent,
    type ResponseInputFile as ResponseInputFile,
    type ResponseInputImage as ResponseInputImage,
    type ResponseInputItem as ResponseInputItem,
    type ResponseInputMessageContentList as ResponseInputMessageContentList,
    type ResponseInputMessageItem as ResponseInputMessageItem,
    type ResponseInputText as ResponseInputText,
    type ResponseItem as ResponseItem,
    type ResponseOutputAudio as ResponseOutputAudio,
    type ResponseOutputItem as ResponseOutputItem,
    type ResponseOutputItemAddedEvent as ResponseOutputItemAddedEvent,
    type ResponseOutputItemDoneEvent as ResponseOutputItemDoneEvent,
    type ResponseOutputMessage as ResponseOutputMessage,
    type ResponseOutputRefusal as ResponseOutputRefusal,
    type ResponseOutputText as ResponseOutputText,
    type ResponseReasoningItem as ResponseReasoningItem,
    type ResponseRefusalDeltaEvent as ResponseRefusalDeltaEvent,
    type ResponseRefusalDoneEvent as ResponseRefusalDoneEvent,
    type ResponseStatus as ResponseStatus,
    type ResponseStreamEvent as ResponseStreamEvent,
    type ResponseTextAnnotationDeltaEvent as ResponseTextAnnotationDeltaEvent,
    type ResponseTextConfig as ResponseTextConfig,
    type ResponseTextDeltaEvent as ResponseTextDeltaEvent,
    type ResponseTextDoneEvent as ResponseTextDoneEvent,
    type ResponseUsage as ResponseUsage,
    type ResponseWebSearchCallCompletedEvent as ResponseWebSearchCallCompletedEvent,
    type ResponseWebSearchCallInProgressEvent as ResponseWebSearchCallInProgressEvent,
    type ResponseWebSearchCallSearchingEvent as ResponseWebSearchCallSearchingEvent,
    type Tool as Tool,
    type ToolChoiceFunction as ToolChoiceFunction,
    type ToolChoiceOptions as ToolChoiceOptions,
    type ToolChoiceTypes as ToolChoiceTypes,
    type WebSearchTool as WebSearchTool,
    type ResponseCreateParams as ResponseCreateParams,
    type ResponseCreateParamsNonStreaming as ResponseCreateParamsNonStreaming,
    type ResponseCreateParamsStreaming as ResponseCreateParamsStreaming,
    type ResponseRetrieveParams as ResponseRetrieveParams,
  };

  export {
    InputItems as InputItems,
    type ResponseItemList as ResponseItemList,
    type InputItemListParams as InputItemListParams,
  };
}
