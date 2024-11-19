// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../resource';
import * as FilesAPI from './files';
import { VectorStoreFilesPage } from './files';
import * as VectorStoresAPI from './vector-stores';
import { APIPromise } from '../../../api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../pagination';
import { RequestOptions } from '../../../internal/request-options';

export class FileBatches extends APIResource {
  /**
   * Create a vector store file batch.
   */
  create(
    vectorStoreID: string,
    body: FileBatchCreateParams,
    options?: RequestOptions,
  ): APIPromise<VectorStoreFileBatch> {
    return this._client.post(`/vector_stores/${vectorStoreID}/file_batches`, {
      body,
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Retrieves a vector store file batch.
   */
  retrieve(
    batchID: string,
    params: FileBatchRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<VectorStoreFileBatch> {
    const { vector_store_id } = params;
    return this._client.get(`/vector_stores/${vector_store_id}/file_batches/${batchID}`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Cancel a vector store file batch. This attempts to cancel the processing of
   * files in this batch as soon as possible.
   */
  cancel(
    batchID: string,
    params: FileBatchCancelParams,
    options?: RequestOptions,
  ): APIPromise<VectorStoreFileBatch> {
    const { vector_store_id } = params;
    return this._client.post(`/vector_stores/${vector_store_id}/file_batches/${batchID}/cancel`, {
      ...options,
      headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
    });
  }

  /**
   * Returns a list of vector store files in a batch.
   */
  listFiles(
    batchID: string,
    params: FileBatchListFilesParams,
    options?: RequestOptions,
  ): PagePromise<VectorStoreFilesPage, FilesAPI.VectorStoreFile> {
    const { vector_store_id, ...query } = params;
    return this._client.getAPIList(
      `/vector_stores/${vector_store_id}/file_batches/${batchID}/files`,
      CursorPage<FilesAPI.VectorStoreFile>,
      { query, ...options, headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers } },
    );
  }
}

/**
 * A batch of files attached to a vector store.
 */
export interface VectorStoreFileBatch {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the vector store files batch was
   * created.
   */
  created_at: number;

  file_counts: VectorStoreFileBatch.FileCounts;

  /**
   * The object type, which is always `vector_store.file_batch`.
   */
  object: 'vector_store.files_batch';

  /**
   * The status of the vector store files batch, which can be either `in_progress`,
   * `completed`, `cancelled` or `failed`.
   */
  status: 'in_progress' | 'completed' | 'cancelled' | 'failed';

  /**
   * The ID of the
   * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object)
   * that the [File](https://platform.openai.com/docs/api-reference/files) is
   * attached to.
   */
  vector_store_id: string;
}

export namespace VectorStoreFileBatch {
  export interface FileCounts {
    /**
     * The number of files that where cancelled.
     */
    cancelled: number;

    /**
     * The number of files that have been processed.
     */
    completed: number;

    /**
     * The number of files that have failed to process.
     */
    failed: number;

    /**
     * The number of files that are currently being processed.
     */
    in_progress: number;

    /**
     * The total number of files.
     */
    total: number;
  }
}

export interface FileBatchCreateParams {
  /**
   * A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
   * the vector store should use. Useful for tools like `file_search` that can access
   * files.
   */
  file_ids: Array<string>;

  /**
   * The chunking strategy used to chunk the file(s). If not set, will use the `auto`
   * strategy. Only applicable if `file_ids` is non-empty.
   */
  chunking_strategy?: VectorStoresAPI.FileChunkingStrategyParam;
}

export interface FileBatchRetrieveParams {
  /**
   * The ID of the vector store that the file batch belongs to.
   */
  vector_store_id: string;
}

export interface FileBatchCancelParams {
  /**
   * The ID of the vector store that the file batch belongs to.
   */
  vector_store_id: string;
}

export interface FileBatchListFilesParams extends CursorPageParams {
  /**
   * Path param: The ID of the vector store that the files belong to.
   */
  vector_store_id: string;

  /**
   * Query param: A cursor for use in pagination. `before` is an object ID that
   * defines your place in the list. For instance, if you make a list request and
   * receive 100 objects, starting with obj_foo, your subsequent call can include
   * before=obj_foo in order to fetch the previous page of the list.
   */
  before?: string;

  /**
   * Query param: Filter by file status. One of `in_progress`, `completed`, `failed`,
   * `cancelled`.
   */
  filter?: 'in_progress' | 'completed' | 'failed' | 'cancelled';

  /**
   * Query param: Sort order by the `created_at` timestamp of the objects. `asc` for
   * ascending order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';
}

export declare namespace FileBatches {
  export {
    type VectorStoreFileBatch as VectorStoreFileBatch,
    type FileBatchCreateParams as FileBatchCreateParams,
    type FileBatchRetrieveParams as FileBatchRetrieveParams,
    type FileBatchCancelParams as FileBatchCancelParams,
    type FileBatchListFilesParams as FileBatchListFilesParams,
  };
}

export { type VectorStoreFilesPage };
