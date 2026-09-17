import { concatBytes, encodeUTF8 } from './utils/bytes';
import { OpenAIError } from '../core/error';
import type { WebSocketLike } from './ws-adapter';

const webSocketErrors = new WeakMap<WebSocketLike, Error>();

/** Records physical failure before transport callbacks notify public observers. @internal */
export function recordWebSocketError(socket: WebSocketLike, error: Error): void {
  webSocketErrors.set(socket, error);
}

/** Returns physical failure for this socket instance, never for a replacement. @internal */
export function getWebSocketError(socket: WebSocketLike): Error | undefined {
  return webSocketErrors.get(socket);
}

/** Options for an independently buffered WebSocket stream iterator. */
export interface WebSocketStreamOptions {
  /**
   * Maximum queued records, including raw data, errors and lifecycle events.
   * Must be a positive safe integer. Omitted means unlimited. Overflow discards
   * this iterator's backlog and rejects its next() calls with a WebSocketError,
   * without closing the shared socket or affecting other iterators.
   * This bounds event count, not payload bytes or total memory.
   */
  maxBufferedEvents?: number | undefined;
}

/** Snapshots and validates the iterator's limit before listeners are attached. */
export function getMaxBufferedEvents(options?: WebSocketStreamOptions): number | undefined {
  const limit = options?.maxBufferedEvents;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new OpenAIError('maxBufferedEvents must be a positive safe integer');
  }
  return limit;
}

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

interface CredentialedWebSocketOptions {
  auth?: string | null | undefined;
  followRedirects?: boolean | undefined;
  headers?: object | null | undefined;
}

const REDIRECT_SAFE_WEBSOCKET_HEADERS = new Set([
  'connection',
  'host',
  'openai-beta',
  'origin',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-version',
  'upgrade',
  'user-agent',
  'x-access-level',
  'x-auth-metadata',
  'x-auth-tokenization',
  'x-authentication-metadata',
  'x-authentication-tokenization',
  'x-security-policy',
  'x-token-budget',
  'x-trace-id',
]);

function isWebSocketCredentialHeader(name: string): boolean {
  return !REDIRECT_SAFE_WEBSOCKET_HEADERS.has(name.toLowerCase().split('_').join('-'));
}

/**
 * Snapshots credential values in final socket options before validation and dispatch.
 * Reports potential caller authentication, including custom headers; the server
 * remains responsible for validating credentials. Noncredential headers are left intact.
 */
export function snapshotWebSocketCredentials(options: {
  auth?: unknown;
  headers?: Record<string, unknown> | undefined;
}): boolean {
  if (options.auth !== null && options.auth !== undefined) {
    options.auth = String(options.auth);
  }
  const credentials = new Map<string, boolean>();
  const headers = options.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase().split('_').join('-');
    // Routing metadata is still protected on redirects, but cannot authenticate a socket.
    if (
      !isWebSocketCredentialHeader(name) ||
      normalizedName === 'openai-organization' ||
      normalizedName === 'openai-project'
    ) {
      continue;
    }
    let snapshot = value;
    if (Array.isArray(value)) {
      snapshot = value.map(String);
    } else if (value !== null && value !== undefined) {
      snapshot = String(value);
    }
    headers[name] = snapshot;
    const values = Array.isArray(snapshot) ? snapshot : [snapshot];
    credentials.set(
      name.toLowerCase(),
      values.some((item) => typeof item === 'string' && item.trim().length > 0),
    );
  }
  // Node applies header names case-insensitively, and Authorization overrides Basic auth.
  return (
    [...credentials.values()].some(Boolean) ||
    (!credentials.has('authorization') && typeof options.auth === 'string' && options.auth.trim().length > 0)
  );
}

/** Prevents WebSocket redirects from forwarding caller or SDK credentials to another origin. */
export function protectWebSocketOptionsFromCredentialRedirects<Options extends CredentialedWebSocketOptions>(
  options: Options,
): Options {
  const hasSensitiveHeader = Object.keys(options.headers ?? {}).some(isWebSocketCredentialHeader);

  if (!options.auth && !hasSensitiveHeader) {
    return options;
  }

  return { ...options, followRedirects: false };
}

/** A queued application message or raw WebSocket frame that was never transmitted. */
export type UnsentMessage<T> =
  | {
      /** Identifies a JSON-serialized application message. */
      type: 'message';

      /** The deserialized snapshot captured when the message was queued. */
      message: T;
    }
  | {
      /** Identifies an unencoded WebSocket frame. */
      type: 'raw';

      /** The string or copied binary payload captured when the frame was queued. */
      data: RawWebSocketData;
    };

type QueueEntry =
  | { kind: 'json'; data: string; byteLength: number }
  | { kind: 'raw'; data: RawWebSocketData; byteLength: number };

function toUint8Array(view: ArrayBufferView): Uint8Array {
  if (view instanceof Uint8Array) {
    return view;
  }
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Flatten `ArrayBufferView[]` fragments into a single `Uint8Array` so that
 * `ws.send()` transmits the correct bytes.
 */
export function flattenRawData(data: RawWebSocketData): Exclude<RawWebSocketData, ArrayBufferView[]> {
  if (Array.isArray(data)) {
    return concatBytes(data.map(toUint8Array));
  }
  return data;
}

function snapshotRawData(data: RawWebSocketData): Exclude<RawWebSocketData, ArrayBufferView[]> {
  if (typeof data === 'string') {
    return data;
  }
  if (Array.isArray(data)) {
    return concatBytes(data.map(toUint8Array));
  }
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(toUint8Array(data));
    return copy;
  }
  // oxlint-disable-next-line unicorn/prefer-spread -- ArrayBufferLike.slice copies bytes while spread changes the return type.
  return data.slice(0);
}

/** Counts wire bytes without allocating another payload-sized buffer. */
export function rawByteLength(data: RawWebSocketData): number {
  if (typeof data === 'string') {
    let bytes = 0;
    for (let index = 0; index < data.length; index += 1) {
      const code = data.codePointAt(index)!;
      if (code < 128) {
        bytes += 1;
      } else if (code < 2048) {
        bytes += 2;
      } else if (code <= 65_535) {
        bytes += 3;
      } else {
        bytes += 4;
        index += 1;
      }
    }
    return bytes;
  }
  if (Array.isArray(data)) {
    return data.reduce((sum, buf) => sum + buf.byteLength, 0);
  }
  if ('byteLength' in data) {
    return data.byteLength;
  }
  return 0;
}

/**
 * Buffers outgoing WebSocket messages while a connection is unavailable.
 *
 * JSON values are serialized immediately, and raw binary payloads are copied,
 * so later caller mutations cannot change queued messages. A single oversized
 * message is accepted when the queue is empty; further messages are rejected
 * whenever they would exceed the configured byte budget.
 */
export class SendQueue<T = unknown> {
  private _queue: QueueEntry[] = [];
  private _bytes = 0;
  private _maxBytes: number;

  /** Creates a queue with a one-mebibyte default byte budget. */
  constructor(maxBytes = 1_048_576) {
    this._maxBytes = maxBytes;
  }

  /**
   * Serializes and snapshots a JSON message before queueing it.
   *
   * @returns `true` when accepted, including an oversized first message; `false`
   * when adding it to a nonempty queue would exceed the byte budget.
   */
  enqueue(event: T): boolean {
    const data = JSON.stringify(event);
    const byteLength = encodeUTF8(data).byteLength;
    if (this._bytes + byteLength > this._maxBytes && this._queue.length > 0) {
      return false;
    }
    this._queue.push({ kind: 'json', data, byteLength });
    this._bytes += byteLength;
    return true;
  }

  /**
   * Queues a raw string or a defensive copy of a binary WebSocket payload.
   * Fragmented typed-array payloads are flattened before storage.
   *
   * @returns `true` when accepted, including an oversized first frame; `false`
   * when adding it to a nonempty queue would exceed the byte budget.
   */
  enqueueRaw(data: RawWebSocketData): boolean {
    const snapshot = snapshotRawData(data);
    const byteLength = rawByteLength(snapshot);
    if (this._bytes + byteLength > this._maxBytes && this._queue.length > 0) {
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
        this._queue = [...remaining, ...this._queue];
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
      if (entry.kind === 'raw') {
        return { type: 'raw', data: entry.data };
      }
      // SAFETY: T is the transport caller's event contract; JSON syntax is parsed here without imposing a runtime schema on forward-compatible events.
      return { type: 'message', message: JSON.parse(entry.data) as T };
    });
    this._queue = [];
    this._bytes = 0;
    return unsent;
  }
}

/**
 * Reports whether an RFC 6455 close code represents a recoverable interruption.
 *
 * Network failures, service restarts, temporary server errors, and TLS
 * handshake failures can be retried; normal closure, protocol violations,
 * invalid payloads, and unrecognized codes cannot.
 */
export function isRecoverableClose(code: number): boolean {
  switch (code) {
    case 1000: {
      return false;
    } // Normal closure
    case 1001: {
      return true;
    } // Going away (server shutting down)
    case 1002: {
      return false;
    } // Protocol error
    case 1003: {
      return false;
    } // Unsupported data
    case 1005: {
      return true;
    } // No status code (abnormal)
    case 1006: {
      return true;
    } // Abnormal closure (network drop)
    case 1007: {
      return false;
    } // Invalid payload
    case 1008: {
      return false;
    } // Policy violation
    case 1009: {
      return false;
    } // Message too big
    case 1010: {
      return false;
    } // Missing extension
    case 1011: {
      return true;
    } // Internal server error
    case 1012: {
      return true;
    } // Service restart
    case 1013: {
      return true;
    } // Try again later
    case 1015: {
      return true;
    } // TLS handshake failure
    default: {
      return false;
    }
  }
}
