// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import { isRequestOptions } from '../../../core';
import * as Core from '../../../core';
import * as Shared from '../../shared';
import * as ResponsesAPI from '../../responses/responses';
import * as OutputItemsAPI from './output-items';
import {
  OutputItemListParams,
  OutputItemListResponse,
  OutputItemListResponsesPage,
  OutputItemRetrieveResponse,
  OutputItems,
} from './output-items';
import { CursorPage, type CursorPageParams } from '../../../pagination';

export class Runs extends APIResource {
  outputItems: OutputItemsAPI.OutputItems = new OutputItemsAPI.OutputItems(this._client);

  /**
   * Create a new evaluation run. This is the endpoint that will kick off grading.
   */
  create(
    evalId: string,
    body: RunCreateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunCreateResponse> {
    return this._client.post(`/evals/${evalId}/runs`, { body, ...options });
  }

  /**
   * Get an evaluation run by ID.
   */
  retrieve(
    evalId: string,
    runId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunRetrieveResponse> {
    return this._client.get(`/evals/${evalId}/runs/${runId}`, options);
  }

  /**
   * Get a list of runs for an evaluation.
   */
  list(
    evalId: string,
    query?: RunListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunListResponsesPage, RunListResponse>;
  list(
    evalId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunListResponsesPage, RunListResponse>;
  list(
    evalId: string,
    query: RunListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunListResponsesPage, RunListResponse> {
    if (isRequestOptions(query)) {
      return this.list(evalId, {}, query);
    }
    return this._client.getAPIList(`/evals/${evalId}/runs`, RunListResponsesPage, { query, ...options });
  }

  /**
   * Delete an eval run.
   */
  del(evalId: string, runId: string, options?: Core.RequestOptions): Core.APIPromise<RunDeleteResponse> {
    return this._client.delete(`/evals/${evalId}/runs/${runId}`, options);
  }

  /**
   * Cancel an ongoing evaluation run.
   */
  cancel(evalId: string, runId: string, options?: Core.RequestOptions): Core.APIPromise<RunCancelResponse> {
    return this._client.post(`/evals/${evalId}/runs/${runId}`, options);
  }
}

export class RunListResponsesPage extends CursorPage<RunListResponse> {}

/**
 * A CompletionsRunDataSource object describing a model sampling configuration.
 */
export interface CreateEvalCompletionsRunDataSource {
  /**
   * A StoredCompletionsRunDataSource configuration describing a set of filters
   */
  source:
    | CreateEvalCompletionsRunDataSource.FileContent
    | CreateEvalCompletionsRunDataSource.FileID
    | CreateEvalCompletionsRunDataSource.StoredCompletions;

  /**
   * The type of run data source. Always `completions`.
   */
  type: 'completions';

  input_messages?:
    | CreateEvalCompletionsRunDataSource.Template
    | CreateEvalCompletionsRunDataSource.ItemReference;

  /**
   * The name of the model to use for generating completions (e.g. "o3-mini").
   */
  model?: string;

  sampling_params?: CreateEvalCompletionsRunDataSource.SamplingParams;
}

export namespace CreateEvalCompletionsRunDataSource {
  export interface FileContent {
    /**
     * The content of the jsonl file.
     */
    content: Array<FileContent.Content>;

    /**
     * The type of jsonl source. Always `file_content`.
     */
    type: 'file_content';
  }

  export namespace FileContent {
    export interface Content {
      item: Record<string, unknown>;

      sample?: Record<string, unknown>;
    }
  }

  export interface FileID {
    /**
     * The identifier of the file.
     */
    id: string;

    /**
     * The type of jsonl source. Always `file_id`.
     */
    type: 'file_id';
  }

  /**
   * A StoredCompletionsRunDataSource configuration describing a set of filters
   */
  export interface StoredCompletions {
    /**
     * The type of source. Always `stored_completions`.
     */
    type: 'stored_completions';

    /**
     * An optional Unix timestamp to filter items created after this time.
     */
    created_after?: number | null;

    /**
     * An optional Unix timestamp to filter items created before this time.
     */
    created_before?: number | null;

    /**
     * An optional maximum number of items to return.
     */
    limit?: number | null;

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
     * An optional model to filter by (e.g., 'gpt-4o').
     */
    model?: string | null;
  }

  export interface Template {
    /**
     * A list of chat messages forming the prompt or context. May include variable
     * references to the "item" namespace, ie {{item.name}}.
     */
    template: Array<ResponsesAPI.EasyInputMessage | Template.Message>;

    /**
     * The type of input messages. Always `template`.
     */
    type: 'template';
  }

  export namespace Template {
    /**
     * A message input to the model with a role indicating instruction following
     * hierarchy. Instructions given with the `developer` or `system` role take
     * precedence over instructions given with the `user` role. Messages with the
     * `assistant` role are presumed to have been generated by the model in previous
     * interactions.
     */
    export interface Message {
      /**
       * Text inputs to the model - can contain template strings.
       */
      content: string | ResponsesAPI.ResponseInputText | Message.OutputText;

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

    export namespace Message {
      /**
       * A text output from the model.
       */
      export interface OutputText {
        /**
         * The text output from the model.
         */
        text: string;

        /**
         * The type of the output text. Always `output_text`.
         */
        type: 'output_text';
      }
    }
  }

  export interface ItemReference {
    /**
     * A reference to a variable in the "item" namespace. Ie, "item.name"
     */
    item_reference: string;

    /**
     * The type of input messages. Always `item_reference`.
     */
    type: 'item_reference';
  }

  export interface SamplingParams {
    /**
     * The maximum number of tokens in the generated output.
     */
    max_completion_tokens?: number;

    /**
     * A seed value to initialize the randomness, during sampling.
     */
    seed?: number;

    /**
     * A higher temperature increases randomness in the outputs.
     */
    temperature?: number;

    /**
     * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
     */
    top_p?: number;
  }
}

/**
 * A JsonlRunDataSource object with that specifies a JSONL file that matches the
 * eval
 */
export interface CreateEvalJSONLRunDataSource {
  source: CreateEvalJSONLRunDataSource.FileContent | CreateEvalJSONLRunDataSource.FileID;

  /**
   * The type of data source. Always `jsonl`.
   */
  type: 'jsonl';
}

export namespace CreateEvalJSONLRunDataSource {
  export interface FileContent {
    /**
     * The content of the jsonl file.
     */
    content: Array<FileContent.Content>;

    /**
     * The type of jsonl source. Always `file_content`.
     */
    type: 'file_content';
  }

  export namespace FileContent {
    export interface Content {
      item: Record<string, unknown>;

      sample?: Record<string, unknown>;
    }
  }

  export interface FileID {
    /**
     * The identifier of the file.
     */
    id: string;

    /**
     * The type of jsonl source. Always `file_id`.
     */
    type: 'file_id';
  }
}

/**
 * An object representing an error response from the Eval API.
 */
export interface EvalAPIError {
  /**
   * The error code.
   */
  code: string;

  /**
   * The error message.
   */
  message: string;
}

/**
 * A schema representing an evaluation run.
 */
export interface RunCreateResponse {
  /**
   * Unique identifier for the evaluation run.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Information about the run's data source.
   */
  data_source:
    | CreateEvalJSONLRunDataSource
    | CreateEvalCompletionsRunDataSource
    | RunCreateResponse.Completions;

  /**
   * An object representing an error response from the Eval API.
   */
  error: EvalAPIError;

  /**
   * The identifier of the associated evaluation.
   */
  eval_id: string;

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
   * The model that is evaluated, if applicable.
   */
  model: string;

  /**
   * The name of the evaluation run.
   */
  name: string;

  /**
   * The type of the object. Always "eval.run".
   */
  object: 'eval.run';

  /**
   * Usage statistics for each model during the evaluation run.
   */
  per_model_usage: Array<RunCreateResponse.PerModelUsage>;

  /**
   * Results per testing criteria applied during the evaluation run.
   */
  per_testing_criteria_results: Array<RunCreateResponse.PerTestingCriteriaResult>;

  /**
   * The URL to the rendered evaluation run report on the UI dashboard.
   */
  report_url: string;

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  result_counts: RunCreateResponse.ResultCounts;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace RunCreateResponse {
  /**
   * A ResponsesRunDataSource object describing a model sampling configuration.
   */
  export interface Completions {
    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    source: Completions.FileContent | Completions.FileID | Completions.Responses;

    /**
     * The type of run data source. Always `completions`.
     */
    type: 'completions';

    input_messages?: Completions.Template | Completions.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Completions.SamplingParams;
  }

  export namespace Completions {
    export interface FileContent {
      /**
       * The content of the jsonl file.
       */
      content: Array<FileContent.Content>;

      /**
       * The type of jsonl source. Always `file_content`.
       */
      type: 'file_content';
    }

    export namespace FileContent {
      export interface Content {
        item: Record<string, unknown>;

        sample?: Record<string, unknown>;
      }
    }

    export interface FileID {
      /**
       * The identifier of the file.
       */
      id: string;

      /**
       * The type of jsonl source. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    export interface Responses {
      /**
       * The type of run data source. Always `responses`.
       */
      type: 'responses';

      /**
       * Whether to allow parallel tool calls. This is a query parameter used to select
       * responses.
       */
      allow_parallel_tool_calls?: boolean | null;

      /**
       * Only include items created after this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_after?: number | null;

      /**
       * Only include items created before this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_before?: number | null;

      /**
       * Whether the response has tool calls. This is a query parameter used to select
       * responses.
       */
      has_tool_calls?: boolean | null;

      /**
       * Optional search string for instructions. This is a query parameter used to
       * select responses.
       */
      instructions_search?: string | null;

      /**
       * Metadata filter for the responses. This is a query parameter used to select
       * responses.
       */
      metadata?: unknown | null;

      /**
       * The name of the model to find responses for. This is a query parameter used to
       * select responses.
       */
      model?: string | null;

      /**
       * Optional reasoning effort parameter. This is a query parameter used to select
       * responses.
       */
      reasoning_effort?: Shared.ReasoningEffort | null;

      /**
       * Sampling temperature. This is a query parameter used to select responses.
       */
      temperature?: number | null;

      /**
       * Nucleus sampling parameter. This is a query parameter used to select responses.
       */
      top_p?: number | null;

      /**
       * List of user identifiers. This is a query parameter used to select responses.
       */
      users?: Array<string> | null;
    }

    export interface Template {
      /**
       * A list of chat messages forming the prompt or context. May include variable
       * references to the "item" namespace, ie {{item.name}}.
       */
      template: Array<Template.ChatMessage | Template.EvalItem>;

      /**
       * The type of input messages. Always `template`.
       */
      type: 'template';
    }

    export namespace Template {
      export interface ChatMessage {
        /**
         * The content of the message.
         */
        content: string;

        /**
         * The role of the message (e.g. "system", "assistant", "user").
         */
        role: string;
      }

      /**
       * A message input to the model with a role indicating instruction following
       * hierarchy. Instructions given with the `developer` or `system` role take
       * precedence over instructions given with the `user` role. Messages with the
       * `assistant` role are presumed to have been generated by the model in previous
       * interactions.
       */
      export interface EvalItem {
        /**
         * Text inputs to the model - can contain template strings.
         */
        content: string | ResponsesAPI.ResponseInputText | EvalItem.OutputText;

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

      export namespace EvalItem {
        /**
         * A text output from the model.
         */
        export interface OutputText {
          /**
           * The text output from the model.
           */
          text: string;

          /**
           * The type of the output text. Always `output_text`.
           */
          type: 'output_text';
        }
      }
    }

    export interface ItemReference {
      /**
       * A reference to a variable in the "item" namespace. Ie, "item.name"
       */
      item_reference: string;

      /**
       * The type of input messages. Always `item_reference`.
       */
      type: 'item_reference';
    }

    export interface SamplingParams {
      /**
       * The maximum number of tokens in the generated output.
       */
      max_completion_tokens?: number;

      /**
       * A seed value to initialize the randomness, during sampling.
       */
      seed?: number;

      /**
       * A higher temperature increases randomness in the outputs.
       */
      temperature?: number;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }
  }

  export interface PerModelUsage {
    /**
     * The number of tokens retrieved from cache.
     */
    cached_tokens: number;

    /**
     * The number of completion tokens generated.
     */
    completion_tokens: number;

    /**
     * The number of invocations.
     */
    invocation_count: number;

    /**
     * The name of the model.
     */
    model_name: string;

    /**
     * The number of prompt tokens used.
     */
    prompt_tokens: number;

    /**
     * The total number of tokens used.
     */
    total_tokens: number;
  }

  export interface PerTestingCriteriaResult {
    /**
     * Number of tests failed for this criteria.
     */
    failed: number;

    /**
     * Number of tests passed for this criteria.
     */
    passed: number;

    /**
     * A description of the testing criteria.
     */
    testing_criteria: string;
  }

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  export interface ResultCounts {
    /**
     * Number of output items that resulted in an error.
     */
    errored: number;

    /**
     * Number of output items that failed to pass the evaluation.
     */
    failed: number;

    /**
     * Number of output items that passed the evaluation.
     */
    passed: number;

    /**
     * Total number of executed output items.
     */
    total: number;
  }
}

/**
 * A schema representing an evaluation run.
 */
export interface RunRetrieveResponse {
  /**
   * Unique identifier for the evaluation run.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Information about the run's data source.
   */
  data_source:
    | CreateEvalJSONLRunDataSource
    | CreateEvalCompletionsRunDataSource
    | RunRetrieveResponse.Completions;

  /**
   * An object representing an error response from the Eval API.
   */
  error: EvalAPIError;

  /**
   * The identifier of the associated evaluation.
   */
  eval_id: string;

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
   * The model that is evaluated, if applicable.
   */
  model: string;

  /**
   * The name of the evaluation run.
   */
  name: string;

  /**
   * The type of the object. Always "eval.run".
   */
  object: 'eval.run';

  /**
   * Usage statistics for each model during the evaluation run.
   */
  per_model_usage: Array<RunRetrieveResponse.PerModelUsage>;

  /**
   * Results per testing criteria applied during the evaluation run.
   */
  per_testing_criteria_results: Array<RunRetrieveResponse.PerTestingCriteriaResult>;

  /**
   * The URL to the rendered evaluation run report on the UI dashboard.
   */
  report_url: string;

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  result_counts: RunRetrieveResponse.ResultCounts;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace RunRetrieveResponse {
  /**
   * A ResponsesRunDataSource object describing a model sampling configuration.
   */
  export interface Completions {
    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    source: Completions.FileContent | Completions.FileID | Completions.Responses;

    /**
     * The type of run data source. Always `completions`.
     */
    type: 'completions';

    input_messages?: Completions.Template | Completions.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Completions.SamplingParams;
  }

  export namespace Completions {
    export interface FileContent {
      /**
       * The content of the jsonl file.
       */
      content: Array<FileContent.Content>;

      /**
       * The type of jsonl source. Always `file_content`.
       */
      type: 'file_content';
    }

    export namespace FileContent {
      export interface Content {
        item: Record<string, unknown>;

        sample?: Record<string, unknown>;
      }
    }

    export interface FileID {
      /**
       * The identifier of the file.
       */
      id: string;

      /**
       * The type of jsonl source. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    export interface Responses {
      /**
       * The type of run data source. Always `responses`.
       */
      type: 'responses';

      /**
       * Whether to allow parallel tool calls. This is a query parameter used to select
       * responses.
       */
      allow_parallel_tool_calls?: boolean | null;

      /**
       * Only include items created after this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_after?: number | null;

      /**
       * Only include items created before this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_before?: number | null;

      /**
       * Whether the response has tool calls. This is a query parameter used to select
       * responses.
       */
      has_tool_calls?: boolean | null;

      /**
       * Optional search string for instructions. This is a query parameter used to
       * select responses.
       */
      instructions_search?: string | null;

      /**
       * Metadata filter for the responses. This is a query parameter used to select
       * responses.
       */
      metadata?: unknown | null;

      /**
       * The name of the model to find responses for. This is a query parameter used to
       * select responses.
       */
      model?: string | null;

      /**
       * Optional reasoning effort parameter. This is a query parameter used to select
       * responses.
       */
      reasoning_effort?: Shared.ReasoningEffort | null;

      /**
       * Sampling temperature. This is a query parameter used to select responses.
       */
      temperature?: number | null;

      /**
       * Nucleus sampling parameter. This is a query parameter used to select responses.
       */
      top_p?: number | null;

      /**
       * List of user identifiers. This is a query parameter used to select responses.
       */
      users?: Array<string> | null;
    }

    export interface Template {
      /**
       * A list of chat messages forming the prompt or context. May include variable
       * references to the "item" namespace, ie {{item.name}}.
       */
      template: Array<Template.ChatMessage | Template.EvalItem>;

      /**
       * The type of input messages. Always `template`.
       */
      type: 'template';
    }

    export namespace Template {
      export interface ChatMessage {
        /**
         * The content of the message.
         */
        content: string;

        /**
         * The role of the message (e.g. "system", "assistant", "user").
         */
        role: string;
      }

      /**
       * A message input to the model with a role indicating instruction following
       * hierarchy. Instructions given with the `developer` or `system` role take
       * precedence over instructions given with the `user` role. Messages with the
       * `assistant` role are presumed to have been generated by the model in previous
       * interactions.
       */
      export interface EvalItem {
        /**
         * Text inputs to the model - can contain template strings.
         */
        content: string | ResponsesAPI.ResponseInputText | EvalItem.OutputText;

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

      export namespace EvalItem {
        /**
         * A text output from the model.
         */
        export interface OutputText {
          /**
           * The text output from the model.
           */
          text: string;

          /**
           * The type of the output text. Always `output_text`.
           */
          type: 'output_text';
        }
      }
    }

    export interface ItemReference {
      /**
       * A reference to a variable in the "item" namespace. Ie, "item.name"
       */
      item_reference: string;

      /**
       * The type of input messages. Always `item_reference`.
       */
      type: 'item_reference';
    }

    export interface SamplingParams {
      /**
       * The maximum number of tokens in the generated output.
       */
      max_completion_tokens?: number;

      /**
       * A seed value to initialize the randomness, during sampling.
       */
      seed?: number;

      /**
       * A higher temperature increases randomness in the outputs.
       */
      temperature?: number;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }
  }

  export interface PerModelUsage {
    /**
     * The number of tokens retrieved from cache.
     */
    cached_tokens: number;

    /**
     * The number of completion tokens generated.
     */
    completion_tokens: number;

    /**
     * The number of invocations.
     */
    invocation_count: number;

    /**
     * The name of the model.
     */
    model_name: string;

    /**
     * The number of prompt tokens used.
     */
    prompt_tokens: number;

    /**
     * The total number of tokens used.
     */
    total_tokens: number;
  }

  export interface PerTestingCriteriaResult {
    /**
     * Number of tests failed for this criteria.
     */
    failed: number;

    /**
     * Number of tests passed for this criteria.
     */
    passed: number;

    /**
     * A description of the testing criteria.
     */
    testing_criteria: string;
  }

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  export interface ResultCounts {
    /**
     * Number of output items that resulted in an error.
     */
    errored: number;

    /**
     * Number of output items that failed to pass the evaluation.
     */
    failed: number;

    /**
     * Number of output items that passed the evaluation.
     */
    passed: number;

    /**
     * Total number of executed output items.
     */
    total: number;
  }
}

/**
 * A schema representing an evaluation run.
 */
export interface RunListResponse {
  /**
   * Unique identifier for the evaluation run.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Information about the run's data source.
   */
  data_source:
    | CreateEvalJSONLRunDataSource
    | CreateEvalCompletionsRunDataSource
    | RunListResponse.Completions;

  /**
   * An object representing an error response from the Eval API.
   */
  error: EvalAPIError;

  /**
   * The identifier of the associated evaluation.
   */
  eval_id: string;

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
   * The model that is evaluated, if applicable.
   */
  model: string;

  /**
   * The name of the evaluation run.
   */
  name: string;

  /**
   * The type of the object. Always "eval.run".
   */
  object: 'eval.run';

  /**
   * Usage statistics for each model during the evaluation run.
   */
  per_model_usage: Array<RunListResponse.PerModelUsage>;

  /**
   * Results per testing criteria applied during the evaluation run.
   */
  per_testing_criteria_results: Array<RunListResponse.PerTestingCriteriaResult>;

  /**
   * The URL to the rendered evaluation run report on the UI dashboard.
   */
  report_url: string;

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  result_counts: RunListResponse.ResultCounts;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace RunListResponse {
  /**
   * A ResponsesRunDataSource object describing a model sampling configuration.
   */
  export interface Completions {
    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    source: Completions.FileContent | Completions.FileID | Completions.Responses;

    /**
     * The type of run data source. Always `completions`.
     */
    type: 'completions';

    input_messages?: Completions.Template | Completions.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Completions.SamplingParams;
  }

  export namespace Completions {
    export interface FileContent {
      /**
       * The content of the jsonl file.
       */
      content: Array<FileContent.Content>;

      /**
       * The type of jsonl source. Always `file_content`.
       */
      type: 'file_content';
    }

    export namespace FileContent {
      export interface Content {
        item: Record<string, unknown>;

        sample?: Record<string, unknown>;
      }
    }

    export interface FileID {
      /**
       * The identifier of the file.
       */
      id: string;

      /**
       * The type of jsonl source. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    export interface Responses {
      /**
       * The type of run data source. Always `responses`.
       */
      type: 'responses';

      /**
       * Whether to allow parallel tool calls. This is a query parameter used to select
       * responses.
       */
      allow_parallel_tool_calls?: boolean | null;

      /**
       * Only include items created after this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_after?: number | null;

      /**
       * Only include items created before this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_before?: number | null;

      /**
       * Whether the response has tool calls. This is a query parameter used to select
       * responses.
       */
      has_tool_calls?: boolean | null;

      /**
       * Optional search string for instructions. This is a query parameter used to
       * select responses.
       */
      instructions_search?: string | null;

      /**
       * Metadata filter for the responses. This is a query parameter used to select
       * responses.
       */
      metadata?: unknown | null;

      /**
       * The name of the model to find responses for. This is a query parameter used to
       * select responses.
       */
      model?: string | null;

      /**
       * Optional reasoning effort parameter. This is a query parameter used to select
       * responses.
       */
      reasoning_effort?: Shared.ReasoningEffort | null;

      /**
       * Sampling temperature. This is a query parameter used to select responses.
       */
      temperature?: number | null;

      /**
       * Nucleus sampling parameter. This is a query parameter used to select responses.
       */
      top_p?: number | null;

      /**
       * List of user identifiers. This is a query parameter used to select responses.
       */
      users?: Array<string> | null;
    }

    export interface Template {
      /**
       * A list of chat messages forming the prompt or context. May include variable
       * references to the "item" namespace, ie {{item.name}}.
       */
      template: Array<Template.ChatMessage | Template.EvalItem>;

      /**
       * The type of input messages. Always `template`.
       */
      type: 'template';
    }

    export namespace Template {
      export interface ChatMessage {
        /**
         * The content of the message.
         */
        content: string;

        /**
         * The role of the message (e.g. "system", "assistant", "user").
         */
        role: string;
      }

      /**
       * A message input to the model with a role indicating instruction following
       * hierarchy. Instructions given with the `developer` or `system` role take
       * precedence over instructions given with the `user` role. Messages with the
       * `assistant` role are presumed to have been generated by the model in previous
       * interactions.
       */
      export interface EvalItem {
        /**
         * Text inputs to the model - can contain template strings.
         */
        content: string | ResponsesAPI.ResponseInputText | EvalItem.OutputText;

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

      export namespace EvalItem {
        /**
         * A text output from the model.
         */
        export interface OutputText {
          /**
           * The text output from the model.
           */
          text: string;

          /**
           * The type of the output text. Always `output_text`.
           */
          type: 'output_text';
        }
      }
    }

    export interface ItemReference {
      /**
       * A reference to a variable in the "item" namespace. Ie, "item.name"
       */
      item_reference: string;

      /**
       * The type of input messages. Always `item_reference`.
       */
      type: 'item_reference';
    }

    export interface SamplingParams {
      /**
       * The maximum number of tokens in the generated output.
       */
      max_completion_tokens?: number;

      /**
       * A seed value to initialize the randomness, during sampling.
       */
      seed?: number;

      /**
       * A higher temperature increases randomness in the outputs.
       */
      temperature?: number;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }
  }

  export interface PerModelUsage {
    /**
     * The number of tokens retrieved from cache.
     */
    cached_tokens: number;

    /**
     * The number of completion tokens generated.
     */
    completion_tokens: number;

    /**
     * The number of invocations.
     */
    invocation_count: number;

    /**
     * The name of the model.
     */
    model_name: string;

    /**
     * The number of prompt tokens used.
     */
    prompt_tokens: number;

    /**
     * The total number of tokens used.
     */
    total_tokens: number;
  }

  export interface PerTestingCriteriaResult {
    /**
     * Number of tests failed for this criteria.
     */
    failed: number;

    /**
     * Number of tests passed for this criteria.
     */
    passed: number;

    /**
     * A description of the testing criteria.
     */
    testing_criteria: string;
  }

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  export interface ResultCounts {
    /**
     * Number of output items that resulted in an error.
     */
    errored: number;

    /**
     * Number of output items that failed to pass the evaluation.
     */
    failed: number;

    /**
     * Number of output items that passed the evaluation.
     */
    passed: number;

    /**
     * Total number of executed output items.
     */
    total: number;
  }
}

export interface RunDeleteResponse {
  deleted?: boolean;

  object?: string;

  run_id?: string;
}

/**
 * A schema representing an evaluation run.
 */
export interface RunCancelResponse {
  /**
   * Unique identifier for the evaluation run.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the evaluation run was created.
   */
  created_at: number;

  /**
   * Information about the run's data source.
   */
  data_source:
    | CreateEvalJSONLRunDataSource
    | CreateEvalCompletionsRunDataSource
    | RunCancelResponse.Completions;

  /**
   * An object representing an error response from the Eval API.
   */
  error: EvalAPIError;

  /**
   * The identifier of the associated evaluation.
   */
  eval_id: string;

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
   * The model that is evaluated, if applicable.
   */
  model: string;

  /**
   * The name of the evaluation run.
   */
  name: string;

  /**
   * The type of the object. Always "eval.run".
   */
  object: 'eval.run';

  /**
   * Usage statistics for each model during the evaluation run.
   */
  per_model_usage: Array<RunCancelResponse.PerModelUsage>;

  /**
   * Results per testing criteria applied during the evaluation run.
   */
  per_testing_criteria_results: Array<RunCancelResponse.PerTestingCriteriaResult>;

  /**
   * The URL to the rendered evaluation run report on the UI dashboard.
   */
  report_url: string;

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  result_counts: RunCancelResponse.ResultCounts;

  /**
   * The status of the evaluation run.
   */
  status: string;
}

export namespace RunCancelResponse {
  /**
   * A ResponsesRunDataSource object describing a model sampling configuration.
   */
  export interface Completions {
    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    source: Completions.FileContent | Completions.FileID | Completions.Responses;

    /**
     * The type of run data source. Always `completions`.
     */
    type: 'completions';

    input_messages?: Completions.Template | Completions.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Completions.SamplingParams;
  }

  export namespace Completions {
    export interface FileContent {
      /**
       * The content of the jsonl file.
       */
      content: Array<FileContent.Content>;

      /**
       * The type of jsonl source. Always `file_content`.
       */
      type: 'file_content';
    }

    export namespace FileContent {
      export interface Content {
        item: Record<string, unknown>;

        sample?: Record<string, unknown>;
      }
    }

    export interface FileID {
      /**
       * The identifier of the file.
       */
      id: string;

      /**
       * The type of jsonl source. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    export interface Responses {
      /**
       * The type of run data source. Always `responses`.
       */
      type: 'responses';

      /**
       * Whether to allow parallel tool calls. This is a query parameter used to select
       * responses.
       */
      allow_parallel_tool_calls?: boolean | null;

      /**
       * Only include items created after this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_after?: number | null;

      /**
       * Only include items created before this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_before?: number | null;

      /**
       * Whether the response has tool calls. This is a query parameter used to select
       * responses.
       */
      has_tool_calls?: boolean | null;

      /**
       * Optional search string for instructions. This is a query parameter used to
       * select responses.
       */
      instructions_search?: string | null;

      /**
       * Metadata filter for the responses. This is a query parameter used to select
       * responses.
       */
      metadata?: unknown | null;

      /**
       * The name of the model to find responses for. This is a query parameter used to
       * select responses.
       */
      model?: string | null;

      /**
       * Optional reasoning effort parameter. This is a query parameter used to select
       * responses.
       */
      reasoning_effort?: Shared.ReasoningEffort | null;

      /**
       * Sampling temperature. This is a query parameter used to select responses.
       */
      temperature?: number | null;

      /**
       * Nucleus sampling parameter. This is a query parameter used to select responses.
       */
      top_p?: number | null;

      /**
       * List of user identifiers. This is a query parameter used to select responses.
       */
      users?: Array<string> | null;
    }

    export interface Template {
      /**
       * A list of chat messages forming the prompt or context. May include variable
       * references to the "item" namespace, ie {{item.name}}.
       */
      template: Array<Template.ChatMessage | Template.EvalItem>;

      /**
       * The type of input messages. Always `template`.
       */
      type: 'template';
    }

    export namespace Template {
      export interface ChatMessage {
        /**
         * The content of the message.
         */
        content: string;

        /**
         * The role of the message (e.g. "system", "assistant", "user").
         */
        role: string;
      }

      /**
       * A message input to the model with a role indicating instruction following
       * hierarchy. Instructions given with the `developer` or `system` role take
       * precedence over instructions given with the `user` role. Messages with the
       * `assistant` role are presumed to have been generated by the model in previous
       * interactions.
       */
      export interface EvalItem {
        /**
         * Text inputs to the model - can contain template strings.
         */
        content: string | ResponsesAPI.ResponseInputText | EvalItem.OutputText;

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

      export namespace EvalItem {
        /**
         * A text output from the model.
         */
        export interface OutputText {
          /**
           * The text output from the model.
           */
          text: string;

          /**
           * The type of the output text. Always `output_text`.
           */
          type: 'output_text';
        }
      }
    }

    export interface ItemReference {
      /**
       * A reference to a variable in the "item" namespace. Ie, "item.name"
       */
      item_reference: string;

      /**
       * The type of input messages. Always `item_reference`.
       */
      type: 'item_reference';
    }

    export interface SamplingParams {
      /**
       * The maximum number of tokens in the generated output.
       */
      max_completion_tokens?: number;

      /**
       * A seed value to initialize the randomness, during sampling.
       */
      seed?: number;

      /**
       * A higher temperature increases randomness in the outputs.
       */
      temperature?: number;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }
  }

  export interface PerModelUsage {
    /**
     * The number of tokens retrieved from cache.
     */
    cached_tokens: number;

    /**
     * The number of completion tokens generated.
     */
    completion_tokens: number;

    /**
     * The number of invocations.
     */
    invocation_count: number;

    /**
     * The name of the model.
     */
    model_name: string;

    /**
     * The number of prompt tokens used.
     */
    prompt_tokens: number;

    /**
     * The total number of tokens used.
     */
    total_tokens: number;
  }

  export interface PerTestingCriteriaResult {
    /**
     * Number of tests failed for this criteria.
     */
    failed: number;

    /**
     * Number of tests passed for this criteria.
     */
    passed: number;

    /**
     * A description of the testing criteria.
     */
    testing_criteria: string;
  }

  /**
   * Counters summarizing the outcomes of the evaluation run.
   */
  export interface ResultCounts {
    /**
     * Number of output items that resulted in an error.
     */
    errored: number;

    /**
     * Number of output items that failed to pass the evaluation.
     */
    failed: number;

    /**
     * Number of output items that passed the evaluation.
     */
    passed: number;

    /**
     * Total number of executed output items.
     */
    total: number;
  }
}

export interface RunCreateParams {
  /**
   * Details about the run's data source.
   */
  data_source:
    | CreateEvalJSONLRunDataSource
    | CreateEvalCompletionsRunDataSource
    | RunCreateParams.CreateEvalResponsesRunDataSource;

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
   * The name of the run.
   */
  name?: string;
}

export namespace RunCreateParams {
  /**
   * A ResponsesRunDataSource object describing a model sampling configuration.
   */
  export interface CreateEvalResponsesRunDataSource {
    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    source:
      | CreateEvalResponsesRunDataSource.FileContent
      | CreateEvalResponsesRunDataSource.FileID
      | CreateEvalResponsesRunDataSource.Responses;

    /**
     * The type of run data source. Always `completions`.
     */
    type: 'completions';

    input_messages?:
      | CreateEvalResponsesRunDataSource.Template
      | CreateEvalResponsesRunDataSource.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: CreateEvalResponsesRunDataSource.SamplingParams;
  }

  export namespace CreateEvalResponsesRunDataSource {
    export interface FileContent {
      /**
       * The content of the jsonl file.
       */
      content: Array<FileContent.Content>;

      /**
       * The type of jsonl source. Always `file_content`.
       */
      type: 'file_content';
    }

    export namespace FileContent {
      export interface Content {
        item: Record<string, unknown>;

        sample?: Record<string, unknown>;
      }
    }

    export interface FileID {
      /**
       * The identifier of the file.
       */
      id: string;

      /**
       * The type of jsonl source. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * A EvalResponsesSource object describing a run data source configuration.
     */
    export interface Responses {
      /**
       * The type of run data source. Always `responses`.
       */
      type: 'responses';

      /**
       * Whether to allow parallel tool calls. This is a query parameter used to select
       * responses.
       */
      allow_parallel_tool_calls?: boolean | null;

      /**
       * Only include items created after this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_after?: number | null;

      /**
       * Only include items created before this timestamp (inclusive). This is a query
       * parameter used to select responses.
       */
      created_before?: number | null;

      /**
       * Whether the response has tool calls. This is a query parameter used to select
       * responses.
       */
      has_tool_calls?: boolean | null;

      /**
       * Optional search string for instructions. This is a query parameter used to
       * select responses.
       */
      instructions_search?: string | null;

      /**
       * Metadata filter for the responses. This is a query parameter used to select
       * responses.
       */
      metadata?: unknown | null;

      /**
       * The name of the model to find responses for. This is a query parameter used to
       * select responses.
       */
      model?: string | null;

      /**
       * Optional reasoning effort parameter. This is a query parameter used to select
       * responses.
       */
      reasoning_effort?: Shared.ReasoningEffort | null;

      /**
       * Sampling temperature. This is a query parameter used to select responses.
       */
      temperature?: number | null;

      /**
       * Nucleus sampling parameter. This is a query parameter used to select responses.
       */
      top_p?: number | null;

      /**
       * List of user identifiers. This is a query parameter used to select responses.
       */
      users?: Array<string> | null;
    }

    export interface Template {
      /**
       * A list of chat messages forming the prompt or context. May include variable
       * references to the "item" namespace, ie {{item.name}}.
       */
      template: Array<Template.ChatMessage | Template.EvalItem>;

      /**
       * The type of input messages. Always `template`.
       */
      type: 'template';
    }

    export namespace Template {
      export interface ChatMessage {
        /**
         * The content of the message.
         */
        content: string;

        /**
         * The role of the message (e.g. "system", "assistant", "user").
         */
        role: string;
      }

      /**
       * A message input to the model with a role indicating instruction following
       * hierarchy. Instructions given with the `developer` or `system` role take
       * precedence over instructions given with the `user` role. Messages with the
       * `assistant` role are presumed to have been generated by the model in previous
       * interactions.
       */
      export interface EvalItem {
        /**
         * Text inputs to the model - can contain template strings.
         */
        content: string | ResponsesAPI.ResponseInputText | EvalItem.OutputText;

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

      export namespace EvalItem {
        /**
         * A text output from the model.
         */
        export interface OutputText {
          /**
           * The text output from the model.
           */
          text: string;

          /**
           * The type of the output text. Always `output_text`.
           */
          type: 'output_text';
        }
      }
    }

    export interface ItemReference {
      /**
       * A reference to a variable in the "item" namespace. Ie, "item.name"
       */
      item_reference: string;

      /**
       * The type of input messages. Always `item_reference`.
       */
      type: 'item_reference';
    }

    export interface SamplingParams {
      /**
       * The maximum number of tokens in the generated output.
       */
      max_completion_tokens?: number;

      /**
       * A seed value to initialize the randomness, during sampling.
       */
      seed?: number;

      /**
       * A higher temperature increases randomness in the outputs.
       */
      temperature?: number;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }
  }
}

export interface RunListParams extends CursorPageParams {
  /**
   * Sort order for runs by timestamp. Use `asc` for ascending order or `desc` for
   * descending order. Defaults to `asc`.
   */
  order?: 'asc' | 'desc';

  /**
   * Filter runs by status. One of `queued` | `in_progress` | `failed` | `completed`
   * | `canceled`.
   */
  status?: 'queued' | 'in_progress' | 'completed' | 'canceled' | 'failed';
}

Runs.RunListResponsesPage = RunListResponsesPage;
Runs.OutputItems = OutputItems;
Runs.OutputItemListResponsesPage = OutputItemListResponsesPage;

export declare namespace Runs {
  export {
    type CreateEvalCompletionsRunDataSource as CreateEvalCompletionsRunDataSource,
    type CreateEvalJSONLRunDataSource as CreateEvalJSONLRunDataSource,
    type EvalAPIError as EvalAPIError,
    type RunCreateResponse as RunCreateResponse,
    type RunRetrieveResponse as RunRetrieveResponse,
    type RunListResponse as RunListResponse,
    type RunDeleteResponse as RunDeleteResponse,
    type RunCancelResponse as RunCancelResponse,
    RunListResponsesPage as RunListResponsesPage,
    type RunCreateParams as RunCreateParams,
    type RunListParams as RunListParams,
  };

  export {
    OutputItems as OutputItems,
    type OutputItemRetrieveResponse as OutputItemRetrieveResponse,
    type OutputItemListResponse as OutputItemListResponse,
    OutputItemListResponsesPage as OutputItemListResponsesPage,
    type OutputItemListParams as OutputItemListParams,
  };
}
