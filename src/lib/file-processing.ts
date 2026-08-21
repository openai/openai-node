import { APIConnectionTimeoutError } from '../error';
import { sleep } from '../internal/utils/sleep';
import type { FileObject, Files } from '../resources/files';

/**
 * Waits for file processing through the resource's retrieve method. The timeout
 * is checked after each subsequent retrieval, preserving the existing behavior
 * for an initially terminal file and for a terminal response received too late.
 *
 * @internal
 */
export async function waitForFileProcessing(
  resource: Pick<Files, 'retrieve'>,
  id: string,
  pollInterval: number,
  maxWait: number,
): Promise<FileObject> {
  const terminalStates = new Set(['processed', 'error', 'deleted']);
  const start = Date.now();
  let file = await resource.retrieve(id);

  while (!file.status || !terminalStates.has(file.status)) {
    // oxlint-disable-next-line no-await-in-loop -- Wait before issuing the next processing-status request.
    await sleep(pollInterval);

    // oxlint-disable-next-line no-await-in-loop -- The timeout and next iteration depend on this response.
    file = await resource.retrieve(id);
    if (Date.now() - start > maxWait) {
      throw new APIConnectionTimeoutError({
        message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`,
      });
    }
  }

  return file;
}
