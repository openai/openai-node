// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../resource';
import * as FilesAPI from './files';
import { Page, PagePromise } from '../pagination';
import { type Uploadable, multipartFormRequestOptions } from '../uploads';
import { type Response } from '../_shims/index';
import { APIPromise } from '../internal/api-promise';
import { RequestOptions } from '../internal/request-options';

export class Files extends APIResource {
  /**
   * Upload a file that can be used across various endpoints. Individual files can be
   * up to 512 MB, and the size of all files uploaded by one organization can be up
   * to 100 GB.
   *
   * The Assistants API supports files up to 2 million tokens and of specific file
   * types. See the
   * [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools) for
   * details.
   *
   * The Fine-tuning API only supports `.jsonl` files. The input also has certain
   * required formats for fine-tuning
   * [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input) or
   * [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
   * models.
   *
   * The Batch API only supports `.jsonl` files up to 100 MB in size. The input also
   * has a specific required
   * [format](https://platform.openai.com/docs/api-reference/batch/request-input).
   *
   * Please [contact us](https://help.openai.com/) if you need to increase these
   * storage limits.
   */
  create(body: FileCreateParams, options?: RequestOptions): APIPromise<FileObject> {
    return this._client.post('/files', multipartFormRequestOptions({ body, ...options }));
  }

  /**
   * Returns information about a specific file.
   */
  retrieve(fileID: string, options?: RequestOptions): APIPromise<FileObject> {
    return this._client.get(`/files/${fileID}`, options);
  }

  /**
   * Returns a list of files that belong to the user's organization.
   */
  list(
    query: FileListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<FileObjectsPage, FileObject> {
    return this._client.getAPIList('/files', Page<FileObject>, { query, ...options });
  }

  /**
   * Delete a file.
   */
  delete(fileID: string, options?: RequestOptions): APIPromise<FileDeleted> {
    return this._client.delete(`/files/${fileID}`, options);
  }

  /**
   * Returns the contents of the specified file.
   */
  content(fileID: string, options?: RequestOptions): APIPromise<Response> {
    return this._client.get(`/files/${fileID}/content`, { ...options, __binaryResponse: true });
  }
}

// Note: no pagination actually occurs yet, this is for forwards-compatibility.
export type FileObjectsPage = Page<FileObject>;

export type FileContent = string;

export interface FileDeleted {
  id: string;

  deleted: boolean;

  object: 'file';
}

/**
 * The `File` object represents a document that has been uploaded to OpenAI.
 */
export interface FileObject {
  /**
   * The file identifier, which can be referenced in the API endpoints.
   */
  id: string;

  /**
   * The size of the file, in bytes.
   */
  bytes: number;

  /**
   * The Unix timestamp (in seconds) for when the file was created.
   */
  created_at: number;

  /**
   * The name of the file.
   */
  filename: string;

  /**
   * The object type, which is always `file`.
   */
  object: 'file';

  /**
   * The intended purpose of the file. Supported values are `assistants`,
   * `assistants_output`, `batch`, `batch_output`, `fine-tune`, `fine-tune-results`
   * and `vision`.
   */
  purpose:
    | 'assistants'
    | 'assistants_output'
    | 'batch'
    | 'batch_output'
    | 'fine-tune'
    | 'fine-tune-results'
    | 'vision';

  /**
   * @deprecated: Deprecated. The current status of the file, which can be either
   * `uploaded`, `processed`, or `error`.
   */
  status: 'uploaded' | 'processed' | 'error';

  /**
   * @deprecated: Deprecated. For details on why a fine-tuning training file failed
   * validation, see the `error` field on `fine_tuning.job`.
   */
  status_details?: string;
}

export interface FileCreateParams {
  /**
   * The File object (not file name) to be uploaded.
   */
  file: Uploadable;

  /**
   * The intended purpose of the uploaded file.
   *
   * Use "assistants" for
   * [Assistants](https://platform.openai.com/docs/api-reference/assistants) and
   * [Message](https://platform.openai.com/docs/api-reference/messages) files,
   * "vision" for Assistants image file inputs, "batch" for
   * [Batch API](https://platform.openai.com/docs/guides/batch), and "fine-tune" for
   * [Fine-tuning](https://platform.openai.com/docs/api-reference/fine-tuning).
   */
  purpose: 'assistants' | 'batch' | 'fine-tune' | 'vision';
}

export interface FileListParams {
  /**
   * Only return files with the given purpose.
   */
  purpose?: string;
}

export namespace Files {
  export import FileContent = FilesAPI.FileContent;
  export import FileDeleted = FilesAPI.FileDeleted;
  export import FileObject = FilesAPI.FileObject;
  export type FileObjectsPage = FilesAPI.FileObjectsPage;
  export import FileCreateParams = FilesAPI.FileCreateParams;
  export import FileListParams = FilesAPI.FileListParams;
}
