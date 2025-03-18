// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as ResponsesAPI from './responses';
import { ResponseItemsPage } from './responses';
import { CursorPage, type CursorPageParams, PagePromise } from '../../pagination';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class InputItems extends APIResource {
  /**
   * Returns a list of input items for a given response.
   */
  list(
    responseID: string,
    query: InputItemListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ResponseItemsPage, ResponsesAPI.ResponseItem> {
    return this._client.getAPIList(
      path`/responses/${responseID}/input_items`,
      CursorPage<ResponsesAPI.ResponseItem>,
      { query, ...options },
    );
  }
}

/**
 * A list of Response items.
 */
export interface ResponseItemList {
  /**
   * A list of items used to generate this response.
   */
  data: Array<ResponsesAPI.ResponseItem>;

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

export declare namespace InputItems {
  export { type ResponseItemList as ResponseItemList, type InputItemListParams as InputItemListParams };
}

export { type ResponseItemsPage };
