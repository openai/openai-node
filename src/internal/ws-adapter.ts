/**
 * Normalized WebSocket interface that abstracts over the `ws` package (Node.js)
 * and the native WebSocket API (browser).
 */
export interface WebSocketLike {
  readonly readyState: number;

  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;

  on(event: 'open', listener: () => void): void;
  on(
    event: 'message',
    listener: (data: string | ArrayBuffer | ArrayBufferView, isBinary: boolean) => void,
  ): void;
  on(event: 'close', listener: (code: number, reason: string) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: string, listener: (...args: any[]) => void): void;

  off(event: string, listener: (...args: any[]) => void): void;
  once(event: string, listener: (...args: any[]) => void): void;
}

/** Standard WebSocket readyState values (RFC 6455). */
export const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;
