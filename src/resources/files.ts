// File generated from our OpenAPI spec by Stainless.

import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import { isRequestOptions } from 'openai/core';
import { sleep } from 'openai/core';
import { APIConnectionTimeoutError } from 'openai/error';
import * as FilesAPI from 'openai/resources/files';
import { type Uploadable, multipartFormRequestOptions } from 'openai/core';
import { Page } from 'openai/pagination';

export class Files extends APIResource {
  /**
   * Upload a file that can be used across various endpoints/features. The size of
   * all the files uploaded by one organization can be up to 100 GB.
   *
   * The size of individual files for can be a maximum of 512MB. See the
   * [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools) to
   * learn more about the types of files supported. The Fine-tuning API only supports
   * `.jsonl` files.
   *
   * Please [contact us](https://help.openai.com/) if you need to increase these
   * storage limits.
   */
  create(body: FileCreateParams, options?: Core.RequestOptions): Core.APIPromise<FileObject> {
    return this.post('/files', multipartFormRequestOptions({ body, ...options }));
  }

  /**
   * Returns information about a specific file.
   */
  retrieve(fileId: string, options?: Core.RequestOptions): Core.APIPromise<FileObject> {
    return this.get(`/files/${fileId}`, options);
  }

  /**
   * Returns a list of files that belong to the user's organization.
   */
  list(query?: FileListParams, options?: Core.RequestOptions): Core.PagePromise<FileObjectsPage, FileObject>;
  list(options?: Core.RequestOptions): Core.PagePromise<FileObjectsPage, FileObject>;
  list(
    query: FileListParams | Core.RequestOptions = {},
    options?: Core.RequestOptions,
  ): Core.PagePromise<FileObjectsPage, FileObject> {
    if (isRequestOptions(query)) {
      return this.list({}, query);
    }
    return this.getAPIList('/files', FileObjectsPage, { query, ...options });
  }

  /**
   * Delete a file.
   */
  del(fileId: string, options?: Core.RequestOptions): Core.APIPromise<FileDeleted> {
    return this.delete(`/files/${fileId}`, options);
  }

  /**
   * Returns the contents of the specified file.
   */
  retrieveContent(fileId: string, options?: Core.RequestOptions): Core.APIPromise<string> {
    return this.get(`/files/${fileId}/content`, {
      ...options,
      headers: { Accept: 'application/json', ...options?.headers },
    });
  }

  /**
   * Waits for the given file to be processed, default timeout is 30 mins.
   */
  async waitForProcessing(
    id: string,
    { pollInterval = 5000, maxWait = 30 * 60 * 1000 }: { pollInterval?: number; maxWait?: number } = {},
  ): Promise<FileObject> {
    const TERMINAL_STATES = new Set(['processed', 'error', 'deleted']);

    const start = Date.now();
    let file = await this.retrieve(id);

    while (!file.status || !TERMINAL_STATES.has(file.status)) {
      await sleep(pollInterval);

      file = await this.retrieve(id);
      if (Date.now() - start > maxWait) {
        throw new APIConnectionTimeoutError({
          message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`,
        });
      }
    }

    return file;
  }
}

/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export class FileObjectsPage extends Page<FileObject> {}

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
   * The File identifier, which can be referenced in the API endpoints.
   */
  id: string;

  /**
   * The size of the file, in bytes.
   */
  bytes: number;

  /**
   * The Unix timestamp (in seconds) for when the File was created.
   */
  created_at: number;

  /**
   * The name of the File.
   */
  filename: string;

  /**
   * The object type, which is always `file`.
   */
  object: 'file';

  /**
   * The intended purpose of the File. Supported values are `fine-tune`,
   * `fine-tune-results`, `assistants`, and `assistants_output`.
   */
  purpose: 'fine-tune' | 'fine-tune-results' | 'assistants' | 'assistants_output';

  /**
   * Deprecated. The current status of the File, which can be either `uploaded`,
   * `processed`, or `error`.
   */
  status: 'uploaded' | 'processed' | 'error';

  /**
   * Deprecated. For details on why a fine-tuning training file failed validation,
   * see the `error` field on `fine_tuning.job`.
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
   * Use "fine-tune" for
   * [Fine-tuning](https://platform.openai.com/docs/api-reference/fine-tuning) and
   * "assistants" for
   * [Assistants](https://platform.openai.com/docs/api-reference/assistants) and
   * [Messages](https://platform.openai.com/docs/api-reference/messages). This allows
   * us to validate the format of the uploaded file is correct for fine-tuning.
   */
  purpose: 'fine-tune' | 'assistants';
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
  export import FileObjectsPage = FilesAPI.FileObjectsPage;
  export import FileCreateParams = FilesAPI.FileCreateParams;
  export import FileListParams = FilesAPI.FileListParams;
}
