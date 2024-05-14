// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as Core from '../../../core';
import { APIPromise } from '../../../core';
import { APIResource } from '../../../resource';
import { isRequestOptions } from '../../../core';
import { AssistantStream, ThreadCreateAndRunParamsBaseStream } from '../../../lib/AssistantStream';
import * as ThreadsAPI from './threads';
import * as AssistantsAPI from '../assistants';
import * as MessagesAPI from './messages';
import * as RunsAPI from './runs/runs';
import { Stream } from '../../../streaming';

export class Threads extends APIResource {
  runs: RunsAPI.Runs = new RunsAPI.Runs(this._client);
  messages: MessagesAPI.Messages = new MessagesAPI.Messages(this._client);

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
    return this._client.post('/threads', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Retrieves a thread.
   */
  retrieve(threadId: string, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this._client.get(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Modifies a thread.
   */
  update(threadId: string, body: ThreadUpdateParams, options?: Core.RequestOptions): Core.APIPromise<Thread> {
    return this._client.post(`/threads/${threadId}`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Delete a thread.
   */
  del(threadId: string, options?: Core.RequestOptions): Core.APIPromise<ThreadDeleted> {
    return this._client.delete(`/threads/${threadId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Create a thread and run it in one request.
   */
  createAndRun(
    body: ThreadCreateAndRunParamsNonStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<RunsAPI.Run>;
  createAndRun(
    body: ThreadCreateAndRunParamsStreaming,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<AssistantsAPI.AssistantStreamEvent>>;
  createAndRun(
    body: ThreadCreateAndRunParamsBase,
    options?: Core.RequestOptions,
  ): APIPromise<Stream<AssistantsAPI.AssistantStreamEvent> | RunsAPI.Run>;
  createAndRun(
    body: ThreadCreateAndRunParams,
    options?: Core.RequestOptions,
  ): APIPromise<RunsAPI.Run> | APIPromise<Stream<AssistantsAPI.AssistantStreamEvent>> {
    return this._client.post('/threads/runs', {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
      stream: body.stream ?? false,
    }) as APIPromise<RunsAPI.Run> | APIPromise<Stream<AssistantsAPI.AssistantStreamEvent>>;
  }

  /**
   * A helper to create a thread, start a run and then poll for a terminal state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndRunPoll(
    body: ThreadCreateAndRunParamsNonStreaming,
    options?: Core.RequestOptions & { pollIntervalMs?: number },
  ): Promise<Threads.Run> {
    const run = await this.createAndRun(body, options);
    return await this.runs.poll(run.thread_id, run.id, options);
  }

  /**
   * Create a thread and stream the run back
   */
  createAndRunStream(
    body: ThreadCreateAndRunParamsBaseStream,
    options?: Core.RequestOptions,
  ): AssistantStream {
    return AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
  }
}

/**
 * An object describing the expected output of the model. If `json_object` only
 * `function` type `tools` are allowed to be passed to the Run. If `text` the model
 * can return text or any value needed.
 */
export interface AssistantResponseFormat {
  /**
   * Must be one of `text` or `json_object`.
   */
  type?: 'text' | 'json_object';
}

/**
 * Specifies the format that the model must output. Compatible with
 * [GPT-4o](https://platform.openai.com/docs/models/gpt-4o),
 * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4),
 * and all GPT-3.5 Turbo models since `gpt-3.5-turbo-1106`.
 *
 * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
 * message the model generates is valid JSON.
 *
 * **Important:** when using JSON mode, you **must** also instruct the model to
 * produce JSON yourself via a system or user message. Without this, the model may
 * generate an unending stream of whitespace until the generation reaches the token
 * limit, resulting in a long-running and seemingly "stuck" request. Also note that
 * the message content may be partially cut off if `finish_reason="length"`, which
 * indicates the generation exceeded `max_tokens` or the conversation exceeded the
 * max context length.
 */
export type AssistantResponseFormatOption = 'none' | 'auto' | AssistantResponseFormat;

/**
 * Specifies a tool the model should use. Use to force the model to call a specific
 * tool.
 */
export interface AssistantToolChoice {
  /**
   * The type of the tool. If type is `function`, the function name must be set
   */
  type: 'function' | 'code_interpreter' | 'file_search';

  function?: AssistantToolChoiceFunction;
}

export interface AssistantToolChoiceFunction {
  /**
   * The name of the function to call.
   */
  name: string;
}

/**
 * Controls which (if any) tool is called by the model. `none` means the model will
 * not call any tools and instead generates a message. `auto` is the default value
 * and means the model can pick between generating a message or calling one or more
 * tools. `required` means the model must call one or more tools before responding
 * to the user. Specifying a particular tool like `{"type": "file_search"}` or
 * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
 * call that tool.
 */
export type AssistantToolChoiceOption = 'none' | 'auto' | 'required' | AssistantToolChoice;

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

  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  tool_resources: Thread.ToolResources | null;
}

export namespace Thread {
  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this thread. There can be a maximum of 1 vector store attached to
       * the thread.
       */
      vector_store_ids?: Array<string>;
    }
  }
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

  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  tool_resources?: ThreadCreateParams.ToolResources | null;
}

export namespace ThreadCreateParams {
  export interface Message {
    /**
     * The text contents of the message.
     */
    content: string | Array<MessagesAPI.MessageContentPartParam>;

    /**
     * The role of the entity that is creating the message. Allowed values include:
     *
     * - `user`: Indicates the message is sent by an actual user and should be used in
     *   most cases to represent user-generated messages.
     * - `assistant`: Indicates the message is generated by the assistant. Use this
     *   value to insert messages from the assistant into the conversation.
     */
    role: 'user' | 'assistant';

    /**
     * A list of files attached to the message, and the tools they should be added to.
     */
    attachments?: Array<Message.Attachment> | null;

    /**
     * Set of 16 key-value pairs that can be attached to an object. This can be useful
     * for storing additional information about the object in a structured format. Keys
     * can be a maximum of 64 characters long and values can be a maxium of 512
     * characters long.
     */
    metadata?: unknown | null;
  }

  export namespace Message {
    export interface Attachment {
      /**
       * The ID of the file to attach to the message.
       */
      file_id?: string;

      /**
       * The tools to add this file to.
       */
      tools?: Array<AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool>;
    }
  }

  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this thread. There can be a maximum of 1 vector store attached to
       * the thread.
       */
      vector_store_ids?: Array<string>;

      /**
       * A helper to create a
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * with file_ids and attach it to this thread. There can be a maximum of 1 vector
       * store attached to the thread.
       */
      vector_stores?: Array<FileSearch.VectorStore>;
    }

    export namespace FileSearch {
      export interface VectorStore {
        /**
         * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs to
         * add to the vector store. There can be a maximum of 10000 files in a vector
         * store.
         */
        file_ids?: Array<string>;

        /**
         * Set of 16 key-value pairs that can be attached to a vector store. This can be
         * useful for storing additional information about the vector store in a structured
         * format. Keys can be a maximum of 64 characters long and values can be a maxium
         * of 512 characters long.
         */
        metadata?: unknown;
      }
    }
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

  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  tool_resources?: ThreadUpdateParams.ToolResources | null;
}

export namespace ThreadUpdateParams {
  /**
   * A set of resources that are made available to the assistant's tools in this
   * thread. The resources are specific to the type of tool. For example, the
   * `code_interpreter` tool requires a list of file IDs, while the `file_search`
   * tool requires a list of vector store IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this thread. There can be a maximum of 1 vector store attached to
       * the thread.
       */
      vector_store_ids?: Array<string>;
    }
  }
}

export type ThreadCreateAndRunParams =
  | ThreadCreateAndRunParamsNonStreaming
  | ThreadCreateAndRunParamsStreaming;

export interface ThreadCreateAndRunParamsBase {
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
   * The maximum number of completion tokens that may be used over the course of the
   * run. The run will make a best effort to use only the number of completion tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * completion tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_completion_tokens?: number | null;

  /**
   * The maximum number of prompt tokens that may be used over the course of the run.
   * The run will make a best effort to use only the number of prompt tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * prompt tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_prompt_tokens?: number | null;

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
  model?:
    | (string & {})
    | 'gpt-4o'
    | 'gpt-4o-2024-05-13'
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
    | 'gpt-3.5-turbo-16k-0613'
    | null;

  /**
   * Specifies the format that the model must output. Compatible with
   * [GPT-4o](https://platform.openai.com/docs/models/gpt-4o),
   * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4),
   * and all GPT-3.5 Turbo models since `gpt-3.5-turbo-1106`.
   *
   * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
   * message the model generates is valid JSON.
   *
   * **Important:** when using JSON mode, you **must** also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model may
   * generate an unending stream of whitespace until the generation reaches the token
   * limit, resulting in a long-running and seemingly "stuck" request. Also note that
   * the message content may be partially cut off if `finish_reason="length"`, which
   * indicates the generation exceeded `max_tokens` or the conversation exceeded the
   * max context length.
   */
  response_format?: AssistantResponseFormatOption | null;

  /**
   * If `true`, returns a stream of events that happen during the Run as server-sent
   * events, terminating when the Run enters a terminal state with a `data: [DONE]`
   * message.
   */
  stream?: boolean | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   */
  temperature?: number | null;

  /**
   * If no thread is provided, an empty thread will be created.
   */
  thread?: ThreadCreateAndRunParams.Thread;

  /**
   * Controls which (if any) tool is called by the model. `none` means the model will
   * not call any tools and instead generates a message. `auto` is the default value
   * and means the model can pick between generating a message or calling one or more
   * tools. `required` means the model must call one or more tools before responding
   * to the user. Specifying a particular tool like `{"type": "file_search"}` or
   * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
   * call that tool.
   */
  tool_choice?: AssistantToolChoiceOption | null;

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  tool_resources?: ThreadCreateAndRunParams.ToolResources | null;

  /**
   * Override the tools the assistant can use for this run. This is useful for
   * modifying the behavior on a per-run basis.
   */
  tools?: Array<
    AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool | AssistantsAPI.FunctionTool
  > | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or temperature but not both.
   */
  top_p?: number | null;

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  truncation_strategy?: ThreadCreateAndRunParams.TruncationStrategy | null;
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

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    tool_resources?: Thread.ToolResources | null;
  }

  export namespace Thread {
    export interface Message {
      /**
       * The text contents of the message.
       */
      content: string | Array<MessagesAPI.MessageContentPartParam>;

      /**
       * The role of the entity that is creating the message. Allowed values include:
       *
       * - `user`: Indicates the message is sent by an actual user and should be used in
       *   most cases to represent user-generated messages.
       * - `assistant`: Indicates the message is generated by the assistant. Use this
       *   value to insert messages from the assistant into the conversation.
       */
      role: 'user' | 'assistant';

      /**
       * A list of files attached to the message, and the tools they should be added to.
       */
      attachments?: Array<Message.Attachment> | null;

      /**
       * Set of 16 key-value pairs that can be attached to an object. This can be useful
       * for storing additional information about the object in a structured format. Keys
       * can be a maximum of 64 characters long and values can be a maxium of 512
       * characters long.
       */
      metadata?: unknown | null;
    }

    export namespace Message {
      export interface Attachment {
        /**
         * The ID of the file to attach to the message.
         */
        file_id?: string;

        /**
         * The tools to add this file to.
         */
        tools?: Array<AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool>;
      }
    }

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    export interface ToolResources {
      code_interpreter?: ToolResources.CodeInterpreter;

      file_search?: ToolResources.FileSearch;
    }

    export namespace ToolResources {
      export interface CodeInterpreter {
        /**
         * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
         * available to the `code_interpreter` tool. There can be a maximum of 20 files
         * associated with the tool.
         */
        file_ids?: Array<string>;
      }

      export interface FileSearch {
        /**
         * The
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * attached to this thread. There can be a maximum of 1 vector store attached to
         * the thread.
         */
        vector_store_ids?: Array<string>;

        /**
         * A helper to create a
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * with file_ids and attach it to this thread. There can be a maximum of 1 vector
         * store attached to the thread.
         */
        vector_stores?: Array<FileSearch.VectorStore>;
      }

      export namespace FileSearch {
        export interface VectorStore {
          /**
           * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs to
           * add to the vector store. There can be a maximum of 10000 files in a vector
           * store.
           */
          file_ids?: Array<string>;

          /**
           * Set of 16 key-value pairs that can be attached to a vector store. This can be
           * useful for storing additional information about the vector store in a structured
           * format. Keys can be a maximum of 64 characters long and values can be a maxium
           * of 512 characters long.
           */
          metadata?: unknown;
        }
      }
    }
  }

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The ID of the
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this assistant. There can be a maximum of 1 vector store attached to
       * the assistant.
       */
      vector_store_ids?: Array<string>;
    }
  }

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  export interface TruncationStrategy {
    /**
     * The truncation strategy to use for the thread. The default is `auto`. If set to
     * `last_messages`, the thread will be truncated to the n most recent messages in
     * the thread. When set to `auto`, messages in the middle of the thread will be
     * dropped to fit the context length of the model, `max_prompt_tokens`.
     */
    type: 'auto' | 'last_messages';

    /**
     * The number of most recent messages from the thread when constructing the context
     * for the run.
     */
    last_messages?: number | null;
  }

  export type ThreadCreateAndRunParamsNonStreaming = ThreadsAPI.ThreadCreateAndRunParamsNonStreaming;
  export type ThreadCreateAndRunParamsStreaming = ThreadsAPI.ThreadCreateAndRunParamsStreaming;
}

export interface ThreadCreateAndRunParamsNonStreaming extends ThreadCreateAndRunParamsBase {
  /**
   * If `true`, returns a stream of events that happen during the Run as server-sent
   * events, terminating when the Run enters a terminal state with a `data: [DONE]`
   * message.
   */
  stream?: false | null;
}

export interface ThreadCreateAndRunParamsStreaming extends ThreadCreateAndRunParamsBase {
  /**
   * If `true`, returns a stream of events that happen during the Run as server-sent
   * events, terminating when the Run enters a terminal state with a `data: [DONE]`
   * message.
   */
  stream: true;
}

export interface ThreadCreateAndRunPollParams {
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
   * The maximum number of completion tokens that may be used over the course of the
   * run. The run will make a best effort to use only the number of completion tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * completion tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_completion_tokens?: number | null;

  /**
   * The maximum number of prompt tokens that may be used over the course of the run.
   * The run will make a best effort to use only the number of prompt tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * prompt tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_prompt_tokens?: number | null;

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
  model?:
    | (string & {})
    | 'gpt-4o'
    | 'gpt-4o-2024-05-13'
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
    | 'gpt-3.5-turbo-16k-0613'
    | null;

  /**
   * Specifies the format that the model must output. Compatible with
   * [GPT-4o](https://platform.openai.com/docs/models/gpt-4o),
   * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4),
   * and all GPT-3.5 Turbo models since `gpt-3.5-turbo-1106`.
   *
   * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
   * message the model generates is valid JSON.
   *
   * **Important:** when using JSON mode, you **must** also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model may
   * generate an unending stream of whitespace until the generation reaches the token
   * limit, resulting in a long-running and seemingly "stuck" request. Also note that
   * the message content may be partially cut off if `finish_reason="length"`, which
   * indicates the generation exceeded `max_tokens` or the conversation exceeded the
   * max context length.
   */
  response_format?: AssistantResponseFormatOption | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   */
  temperature?: number | null;

  /**
   * If no thread is provided, an empty thread will be created.
   */
  thread?: ThreadCreateAndRunPollParams.Thread;

  /**
   * Controls which (if any) tool is called by the model. `none` means the model will
   * not call any tools and instead generates a message. `auto` is the default value
   * and means the model can pick between generating a message or calling one or more
   * tools. `required` means the model must call one or more tools before responding
   * to the user. Specifying a particular tool like `{"type": "file_search"}` or
   * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
   * call that tool.
   */
  tool_choice?: AssistantToolChoiceOption | null;

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  tool_resources?: ThreadCreateAndRunPollParams.ToolResources | null;

  /**
   * Override the tools the assistant can use for this run. This is useful for
   * modifying the behavior on a per-run basis.
   */
  tools?: Array<
    AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool | AssistantsAPI.FunctionTool
  > | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or temperature but not both.
   */
  top_p?: number | null;

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  truncation_strategy?: ThreadCreateAndRunPollParams.TruncationStrategy | null;
}

export namespace ThreadCreateAndRunPollParams {
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

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    tool_resources?: Thread.ToolResources | null;
  }

  export namespace Thread {
    export interface Message {
      /**
       * The text contents of the message.
       */
      content: string | Array<MessagesAPI.MessageContentPartParam>;

      /**
       * The role of the entity that is creating the message. Allowed values include:
       *
       * - `user`: Indicates the message is sent by an actual user and should be used in
       *   most cases to represent user-generated messages.
       * - `assistant`: Indicates the message is generated by the assistant. Use this
       *   value to insert messages from the assistant into the conversation.
       */
      role: 'user' | 'assistant';

      /**
       * A list of files attached to the message, and the tools they should be added to.
       */
      attachments?: Array<Message.Attachment> | null;

      /**
       * Set of 16 key-value pairs that can be attached to an object. This can be useful
       * for storing additional information about the object in a structured format. Keys
       * can be a maximum of 64 characters long and values can be a maxium of 512
       * characters long.
       */
      metadata?: unknown | null;
    }

    export namespace Message {
      export interface Attachment {
        /**
         * The ID of the file to attach to the message.
         */
        file_id?: string;

        /**
         * The tools to add this file to.
         */
        tools?: Array<AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool>;
      }
    }

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    export interface ToolResources {
      code_interpreter?: ToolResources.CodeInterpreter;

      file_search?: ToolResources.FileSearch;
    }

    export namespace ToolResources {
      export interface CodeInterpreter {
        /**
         * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
         * available to the `code_interpreter` tool. There can be a maximum of 20 files
         * associated with the tool.
         */
        file_ids?: Array<string>;
      }

      export interface FileSearch {
        /**
         * The
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * attached to this thread. There can be a maximum of 1 vector store attached to
         * the thread.
         */
        vector_store_ids?: Array<string>;

        /**
         * A helper to create a
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * with file_ids and attach it to this thread. There can be a maximum of 1 vector
         * store attached to the thread.
         */
        vector_stores?: Array<FileSearch.VectorStore>;
      }

      export namespace FileSearch {
        export interface VectorStore {
          /**
           * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs to
           * add to the vector store. There can be a maximum of 10000 files in a vector
           * store.
           */
          file_ids?: Array<string>;

          /**
           * Set of 16 key-value pairs that can be attached to a vector store. This can be
           * useful for storing additional information about the vector store in a structured
           * format. Keys can be a maximum of 64 characters long and values can be a maxium
           * of 512 characters long.
           */
          metadata?: unknown;
        }
      }
    }
  }

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The ID of the
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this assistant. There can be a maximum of 1 vector store attached to
       * the assistant.
       */
      vector_store_ids?: Array<string>;
    }
  }

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  export interface TruncationStrategy {
    /**
     * The truncation strategy to use for the thread. The default is `auto`. If set to
     * `last_messages`, the thread will be truncated to the n most recent messages in
     * the thread. When set to `auto`, messages in the middle of the thread will be
     * dropped to fit the context length of the model, `max_prompt_tokens`.
     */
    type: 'auto' | 'last_messages';

    /**
     * The number of most recent messages from the thread when constructing the context
     * for the run.
     */
    last_messages?: number | null;
  }
}

export interface ThreadCreateAndRunStreamParams {
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
   * The maximum number of completion tokens that may be used over the course of the
   * run. The run will make a best effort to use only the number of completion tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * completion tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_completion_tokens?: number | null;

  /**
   * The maximum number of prompt tokens that may be used over the course of the run.
   * The run will make a best effort to use only the number of prompt tokens
   * specified, across multiple turns of the run. If the run exceeds the number of
   * prompt tokens specified, the run will end with status `incomplete`. See
   * `incomplete_details` for more info.
   */
  max_prompt_tokens?: number | null;

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
  model?:
    | (string & {})
    | 'gpt-4o'
    | 'gpt-4o-2024-05-13'
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
    | 'gpt-3.5-turbo-16k-0613'
    | null;

  /**
   * Specifies the format that the model must output. Compatible with
   * [GPT-4o](https://platform.openai.com/docs/models/gpt-4o),
   * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4),
   * and all GPT-3.5 Turbo models since `gpt-3.5-turbo-1106`.
   *
   * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
   * message the model generates is valid JSON.
   *
   * **Important:** when using JSON mode, you **must** also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model may
   * generate an unending stream of whitespace until the generation reaches the token
   * limit, resulting in a long-running and seemingly "stuck" request. Also note that
   * the message content may be partially cut off if `finish_reason="length"`, which
   * indicates the generation exceeded `max_tokens` or the conversation exceeded the
   * max context length.
   */
  response_format?: AssistantResponseFormatOption | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   */
  temperature?: number | null;

  /**
   * If no thread is provided, an empty thread will be created.
   */
  thread?: ThreadCreateAndRunStreamParams.Thread;

  /**
   * Controls which (if any) tool is called by the model. `none` means the model will
   * not call any tools and instead generates a message. `auto` is the default value
   * and means the model can pick between generating a message or calling one or more
   * tools. `required` means the model must call one or more tools before responding
   * to the user. Specifying a particular tool like `{"type": "file_search"}` or
   * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
   * call that tool.
   */
  tool_choice?: AssistantToolChoiceOption | null;

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  tool_resources?: ThreadCreateAndRunStreamParams.ToolResources | null;

  /**
   * Override the tools the assistant can use for this run. This is useful for
   * modifying the behavior on a per-run basis.
   */
  tools?: Array<
    AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool | AssistantsAPI.FunctionTool
  > | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or temperature but not both.
   */
  top_p?: number | null;

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  truncation_strategy?: ThreadCreateAndRunStreamParams.TruncationStrategy | null;
}

export namespace ThreadCreateAndRunStreamParams {
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

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    tool_resources?: Thread.ToolResources | null;
  }

  export namespace Thread {
    export interface Message {
      /**
       * The text contents of the message.
       */
      content: string | Array<MessagesAPI.MessageContentPartParam>;

      /**
       * The role of the entity that is creating the message. Allowed values include:
       *
       * - `user`: Indicates the message is sent by an actual user and should be used in
       *   most cases to represent user-generated messages.
       * - `assistant`: Indicates the message is generated by the assistant. Use this
       *   value to insert messages from the assistant into the conversation.
       */
      role: 'user' | 'assistant';

      /**
       * A list of files attached to the message, and the tools they should be added to.
       */
      attachments?: Array<Message.Attachment> | null;

      /**
       * Set of 16 key-value pairs that can be attached to an object. This can be useful
       * for storing additional information about the object in a structured format. Keys
       * can be a maximum of 64 characters long and values can be a maxium of 512
       * characters long.
       */
      metadata?: unknown | null;
    }

    export namespace Message {
      export interface Attachment {
        /**
         * The ID of the file to attach to the message.
         */
        file_id?: string;

        /**
         * The tools to add this file to.
         */
        tools?: Array<AssistantsAPI.CodeInterpreterTool | AssistantsAPI.FileSearchTool>;
      }
    }

    /**
     * A set of resources that are made available to the assistant's tools in this
     * thread. The resources are specific to the type of tool. For example, the
     * `code_interpreter` tool requires a list of file IDs, while the `file_search`
     * tool requires a list of vector store IDs.
     */
    export interface ToolResources {
      code_interpreter?: ToolResources.CodeInterpreter;

      file_search?: ToolResources.FileSearch;
    }

    export namespace ToolResources {
      export interface CodeInterpreter {
        /**
         * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
         * available to the `code_interpreter` tool. There can be a maximum of 20 files
         * associated with the tool.
         */
        file_ids?: Array<string>;
      }

      export interface FileSearch {
        /**
         * The
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * attached to this thread. There can be a maximum of 1 vector store attached to
         * the thread.
         */
        vector_store_ids?: Array<string>;

        /**
         * A helper to create a
         * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
         * with file_ids and attach it to this thread. There can be a maximum of 1 vector
         * store attached to the thread.
         */
        vector_stores?: Array<FileSearch.VectorStore>;
      }

      export namespace FileSearch {
        export interface VectorStore {
          /**
           * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs to
           * add to the vector store. There can be a maximum of 10000 files in a vector
           * store.
           */
          file_ids?: Array<string>;

          /**
           * Set of 16 key-value pairs that can be attached to a vector store. This can be
           * useful for storing additional information about the vector store in a structured
           * format. Keys can be a maximum of 64 characters long and values can be a maxium
           * of 512 characters long.
           */
          metadata?: unknown;
        }
      }
    }
  }

  /**
   * A set of resources that are used by the assistant's tools. The resources are
   * specific to the type of tool. For example, the `code_interpreter` tool requires
   * a list of file IDs, while the `file_search` tool requires a list of vector store
   * IDs.
   */
  export interface ToolResources {
    code_interpreter?: ToolResources.CodeInterpreter;

    file_search?: ToolResources.FileSearch;
  }

  export namespace ToolResources {
    export interface CodeInterpreter {
      /**
       * A list of [file](https://platform.openai.com/docs/api-reference/files) IDs made
       * available to the `code_interpreter` tool. There can be a maximum of 20 files
       * associated with the tool.
       */
      file_ids?: Array<string>;
    }

    export interface FileSearch {
      /**
       * The ID of the
       * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
       * attached to this assistant. There can be a maximum of 1 vector store attached to
       * the assistant.
       */
      vector_store_ids?: Array<string>;
    }
  }

  /**
   * Controls for how a thread will be truncated prior to the run. Use this to
   * control the intial context window of the run.
   */
  export interface TruncationStrategy {
    /**
     * The truncation strategy to use for the thread. The default is `auto`. If set to
     * `last_messages`, the thread will be truncated to the n most recent messages in
     * the thread. When set to `auto`, messages in the middle of the thread will be
     * dropped to fit the context length of the model, `max_prompt_tokens`.
     */
    type: 'auto' | 'last_messages';

    /**
     * The number of most recent messages from the thread when constructing the context
     * for the run.
     */
    last_messages?: number | null;
  }
}

export namespace Threads {
  export import AssistantResponseFormat = ThreadsAPI.AssistantResponseFormat;
  export import AssistantResponseFormatOption = ThreadsAPI.AssistantResponseFormatOption;
  export import AssistantToolChoice = ThreadsAPI.AssistantToolChoice;
  export import AssistantToolChoiceFunction = ThreadsAPI.AssistantToolChoiceFunction;
  export import AssistantToolChoiceOption = ThreadsAPI.AssistantToolChoiceOption;
  export import Thread = ThreadsAPI.Thread;
  export import ThreadDeleted = ThreadsAPI.ThreadDeleted;
  export import ThreadCreateParams = ThreadsAPI.ThreadCreateParams;
  export import ThreadUpdateParams = ThreadsAPI.ThreadUpdateParams;
  export import ThreadCreateAndRunParams = ThreadsAPI.ThreadCreateAndRunParams;
  export import ThreadCreateAndRunParamsNonStreaming = ThreadsAPI.ThreadCreateAndRunParamsNonStreaming;
  export import ThreadCreateAndRunParamsStreaming = ThreadsAPI.ThreadCreateAndRunParamsStreaming;
  export import ThreadCreateAndRunPollParams = ThreadsAPI.ThreadCreateAndRunPollParams;
  export import ThreadCreateAndRunStreamParams = ThreadsAPI.ThreadCreateAndRunStreamParams;
  export import Runs = RunsAPI.Runs;
  export import RequiredActionFunctionToolCall = RunsAPI.RequiredActionFunctionToolCall;
  export import Run = RunsAPI.Run;
  export import RunStatus = RunsAPI.RunStatus;
  export import RunsPage = RunsAPI.RunsPage;
  export import RunCreateParams = RunsAPI.RunCreateParams;
  export import RunCreateParamsNonStreaming = RunsAPI.RunCreateParamsNonStreaming;
  export import RunCreateParamsStreaming = RunsAPI.RunCreateParamsStreaming;
  export import RunUpdateParams = RunsAPI.RunUpdateParams;
  export import RunListParams = RunsAPI.RunListParams;
  export import RunCreateAndPollParams = RunsAPI.RunCreateAndPollParams;
  export import RunCreateAndStreamParams = RunsAPI.RunCreateAndStreamParams;
  export import RunStreamParams = RunsAPI.RunStreamParams;
  export import RunSubmitToolOutputsParams = RunsAPI.RunSubmitToolOutputsParams;
  export import RunSubmitToolOutputsParamsNonStreaming = RunsAPI.RunSubmitToolOutputsParamsNonStreaming;
  export import RunSubmitToolOutputsParamsStreaming = RunsAPI.RunSubmitToolOutputsParamsStreaming;
  export import RunSubmitToolOutputsAndPollParams = RunsAPI.RunSubmitToolOutputsAndPollParams;
  export import RunSubmitToolOutputsStreamParams = RunsAPI.RunSubmitToolOutputsStreamParams;
  export import Messages = MessagesAPI.Messages;
  export import Annotation = MessagesAPI.Annotation;
  export import AnnotationDelta = MessagesAPI.AnnotationDelta;
  export import FileCitationAnnotation = MessagesAPI.FileCitationAnnotation;
  export import FileCitationDeltaAnnotation = MessagesAPI.FileCitationDeltaAnnotation;
  export import FilePathAnnotation = MessagesAPI.FilePathAnnotation;
  export import FilePathDeltaAnnotation = MessagesAPI.FilePathDeltaAnnotation;
  export import ImageFile = MessagesAPI.ImageFile;
  export import ImageFileContentBlock = MessagesAPI.ImageFileContentBlock;
  export import ImageFileDelta = MessagesAPI.ImageFileDelta;
  export import ImageFileDeltaBlock = MessagesAPI.ImageFileDeltaBlock;
  export import ImageURL = MessagesAPI.ImageURL;
  export import ImageURLContentBlock = MessagesAPI.ImageURLContentBlock;
  export import ImageURLDelta = MessagesAPI.ImageURLDelta;
  export import ImageURLDeltaBlock = MessagesAPI.ImageURLDeltaBlock;
  export import Message = MessagesAPI.Message;
  export import MessageContent = MessagesAPI.MessageContent;
  export import MessageContentDelta = MessagesAPI.MessageContentDelta;
  export import MessageContentPartParam = MessagesAPI.MessageContentPartParam;
  export import MessageDeleted = MessagesAPI.MessageDeleted;
  export import MessageDelta = MessagesAPI.MessageDelta;
  export import MessageDeltaEvent = MessagesAPI.MessageDeltaEvent;
  export import Text = MessagesAPI.Text;
  export import TextContentBlock = MessagesAPI.TextContentBlock;
  export import TextContentBlockParam = MessagesAPI.TextContentBlockParam;
  export import TextDelta = MessagesAPI.TextDelta;
  export import TextDeltaBlock = MessagesAPI.TextDeltaBlock;
  export import MessagesPage = MessagesAPI.MessagesPage;
  export import MessageCreateParams = MessagesAPI.MessageCreateParams;
  export import MessageUpdateParams = MessagesAPI.MessageUpdateParams;
  export import MessageListParams = MessagesAPI.MessageListParams;
}
