import type { Response, ResponseStreamEvent } from '../../resources/responses/responses';
import {
  accumulateResponseWithContext,
  createResponseContext,
} from '../../internal/responses/response-accumulator';

/** A transport keepalive event that leaves the accumulated response unchanged. */
type ResponseKeepAliveEvent = {
  /** Identifies a non-content keepalive event emitted by the response transport. */
  type: 'keepalive';
  /** Monotonically ordered event sequence number assigned by the response stream. */
  sequence_number: number;
};

/**
 * Applies a streaming event to a response snapshot.
 *
 * Always use the returned snapshot. Incremental events update the supplied snapshot
 * in place, while response lifecycle events return a detached replacement. Event
 * payloads are cloned, so retaining or replaying the raw events is safe.
 */
export function accumulateResponse(
  event: ResponseStreamEvent | ResponseKeepAliveEvent,
  snapshot?: Response,
): Response {
  return accumulateResponseWithContext(event, snapshot, createResponseContext());
}
