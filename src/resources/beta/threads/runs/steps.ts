// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../resource';
import { isRequestOptions } from '../../../../core';
import * as Core from '../../../../core';
import * as StepsAPI from './steps';
import * as Shared from '../../../shared';
import { CursorPage, type CursorPageParams } from '../../../../pagination';

export class Steps extends APIResource {
  /**
   * Retrieves a run step.
   */
  retrieve(
    threadId: string,
    runId: string,
    stepId: string,
    query?: StepRetrieveParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunStep>;
  retrieve(
    threadId: string,
    runId: string,
    stepId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunStep>;
  retrieve(
    threadId: string,
    runId: string,
    stepId: string,
    query: StepRetrieveParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunStep> {
    if (isRequestOptions(query)) {
      return this.retrieve(threadId, runId, stepId, {}, query);
    }
    return this._client.get(`/threads/${threadId}/runs/${runId}/steps/${stepId}`, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Returns a list of run steps belonging to a run.
   */
  list(
    threadId: string,
    runId: string,
    query?: StepListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunStepsPage, RunStep>;
  list(
    threadId: string,
    runId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunStepsPage, RunStep>;
  list(
    threadId: string,
    runId: string,
    query: StepListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunStepsPage, RunStep> {
    if (isRequestOptions(query)) {
      return this.list(threadId, runId, {}, query);
    }
    return this._client.getAPIList(`/threads/${threadId}/runs/${runId}/steps`, RunStepsPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }
}

export class RunStepsPage extends CursorPage<RunStep> {}

/**
 * Text output from the Code Interpreter tool call as part of a run step.
 */
export interface CodeInterpreterLogs {
  /**
   * The index of the output in the outputs array.
   */
  index: number;

  /**
   * Always `logs`.
   */
  type: 'logs';

  /**
   * The text output from the Code Interpreter tool call.
   */
  logs?: string;
}

export interface CodeInterpreterOutputImage {
  /**
   * The index of the output in the outputs array.
   */
  index: number;

  /**
   * Always `image`.
   */
  type: 'image';

  image?: CodeInterpreterOutputImage.Image;
}

export namespace CodeInterpreterOutputImage {
  export interface Image {
    /**
     * The [file](https://platform.openai.com/docs/api-reference/files) ID of the
     * image.
     */
    file_id?: string;
  }
}

/**
 * Details of the Code Interpreter tool call the run step was involved in.
 */
export interface CodeInterpreterToolCall {
  /**
   * The ID of the tool call.
   */
  id: string;

  /**
   * The Code Interpreter tool call definition.
   */
  code_interpreter: CodeInterpreterToolCall.CodeInterpreter;

  /**
   * The type of tool call. This is always going to be `code_interpreter` for this
   * type of tool call.
   */
  type: 'code_interpreter';
}

export namespace CodeInterpreterToolCall {
  /**
   * The Code Interpreter tool call definition.
   */
  export interface CodeInterpreter {
    /**
     * The input to the Code Interpreter tool call.
     */
    input: string;

    /**
     * The outputs from the Code Interpreter tool call. Code Interpreter can output one
     * or more items, including text (`logs`) or images (`image`). Each of these are
     * represented by a different object type.
     */
    outputs: Array<CodeInterpreter.Logs | CodeInterpreter.Image>;
  }

  export namespace CodeInterpreter {
    /**
     * Text output from the Code Interpreter tool call as part of a run step.
     */
    export interface Logs {
      /**
       * The text output from the Code Interpreter tool call.
       */
      logs: string;

      /**
       * Always `logs`.
       */
      type: 'logs';
    }

    export interface Image {
      image: Image.Image;

      /**
       * Always `image`.
       */
      type: 'image';
    }

    export namespace Image {
      export interface Image {
        /**
         * The [file](https://platform.openai.com/docs/api-reference/files) ID of the
         * image.
         */
        file_id: string;
      }
    }
  }
}

/**
 * Details of the Code Interpreter tool call the run step was involved in.
 */
export interface CodeInterpreterToolCallDelta {
  /**
   * The index of the tool call in the tool calls array.
   */
  index: number;

  /**
   * The type of tool call. This is always going to be `code_interpreter` for this
   * type of tool call.
   */
  type: 'code_interpreter';

  /**
   * The ID of the tool call.
   */
  id?: string;

  /**
   * The Code Interpreter tool call definition.
   */
  code_interpreter?: CodeInterpreterToolCallDelta.CodeInterpreter;
}

export namespace CodeInterpreterToolCallDelta {
  /**
   * The Code Interpreter tool call definition.
   */
  export interface CodeInterpreter {
    /**
     * The input to the Code Interpreter tool call.
     */
    input?: string;

    /**
     * The outputs from the Code Interpreter tool call. Code Interpreter can output one
     * or more items, including text (`logs`) or images (`image`). Each of these are
     * represented by a different object type.
     */
    outputs?: Array<StepsAPI.CodeInterpreterLogs | StepsAPI.CodeInterpreterOutputImage>;
  }
}

export interface FileSearchToolCall {
  /**
   * The ID of the tool call object.
   */
  id: string;

  /**
   * For now, this is always going to be an empty object.
   */
  file_search: FileSearchToolCall.FileSearch;

  /**
   * The type of tool call. This is always going to be `file_search` for this type of
   * tool call.
   */
  type: 'file_search';
}

export namespace FileSearchToolCall {
  /**
   * For now, this is always going to be an empty object.
   */
  export interface FileSearch {
    /**
     * The ranking options for the file search.
     */
    ranking_options?: FileSearch.RankingOptions;

    /**
     * The results of the file search.
     */
    results?: Array<FileSearch.Result>;
  }

  export namespace FileSearch {
    /**
     * The ranking options for the file search.
     */
    export interface RankingOptions {
      /**
       * The ranker used for the file search.
       */
      ranker: 'default_2024_08_21';

      /**
       * The score threshold for the file search. All values must be a floating point
       * number between 0 and 1.
       */
      score_threshold: number;
    }

    /**
     * A result instance of the file search.
     */
    export interface Result {
      /**
       * The ID of the file that result was found in.
       */
      file_id: string;

      /**
       * The name of the file that result was found in.
       */
      file_name: string;

      /**
       * The score of the result. All values must be a floating point number between 0
       * and 1.
       */
      score: number;

      /**
       * The content of the result that was found. The content is only included if
       * requested via the include query parameter.
       */
      content?: Array<Result.Content>;
    }

    export namespace Result {
      export interface Content {
        /**
         * The text content of the file.
         */
        text?: string;

        /**
         * The type of the content.
         */
        type?: 'text';
      }
    }
  }
}

export interface FileSearchToolCallDelta {
  /**
   * For now, this is always going to be an empty object.
   */
  file_search: unknown;

  /**
   * The index of the tool call in the tool calls array.
   */
  index: number;

  /**
   * The type of tool call. This is always going to be `file_search` for this type of
   * tool call.
   */
  type: 'file_search';

  /**
   * The ID of the tool call object.
   */
  id?: string;
}

export interface FunctionToolCall {
  /**
   * The ID of the tool call object.
   */
  id: string;

  /**
   * The definition of the function that was called.
   */
  function: FunctionToolCall.Function;

  /**
   * The type of tool call. This is always going to be `function` for this type of
   * tool call.
   */
  type: 'function';
}

export namespace FunctionToolCall {
  /**
   * The definition of the function that was called.
   */
  export interface Function {
    /**
     * The arguments passed to the function.
     */
    arguments: string;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * The output of the function. This will be `null` if the outputs have not been
     * [submitted](https://platform.openai.com/docs/api-reference/runs/submitToolOutputs)
     * yet.
     */
    output: string | null;
  }
}

export interface FunctionToolCallDelta {
  /**
   * The index of the tool call in the tool calls array.
   */
  index: number;

  /**
   * The type of tool call. This is always going to be `function` for this type of
   * tool call.
   */
  type: 'function';

  /**
   * The ID of the tool call object.
   */
  id?: string;

  /**
   * The definition of the function that was called.
   */
  function?: FunctionToolCallDelta.Function;
}

export namespace FunctionToolCallDelta {
  /**
   * The definition of the function that was called.
   */
  export interface Function {
    /**
     * The arguments passed to the function.
     */
    arguments?: string;

    /**
     * The name of the function.
     */
    name?: string;

    /**
     * The output of the function. This will be `null` if the outputs have not been
     * [submitted](https://platform.openai.com/docs/api-reference/runs/submitToolOutputs)
     * yet.
     */
    output?: string | null;
  }
}

/**
 * Details of the message creation by the run step.
 */
export interface MessageCreationStepDetails {
  message_creation: MessageCreationStepDetails.MessageCreation;

  /**
   * Always `message_creation`.
   */
  type: 'message_creation';
}

export namespace MessageCreationStepDetails {
  export interface MessageCreation {
    /**
     * The ID of the message that was created by this run step.
     */
    message_id: string;
  }
}

/**
 * Represents a step in execution of a run.
 */
export interface RunStep {
  /**
   * The identifier of the run step, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The ID of the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants)
   * associated with the run step.
   */
  assistant_id: string;

  /**
   * The Unix timestamp (in seconds) for when the run step was cancelled.
   */
  cancelled_at: number | null;

  /**
   * The Unix timestamp (in seconds) for when the run step completed.
   */
  completed_at: number | null;

  /**
   * The Unix timestamp (in seconds) for when the run step was created.
   */
  created_at: number;

  /**
   * The Unix timestamp (in seconds) for when the run step expired. A step is
   * considered expired if the parent run is expired.
   */
  expired_at: number | null;

  /**
   * The Unix timestamp (in seconds) for when the run step failed.
   */
  failed_at: number | null;

  /**
   * The last error associated with this run step. Will be `null` if there are no
   * errors.
   */
  last_error: RunStep.LastError | null;

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
   * The object type, which is always `thread.run.step`.
   */
  object: 'thread.run.step';

  /**
   * The ID of the [run](https://platform.openai.com/docs/api-reference/runs) that
   * this run step is a part of.
   */
  run_id: string;

  /**
   * The status of the run step, which can be either `in_progress`, `cancelled`,
   * `failed`, `completed`, or `expired`.
   */
  status: 'in_progress' | 'cancelled' | 'failed' | 'completed' | 'expired';

  /**
   * The details of the run step.
   */
  step_details: MessageCreationStepDetails | ToolCallsStepDetails;

  /**
   * The ID of the [thread](https://platform.openai.com/docs/api-reference/threads)
   * that was run.
   */
  thread_id: string;

  /**
   * The type of run step, which can be either `message_creation` or `tool_calls`.
   */
  type: 'message_creation' | 'tool_calls';

  /**
   * Usage statistics related to the run step. This value will be `null` while the
   * run step's status is `in_progress`.
   */
  usage: RunStep.Usage | null;
}

export namespace RunStep {
  /**
   * The last error associated with this run step. Will be `null` if there are no
   * errors.
   */
  export interface LastError {
    /**
     * One of `server_error` or `rate_limit_exceeded`.
     */
    code: 'server_error' | 'rate_limit_exceeded';

    /**
     * A human-readable description of the error.
     */
    message: string;
  }

  /**
   * Usage statistics related to the run step. This value will be `null` while the
   * run step's status is `in_progress`.
   */
  export interface Usage {
    /**
     * Number of completion tokens used over the course of the run step.
     */
    completion_tokens: number;

    /**
     * Number of prompt tokens used over the course of the run step.
     */
    prompt_tokens: number;

    /**
     * Total number of tokens used (prompt + completion).
     */
    total_tokens: number;
  }
}

/**
 * The delta containing the fields that have changed on the run step.
 */
export interface RunStepDelta {
  /**
   * The details of the run step.
   */
  step_details?: RunStepDeltaMessageDelta | ToolCallDeltaObject;
}

/**
 * Represents a run step delta i.e. any changed fields on a run step during
 * streaming.
 */
export interface RunStepDeltaEvent {
  /**
   * The identifier of the run step, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The delta containing the fields that have changed on the run step.
   */
  delta: RunStepDelta;

  /**
   * The object type, which is always `thread.run.step.delta`.
   */
  object: 'thread.run.step.delta';
}

/**
 * Details of the message creation by the run step.
 */
export interface RunStepDeltaMessageDelta {
  /**
   * Always `message_creation`.
   */
  type: 'message_creation';

  message_creation?: RunStepDeltaMessageDelta.MessageCreation;
}

export namespace RunStepDeltaMessageDelta {
  export interface MessageCreation {
    /**
     * The ID of the message that was created by this run step.
     */
    message_id?: string;
  }
}

export type RunStepInclude = 'step_details.tool_calls[*].file_search.results[*].content';

/**
 * Details of the Code Interpreter tool call the run step was involved in.
 */
export type ToolCall = CodeInterpreterToolCall | FileSearchToolCall | FunctionToolCall;

/**
 * Details of the Code Interpreter tool call the run step was involved in.
 */
export type ToolCallDelta = CodeInterpreterToolCallDelta | FileSearchToolCallDelta | FunctionToolCallDelta;

/**
 * Details of the tool call.
 */
export interface ToolCallDeltaObject {
  /**
   * Always `tool_calls`.
   */
  type: 'tool_calls';

  /**
   * An array of tool calls the run step was involved in. These can be associated
   * with one of three types of tools: `code_interpreter`, `file_search`, or
   * `function`.
   */
  tool_calls?: Array<ToolCallDelta>;
}

/**
 * Details of the tool call.
 */
export interface ToolCallsStepDetails {
  /**
   * An array of tool calls the run step was involved in. These can be associated
   * with one of three types of tools: `code_interpreter`, `file_search`, or
   * `function`.
   */
  tool_calls: Array<ToolCall>;

  /**
   * Always `tool_calls`.
   */
  type: 'tool_calls';
}

export interface StepRetrieveParams {
  /**
   * A list of additional fields to include in the response. Currently the only
   * supported value is `step_details.tool_calls[*].file_search.results[*].content`
   * to fetch the file search result content.
   *
   * See the
   * [file search tool documentation](https://platform.openai.com/docs/assistants/tools/file-search#customizing-file-search-settings)
   * for more information.
   */
  include?: Array<RunStepInclude>;
}

export interface StepListParams extends CursorPageParams {
  /**
   * A cursor for use in pagination. `before` is an object ID that defines your place
   * in the list. For instance, if you make a list request and receive 100 objects,
   * starting with obj_foo, your subsequent call can include before=obj_foo in order
   * to fetch the previous page of the list.
   */
  before?: string;

  /**
   * A list of additional fields to include in the response. Currently the only
   * supported value is `step_details.tool_calls[*].file_search.results[*].content`
   * to fetch the file search result content.
   *
   * See the
   * [file search tool documentation](https://platform.openai.com/docs/assistants/tools/file-search#customizing-file-search-settings)
   * for more information.
   */
  include?: Array<RunStepInclude>;

  /**
   * Sort order by the `created_at` timestamp of the objects. `asc` for ascending
   * order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';
}

Steps.RunStepsPage = RunStepsPage;

export declare namespace Steps {
  export {
    type CodeInterpreterLogs as CodeInterpreterLogs,
    type CodeInterpreterOutputImage as CodeInterpreterOutputImage,
    type CodeInterpreterToolCall as CodeInterpreterToolCall,
    type CodeInterpreterToolCallDelta as CodeInterpreterToolCallDelta,
    type FileSearchToolCall as FileSearchToolCall,
    type FileSearchToolCallDelta as FileSearchToolCallDelta,
    type FunctionToolCall as FunctionToolCall,
    type FunctionToolCallDelta as FunctionToolCallDelta,
    type MessageCreationStepDetails as MessageCreationStepDetails,
    type RunStep as RunStep,
    type RunStepDelta as RunStepDelta,
    type RunStepDeltaEvent as RunStepDeltaEvent,
    type RunStepDeltaMessageDelta as RunStepDeltaMessageDelta,
    type RunStepInclude as RunStepInclude,
    type ToolCall as ToolCall,
    type ToolCallDelta as ToolCallDelta,
    type ToolCallDeltaObject as ToolCallDeltaObject,
    type ToolCallsStepDetails as ToolCallsStepDetails,
    RunStepsPage as RunStepsPage,
    type StepRetrieveParams as StepRetrieveParams,
    type StepListParams as StepListParams,
  };
}
