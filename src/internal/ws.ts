import { concatBytes, encodeUTF8 } from './utils/bytes';

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

/**
 * Raw data types that can be sent over a WebSocket without serialization.
 */
export type RawWebSocketData = string | ArrayBufferLike | ArrayBufferView | ArrayBufferView[];

export type UnsentMessage<T> = { type: 'message'; message: T } | { type: 'raw'; data: RawWebSocketData };

type QueueEntry =
  | { kind: 'json'; data: string; byteLength: number }
  | { kind: 'raw'; data: RawWebSocketData; byteLength: number };

function toUint8Array(view: ArrayBufferView): Uint8Array {
  if (view instanceof Uint8Array) return view;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Flatten `ArrayBufferView[]` fragments into a single `Uint8Array` so that
 * `ws.send()` transmits the correct bytes.
 */
export function flattenRawData(data: RawWebSocketData): Exclude<RawWebSocketData, ArrayBufferView[]> {
  if (Array.isArray(data)) return concatBytes(data.map(toUint8Array));
  return data;
}

function snapshotRawData(data: RawWebSocketData): Exclude<RawWebSocketData, ArrayBufferView[]> {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return concatBytes(data.map(toUint8Array));
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(toUint8Array(data));
    return copy;
  }
  return data.slice(0);
}

function rawByteLength(data: RawWebSocketData): number {
  if (typeof data === 'string') return encodeUTF8(data).byteLength;
  if (Array.isArray(data)) return data.reduce((sum, buf) => sum + buf.byteLength, 0);
  if ('byteLength' in data) return data.byteLength;
  return 0;
}

/**
 * A bounded queue for outgoing WebSocket messages. JSON messages are
 * serialized on enqueue; raw messages are stored as-is. The queue enforces
 * a configurable byte-size limit and can return the original messages via
 * {@link drain} when the connection permanently closes.
 */
export class SendQueue<T = unknown> {
  private _queue: QueueEntry[] = [];
  private _bytes: number = 0;
  private _maxBytes: number;

  constructor(maxBytes: number = 1_048_576) {
    this._maxBytes = maxBytes;
  }

  /**
   * Serialize and enqueue a JSON message. Returns `true` if the message was
   * accepted, `false` if it would exceed the byte-size limit.
   */
  enqueue(event: T): boolean {
    const data = JSON.stringify(event);
    const byteLength = encodeUTF8(data).byteLength;
    if (this._bytes + byteLength > this._maxBytes) {
      return false;
    }
    this._queue.push({ kind: 'json', data, byteLength });
    this._bytes += byteLength;
    return true;
  }

  /**
   * Enqueue raw data without serialization. Returns `true` if the data was
   * accepted, `false` if it would exceed the byte-size limit.
   */
  enqueueRaw(data: RawWebSocketData): boolean {
    const snapshot = snapshotRawData(data);
    const byteLength = rawByteLength(snapshot);
    if (this._bytes + byteLength > this._maxBytes) {
      return false;
    }
    this._queue.push({ kind: 'raw', data: snapshot, byteLength });
    this._bytes += byteLength;
    return true;
  }

  /**
   * Send every queued message via `send`. If `send` throws, the failing
   * message and all subsequent messages are re-queued and the error is
   * re-thrown so the caller can report it.
   */
  flush(send: (data: RawWebSocketData) => void): void {
    const pending = this._queue.splice(0);
    this._bytes = 0;
    for (let i = 0; i < pending.length; i++) {
      try {
        send(pending[i]!.data);
      } catch (err) {
        const remaining = pending.slice(i);
        this._queue = remaining.concat(this._queue);
        this._bytes = this._queue.reduce((sum, item) => sum + item.byteLength, 0);
        throw err;
      }
    }
  }

  /**
   * Drain the queue and return the unsent messages. JSON messages are
   * deserialized back to their original form. Resets byte tracking to zero.
   */
  drain(): UnsentMessage<T>[] {
    const unsent = this._queue.map((entry): UnsentMessage<T> => {
      if (entry.kind === 'raw') return { type: 'raw', data: entry.data };
      return { type: 'message', message: JSON.parse(entry.data) as T };
    });
    this._queue = [];
    this._bytes = 0;
    return unsent;
  }
}

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
