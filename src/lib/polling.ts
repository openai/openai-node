import type { APIPromise } from '../core/api-promise';
import { buildHeaders } from '../internal/headers';
import type { NullableHeaders } from '../internal/headers';
import type { RequestOptions } from '../internal/request-options';
import { sleep } from '../internal/utils/sleep';

type PollOptions = RequestOptions & { pollIntervalMs?: number };

/**
 * Repeatedly retrieves a lifecycle resource using the existing polling-helper
 * headers. Intermediate states wait for the explicit interval, server interval,
 * or five-second default; terminal states return the same parsed object.
 * Unknown states retry immediately, and retrieval errors propagate unchanged.
 *
 * @internal
 */
export async function pollWithResponse<T extends { status: string }>(
  retrieve: (headers: NullableHeaders) => APIPromise<T>,
  intermediateStatuses: readonly T['status'][],
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

    if (intermediateStatuses.includes(status)) {
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
