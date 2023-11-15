// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as StepsAPI from 'openai/resources/beta/threads/runs/steps';
import { CursorPage, type CursorPageParams } from 'openai/pagination';

export class Steps extends APIResource {
  /**
   * Retrieves a run step.
   */
  retrieve(
    threadId: string,
    runId: string,
    stepId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<RunStep> {
    return this._client.get(`/threads/${threadId}/runs/${runId}/steps/${stepId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
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
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

export class RunStepsPage extends CursorPage<RunStep> {}

/**
 * Details of the Code Interpreter tool call the run step was involved in.
 */
export interface CodeToolCall {
  /**
   * The ID of the tool call.
   */
  id: string;

  /**
   * The Code Interpreter tool call definition.
   */
  code_interpreter: CodeToolCall.CodeInterpreter;

  /**
   * The type of tool call. This is always going to be `code_interpreter` for this
   * type of tool call.
   */
  type: 'code_interpreter';
}

export namespace CodeToolCall {
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

/**
 * Details of the message creation by the run step.
 */
export interface MessageCreationStepDetails {
  message_creation: MessageCreationStepDetails.MessageCreation;

  /**
   * Always `message_creation``.
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

export interface RetrievalToolCall {
  /**
   * The ID of the tool call object.
   */
  id: string;

  /**
   * For now, this is always going to be an empty object.
   */
  retrieval: unknown;

  /**
   * The type of tool call. This is always going to be `retrieval` for this type of
   * tool call.
   */
  type: 'retrieval';
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
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata: unknown | null;

  /**
   * The object type, which is always `thread.run.step``.
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
}

/**
 * Details of the tool call.
 */
export interface ToolCallsStepDetails {
  /**
   * An array of tool calls the run step was involved in. These can be associated
   * with one of three types of tools: `code_interpreter`, `retrieval`, or
   * `function`.
   */
  tool_calls: Array<CodeToolCall | RetrievalToolCall | FunctionToolCall>;

  /**
   * Always `tool_calls`.
   */
  type: 'tool_calls';
}

export interface StepListParams extends CursorPageParams {
  /**
   * A cursor for use in pagination. `before` is an object ID that defines your place
   * in the list. For instance, if you make a list request and receive 100 objects,
   * ending with obj_foo, your subsequent call can include before=obj_foo in order to
   * fetch the previous page of the list.
   */
  before?: string;

  /**
   * Sort order by the `created_at` timestamp of the objects. `asc` for ascending
   * order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';
}

export namespace Steps {
  export import CodeToolCall = StepsAPI.CodeToolCall;
  export import FunctionToolCall = StepsAPI.FunctionToolCall;
  export import MessageCreationStepDetails = StepsAPI.MessageCreationStepDetails;
  export import RetrievalToolCall = StepsAPI.RetrievalToolCall;
  export import RunStep = StepsAPI.RunStep;
  export import ToolCallsStepDetails = StepsAPI.ToolCallsStepDetails;
  export import RunStepsPage = StepsAPI.RunStepsPage;
  export import StepListParams = StepsAPI.StepListParams;
}
