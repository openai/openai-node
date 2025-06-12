// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as Shared from '../../shared';
import * as ResponsesAPI from '../../responses/responses';
import * as CompletionsAPI from '../../chat/completions/completions';
import * as OutputItemsAPI from './output-items';
import {
  OutputItemListParams,
  OutputItemListResponse,
  OutputItemListResponsesPage,
  OutputItemRetrieveParams,
  OutputItemRetrieveResponse,
  OutputItems,
} from './output-items';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Runs extends APIResource {
  outputItems: OutputItemsAPI.OutputItems = new OutputItemsAPI.OutputItems(this._client);

  /**
   * Kicks off a new run for a given evaluation, specifying the data source, and what
   * model configuration to use to test. The datasource will be validated against the
   * schema specified in the config of the evaluation.
   */
  create(evalID: string, body: RunCreateParams, options?: RequestOptions): APIPromise<RunCreateResponse> {
    return this._client.post(path`/evals/${evalID}/runs`, { body, ...options });
  }

  /**
   * Get an evaluation run by ID.
   */
  retrieve(
    runID: string,
    params: RunRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<RunRetrieveResponse> {
    const { eval_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${runID}`, options);
  }

  /**
   * Get a list of runs for an evaluation.
   */
  list(
    evalID: string,
    query: RunListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<RunListResponsesPage, RunListResponse> {
    return this._client.getAPIList(path`/evals/${evalID}/runs`, CursorPage<RunListResponse>, {
      query,
      ...options,
    });
  }

  /**
   * Delete an eval run.
   */
  delete(runID: string, params: RunDeleteParams, options?: RequestOptions): APIPromise<RunDeleteResponse> {
    const { eval_id } = params;
    return this._client.delete(path`/evals/${eval_id}/runs/${runID}`, options);
  }

  /**
   * Cancel an ongoing evaluation run.
   */
  cancel(runID: string, params: RunCancelParams, options?: RequestOptions): APIPromise<RunCancelResponse> {
    const { eval_id } = params;
    return this._client.post(path`/evals/${eval_id}/runs/${runID}`, options);
  }
}

export type RunListResponsesPage = CursorPage<RunListResponse>;

/**
 * A CompletionsRunDataSource object describing a model sampling configuration.
 */
export interface CreateEvalCompletionsRunDataSource {
  /**
   * Determines what populates the `item` namespace in this run's data source.
   */
  source:
    | CreateEvalCompletionsRunDataSource.FileContent
    | CreateEvalCompletionsRunDataSource.FileID
    | CreateEvalCompletionsRunDataSource.StoredCompletions;

  /**
   * The type of run data source. Always `completions`.
   */
  type: 'completions';

  /**
   * Used when sampling from a model. Dictates the structure of the messages passed
   * into the model. Can either be a reference to a prebuilt trajectory (ie,
   * `item.input_trajectory`), or a template with variable references to the `item`
   * namespace.
   */
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
     * references to the `item` namespace, ie {{item.name}}.
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
     * A reference to a variable in the `item` namespace. Ie, "item.input_trajectory"
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
     * A seed value to initialize the randomness, during sampling.
     */
    seed?: number;

    /**
     * A higher temperature increases randomness in the outputs.
     */
    temperature?: number;

    /**
     * A list of tools the model may call. Currently, only functions are supported as a
     * tool. Use this to provide a list of functions the model may generate JSON inputs
     * for. A max of 128 functions are supported.
     */
    tools?: Array<CompletionsAPI.ChatCompletionTool>;

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
  /**
   * Determines what populates the `item` namespace in the data source.
   */
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
    | RunCreateResponse.Responses;

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
  export interface Responses {
    /**
     * Determines what populates the `item` namespace in this run's data source.
     */
    source: Responses.FileContent | Responses.FileID | Responses.Responses;

    /**
     * The type of run data source. Always `responses`.
     */
    type: 'responses';

    /**
     * Used when sampling from a model. Dictates the structure of the messages passed
     * into the model. Can either be a reference to a prebuilt trajectory (ie,
     * `item.input_trajectory`), or a template with variable references to the `item`
     * namespace.
     */
    input_messages?: Responses.Template | Responses.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Responses.SamplingParams;
  }

  export namespace Responses {
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
       * Optional string to search the 'instructions' field. This is a query parameter
       * used to select responses.
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
       * List of tool names. This is a query parameter used to select responses.
       */
      tools?: Array<string> | null;

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
       * references to the `item` namespace, ie {{item.name}}.
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
       * A reference to a variable in the `item` namespace. Ie, "item.name"
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
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      text?: SamplingParams.Text;

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
      tools?: Array<ResponsesAPI.Tool>;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }

    export namespace SamplingParams {
      /**
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      export interface Text {
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
        format?: ResponsesAPI.ResponseFormatTextConfig;
      }
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
    | RunRetrieveResponse.Responses;

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
  export interface Responses {
    /**
     * Determines what populates the `item` namespace in this run's data source.
     */
    source: Responses.FileContent | Responses.FileID | Responses.Responses;

    /**
     * The type of run data source. Always `responses`.
     */
    type: 'responses';

    /**
     * Used when sampling from a model. Dictates the structure of the messages passed
     * into the model. Can either be a reference to a prebuilt trajectory (ie,
     * `item.input_trajectory`), or a template with variable references to the `item`
     * namespace.
     */
    input_messages?: Responses.Template | Responses.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Responses.SamplingParams;
  }

  export namespace Responses {
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
       * Optional string to search the 'instructions' field. This is a query parameter
       * used to select responses.
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
       * List of tool names. This is a query parameter used to select responses.
       */
      tools?: Array<string> | null;

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
       * references to the `item` namespace, ie {{item.name}}.
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
       * A reference to a variable in the `item` namespace. Ie, "item.name"
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
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      text?: SamplingParams.Text;

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
      tools?: Array<ResponsesAPI.Tool>;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }

    export namespace SamplingParams {
      /**
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      export interface Text {
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
        format?: ResponsesAPI.ResponseFormatTextConfig;
      }
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
  data_source: CreateEvalJSONLRunDataSource | CreateEvalCompletionsRunDataSource | RunListResponse.Responses;

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
  export interface Responses {
    /**
     * Determines what populates the `item` namespace in this run's data source.
     */
    source: Responses.FileContent | Responses.FileID | Responses.Responses;

    /**
     * The type of run data source. Always `responses`.
     */
    type: 'responses';

    /**
     * Used when sampling from a model. Dictates the structure of the messages passed
     * into the model. Can either be a reference to a prebuilt trajectory (ie,
     * `item.input_trajectory`), or a template with variable references to the `item`
     * namespace.
     */
    input_messages?: Responses.Template | Responses.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Responses.SamplingParams;
  }

  export namespace Responses {
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
       * Optional string to search the 'instructions' field. This is a query parameter
       * used to select responses.
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
       * List of tool names. This is a query parameter used to select responses.
       */
      tools?: Array<string> | null;

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
       * references to the `item` namespace, ie {{item.name}}.
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
       * A reference to a variable in the `item` namespace. Ie, "item.name"
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
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      text?: SamplingParams.Text;

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
      tools?: Array<ResponsesAPI.Tool>;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }

    export namespace SamplingParams {
      /**
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      export interface Text {
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
        format?: ResponsesAPI.ResponseFormatTextConfig;
      }
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
    | RunCancelResponse.Responses;

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
  export interface Responses {
    /**
     * Determines what populates the `item` namespace in this run's data source.
     */
    source: Responses.FileContent | Responses.FileID | Responses.Responses;

    /**
     * The type of run data source. Always `responses`.
     */
    type: 'responses';

    /**
     * Used when sampling from a model. Dictates the structure of the messages passed
     * into the model. Can either be a reference to a prebuilt trajectory (ie,
     * `item.input_trajectory`), or a template with variable references to the `item`
     * namespace.
     */
    input_messages?: Responses.Template | Responses.ItemReference;

    /**
     * The name of the model to use for generating completions (e.g. "o3-mini").
     */
    model?: string;

    sampling_params?: Responses.SamplingParams;
  }

  export namespace Responses {
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
       * Optional string to search the 'instructions' field. This is a query parameter
       * used to select responses.
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
       * List of tool names. This is a query parameter used to select responses.
       */
      tools?: Array<string> | null;

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
       * references to the `item` namespace, ie {{item.name}}.
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
       * A reference to a variable in the `item` namespace. Ie, "item.name"
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
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      text?: SamplingParams.Text;

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
      tools?: Array<ResponsesAPI.Tool>;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }

    export namespace SamplingParams {
      /**
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      export interface Text {
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
        format?: ResponsesAPI.ResponseFormatTextConfig;
      }
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
     * Determines what populates the `item` namespace in this run's data source.
     */
    source:
      | CreateEvalResponsesRunDataSource.FileContent
      | CreateEvalResponsesRunDataSource.FileID
      | CreateEvalResponsesRunDataSource.Responses;

    /**
     * The type of run data source. Always `responses`.
     */
    type: 'responses';

    /**
     * Used when sampling from a model. Dictates the structure of the messages passed
     * into the model. Can either be a reference to a prebuilt trajectory (ie,
     * `item.input_trajectory`), or a template with variable references to the `item`
     * namespace.
     */
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
       * Optional string to search the 'instructions' field. This is a query parameter
       * used to select responses.
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
       * List of tool names. This is a query parameter used to select responses.
       */
      tools?: Array<string> | null;

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
       * references to the `item` namespace, ie {{item.name}}.
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
       * A reference to a variable in the `item` namespace. Ie, "item.name"
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
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      text?: SamplingParams.Text;

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
      tools?: Array<ResponsesAPI.Tool>;

      /**
       * An alternative to temperature for nucleus sampling; 1.0 includes all tokens.
       */
      top_p?: number;
    }

    export namespace SamplingParams {
      /**
       * Configuration options for a text response from the model. Can be plain text or
       * structured JSON data. Learn more:
       *
       * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
       * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
       */
      export interface Text {
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
        format?: ResponsesAPI.ResponseFormatTextConfig;
      }
    }
  }
}

export interface RunRetrieveParams {
  /**
   * The ID of the evaluation to retrieve runs for.
   */
  eval_id: string;
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

export interface RunDeleteParams {
  /**
   * The ID of the evaluation to delete the run from.
   */
  eval_id: string;
}

export interface RunCancelParams {
  /**
   * The ID of the evaluation whose run you want to cancel.
   */
  eval_id: string;
}

Runs.OutputItems = OutputItems;

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
    type RunListResponsesPage as RunListResponsesPage,
    type RunCreateParams as RunCreateParams,
    type RunRetrieveParams as RunRetrieveParams,
    type RunListParams as RunListParams,
    type RunDeleteParams as RunDeleteParams,
    type RunCancelParams as RunCancelParams,
  };

  export {
    OutputItems as OutputItems,
    type OutputItemRetrieveResponse as OutputItemRetrieveResponse,
    type OutputItemListResponse as OutputItemListResponse,
    type OutputItemListResponsesPage as OutputItemListResponsesPage,
    type OutputItemRetrieveParams as OutputItemRetrieveParams,
    type OutputItemListParams as OutputItemListParams,
  };
}
