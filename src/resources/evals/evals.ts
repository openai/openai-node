// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import { isRequestOptions } from '../../core';
import * as Core from '../../core';
import * as Shared from '../shared';
import * as RunsAPI from './runs/runs';
import {
  CreateEvalCompletionsRunDataSource,
  CreateEvalJSONLRunDataSource,
  EvalAPIError,
  RunCancelResponse,
  RunCreateParams,
  RunCreateResponse,
  RunDeleteResponse,
  RunListParams,
  RunListResponse,
  RunListResponsesPage,
  RunRetrieveResponse,
  Runs,
} from './runs/runs';
import { CursorPage, type CursorPageParams } from '../../pagination';

export class Evals extends APIResource {
  runs: RunsAPI.Runs = new RunsAPI.Runs(this._client);

  /**
   * Create the structure of an evaluation that can be used to test a model's
   * performance. An evaluation is a set of testing criteria and a datasource. After
   * creating an evaluation, you can run it on different models and model parameters.
   * We support several types of graders and datasources. For more information, see
   * the [Evals guide](https://platform.openai.com/docs/guides/evals).
   */
  create(body: EvalCreateParams, options?: Core.RequestOptions): Core.APIPromise<EvalCreateResponse> {
    return this._client.post('/evals', { body, ...options });
  }

  /**
   * Get an evaluation by ID.
   */
  retrieve(evalId: string, options?: Core.RequestOptions): Core.APIPromise<EvalRetrieveResponse> {
    return this._client.get(`/evals/${evalId}`, options);
  }

  /**
   * Update certain properties of an evaluation.
   */
  update(
    evalId: string,
    body: EvalUpdateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<EvalUpdateResponse> {
    return this._client.post(`/evals/${evalId}`, { body, ...options });
  }

  /**
   * List evaluations for a project.
   */
  list(
    query?: EvalListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<EvalListResponsesPage, EvalListResponse>;
  list(options?: Core.RequestOptions): Core.PagePromise<EvalListResponsesPage, EvalListResponse>;
  list(
    query: EvalListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<EvalListResponsesPage, EvalListResponse> {
    if (isRequestOptions(query)) {
      return this.list({}, query);
    }
    return this._client.getAPIList('/evals', EvalListResponsesPage, { query, ...options });
  }

  /**
   * Delete an evaluation.
   */
  del(evalId: string, options?: Core.RequestOptions): Core.APIPromise<EvalDeleteResponse> {
    return this._client.delete(`/evals/${evalId}`, options);
  }
}

export class EvalListResponsesPage extends CursorPage<EvalListResponse> {}

/**
 * A CustomDataSourceConfig which specifies the schema of your `item` and
 * optionally `sample` namespaces. The response schema defines the shape of the
 * data that will be:
 *
 * - Used to define your testing criteria and
 * - What data is required when creating a run
 */
export interface EvalCustomDataSourceConfig {
  /**
   * The json schema for the run data source items. Learn how to build JSON schemas
   * [here](https://json-schema.org/).
   */
  schema: Record<string, unknown>;

  /**
   * The type of data source. Always `custom`.
   */
  type: 'custom';
}

/**
 * A LabelModelGrader object which uses a model to assign labels to each item in
 * the evaluation.
 */
export interface EvalLabelModelGrader {
  input: Array<EvalLabelModelGrader.InputMessage | EvalLabelModelGrader.Assistant>;

  /**
   * The labels to assign to each item in the evaluation.
   */
  labels: Array<string>;

  /**
   * The model to use for the evaluation. Must support structured outputs.
   */
  model: string;

  /**
   * The name of the grader.
   */
  name: string;

  /**
   * The labels that indicate a passing result. Must be a subset of labels.
   */
  passing_labels: Array<string>;

  /**
   * The object type, which is always `label_model`.
   */
  type: 'label_model';
}

export namespace EvalLabelModelGrader {
  export interface InputMessage {
    content: InputMessage.Content;

    /**
     * The role of the message. One of `user`, `system`, or `developer`.
     */
    role: 'user' | 'system' | 'developer';

    /**
     * The type of item, which is always `message`.
     */
    type: 'message';
  }

  export namespace InputMessage {
    export interface Content {
      /**
       * The text content.
       */
      text: string;

      /**
       * The type of content, which is always `input_text`.
       */
      type: 'input_text';
    }
  }

  export interface Assistant {
    content: Assistant.Content;

    /**
     * The role of the message. Must be `assistant` for output.
     */
    role: 'assistant';

    /**
     * The type of item, which is always `message`.
     */
    type: 'message';
  }

  export namespace Assistant {
    export interface Content {
      /**
       * The text content.
       */
      text: string;

      /**
       * The type of content, which is always `output_text`.
       */
      type: 'output_text';
    }
  }
}

/**
 * A StoredCompletionsDataSourceConfig which specifies the metadata property of
 * your stored completions query. This is usually metadata like `usecase=chatbot`
 * or `prompt-version=v2`, etc. The schema returned by this data source config is
 * used to defined what variables are available in your evals. `item` and `sample`
 * are both defined when using this data source config.
 */
export interface EvalStoredCompletionsDataSourceConfig {
  /**
   * The json schema for the run data source items. Learn how to build JSON schemas
   * [here](https://json-schema.org/).
   */
  schema: Record<string, unknown>;

  /**
   * The type of data source. Always `stored_completions`.
   */
  type: 'stored_completions';

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format, and
   * querying for objects via API or the dashboard.
   *
   * Keys are strings with a maximum length of 64 characters. Values are strings with
   * a maximum length of 512 characters.
   */
  metadata?: Shared.Metadata | null;
}

/**
 * A StringCheckGrader object that performs a string comparison between input and
 * reference using a specified operation.
 */
export interface EvalStringCheckGrader {
  /**
   * The input text. This may include template strings.
   */
  input: string;

  /**
   * The name of the grader.
   */
  name: string;

  /**
   * The string check operation to perform. One of `eq`, `ne`, `like`, or `ilike`.
   */
  operation: 'eq' | 'ne' | 'like' | 'ilike';

  /**
   * The reference text. This may include template strings.
   */
  reference: string;

  /**
   * The object type, which is always `string_check`.
   */
  type: 'string_check';
}

/**
 * A TextSimilarityGrader object which grades text based on similarity metrics.
 */
export interface EvalTextSimilarityGrader {
  /**
   * The evaluation metric to use. One of `cosine`, `fuzzy_match`, `bleu`, `gleu`,
   * `meteor`, `rouge_1`, `rouge_2`, `rouge_3`, `rouge_4`, `rouge_5`, or `rouge_l`.
   */
  evaluation_metric:
    | 'fuzzy_match'
    | 'bleu'
    | 'gleu'
    | 'meteor'
    | 'rouge_1'
    | 'rouge_2'
    | 'rouge_3'
    | 'rouge_4'
    | 'rouge_5'
    | 'rouge_l'
    | 'cosine';

  /**
   * The text being graded.
   */
  input: string;

  /**
   * A float score where a value greater than or equal indicates a passing grade.
   */
  pass_threshold: number;

  /**
   * The text being graded against.
   */
  reference: string;

  /**
   * The type of grader.
   */
  type: 'text_similarity';

  /**
   * The name of the grader.
   */
  name?: string;
}

/**
 * An Eval object with a data source config and testing criteria. An Eval
 * represents a task to be done for your LLM integration. Like:
 *
 * - Improve the quality of my chatbot
 * - See how well my chatbot handles customer support
 * - Check if o3-mini is better at my usecase than gpt-4o
 */
export interface EvalCreateResponse {
  /**
   * Unique identifier for the evaluation.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the eval was created.
   */
  created_at: number;

  /**
   * Configuration of data sources used in runs of the evaluation.
   */
  data_source_config: EvalCustomDataSourceConfig | EvalStoredCompletionsDataSourceConfig;

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
   * The name of the evaluation.
   */
  name: string;

  /**
   * The object type.
   */
  object: 'eval';

  /**
   * Indicates whether the evaluation is shared with OpenAI.
   */
  share_with_openai: boolean;

  /**
   * A list of testing criteria.
   */
  testing_criteria: Array<EvalLabelModelGrader | EvalStringCheckGrader | EvalTextSimilarityGrader>;
}

/**
 * An Eval object with a data source config and testing criteria. An Eval
 * represents a task to be done for your LLM integration. Like:
 *
 * - Improve the quality of my chatbot
 * - See how well my chatbot handles customer support
 * - Check if o3-mini is better at my usecase than gpt-4o
 */
export interface EvalRetrieveResponse {
  /**
   * Unique identifier for the evaluation.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the eval was created.
   */
  created_at: number;

  /**
   * Configuration of data sources used in runs of the evaluation.
   */
  data_source_config: EvalCustomDataSourceConfig | EvalStoredCompletionsDataSourceConfig;

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
   * The name of the evaluation.
   */
  name: string;

  /**
   * The object type.
   */
  object: 'eval';

  /**
   * Indicates whether the evaluation is shared with OpenAI.
   */
  share_with_openai: boolean;

  /**
   * A list of testing criteria.
   */
  testing_criteria: Array<EvalLabelModelGrader | EvalStringCheckGrader | EvalTextSimilarityGrader>;
}

/**
 * An Eval object with a data source config and testing criteria. An Eval
 * represents a task to be done for your LLM integration. Like:
 *
 * - Improve the quality of my chatbot
 * - See how well my chatbot handles customer support
 * - Check if o3-mini is better at my usecase than gpt-4o
 */
export interface EvalUpdateResponse {
  /**
   * Unique identifier for the evaluation.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the eval was created.
   */
  created_at: number;

  /**
   * Configuration of data sources used in runs of the evaluation.
   */
  data_source_config: EvalCustomDataSourceConfig | EvalStoredCompletionsDataSourceConfig;

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
   * The name of the evaluation.
   */
  name: string;

  /**
   * The object type.
   */
  object: 'eval';

  /**
   * Indicates whether the evaluation is shared with OpenAI.
   */
  share_with_openai: boolean;

  /**
   * A list of testing criteria.
   */
  testing_criteria: Array<EvalLabelModelGrader | EvalStringCheckGrader | EvalTextSimilarityGrader>;
}

/**
 * An Eval object with a data source config and testing criteria. An Eval
 * represents a task to be done for your LLM integration. Like:
 *
 * - Improve the quality of my chatbot
 * - See how well my chatbot handles customer support
 * - Check if o3-mini is better at my usecase than gpt-4o
 */
export interface EvalListResponse {
  /**
   * Unique identifier for the evaluation.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the eval was created.
   */
  created_at: number;

  /**
   * Configuration of data sources used in runs of the evaluation.
   */
  data_source_config: EvalCustomDataSourceConfig | EvalStoredCompletionsDataSourceConfig;

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
   * The name of the evaluation.
   */
  name: string;

  /**
   * The object type.
   */
  object: 'eval';

  /**
   * Indicates whether the evaluation is shared with OpenAI.
   */
  share_with_openai: boolean;

  /**
   * A list of testing criteria.
   */
  testing_criteria: Array<EvalLabelModelGrader | EvalStringCheckGrader | EvalTextSimilarityGrader>;
}

export interface EvalDeleteResponse {
  deleted: boolean;

  eval_id: string;

  object: string;
}

export interface EvalCreateParams {
  /**
   * The configuration for the data source used for the evaluation runs.
   */
  data_source_config: EvalCreateParams.Custom | EvalCreateParams.StoredCompletions;

  /**
   * A list of graders for all eval runs in this group.
   */
  testing_criteria: Array<EvalCreateParams.LabelModel | EvalStringCheckGrader | EvalTextSimilarityGrader>;

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
   * The name of the evaluation.
   */
  name?: string;

  /**
   * Indicates whether the evaluation is shared with OpenAI.
   */
  share_with_openai?: boolean;
}

export namespace EvalCreateParams {
  /**
   * A CustomDataSourceConfig object that defines the schema for the data source used
   * for the evaluation runs. This schema is used to define the shape of the data
   * that will be:
   *
   * - Used to define your testing criteria and
   * - What data is required when creating a run
   */
  export interface Custom {
    /**
     * The json schema for the run data source items.
     */
    item_schema: Record<string, unknown>;

    /**
     * The type of data source. Always `custom`.
     */
    type: 'custom';

    /**
     * Whether to include the sample schema in the data source.
     */
    include_sample_schema?: boolean;
  }

  /**
   * A data source config which specifies the metadata property of your stored
   * completions query. This is usually metadata like `usecase=chatbot` or
   * `prompt-version=v2`, etc.
   */
  export interface StoredCompletions {
    /**
     * The type of data source. Always `stored_completions`.
     */
    type: 'stored_completions';

    /**
     * Set of 16 key-value pairs that can be attached to an object. This can be useful
     * for storing additional information about the object in a structured format, and
     * querying for objects via API or the dashboard.
     *
     * Keys are strings with a maximum length of 64 characters. Values are strings with
     * a maximum length of 512 characters.
     */
    metadata?: Shared.Metadata | null;
  }

  /**
   * A LabelModelGrader object which uses a model to assign labels to each item in
   * the evaluation.
   */
  export interface LabelModel {
    input: Array<LabelModel.SimpleInputMessage | LabelModel.InputMessage | LabelModel.OutputMessage>;

    /**
     * The labels to classify to each item in the evaluation.
     */
    labels: Array<string>;

    /**
     * The model to use for the evaluation. Must support structured outputs.
     */
    model: string;

    /**
     * The name of the grader.
     */
    name: string;

    /**
     * The labels that indicate a passing result. Must be a subset of labels.
     */
    passing_labels: Array<string>;

    /**
     * The object type, which is always `label_model`.
     */
    type: 'label_model';
  }

  export namespace LabelModel {
    export interface SimpleInputMessage {
      /**
       * The content of the message.
       */
      content: string;

      /**
       * The role of the message (e.g. "system", "assistant", "user").
       */
      role: string;
    }

    export interface InputMessage {
      content: InputMessage.Content;

      /**
       * The role of the message. One of `user`, `system`, or `developer`.
       */
      role: 'user' | 'system' | 'developer';

      /**
       * The type of item, which is always `message`.
       */
      type: 'message';
    }

    export namespace InputMessage {
      export interface Content {
        /**
         * The text content.
         */
        text: string;

        /**
         * The type of content, which is always `input_text`.
         */
        type: 'input_text';
      }
    }

    export interface OutputMessage {
      content: OutputMessage.Content;

      /**
       * The role of the message. Must be `assistant` for output.
       */
      role: 'assistant';

      /**
       * The type of item, which is always `message`.
       */
      type: 'message';
    }

    export namespace OutputMessage {
      export interface Content {
        /**
         * The text content.
         */
        text: string;

        /**
         * The type of content, which is always `output_text`.
         */
        type: 'output_text';
      }
    }
  }
}

export interface EvalUpdateParams {
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
   * Rename the evaluation.
   */
  name?: string;
}

export interface EvalListParams extends CursorPageParams {
  /**
   * Sort order for evals by timestamp. Use `asc` for ascending order or `desc` for
   * descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * Evals can be ordered by creation time or last updated time. Use `created_at` for
   * creation time or `updated_at` for last updated time.
   */
  order_by?: 'created_at' | 'updated_at';
}

Evals.EvalListResponsesPage = EvalListResponsesPage;
Evals.Runs = Runs;
Evals.RunListResponsesPage = RunListResponsesPage;

export declare namespace Evals {
  export {
    type EvalCustomDataSourceConfig as EvalCustomDataSourceConfig,
    type EvalLabelModelGrader as EvalLabelModelGrader,
    type EvalStoredCompletionsDataSourceConfig as EvalStoredCompletionsDataSourceConfig,
    type EvalStringCheckGrader as EvalStringCheckGrader,
    type EvalTextSimilarityGrader as EvalTextSimilarityGrader,
    type EvalCreateResponse as EvalCreateResponse,
    type EvalRetrieveResponse as EvalRetrieveResponse,
    type EvalUpdateResponse as EvalUpdateResponse,
    type EvalListResponse as EvalListResponse,
    type EvalDeleteResponse as EvalDeleteResponse,
    EvalListResponsesPage as EvalListResponsesPage,
    type EvalCreateParams as EvalCreateParams,
    type EvalUpdateParams as EvalUpdateParams,
    type EvalListParams as EvalListParams,
  };

  export {
    Runs as Runs,
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
}
