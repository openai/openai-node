import type { RequestOptions } from '../internal/request-options';
import type { Run, RunRetrieveParams, Runs } from '../resources/beta/threads/runs/runs';
import { pollWithResponse } from './polling';

/**
 * Polls an assistant run through the resource's retrieve method, preserving the
 * original params object, request-header merge, and terminal run states.
 *
 * @internal
 */
export function pollAssistantRun(
  resource: Pick<Runs, 'retrieve'>,
  runID: string,
  params: RunRetrieveParams,
  options?: RequestOptions & { pollIntervalMs?: number },
): Promise<Run> {
  return pollWithResponse(
    (headers) =>
      resource.retrieve(runID, params, {
        ...options,
        headers: { ...options?.headers, ...headers },
      }),
    ['queued', 'in_progress', 'cancelling'],
    ['requires_action', 'incomplete', 'cancelled', 'completed', 'failed', 'expired'],
    options,
  );
}
