import type { OpenAI } from '../client';
import type { RequestOptions } from '../internal/request-options';
import type { FileBatches, VectorStoreFileBatch } from '../resources/vector-stores/file-batches';
import type { Uploadable } from '../uploads';
import { allSettledWithThrow } from './Util';

type UploadOptions = RequestOptions & { pollIntervalMs?: number; maxConcurrency?: number };

/**
 * Uploads files with a shared iterator, then creates and polls the batch. Every
 * worker settles before upload failures are propagated.
 *
 * @internal
 */
export async function uploadAndPollVectorStoreFileBatch(
  resource: Pick<FileBatches, 'createAndPoll'>,
  client: Pick<OpenAI, 'files'>,
  vectorStoreId: string,
  files: Uploadable[],
  fileIds: string[],
  options?: UploadOptions,
): Promise<VectorStoreFileBatch> {
  if (files === null || files === undefined || files.length === 0) {
    throw new Error(
      "No `files` provided to process. If you've already uploaded files you should use `.createAndPoll()` instead",
    );
  }

  const configuredConcurrency = options?.maxConcurrency ?? 5;
  const concurrencyLimit = Math.min(configuredConcurrency, files.length);
  const fileIterator = files.values();
  const allFileIds = [...fileIds];

  // This code is based on this design. The libraries don't accommodate our environment limits.
  // https://stackoverflow.com/questions/40639432/what-is-the-best-way-to-limit-concurrency-when-using-es6s-promise-all
  async function processFiles(iterator: IterableIterator<Uploadable>) {
    for (const item of iterator) {
      // oxlint-disable-next-line no-await-in-loop -- Each worker uploads one file at a time.
      const fileObj = await client.files.create({ file: item, purpose: 'assistants' }, options);
      allFileIds.push(fileObj.id);
    }
  }

  // Assigning length preserves native validation of invalid concurrency values.
  const workers: Promise<void>[] = [];
  workers.length = concurrencyLimit;
  for (let index = 0; index < workers.length; index += 1) {
    workers[index] = processFiles(fileIterator);
  }
  await allSettledWithThrow(workers);

  return await resource.createAndPoll(vectorStoreId, { file_ids: allFileIds }, options);
}
