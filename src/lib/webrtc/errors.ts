import { OpenAIError } from '../../core/error';

/** Stable classifications of local WebRTC failures, independent of API error codes. */
export type WebRTCErrorCode =
  | 'invalid_state'
  | 'not_open'
  | 'send_failed'
  | 'invalid_message'
  | 'signaling_failed'
  | 'negotiation_failed'
  | 'transport_failed'
  | 'connection_closed'
  | 'timeout'
  | 'aborted'
  | 'unsupported_environment';

/** The operation in which a local error originated. */
export type WebRTCErrorPhase = 'offer' | 'signaling' | 'answer' | 'transport' | 'message' | 'send';

/** A local SDK/transport failure. Server error events remain unchanged in onEvent(). */
export class WebRTCError extends OpenAIError {
  /** Distinguishes this error from API errors and application callback exceptions. */
  override readonly name = 'WebRTCError';
  /** Stable failure classification, suitable for detecting expected cancellation. */
  readonly code: WebRTCErrorCode;
  /** The failing setup, transport, or message operation. */
  readonly phase: WebRTCErrorPhase;
  /** Original exception or abort reason. It may contain application-sensitive details; do not log blindly. */
  readonly cause: unknown;

  /** Creates a safe diagnostic while retaining the original cause separately. */
  constructor(code: WebRTCErrorCode, phase: WebRTCErrorPhase, message: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.phase = phase;
    this.cause = cause;
  }
}
