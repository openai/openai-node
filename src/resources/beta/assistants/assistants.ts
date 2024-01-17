// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as AssistantsAPI from 'openai/resources/beta/assistants/assistants';
import * as Shared from 'openai/resources/shared';
import * as FilesAPI from 'openai/resources/beta/assistants/files';
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
   * The system instructions that the assistant uses. The maximum length is 32768
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
  tools: Array<Assistant.CodeInterpreter | Assistant.Retrieval | Assistant.Function>;
}

export namespace Assistant {
  export interface CodeInterpreter {
    /**
     * The type of tool being defined: `code_interpreter`
     */
    type: 'code_interpreter';
  }

  export interface Retrieval {
    /**
     * The type of tool being defined: `retrieval`
     */
    type: 'retrieval';
  }

  export interface Function {
    function: Shared.FunctionDefinition;

    /**
     * The type of tool being defined: `function`
     */
    type: 'function';
  }
}

export interface AssistantDeleted {
  id: string;

  deleted: boolean;

  object: 'assistant.deleted';
}

export interface AssistantCreateParams {
  /**
   * ID of the model to use. You can use the
   * [List models](https://platform.openai.com/docs/api-reference/models/list) API to
   * see all of your available models, or see our
   * [Model overview](https://platform.openai.com/docs/models/overview) for
   * descriptions of them.
   */
  model: string;

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
   * The system instructions that the assistant uses. The maximum length is 32768
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
  tools?: Array<
    | AssistantCreateParams.AssistantToolsCode
    | AssistantCreateParams.AssistantToolsRetrieval
    | AssistantCreateParams.AssistantToolsFunction
  >;
}

export namespace AssistantCreateParams {
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
   * The system instructions that the assistant uses. The maximum length is 32768
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
  tools?: Array<
    | AssistantUpdateParams.AssistantToolsCode
    | AssistantUpdateParams.AssistantToolsRetrieval
    | AssistantUpdateParams.AssistantToolsFunction
  >;
}

export namespace AssistantUpdateParams {
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
