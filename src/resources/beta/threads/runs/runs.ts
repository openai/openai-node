// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as RunsAPI from 'openai/resources/beta/threads/runs/runs';
import * as Shared from 'openai/resources/shared';
import * as StepsAPI from 'openai/resources/beta/threads/runs/steps';
import { CursorPage, type CursorPageParams } from 'openai/pagination';

export class Runs extends APIResource {
  steps: StepsAPI.Steps = new StepsAPI.Steps(this._client);

  /**
   * Create a run.
   */
  create(threadId: string, body: RunCreateParams, options?: Core.RequestOptions): Core.APIPromise<Run> {
    return this._client.post(`/threads/${threadId}/runs`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Retrieves a run.
   */
  retrieve(threadId: string, runId: string, options?: Core.RequestOptions): Core.APIPromise<Run> {
    return this._client.get(`/threads/${threadId}/runs/${runId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Modifies a run.
   */
  update(
    threadId: string,
    runId: string,
    body: RunUpdateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Run> {
    return this._client.post(`/threads/${threadId}/runs/${runId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Returns a list of runs belonging to a thread.
   */
  list(
    threadId: string,
    query?: RunListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunsPage, Run>;
  list(threadId: string, options?: Core.RequestOptions): Core.PagePromise<RunsPage, Run>;
  list(
    threadId: string,
    query: RunListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<RunsPage, Run> {
    if (isRequestOptions(query)) {
      return this.list(threadId, {}, query);
    }
    return this._client.getAPIList(`/threads/${threadId}/runs`, RunsPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Cancels a run that is `in_progress`.
   */
  cancel(threadId: string, runId: string, options?: Core.RequestOptions): Core.APIPromise<Run> {
    return this._client.post(`/threads/${threadId}/runs/${runId}/cancel`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * When a run has the `status: "requires_action"` and `required_action.type` is
   * `submit_tool_outputs`, this endpoint can be used to submit the outputs from the
   * tool calls once they're all completed. All outputs must be submitted in a single
   * request.
   */
  submitToolOutputs(
    threadId: string,
    runId: string,
    body: RunSubmitToolOutputsParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Run> {
    return this._client.post(`/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

export class RunsPage extends CursorPage<Run> {}

/**
 * Tool call objects
 */
export interface RequiredActionFunctionToolCall {
  /**
   * The ID of the tool call. This ID must be referenced when you submit the tool
   * outputs in using the
   * [Submit tool outputs to run](https://platform.openai.com/docs/api-reference/runs/submitToolOutputs)
   * endpoint.
   */
  id: string;

  /**
   * The function definition.
   */
  function: RequiredActionFunctionToolCall.Function;

  /**
   * The type of tool call the output is required for. For now, this is always
   * `function`.
   */
  type: 'function';
}

export namespace RequiredActionFunctionToolCall {
  /**
   * The function definition.
   */
  export interface Function {
    /**
     * The arguments that the model expects you to pass to the function.
     */
    arguments: string;

    /**
     * The name of the function.
     */
    name: string;
  }
}

/**
 * Represents an execution run on a
 * [thread](https://platform.openai.com/docs/api-reference/threads).
 */
export interface Run {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The ID of the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) used for
   * execution of this run.
   */
  assistant_id: string;

  /**
   * The Unix timestamp (in seconds) for when the run was cancelled.
   */
  cancelled_at: number | null;

  /**
   * The Unix timestamp (in seconds) for when the run was completed.
   */
  completed_at: number | null;

  /**
   * The Unix timestamp (in seconds) for when the run was created.
   */
  created_at: number;

  /**
   * The Unix timestamp (in seconds) for when the run will expire.
   */
  expires_at: number;

  /**
   * The Unix timestamp (in seconds) for when the run failed.
   */
  failed_at: number | null;

  /**
   * The list of [File](https://platform.openai.com/docs/api-reference/files) IDs the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) used for
   * this run.
   */
  file_ids: Array<string>;

  /**
   * The instructions that the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) used for
   * this run.
   */
  instructions: string;

  /**
   * The last error associated with this run. Will be `null` if there are no errors.
   */
  last_error: Run.LastError | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata: unknown | null;

  /**
   * The model that the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) used for
   * this run.
   */
  model: string;

  /**
   * The object type, which is always `thread.run`.
   */
  object: 'thread.run';

  /**
   * Details on the action required to continue the run. Will be `null` if no action
   * is required.
   */
  required_action: Run.RequiredAction | null;

  /**
   * The Unix timestamp (in seconds) for when the run was started.
   */
  started_at: number | null;

  /**
   * The status of the run, which can be either `queued`, `in_progress`,
   * `requires_action`, `cancelling`, `cancelled`, `failed`, `completed`, or
   * `expired`.
   */
  status:
    | 'queued'
    | 'in_progress'
    | 'requires_action'
    | 'cancelling'
    | 'cancelled'
    | 'failed'
    | 'completed'
    | 'expired';

  /**
   * The ID of the [thread](https://platform.openai.com/docs/api-reference/threads)
   * that was executed on as a part of this run.
   */
  thread_id: string;

  /**
   * The list of tools that the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) used for
   * this run.
   */
  tools: Array<Run.AssistantToolsCode | Run.AssistantToolsRetrieval | Run.AssistantToolsFunction>;
}

export namespace Run {
  /**
   * The last error associated with this run. Will be `null` if there are no errors.
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
   * Details on the action required to continue the run. Will be `null` if no action
   * is required.
   */
  export interface RequiredAction {
    /**
     * Details on the tool outputs needed for this run to continue.
     */
    submit_tool_outputs: RequiredAction.SubmitToolOutputs;

    /**
     * For now, this is always `submit_tool_outputs`.
     */
    type: 'submit_tool_outputs';
  }

  export namespace RequiredAction {
    /**
     * Details on the tool outputs needed for this run to continue.
     */
    export interface SubmitToolOutputs {
      /**
       * A list of the relevant tool calls.
       */
      tool_calls: Array<RunsAPI.RequiredActionFunctionToolCall>;
    }
  }

  export interface AssistantToolsCode {
    /**
     * The type of tool being defined: `code_interpreter`
     */
    type: 'code_interpreter';
  }

  export interface AssistantToolsRetrieval {
    /**
     * The type of tool being defined: `retrieval`
     */
    type: 'retrieval';
  }

  export interface AssistantToolsFunction {
    function: Shared.FunctionDefinition;

    /**
     * The type of tool being defined: `function`
     */
    type: 'function';
  }
}

export interface RunCreateParams {
  /**
   * The ID of the
   * [assistant](https://platform.openai.com/docs/api-reference/assistants) to use to
   * execute this run.
   */
  assistant_id: string;

  /**
   * Override the default system message of the assistant. This is useful for
   * modifying the behavior on a per-run basis.
   */
  instructions?: string | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata?: unknown | null;

  /**
   * The ID of the [Model](https://platform.openai.com/docs/api-reference/models) to
   * be used to execute this run. If a value is provided here, it will override the
   * model associated with the assistant. If not, the model associated with the
   * assistant will be used.
   */
  model?: string | null;

  /**
   * Override the tools the assistant can use for this run. This is useful for
   * modifying the behavior on a per-run basis.
   */
  tools?: Array<
    | RunCreateParams.AssistantToolsCode
    | RunCreateParams.AssistantToolsRetrieval
    | RunCreateParams.AssistantToolsFunction
  > | null;
}

export namespace RunCreateParams {
  export interface AssistantToolsCode {
    /**
     * The type of tool being defined: `code_interpreter`
     */
    type: 'code_interpreter';
  }

  export interface AssistantToolsRetrieval {
    /**
     * The type of tool being defined: `retrieval`
     */
    type: 'retrieval';
  }

  export interface AssistantToolsFunction {
    function: Shared.FunctionDefinition;

    /**
     * The type of tool being defined: `function`
     */
    type: 'function';
  }
}

export interface RunUpdateParams {
  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata?: unknown | null;
}

export interface RunListParams extends CursorPageParams {
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

export interface RunSubmitToolOutputsParams {
  /**
   * A list of tools for which the outputs are being submitted.
   */
  tool_outputs: Array<RunSubmitToolOutputsParams.ToolOutput>;
}

export namespace RunSubmitToolOutputsParams {
  export interface ToolOutput {
    /**
     * The output of the tool call to be submitted to continue the run.
     */
    output?: string;

    /**
     * The ID of the tool call in the `required_action` object within the run object
     * the output is being submitted for.
     */
    tool_call_id?: string;
  }
}

export namespace Runs {
  export import RequiredActionFunctionToolCall = RunsAPI.RequiredActionFunctionToolCall;
  export import Run = RunsAPI.Run;
  export import RunsPage = RunsAPI.RunsPage;
  export import RunCreateParams = RunsAPI.RunCreateParams;
  export import RunUpdateParams = RunsAPI.RunUpdateParams;
  export import RunListParams = RunsAPI.RunListParams;
  export import RunSubmitToolOutputsParams = RunsAPI.RunSubmitToolOutputsParams;
  export import Steps = StepsAPI.Steps;
  export import CodeToolCall = StepsAPI.CodeToolCall;
  export import FunctionToolCall = StepsAPI.FunctionToolCall;
  export import MessageCreationStepDetails = StepsAPI.MessageCreationStepDetails;
  export import RetrievalToolCall = StepsAPI.RetrievalToolCall;
  export import RunStep = StepsAPI.RunStep;
  export import ToolCallsStepDetails = StepsAPI.ToolCallsStepDetails;
  export import RunStepsPage = StepsAPI.RunStepsPage;
  export import StepListParams = StepsAPI.StepListParams;
}
