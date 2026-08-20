import type { APIPromise } from '../core/api-promise';
import { buildHeaders } from '../internal/headers';
import type { NullableHeaders } from '../internal/headers';
import type { RequestOptions } from '../internal/request-options';
import { sleep } from '../internal/utils/sleep';
import type { FileBatches, VectorStoreFileBatch } from '../resources/vector-stores/file-batches';
import type { Files, VectorStoreFile } from '../resources/vector-stores/files';

type PollOptions = RequestOptions & { pollIntervalMs?: number };

async function poll<T extends { status: string }>(
  retrieve: (headers: NullableHeaders) => APIPromise<T>,
  terminalStatuses: readonly T['status'][],
  options?: PollOptions,
): Promise<T> {
  const headers = buildHeaders([
    options?.headers,
    {
      'X-Stainless-Poll-Helper': 'true',
      'X-Stainless-Custom-Poll-Interval': options?.pollIntervalMs?.toString() ?? undefined,
    },
  ]);

  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Each poll depends on the previous response.
    const { data, response } = await retrieve(headers).withResponse();
    const { status } = data;

    if (status === 'in_progress') {
      let sleepInterval = 5000;

      if (options?.pollIntervalMs) {
        sleepInterval = options.pollIntervalMs;
      } else {
        const headerInterval = response.headers.get('openai-poll-after-ms');
        if (headerInterval) {
          // oxlint-disable-next-line radix -- Preserve the existing decimal and hexadecimal header parsing.
          const headerIntervalMs = Number.parseInt(headerInterval);
          if (!Number.isNaN(headerIntervalMs)) {
            sleepInterval = headerIntervalMs;
          }
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- Wait before issuing the next poll request.
      await sleep(sleepInterval);
    } else if (terminalStatuses.includes(status)) {
      return data;
    }
  }
}

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
  return poll(
    (headers) => resource.retrieve(fileID, { vector_store_id: vectorStoreID }, { ...options, headers }),
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
  return poll(
    (headers) => resource.retrieve(batchID, { vector_store_id: vectorStoreID }, { ...options, headers }),
    ['failed', 'cancelled', 'completed'],
    options,
  );
}
