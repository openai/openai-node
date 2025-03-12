// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import { isRequestOptions } from '../../core';
import * as Core from '../../core';
import * as ResponsesAPI from './responses';
import { CursorPage, type CursorPageParams } from '../../pagination';

export class InputItems extends APIResource {
  /**
   * Returns a list of input items for a given response.
   */
  list(
    responseId: string,
    query?: InputItemListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<
    ResponseItemListDataPage,
    | ResponseItemList.Message
    | ResponsesAPI.ResponseOutputMessage
    | ResponsesAPI.ResponseFileSearchToolCall
    | ResponsesAPI.ResponseComputerToolCall
    | ResponseItemList.ComputerCallOutput
    | ResponsesAPI.ResponseFunctionWebSearch
    | ResponsesAPI.ResponseFunctionToolCall
    | ResponseItemList.FunctionCallOutput
  >;
  list(
    responseId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<
    ResponseItemListDataPage,
    | ResponseItemList.Message
    | ResponsesAPI.ResponseOutputMessage
    | ResponsesAPI.ResponseFileSearchToolCall
    | ResponsesAPI.ResponseComputerToolCall
    | ResponseItemList.ComputerCallOutput
    | ResponsesAPI.ResponseFunctionWebSearch
    | ResponsesAPI.ResponseFunctionToolCall
    | ResponseItemList.FunctionCallOutput
  >;
  list(
    responseId: string,
    query: InputItemListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<
    ResponseItemListDataPage,
    | ResponseItemList.Message
    | ResponsesAPI.ResponseOutputMessage
    | ResponsesAPI.ResponseFileSearchToolCall
    | ResponsesAPI.ResponseComputerToolCall
    | ResponseItemList.ComputerCallOutput
    | ResponsesAPI.ResponseFunctionWebSearch
    | ResponsesAPI.ResponseFunctionToolCall
    | ResponseItemList.FunctionCallOutput
  > {
    if (isRequestOptions(query)) {
      return this.list(responseId, {}, query);
    }
    return this._client.getAPIList(`/responses/${responseId}/input_items`, ResponseItemListDataPage, {
      query,
      ...options,
    });
  }
}

export class ResponseItemListDataPage extends CursorPage<
  | ResponseItemList.Message
  | ResponsesAPI.ResponseOutputMessage
  | ResponsesAPI.ResponseFileSearchToolCall
  | ResponsesAPI.ResponseComputerToolCall
  | ResponseItemList.ComputerCallOutput
  | ResponsesAPI.ResponseFunctionWebSearch
  | ResponsesAPI.ResponseFunctionToolCall
  | ResponseItemList.FunctionCallOutput
> {}

/**
 * A list of Response items.
 */
export interface ResponseItemList {
  /**
   * A list of items used to generate this response.
   */
  data: Array<
    | ResponseItemList.Message
    | ResponsesAPI.ResponseOutputMessage
    | ResponsesAPI.ResponseFileSearchToolCall
    | ResponsesAPI.ResponseComputerToolCall
    | ResponseItemList.ComputerCallOutput
    | ResponsesAPI.ResponseFunctionWebSearch
    | ResponsesAPI.ResponseFunctionToolCall
    | ResponseItemList.FunctionCallOutput
  >;

  /**
   * The ID of the first item in the list.
   */
  first_id: string;

  /**
   * Whether there are more items available.
   */
  has_more: boolean;

  /**
   * The ID of the last item in the list.
   */
  last_id: string;

  /**
   * The type of object returned, must be `list`.
   */
  object: 'list';
}

export namespace ResponseItemList {
  export interface Message {
    /**
     * The unique ID of the message input.
     */
    id: string;

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

  export interface ComputerCallOutput {
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
    output: ComputerCallOutput.Output;

    /**
     * The type of the computer tool call output. Always `computer_call_output`.
     */
    type: 'computer_call_output';

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
     * A computer screenshot image used with the computer use tool.
     */
    export interface Output {
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

  export interface FunctionCallOutput {
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
}

export interface InputItemListParams extends CursorPageParams {
  /**
   * An item ID to list items before, used in pagination.
   */
  before?: string;

  /**
   * The order to return the input items in. Default is `asc`.
   *
   * - `asc`: Return the input items in ascending order.
   * - `desc`: Return the input items in descending order.
   */
  order?: 'asc' | 'desc';
}

InputItems.ResponseItemListDataPage = ResponseItemListDataPage;

export declare namespace InputItems {
  export {
    type ResponseItemList as ResponseItemList,
    ResponseItemListDataPage as ResponseItemListDataPage,
    type InputItemListParams as InputItemListParams,
  };
}
