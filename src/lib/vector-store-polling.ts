import type { RequestOptions } from '../internal/request-options';
import type { FileBatches, VectorStoreFileBatch } from '../resources/vector-stores/file-batches';
import type { Files, VectorStoreFile } from '../resources/vector-stores/files';
import { pollWithResponse } from './polling';

type PollOptions = RequestOptions & { pollIntervalMs?: number };

/**
 * Polls an attached file through the resource's retrieve method. Failed files are
 * returned to the caller, and cancelled files retain their existing retry behavior.
 *
 * @internal
 */
export function pollVectorStoreFile(
  resource: Pick<Files, 'retrieve'>,
  vectorStoreID: string,
  fileID: string,
  options?: PollOptions,
): Promise<VectorStoreFile> {
  return pollWithResponse(
    (headers) => resource.retrieve(fileID, { vector_store_id: vectorStoreID }, { ...options, headers }),
    ['in_progress'],
    ['failed', 'completed'],
    options,
  );
}

/**
 * Polls a file batch through the resource's retrieve method until it completes,
 * fails, or is cancelled. Retrieval errors are propagated unchanged.
 *
 * @internal
 */
export function pollVectorStoreFileBatch(
  resource: Pick<FileBatches, 'retrieve'>,
  vectorStoreID: string,
  batchID: string,
  options?: PollOptions,
): Promise<VectorStoreFileBatch> {
  return pollWithResponse(
    (headers) => resource.retrieve(batchID, { vector_store_id: vectorStoreID }, { ...options, headers }),
    ['in_progress'],
    ['failed', 'cancelled', 'completed'],
    options,
  );
}
