// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as ThreadsAPI from 'openai/resources/beta/threads/threads';
import * as Shared from 'openai/resources/shared';
import * as MessagesAPI from 'openai/resources/beta/threads/messages/messages';
import * as RunsAPI from 'openai/resources/beta/threads/runs/runs';

export class Threads extends APIResource {
  runs: RunsAPI.Runs = new RunsAPI.Runs(this.client);
  messages: MessagesAPI.Messages = new MessagesAPI.Messages(this.client);

  /**
   * Create a thread.
   */
  create(body?: ThreadCreateParams, options?: Core.RequestOptions): Core.APIPromise<Thread>;
  create(options?: Core.RequestOptions): Core.APIPromise<Thread>;
  create(
    body: ThreadCreateParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.APIPromise<Thread> {
    if (isRequestOptions(body)) {
      return this.create({}, body);
    }
    return this.post('/threads', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Retrieves a thread.
   */
  retrieve(threadId: string, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this.get(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Modifies a thread.
   */
  update(threadId: string, body: ThreadUpdateParams, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this.post(`/threads/${threadId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Delete a thread.
   */
  del(threadId: string, options?: Core.RequestOptions): Core.APIPromise<ThreadDeleted> {
    return this.delete(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Create a thread and run it in one request.
   */
  createAndRun(body: ThreadCreateAndRunParams, options?: Core.RequestOptions): Core.APIPromise<RunsAPI.Run> {
    return this.post('/threads/runs', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

/**
 * Represents a thread that contains
 * [messages](https://platform.openai.com/docs/api-reference/messages).
 */
export interface Thread {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the thread was created.
   */
  created_at: number;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata: unknown | null;

  /**
   * The object type, which is always `thread`.
   */
  object: 'thread';
}

export interface ThreadDeleted {
  id: string;

  deleted: boolean;

  object: 'thread.deleted';
}

export interface ThreadCreateParams {
  /**
   * A list of [messages](https://platform.openai.com/docs/api-reference/messages) to
   * start the thread with.
   */
  messages?: Array<ThreadCreateParams.Message>;

  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata?: unknown | null;
}

export namespace ThreadCreateParams {
  export interface Message {
    /**
     * The content of the message.
     */
    content: string;

    /**
     * The role of the entity that is creating the message. Currently only `user` is
     * supported.
     */
    role: 'user';

    /**
     * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
     * the message should use. There can be a maximum of 10 files attached to a
     * message. Useful for tools like `retrieval` and `code_interpreter` that can
     * access and use files.
     */
    file_ids?: Array<string>;

    /**
     * Set of 16 key-value pairs that can be attached to an object. This can be useful
     * for storing additional information about the object in a structured format. Keys
     * can be a maximum of 64 characters long and values can be a maxium of 512
     * characters long.
     */
    metadata?: unknown | null;
  }
}

export interface ThreadUpdateParams {
  /**
   * Set of 16 key-value pairs that can be attached to an object. This can be useful
   * for storing additional information about the object in a structured format. Keys
   * can be a maximum of 64 characters long and values can be a maxium of 512
   * characters long.
   */
  metadata?: unknown | null;
}

export interface ThreadCreateAndRunParams {
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
   * If no thread is provided, an empty thread will be created.
   */
  thread?: ThreadCreateAndRunParams.Thread;

  /**
   * Override the tools the assistant can use for this run. This is useful for
   * modifying the behavior on a per-run basis.
   */
  tools?: Array<
    | ThreadCreateAndRunParams.AssistantToolsCode
    | ThreadCreateAndRunParams.AssistantToolsRetrieval
    | ThreadCreateAndRunParams.AssistantToolsFunction
  > | null;
}

export namespace ThreadCreateAndRunParams {
  /**
   * If no thread is provided, an empty thread will be created.
   */
  export interface Thread {
    /**
     * A list of [messages](https://platform.openai.com/docs/api-reference/messages) to
     * start the thread with.
     */
    messages?: Array<Thread.Message>;

    /**
     * Set of 16 key-value pairs that can be attached to an object. This can be useful
     * for storing additional information about the object in a structured format. Keys
     * can be a maximum of 64 characters long and values can be a maxium of 512
     * characters long.
     */
    metadata?: unknown | null;
  }

  export namespace Thread {
    export interface Message {
      /**
       * The content of the message.
       */
      content: string;

      /**
       * The role of the entity that is creating the message. Currently only `user` is
       * supported.
       */
      role: 'user';

      /**
       * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
       * the message should use. There can be a maximum of 10 files attached to a
       * message. Useful for tools like `retrieval` and `code_interpreter` that can
       * access and use files.
       */
      file_ids?: Array<string>;

      /**
       * Set of 16 key-value pairs that can be attached to an object. This can be useful
       * for storing additional information about the object in a structured format. Keys
       * can be a maximum of 64 characters long and values can be a maxium of 512
       * characters long.
       */
      metadata?: unknown | null;
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
    function: Shared.FunctionObject;

    /**
     * The type of tool being defined: `function`
     */
    type: 'function';
  }
}

export namespace Threads {
  export import Thread = ThreadsAPI.Thread;
  export import ThreadDeleted = ThreadsAPI.ThreadDeleted;
  export import ThreadCreateParams = ThreadsAPI.ThreadCreateParams;
  export import ThreadUpdateParams = ThreadsAPI.ThreadUpdateParams;
  export import ThreadCreateAndRunParams = ThreadsAPI.ThreadCreateAndRunParams;
  export import Runs = RunsAPI.Runs;
  export import RequiredActionFunctionToolCall = RunsAPI.RequiredActionFunctionToolCall;
  export import Run = RunsAPI.Run;
  export import RunsPage = RunsAPI.RunsPage;
  export import RunCreateParams = RunsAPI.RunCreateParams;
  export import RunUpdateParams = RunsAPI.RunUpdateParams;
  export import RunListParams = RunsAPI.RunListParams;
  export import RunSubmitToolOutputsParams = RunsAPI.RunSubmitToolOutputsParams;
  export import Messages = MessagesAPI.Messages;
  export import MessageContentImageFile = MessagesAPI.MessageContentImageFile;
  export import MessageContentText = MessagesAPI.MessageContentText;
  export import ThreadMessage = MessagesAPI.ThreadMessage;
  export import ThreadMessageDeleted = MessagesAPI.ThreadMessageDeleted;
  export import ThreadMessagesPage = MessagesAPI.ThreadMessagesPage;
  export import MessageCreateParams = MessagesAPI.MessageCreateParams;
  export import MessageUpdateParams = MessagesAPI.MessageUpdateParams;
  export import MessageListParams = MessagesAPI.MessageListParams;
}
