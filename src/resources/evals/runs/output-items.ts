// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as RunsAPI from './runs';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class OutputItems extends APIResource {
  /**
   * Get an evaluation run output item by ID.
   */
  retrieve(
    outputItemID: string,
    params: OutputItemRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<OutputItemRetrieveResponse> {
    const { eval_id, run_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${run_id}/output_items/${outputItemID}`, options);
  }

  /**
   * Get a list of output items for an evaluation run.
   */
  list(
    runID: string,
    params: OutputItemListParams,
    options?: RequestOptions,
  ): PagePromise<OutputItemListResponsesPage, OutputItemListResponse> {
    const { eval_id, ...query } = params;
    return this._client.getAPIList(
      path`/evals/${eval_id}/runs/${runID}/output_items`,
      CursorPage<OutputItemListResponse>,
      { query, ...options },
    );
  }
}

export type OutputItemListResponsesPage = CursorPage<OutputItemListResponse>;

/**
 * A schema representing an evaluation run output item.
 */
export interface OutputItemRetrieveResponse {
  /**
   * Unique identifier for the evaluation run output item.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Details of the input data source item.
   */
  datasource_item: Record<string, unknown>;

  /**
   * The identifier for the data source item.
   */
  datasource_item_id: number;

  /**
   * The identifier of the evaluation group.
   */
  eval_id: string;

  /**
   * The type of the object. Always "eval.run.output_item".
   */
  object: 'eval.run.output_item';

  /**
   * A list of results from the evaluation run.
   */
  results: Array<Record<string, unknown>>;

  /**
   * The identifier of the evaluation run associated with this output item.
   */
  run_id: string;

  /**
   * A sample containing the input and output of the evaluation run.
   */
  sample: OutputItemRetrieveResponse.Sample;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace OutputItemRetrieveResponse {
  /**
   * A sample containing the input and output of the evaluation run.
   */
  export interface Sample {
    /**
     * An object representing an error response from the Eval API.
     */
    error: RunsAPI.EvalAPIError;

    /**
     * The reason why the sample generation was finished.
     */
    finish_reason: string;

    /**
     * An array of input messages.
     */
    input: Array<Sample.Input>;

    /**
     * The maximum number of tokens allowed for completion.
     */
    max_completion_tokens: number;

    /**
     * The model used for generating the sample.
     */
    model: string;

    /**
     * An array of output messages.
     */
    output: Array<Sample.Output>;

    /**
     * The seed used for generating the sample.
     */
    seed: number;

    /**
     * The sampling temperature used.
     */
    temperature: number;

    /**
     * The top_p value used for sampling.
     */
    top_p: number;

    /**
     * Token usage details for the sample.
     */
    usage: Sample.Usage;
  }

  export namespace Sample {
    /**
     * An input message.
     */
    export interface Input {
      /**
       * The content of the message.
       */
      content: string;

      /**
       * The role of the message sender (e.g., system, user, developer).
       */
      role: string;
    }

    export interface Output {
      /**
       * The content of the message.
       */
      content?: string;

      /**
       * The role of the message (e.g. "system", "assistant", "user").
       */
      role?: string;
    }

    /**
     * Token usage details for the sample.
     */
    export interface Usage {
      /**
       * The number of tokens retrieved from cache.
       */
      cached_tokens: number;

      /**
       * The number of completion tokens generated.
       */
      completion_tokens: number;

      /**
       * The number of prompt tokens used.
       */
      prompt_tokens: number;

      /**
       * The total number of tokens used.
       */
      total_tokens: number;
    }
  }
}

/**
 * A schema representing an evaluation run output item.
 */
export interface OutputItemListResponse {
  /**
   * Unique identifier for the evaluation run output item.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Details of the input data source item.
   */
  datasource_item: Record<string, unknown>;

  /**
   * The identifier for the data source item.
   */
  datasource_item_id: number;

  /**
   * The identifier of the evaluation group.
   */
  eval_id: string;

  /**
   * The type of the object. Always "eval.run.output_item".
   */
  object: 'eval.run.output_item';

  /**
   * A list of results from the evaluation run.
   */
  results: Array<Record<string, unknown>>;

  /**
   * The identifier of the evaluation run associated with this output item.
   */
  run_id: string;

  /**
   * A sample containing the input and output of the evaluation run.
   */
  sample: OutputItemListResponse.Sample;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace OutputItemListResponse {
  /**
   * A sample containing the input and output of the evaluation run.
   */
  export interface Sample {
    /**
     * An object representing an error response from the Eval API.
     */
    error: RunsAPI.EvalAPIError;

    /**
     * The reason why the sample generation was finished.
     */
    finish_reason: string;

    /**
     * An array of input messages.
     */
    input: Array<Sample.Input>;

    /**
     * The maximum number of tokens allowed for completion.
     */
    max_completion_tokens: number;

    /**
     * The model used for generating the sample.
     */
    model: string;

    /**
     * An array of output messages.
     */
    output: Array<Sample.Output>;

    /**
     * The seed used for generating the sample.
     */
    seed: number;

    /**
     * The sampling temperature used.
     */
    temperature: number;

    /**
     * The top_p value used for sampling.
     */
    top_p: number;

    /**
     * Token usage details for the sample.
     */
    usage: Sample.Usage;
  }

  export namespace Sample {
    /**
     * An input message.
     */
    export interface Input {
      /**
       * The content of the message.
       */
      content: string;

      /**
       * The role of the message sender (e.g., system, user, developer).
       */
      role: string;
    }

    export interface Output {
      /**
       * The content of the message.
       */
      content?: string;

      /**
       * The role of the message (e.g. "system", "assistant", "user").
       */
      role?: string;
    }

    /**
     * Token usage details for the sample.
     */
    export interface Usage {
      /**
       * The number of tokens retrieved from cache.
       */
      cached_tokens: number;

      /**
       * The number of completion tokens generated.
       */
      completion_tokens: number;

      /**
       * The number of prompt tokens used.
       */
      prompt_tokens: number;

      /**
       * The total number of tokens used.
       */
      total_tokens: number;
    }
  }
}

export interface OutputItemRetrieveParams {
  /**
   * The ID of the evaluation to retrieve runs for.
   */
  eval_id: string;

  /**
   * The ID of the run to retrieve.
   */
  run_id: string;
}

export interface OutputItemListParams extends CursorPageParams {
  /**
   * Path param: The ID of the evaluation to retrieve runs for.
   */
  eval_id: string;

  /**
   * Query param: Sort order for output items by timestamp. Use `asc` for ascending
   * order or `desc` for descending order. Defaults to `asc`.
   */
  order?: 'asc' | 'desc';

  /**
   * Query param: Filter output items by status. Use `failed` to filter by failed
   * output items or `pass` to filter by passed output items.
   */
  status?: 'fail' | 'pass';
}

export declare namespace OutputItems {
  export {
    type OutputItemRetrieveResponse as OutputItemRetrieveResponse,
    type OutputItemListResponse as OutputItemListResponse,
    type OutputItemListResponsesPage as OutputItemListResponsesPage,
    type OutputItemRetrieveParams as OutputItemRetrieveParams,
    type OutputItemListParams as OutputItemListParams,
  };
}
