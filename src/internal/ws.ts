/** Reconnection event passed to the `onReconnecting` handler and event listeners. */
export interface ReconnectingEvent<Parameters = Record<string, unknown>> {
  /** Which retry attempt this is (1-based). */
  readonly attempt: number;
  /** Total attempts that will be made. */
  readonly maxAttempts: number;
  /** Delay in ms before this attempt connects. */
  readonly delay: number;
  /** The WebSocket close code that triggered reconnection. */
  readonly closeCode: number;
  /** The current query parameters. */
  readonly parameters: (Parameters & Record<string, unknown>) | undefined;
}

/**
 * Optional overrides returned from the `onReconnecting` handler
 * to customize the next reconnection attempt.
 */
export type ReconnectingOverrides<Parameters = Record<string, unknown>> =
  | {
      /**
       * If provided, assigns the query parameters for the next connection.
       * Set to `undefined` to clear all query parameters.
       */
      parameters?: (Parameters & Record<string, unknown>) | undefined;
    }
  | {
      /**
       * If set, will stop attempting to reconnect.
       */
      abort: true;
    };

// RFC 6455 §7.4.1
export function isRecoverableClose(code: number): boolean {
  switch (code) {
    case 1000:
      return false; // Normal closure
    case 1001:
      return true; // Going away (server shutting down)
    case 1002:
      return false; // Protocol error
    case 1003:
      return false; // Unsupported data
    case 1005:
      return true; // No status code (abnormal)
    case 1006:
      return true; // Abnormal closure (network drop)
    case 1007:
      return false; // Invalid payload
    case 1008:
      return false; // Policy violation
    case 1009:
      return false; // Message too big
    case 1010:
      return false; // Missing extension
    case 1011:
      return true; // Internal server error
    case 1012:
      return true; // Service restart
    case 1013:
      return true; // Try again later
    case 1015:
      return true; // TLS handshake failure
    default:
      return false;
  }
}
