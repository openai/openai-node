// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as FilesAPI from 'openai/resources/beta/assistants/files';
import { CursorPage, type CursorPageParams } from 'openai/pagination';

export class Files extends APIResource {
  /**
   * Create an assistant file by attaching a
   * [File](https://platform.openai.com/docs/api-reference/files) to an
   * [assistant](https://platform.openai.com/docs/api-reference/assistants).
   */
  create(
    assistantId: string,
    body: FileCreateParams,
    options?: Core.RequestOptions,
  ): Core.APIPromise<AssistantFile> {
    return this._client.post(`/assistants/${assistantId}/files`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Retrieves an AssistantFile.
   */
  retrieve(
    assistantId: string,
    fileId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<AssistantFile> {
    return this._client.get(`/assistants/${assistantId}/files/${fileId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Returns a list of assistant files.
   */
  list(
    assistantId: string,
    query?: FileListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<AssistantFilesPage, AssistantFile>;
  list(
    assistantId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<AssistantFilesPage, AssistantFile>;
  list(
    assistantId: string,
    query: FileListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<AssistantFilesPage, AssistantFile> {
    if (isRequestOptions(query)) {
      return this.list(assistantId, {}, query);
    }
    return this._client.getAPIList(`/assistants/${assistantId}/files`, AssistantFilesPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Delete an assistant file.
   */
  del(
    assistantId: string,
    fileId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<FileDeleteResponse> {
    return this._client.delete(`/assistants/${assistantId}/files/${fileId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

export class AssistantFilesPage extends CursorPage<AssistantFile> {}

/**
 * A list of [Files](https://platform.openai.com/docs/api-reference/files) attached
 * to an `assistant`.
 */
export interface AssistantFile {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The assistant ID that the file is attached to.
   */
  assistant_id: string;

  /**
   * The Unix timestamp (in seconds) for when the assistant file was created.
   */
  created_at: number;

  /**
   * The object type, which is always `assistant.file`.
   */
  object: 'assistant.file';
}

/**
 * Deletes the association between the assistant and the file, but does not delete
 * the [File](https://platform.openai.com/docs/api-reference/files) object itself.
 */
export interface FileDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'assistant.file.deleted';
}

export interface FileCreateParams {
  /**
   * A [File](https://platform.openai.com/docs/api-reference/files) ID (with
   * `purpose="assistants"`) that the assistant should use. Useful for tools like
   * `retrieval` and `code_interpreter` that can access files.
   */
  file_id: string;
}

export interface FileListParams extends CursorPageParams {
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

export namespace Files {
  export import AssistantFile = FilesAPI.AssistantFile;
  export import FileDeleteResponse = FilesAPI.FileDeleteResponse;
  export import AssistantFilesPage = FilesAPI.AssistantFilesPage;
  export import FileCreateParams = FilesAPI.FileCreateParams;
  export import FileListParams = FilesAPI.FileListParams;
}
