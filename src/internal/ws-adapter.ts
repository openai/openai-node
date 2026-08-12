/**
 * Normalized WebSocket interface that abstracts over the `ws` package (Node.js)
 * and the native WebSocket API (browser).
 */
export interface WebSocketLike {
  /** Current connection state, using the numeric values in {@link ReadyState}. */
  readonly readyState: number;

  /** Sends a text or binary frame through the underlying platform socket. */
  send(data: string | ArrayBufferLike | ArrayBufferView): void;

  /** Initiates the closing handshake, optionally providing a close code and reason. */
  close(code?: number, reason?: string): void;

  /** Registers a listener that runs when the socket connection opens. */
  on(event: 'open', listener: () => void): void;

  /** Registers a listener for normalized text or binary message payloads. */
  on(
    event: 'message',
    listener: (data: string | ArrayBuffer | ArrayBufferView, isBinary: boolean) => void,
  ): void;

  /** Registers a listener for the numeric close code and decoded close reason. */
  on(event: 'close', listener: (code: number, reason: string) => void): void;

  /** Registers a listener for normalized WebSocket connection errors. */
  on(event: 'error', listener: (err: Error) => void): void;

  /** Registers a listener for any additional platform-supported socket event. */
  on(event: string, listener: (...args: any[]) => void): void;

  /** Removes a listener previously registered for the same event. */
  off(event: string, listener: (...args: any[]) => void): void;

  /** Registers a listener that removes itself before its first invocation. */
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Standard WebSocket readyState values (RFC 6455). */
export const ReadyState = {
  /** The connection has been created but is not ready to send messages. */
  CONNECTING: 0,

  /** The connection is established and ready to send messages. */
  OPEN: 1,

  /** The closing handshake has started but is not complete. */
  CLOSING: 2,

  /** The connection is closed or could not be established. */
  CLOSED: 3,
} as const;
