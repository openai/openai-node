// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as AssistantsAPI from 'openai/resources/beta/assistants/assistants';
import * as Shared from 'openai/resources/shared';
import * as FilesAPI from 'openai/resources/beta/assistants/files';
import * as ThreadsAPI from 'openai/resources/beta/threads/threads';
import * as MessagesAPI from 'openai/resources/beta/threads/messages/messages';
import * as RunsAPI from 'openai/resources/beta/threads/runs/runs';
import * as StepsAPI from 'openai/resources/beta/threads/runs/steps';
import { CursorPage, type CursorPageParams } from 'openai/pagination';

export class Assistants extends APIResource {
  files: FilesAPI.Files = new FilesAPI.Files(this._client);

  /**
   * Create an assistant with a model and instructions.
   */
  create(body: AssistantCreateParams, options?: Core.RequestOptions): Core.APIPromise<Assistant> {
    return this._client.post('/assistants', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Retrieves an assistant.
   */
  retrieve(assistantId: string, options?: Core.RequestOptions): Core.APIPromise<Assistant> {
    return this._client.get(`/assistants/${assistantId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Modifies an assistant.
   */
  update(
    assistantId: string,
    body: AssistantUpdateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<Assistant> {
    return this._client.post(`/assistants/${assistantId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Returns a list of assistants.
   */
  list(
    query?: AssistantListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<AssistantsPage, Assistant>;
  list(options?: Core.RequestOptions): Core.PagePromise<AssistantsPage, Assistant>;
  list(
    query: AssistantListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<AssistantsPage, Assistant> {
    if (isRequestOptions(query)) {
      return this.list({}, query);
    }
    return this._client.getAPIList('/assistants', AssistantsPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Delete an assistant.
   */
  del(assistantId: string, options?: Core.RequestOptions): Core.APIPromise<AssistantDeleted> {
    return this._client.delete(`/assistants/${assistantId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

export class AssistantsPage extends CursorPage<Assistant> {}

/**
 * Represents an `assistant` that can call the model and use tools.
 */
export interface Assistant {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the assistant was created.
   */
  created_at: number;

  /**
   * The description of the assistant. The maximum length is 512 characters.
   */
  description: string | null;

  /**
   * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs
   * attached to this assistant. There can be a maximum of 20 files attached to the
   * assistant. Files are ordered by their creation date in ascending order.
   */
  file_ids: Array<string>;

  /**
   * The system instructions that the assistant uses. The maximum length is 256,000
   * characters.
   */
  instructions: string | null;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata: unknown | null;

  /**
   * ID of the model to use. You can use the
   * [List models](https://platform.openai.com/docs/api-reference/models/list) API to
   * see all of your available models, or see our
   * [Model overview](https://platform.openai.com/docs/models/overview) for
   * descriptions of them.
   */
  model: string;

  /**
   * The name of the assistant. The maximum length is 256 characters.
   */
  name: string | null;

  /**
   * The object type, which is always `assistant`.
   */
  object: 'assistant';

  /**
   * A list of tool enabled on the assistant. There can be a maximum of 128 tools per
   * assistant. Tools can be of types `code_interpreter`, `retrieval`, or `function`.
   */
  tools: Array<AssistantTool>;
}

export interface AssistantDeleted {
  id: string;

  deleted: boolean;

  object: 'assistant.deleted';
}

/**
 * Represents an event emitted when streaming a Run.
 *
 * Each event in a server-sent events stream has an `event` and `data` property:
 *
 * ```
 * event: thread.created
 * data: {"id": "thread_123", "object": "thread", ...}
 * ```
 *
 * We emit events whenever a new object is created, transitions to a new state, or
 * is being streamed in parts (deltas). For example, we emit `thread.run.created`
 * when a new run is created, `thread.run.completed` when a run completes, and so
 * on. When an Assistant chooses to create a message during a run, we emit a
 * `thread.message.created event`, a `thread.message.in_progress` event, many
 * `thread.message.delta` events, and finally a `thread.message.completed` event.
 *
 * We may add additional events over time, so we recommend handling unknown events
 * gracefully in your code. See the
 * [Assistants API quickstart](https://platform.openai.com/docs/assistants/overview)
 * to learn how to integrate the Assistants API with streaming.
 */
export type AssistantStreamEvent =
  | AssistantStreamEvent.ThreadCreated
  | AssistantStreamEvent.ThreadRunCreated
  | AssistantStreamEvent.ThreadRunQueued
  | AssistantStreamEvent.ThreadRunInProgress
  | AssistantStreamEvent.ThreadRunRequiresAction
  | AssistantStreamEvent.ThreadRunCompleted
  | AssistantStreamEvent.ThreadRunFailed
  | AssistantStreamEvent.ThreadRunCancelling
  | AssistantStreamEvent.ThreadRunCancelled
  | AssistantStreamEvent.ThreadRunExpired
  | AssistantStreamEvent.ThreadRunStepCreated
  | AssistantStreamEvent.ThreadRunStepInProgress
  | AssistantStreamEvent.ThreadRunStepDelta
  | AssistantStreamEvent.ThreadRunStepCompleted
  | AssistantStreamEvent.ThreadRunStepFailed
  | AssistantStreamEvent.ThreadRunStepCancelled
  | AssistantStreamEvent.ThreadRunStepExpired
  | AssistantStreamEvent.ThreadMessageCreated
  | AssistantStreamEvent.ThreadMessageInProgress
  | AssistantStreamEvent.ThreadMessageDelta
  | AssistantStreamEvent.ThreadMessageCompleted
  | AssistantStreamEvent.ThreadMessageIncomplete
  | AssistantStreamEvent.ErrorEvent;

export namespace AssistantStreamEvent {
  /**
   * Occurs when a new
   * [thread](https://platform.openai.com/docs/api-reference/threads/object) is
   * created.
   */
  export interface ThreadCreated {
    /**
     * Represents a thread that contains
     * [messages](https://platform.openai.com/docs/api-reference/messages).
     */
    data: ThreadsAPI.Thread;

    event: 'thread.created';
  }

  /**
   * Occurs when a new
   * [run](https://platform.openai.com/docs/api-reference/runs/object) is created.
   */
  export interface ThreadRunCreated {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.created';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `queued` status.
   */
  export interface ThreadRunQueued {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.queued';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to an `in_progress` status.
   */
  export interface ThreadRunInProgress {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.in_progress';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `requires_action` status.
   */
  export interface ThreadRunRequiresAction {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.requires_action';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * is completed.
   */
  export interface ThreadRunCompleted {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.completed';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * fails.
   */
  export interface ThreadRunFailed {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.failed';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `cancelling` status.
   */
  export interface ThreadRunCancelling {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.cancelling';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * is cancelled.
   */
  export interface ThreadRunCancelled {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.cancelled';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * expires.
   */
  export interface ThreadRunExpired {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.expired';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * created.
   */
  export interface ThreadRunStepCreated {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.created';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * moves to an `in_progress` state.
   */
  export interface ThreadRunStepInProgress {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.in_progress';
  }

  /**
   * Occurs when parts of a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) are
   * being streamed.
   */
  export interface ThreadRunStepDelta {
    /**
     * Represents a run step delta i.e. any changed fields on a run step during
     * streaming.
     */
    data: StepsAPI.RunStepDeltaEvent;

    event: 'thread.run.step.delta';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * completed.
   */
  export interface ThreadRunStepCompleted {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.completed';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * fails.
   */
  export interface ThreadRunStepFailed {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.failed';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * cancelled.
   */
  export interface ThreadRunStepCancelled {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.cancelled';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * expires.
   */
  export interface ThreadRunStepExpired {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.expired';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) is
   * created.
   */
  export interface ThreadMessageCreated {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.created';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) moves
   * to an `in_progress` state.
   */
  export interface ThreadMessageInProgress {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.in_progress';
  }

  /**
   * Occurs when parts of a
   * [Message](https://platform.openai.com/docs/api-reference/messages/object) are
   * being streamed.
   */
  export interface ThreadMessageDelta {
    /**
     * Represents a message delta i.e. any changed fields on a message during
     * streaming.
     */
    data: MessagesAPI.MessageDeltaEvent;

    event: 'thread.message.delta';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) is
   * completed.
   */
  export interface ThreadMessageCompleted {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.completed';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) ends
   * before it is completed.
   */
  export interface ThreadMessageIncomplete {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.incomplete';
  }

  /**
   * Occurs when an
   * [error](https://platform.openai.com/docs/guides/error-codes/api-errors) occurs.
   * This can happen due to an internal server error or a timeout.
   */
  export interface ErrorEvent {
    data: Shared.ErrorObject;

    event: 'error';
  }
}

export type AssistantTool = CodeInterpreterTool | RetrievalTool | FunctionTool;

export interface CodeInterpreterTool {
  /**
   * The type of tool being defined: `code_interpreter`
   */
  type: 'code_interpreter';
}

export interface FunctionTool {
  function: Shared.FunctionDefinition;

  /**
   * The type of tool being defined: `function`
   */
  type: 'function';
}

/**
 * Occurs when a
 * [message](https://platform.openai.com/docs/api-reference/messages/object) is
 * created.
 */
export type MessageStreamEvent =
  | MessageStreamEvent.ThreadMessageCreated
  | MessageStreamEvent.ThreadMessageInProgress
  | MessageStreamEvent.ThreadMessageDelta
  | MessageStreamEvent.ThreadMessageCompleted
  | MessageStreamEvent.ThreadMessageIncomplete;

export namespace MessageStreamEvent {
  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) is
   * created.
   */
  export interface ThreadMessageCreated {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.created';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) moves
   * to an `in_progress` state.
   */
  export interface ThreadMessageInProgress {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.in_progress';
  }

  /**
   * Occurs when parts of a
   * [Message](https://platform.openai.com/docs/api-reference/messages/object) are
   * being streamed.
   */
  export interface ThreadMessageDelta {
    /**
     * Represents a message delta i.e. any changed fields on a message during
     * streaming.
     */
    data: MessagesAPI.MessageDeltaEvent;

    event: 'thread.message.delta';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) is
   * completed.
   */
  export interface ThreadMessageCompleted {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.completed';
  }

  /**
   * Occurs when a
   * [message](https://platform.openai.com/docs/api-reference/messages/object) ends
   * before it is completed.
   */
  export interface ThreadMessageIncomplete {
    /**
     * Represents a message within a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: MessagesAPI.Message;

    event: 'thread.message.incomplete';
  }
}

export interface RetrievalTool {
  /**
   * The type of tool being defined: `retrieval`
   */
  type: 'retrieval';
}

/**
 * Occurs when a
 * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
 * created.
 */
export type RunStepStreamEvent =
  | RunStepStreamEvent.ThreadRunStepCreated
  | RunStepStreamEvent.ThreadRunStepInProgress
  | RunStepStreamEvent.ThreadRunStepDelta
  | RunStepStreamEvent.ThreadRunStepCompleted
  | RunStepStreamEvent.ThreadRunStepFailed
  | RunStepStreamEvent.ThreadRunStepCancelled
  | RunStepStreamEvent.ThreadRunStepExpired;

export namespace RunStepStreamEvent {
  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * created.
   */
  export interface ThreadRunStepCreated {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.created';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * moves to an `in_progress` state.
   */
  export interface ThreadRunStepInProgress {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.in_progress';
  }

  /**
   * Occurs when parts of a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) are
   * being streamed.
   */
  export interface ThreadRunStepDelta {
    /**
     * Represents a run step delta i.e. any changed fields on a run step during
     * streaming.
     */
    data: StepsAPI.RunStepDeltaEvent;

    event: 'thread.run.step.delta';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * completed.
   */
  export interface ThreadRunStepCompleted {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.completed';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * fails.
   */
  export interface ThreadRunStepFailed {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.failed';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object) is
   * cancelled.
   */
  export interface ThreadRunStepCancelled {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.cancelled';
  }

  /**
   * Occurs when a
   * [run step](https://platform.openai.com/docs/api-reference/runs/step-object)
   * expires.
   */
  export interface ThreadRunStepExpired {
    /**
     * Represents a step in execution of a run.
     */
    data: StepsAPI.RunStep;

    event: 'thread.run.step.expired';
  }
}

/**
 * Occurs when a new
 * [run](https://platform.openai.com/docs/api-reference/runs/object) is created.
 */
export type RunStreamEvent =
  | RunStreamEvent.ThreadRunCreated
  | RunStreamEvent.ThreadRunQueued
  | RunStreamEvent.ThreadRunInProgress
  | RunStreamEvent.ThreadRunRequiresAction
  | RunStreamEvent.ThreadRunCompleted
  | RunStreamEvent.ThreadRunFailed
  | RunStreamEvent.ThreadRunCancelling
  | RunStreamEvent.ThreadRunCancelled
  | RunStreamEvent.ThreadRunExpired;

export namespace RunStreamEvent {
  /**
   * Occurs when a new
   * [run](https://platform.openai.com/docs/api-reference/runs/object) is created.
   */
  export interface ThreadRunCreated {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.created';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `queued` status.
   */
  export interface ThreadRunQueued {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.queued';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to an `in_progress` status.
   */
  export interface ThreadRunInProgress {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.in_progress';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `requires_action` status.
   */
  export interface ThreadRunRequiresAction {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.requires_action';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * is completed.
   */
  export interface ThreadRunCompleted {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.completed';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * fails.
   */
  export interface ThreadRunFailed {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.failed';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * moves to a `cancelling` status.
   */
  export interface ThreadRunCancelling {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.cancelling';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * is cancelled.
   */
  export interface ThreadRunCancelled {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.cancelled';
  }

  /**
   * Occurs when a [run](https://platform.openai.com/docs/api-reference/runs/object)
   * expires.
   */
  export interface ThreadRunExpired {
    /**
     * Represents an execution run on a
     * [thread](https://platform.openai.com/docs/api-reference/threads).
     */
    data: RunsAPI.Run;

    event: 'thread.run.expired';
  }
}

/**
 * Occurs when a new
 * [thread](https://platform.openai.com/docs/api-reference/threads/object) is
 * created.
 */
export interface ThreadStreamEvent {
  /**
   * Represents a thread that contains
   * [messages](https://platform.openai.com/docs/api-reference/messages).
   */
  data: ThreadsAPI.Thread;

  event: 'thread.created';
}

export interface AssistantCreateParams {
  /**
   * ID of the model to use. You can use the
   * [List models](https://platform.openai.com/docs/api-reference/models/list) API to
   * see all of your available models, or see our
   * [Model overview](https://platform.openai.com/docs/models/overview) for
   * descriptions of them.
   */
  model:
    | (string & {})
    | 'gpt-4-turbo'
    | 'gpt-4-turbo-2024-04-09'
    | 'gpt-4-0125-preview'
    | 'gpt-4-turbo-preview'
    | 'gpt-4-1106-preview'
    | 'gpt-4-vision-preview'
    | 'gpt-4'
    | 'gpt-4-0314'
    | 'gpt-4-0613'
    | 'gpt-4-32k'
    | 'gpt-4-32k-0314'
    | 'gpt-4-32k-0613'
    | 'gpt-3.5-turbo'
    | 'gpt-3.5-turbo-16k'
    | 'gpt-3.5-turbo-0613'
    | 'gpt-3.5-turbo-1106'
    | 'gpt-3.5-turbo-0125'
    | 'gpt-3.5-turbo-16k-0613';

  /**
   * The description of the assistant. The maximum length is 512 characters.
   */
  description?: string | null;

  /**
   * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs
   * attached to this assistant. There can be a maximum of 20 files attached to the
   * assistant. Files are ordered by their creation date in ascending order.
   */
  file_ids?: Array<string>;

  /**
   * The system instructions that the assistant uses. The maximum length is 256,000
   * characters.
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
   * The name of the assistant. The maximum length is 256 characters.
   */
  name?: string | null;

  /**
   * A list of tool enabled on the assistant. There can be a maximum of 128 tools per
   * assistant. Tools can be of types `code_interpreter`, `retrieval`, or `function`.
   */
  tools?: Array<AssistantTool>;
}

export interface AssistantUpdateParams {
  /**
   * The description of the assistant. The maximum length is 512 characters.
   */
  description?: string | null;

  /**
   * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs
   * attached to this assistant. There can be a maximum of 20 files attached to the
   * assistant. Files are ordered by their creation date in ascending order. If a
   * file was previously attached to the list but does not show up in the list, it
   * will be deleted from the assistant.
   */
  file_ids?: Array<string>;

  /**
   * The system instructions that the assistant uses. The maximum length is 256,000
   * characters.
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
   * ID of the model to use. You can use the
   * [List models](https://platform.openai.com/docs/api-reference/models/list) API to
   * see all of your available models, or see our
   * [Model overview](https://platform.openai.com/docs/models/overview) for
   * descriptions of them.
   */
  model?: string;

  /**
   * The name of the assistant. The maximum length is 256 characters.
   */
  name?: string | null;

  /**
   * A list of tool enabled on the assistant. There can be a maximum of 128 tools per
   * assistant. Tools can be of types `code_interpreter`, `retrieval`, or `function`.
   */
  tools?: Array<AssistantTool>;
}

export interface AssistantListParams extends CursorPageParams {
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

export namespace Assistants {
  export import Assistant = AssistantsAPI.Assistant;
  export import AssistantDeleted = AssistantsAPI.AssistantDeleted;
  export import AssistantStreamEvent = AssistantsAPI.AssistantStreamEvent;
  export import AssistantTool = AssistantsAPI.AssistantTool;
  export import CodeInterpreterTool = AssistantsAPI.CodeInterpreterTool;
  export import FunctionTool = AssistantsAPI.FunctionTool;
  export import MessageStreamEvent = AssistantsAPI.MessageStreamEvent;
  export import RetrievalTool = AssistantsAPI.RetrievalTool;
  export import RunStepStreamEvent = AssistantsAPI.RunStepStreamEvent;
  export import RunStreamEvent = AssistantsAPI.RunStreamEvent;
  export import ThreadStreamEvent = AssistantsAPI.ThreadStreamEvent;
  export import AssistantsPage = AssistantsAPI.AssistantsPage;
  export import AssistantCreateParams = AssistantsAPI.AssistantCreateParams;
  export import AssistantUpdateParams = AssistantsAPI.AssistantUpdateParams;
  export import AssistantListParams = AssistantsAPI.AssistantListParams;
  export import Files = FilesAPI.Files;
  export import AssistantFile = FilesAPI.AssistantFile;
  export import FileDeleteResponse = FilesAPI.FileDeleteResponse;
  export import AssistantFilesPage = FilesAPI.AssistantFilesPage;
  export import FileCreateParams = FilesAPI.FileCreateParams;
  export import FileListParams = FilesAPI.FileListParams;
}
