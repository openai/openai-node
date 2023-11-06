// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import * as ThreadsAPI from 'openai/resources/beta/threads/threads';
import * as MessagesAPI from 'openai/resources/beta/threads/messages/messages';
import * as RunsAPI from 'openai/resources/beta/threads/runs/runs';

export class Threads extends APIResource {
  runs: RunsAPI.Runs = new RunsAPI.Runs(this.client);
  messages: MessagesAPI.Messages = new MessagesAPI.Messages(this.client);

  /**
   * Create a Thread.
   */
  create(body: ThreadCreateParams, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this.post('/threads', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Retrieves a Thread.
   */
  retrieve(threadId: string, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this.get(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Modifies a Thread.
   */
  update(threadId: string, body: ThreadUpdateParams, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this.post(`/threads/${threadId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Delete a Thread.
   */
  del(threadId: string, options?: Core.RequestOptions): Core.APIPromise<ThreadDeleted> {
    return this.delete(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Create a Thread and Run it in one request.
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
 * Represents a Thread that contains
 * [Messages](https://platform.openai.com/docs/api-reference/messages).
 */
export interface Thread {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the Thread was created.
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
   * A list of [Messages](https://platform.openai.com/docs/api-reference/messages) to
   * start the Thread with.
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
     * The content of the Message.
     */
    content: string;

    /**
     * The role of the entity that is creating the Message. Currently only `user` is
     * supported.
     */
    role: 'user';

    /**
     * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
     * the Message should use. There can be a maximum of 10 files attached to a
     * Message. Useful for tools like `retrieval` and `code_interpreter` that can
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
   * [Assistant](https://platform.openai.com/docs/api-reference/assistants) to use to
   * execute this Run.
   */
  assistant_id: string;

  /**
   * Override the default system message of the Assistant. This is useful for
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
   * be used to execute this Run. If a value is provided here, it will override the
   * model associated with the Assistant. If not, the model associated with the
   * Assistant will be used.
   */
  model?: string | null;

  /**
   * If no Thread is provided, an empty Thread will be created.
   */
  thread?: ThreadCreateAndRunParams.Thread;

  /**
   * Override the tools the Assistant can use for this Run. This is useful for
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
   * If no Thread is provided, an empty Thread will be created.
   */
  export interface Thread {
    /**
     * A list of [Messages](https://platform.openai.com/docs/api-reference/messages) to
     * start the Thread with.
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
       * The content of the Message.
       */
      content: string;

      /**
       * The role of the entity that is creating the Message. Currently only `user` is
       * supported.
       */
      role: 'user';

      /**
       * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
       * the Message should use. There can be a maximum of 10 files attached to a
       * Message. Useful for tools like `retrieval` and `code_interpreter` that can
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
     * The type of tool being defined: `retreival`
     */
    type: 'retreival';
  }

  export interface AssistantToolsFunction {
    /**
     * The function definition.
     */
    function: AssistantToolsFunction.Function;

    /**
     * The type of tool being defined: `function`
     */
    type: 'function';
  }

  export namespace AssistantToolsFunction {
    /**
     * The function definition.
     */
    export interface Function {
      /**
       * A description of what the function does, used by the model to choose when and
       * how to call the function.
       */
      description: string;

      /**
       * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain
       * underscores and dashes, with a maximum length of 64.
       */
      name: string;

      /**
       * The parameters the functions accepts, described as a JSON Schema object. See the
       * [guide](https://platform.openai.com/docs/guides/gpt/function-calling) for
       * examples, and the
       * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
       * documentation about the format.
       *
       * To describe a function that accepts no parameters, provide the value
       * `{"type": "object", "properties": {}}`.
       */
      parameters: Record<string, unknown>;
    }
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
