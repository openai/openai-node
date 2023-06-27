// File generated from our OpenAPI spec by Stainless.

import * as Core from '~/core';
import { APIResource } from '~/resource';
import * as API from './';
import { type Uploadable, multipartFormRequestOptions } from '~/core';

export class Files extends APIResource {
  /**
   * Upload a file that contains document(s) to be used across various
   * endpoints/features. Currently, the size of all the files uploaded by one
   * organization can be up to 1 GB. Please contact us if you need to increase the
   * storage limit.
   */
  async create(
    body: FileCreateParams,
    options?: Core.RequestOptions,
  ): Promise<Core.APIResponse<FileResponse>> {
    return this.post('/files', await multipartFormRequestOptions({ body, ...options }));
  }

  /**
   * Returns information about a specific file.
   */
  retrieve(fileId: string, options?: Core.RequestOptions): Promise<Core.APIResponse<FileResponse>> {
    return this.get(`/files/${fileId}`, options);
  }

  /**
   * Returns a list of files that belong to the user's organization.
   */
  list(options?: Core.RequestOptions): Promise<Core.APIResponse<FileListResponse>> {
    return this.get('/files', options);
  }

  /**
   * Delete a file.
   */
  del(fileId: string, options?: Core.RequestOptions): Promise<Core.APIResponse<FileDeletedResponse>> {
    return this.delete(`/files/${fileId}`, options);
  }

  /**
   * Returns the contents of the specified file
   */
  retrieveFileContent(
    fileId: string,
    options?: Core.RequestOptions,
  ): Promise<Core.APIResponse<Promise<string>>> {
    return this.get(`/files/${fileId}/content`, {
      ...options,
      headers: { Accept: 'application/json', ...options?.headers },
    });
  }
}

export type FileContentResponse = string;

export interface FileDeletedResponse {
  deleted: boolean;

  id: string;

  object: string;
}

export interface FileResponse {
  bytes: number;

  created_at: number;

  filename: string;

  id: string;

  object: string;

  purpose: string;

  status?: string;

  status_details?: unknown | null;
}

export interface FileListResponse {
  data: Array<FileResponse>;

  object: string;
}

export interface FileCreateParams {
  /**
   * Name of the [JSON Lines](https://jsonlines.readthedocs.io/en/latest/) file to be
   * uploaded.
   *
   * If the `purpose` is set to "fine-tune", each line is a JSON record with "prompt"
   * and "completion" fields representing your
   * [training examples](/docs/guides/fine-tuning/prepare-training-data).
   */
  file: Uploadable;

  /**
   * The intended purpose of the uploaded documents.
   *
   * Use "fine-tune" for [Fine-tuning](/docs/api-reference/fine-tunes). This allows
   * us to validate the format of the uploaded file.
   */
  purpose: string;
}

export namespace Files {
  export import FileContentResponse = API.FileContentResponse;
  export import FileDeletedResponse = API.FileDeletedResponse;
  export import FileResponse = API.FileResponse;
  export import FileListResponse = API.FileListResponse;
  export import FileCreateParams = API.FileCreateParams;
}
