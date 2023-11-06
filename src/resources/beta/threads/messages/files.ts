// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import * as FilesAPI from 'openai/resources/beta/threads/messages/files';
import { CursorPage, type CursorPageParams } from 'openai/pagination';

export class Files extends APIResource {
  /**
   * Retrieves a Message File.
   */
  retrieve(
    threadId: string,
    messageId: string,
    fileId: string,
    options?: Core.RequestOptions,
  ): Core.APIPromise<MessageFile> {
    return this.get(`/threads/${threadId}/messages/${messageId}/files/${fileId}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }

  /**
   * Returns a list of Message Files.
   */
  list(
    threadId: string,
    messageId: string,
    query?: FileListParams,
    options?: Core.RequestOptions,
  ): Core.PagePromise<MessageFilesPage, MessageFile>;
  list(
    threadId: string,
    messageId: string,
    options?: Core.RequestOptions,
  ): Core.PagePromise<MessageFilesPage, MessageFile>;
  list(
    threadId: string,
    messageId: string,
    query: FileListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<MessageFilesPage, MessageFile> {
    if (isRequestOptions(query)) {
      return this.list(threadId, messageId, {}, query);
    }
    return this.getAPIList(`/threads/${threadId}/messages/${messageId}/files`, MessageFilesPage, {
      query,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v1', ...options?.headers },
    });
  }
}

export class MessageFilesPage extends CursorPage<MessageFile> {}

/**
 * A list of Files attached to a `Message`.
 */
export interface MessageFile {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the Message File was created.
   */
  created_at: number;

  /**
   * The ID of the [Message](https://platform.openai.com/docs/api-reference/messages)
   * that the [File](https://platform.openai.com/docs/api-reference/files) is
   * attached to.
   */
  message_id: string;

  /**
   * The object type, which is always `thread.message.file`.
   */
  object: 'thread.message.file';
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
  export import MessageFile = FilesAPI.MessageFile;
  export import MessageFilesPage = FilesAPI.MessageFilesPage;
  export import FileListParams = FilesAPI.FileListParams;
}
