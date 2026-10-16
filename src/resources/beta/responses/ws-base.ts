// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { ResponsesEmitter, ResponsesStreamMessage, WebSocketError, buildURL } from './internal-base';
import { WebSocketConnection } from '../../../internal/ws-connection-controller';
import type { WebSocketLike } from '../../../internal/ws-adapter';
import {
  type WebSocketStreamOptions,
  type RawWebSocketData,
  type ReconnectingEvent,
  type ReconnectingOverrides,
  recordWebSocketError,
  rawByteLength,
} from '../../../internal/ws';
import * as ResponsesAPI from './responses';
import { OpenAI } from '../../../client';

const webSocketEventPayloads = new WeakMap<object, string>();
const webSocketEventBytes = new WeakMap<object, number>();

/** Original wire size, available only during synchronous event notification. @internal */
export function getWebSocketEventBytes(event: object): number | undefined {
  return webSocketEventBytes.get(event);
}

/** Original JSON, available only during synchronous event notification. @internal */
export function getWebSocketEventPayload(event: object): string | undefined {
  return webSocketEventPayloads.get(event);
}

export interface ResponsesWSReconnectOptions {
  /**
   * Called before each reconnect attempt. Return an object with
   * `parameters` to override query parameters for the next connection.
   */
  onReconnecting(
    event: ReconnectingEvent<Record<string, unknown>>,
  ): ReconnectingOverrides<Record<string, unknown>> | void;

  /**
   * Maximum number of reconnection attempts. Default: 5.
   * Set to 0 to disable reconnection entirely.
   */
  maxRetries?: number;

  /**
   * Initial backoff delay in milliseconds. Default: 500.
   */
  initialDelay?: number;

  /**
   * Maximum backoff delay in milliseconds. Default: 8000.
   */
  maxDelay?: number;
}

export interface ResponsesWSBaseOptions {
  /**
   * Options for automatic reconnection on recoverable close codes.
   * Automatic reconnection is only enabled when this has a non-null value.
   */
  reconnect?: ResponsesWSReconnectOptions | null | undefined;

  /**
   * Byte budget for outgoing messages queued while the socket is connecting
   * or reconnecting. An empty queue accepts one message even if it exceeds
   * this budget. Further messages are discarded and an `error` event is emitted
   * if the total queued size would exceed the budget.
   * Default: 1 MiB (1,048,576 bytes).
   */
  maxQueueSize?: number | undefined;
}

export abstract class ResponsesWSBase<TSocket extends WebSocketLike> extends ResponsesEmitter {
  url!: URL;
  socket!: TSocket;

  protected _client: OpenAI;
  protected _parameters: Record<string, unknown> | null | undefined;
  #connection: WebSocketConnection<
    TSocket,
    ResponsesAPI.BetaResponsesClientEvent,
    ResponsesAPI.BetaResponsesServerEvent,
    WebSocketError,
    Record<string, unknown>
  >;

  constructor(client: OpenAI, options?: ResponsesWSBaseOptions | undefined) {
    super();
    this._client = client;
    this._parameters = undefined;
    const owner = this;
    this.#connection = new WebSocketConnection<
      TSocket,
      ResponsesAPI.BetaResponsesClientEvent,
      ResponsesAPI.BetaResponsesServerEvent,
      WebSocketError,
      Record<string, unknown>
    >(
      this,
      {
        buildURL: () => buildURL(this._client, this._parameters ?? {}),
        createSocket: (url) => this._createSocket(url, this._authHeaders()),
        get parameters() {
          return owner._parameters;
        },
        set parameters(parameters) {
          owner._parameters = parameters;
        },
        isErrorEvent: (event) => event.type === 'error',
        onMessage: (data, isBinary) => this.#onMessage(data, isBinary),
        onError: (message, cause) => this._onError(null, message, cause),
        createError: (message) => new WebSocketError(message, null),
        subscribe: (onEvent, onRaw, onError) => {
          this.on('event', onEvent);
          this.on('raw', onRaw);
          this.on('error', onError);
        },
        unsubscribe: (onEvent, onRaw, onError) => {
          this.off('event', onEvent);
          this.off('raw', onRaw);
          this.off('error', onError);
        },
        emitReconnecting: (event) => this._emit('reconnecting', event),
        emitReconnected: () => this._emit('reconnected'),
        emitClose: (code, reason, unsent) => this._emit('close', code, reason, unsent),
        onSocketError: recordWebSocketError,
        prepareReconnectSocket: () => this._prepareReconnectSocket(),
      },
      options,
    );
  }

  /** Establishes the initial WebSocket connection. */
  protected _connectInitial(): void {
    this.url = buildURL(this._client, {});
    this.socket = this.#connection.connect();
  }

  /**
   * Creates a platform-specific WebSocket for the given URL and captured client auth headers.
   * The transport must supply or validate its final credentials before connecting;
   * these headers may be empty when authentication is managed by the transport.
   */
  protected abstract _createSocket(url: URL, authHeaders: Record<string, string>): TSocket;

  send(event: ResponsesAPI.BetaResponsesClientEvent) {
    this.#connection.send(event);
  }

  sendRaw(data: RawWebSocketData) {
    this.#connection.sendRaw(data);
  }

  close(props?: { code: number; reason: string }) {
    this.#connection.close(props);
  }

  /**
   * Returns an async iterator over WebSocket lifecycle and message events,
   * providing an alternative to the event-based `.on()` API.
   * The iterator will exit if the socket closes but exiting the iterator
   * does not close the socket.
   *
   * Pass `maxBufferedEvents` to limit queued records for this iterator, including
   * lifecycle events. Overflow discards its backlog and rejects `next()` with a
   * WebSocketError; the shared socket and other iterators remain active.
   * Omitted means unlimited. This is an event-count limit, not a byte limit.
   *
   * @example
   * ```ts
   * for await (const event of client.stream()) {
   *   switch (event.type) {
   *     case 'message':
   *       console.log('received:', event.message);
   *       break;
   *     case 'error':
   *       console.error(event.error);
   *       break;
   *     case 'close':
   *       console.log('connection closed');
   *       break;
   *   }
   * }
   * ```
   */
  stream(options?: WebSocketStreamOptions): AsyncIterableIterator<ResponsesStreamMessage> {
    return options === undefined ? this[Symbol.asyncIterator]() : this[Symbol.asyncIterator](options);
  }

  [Symbol.asyncIterator](options?: WebSocketStreamOptions): AsyncIterableIterator<ResponsesStreamMessage> {
    return this.#connection.iterate(options);
  }

  #onMessage(data: string | ArrayBuffer | ArrayBufferView, isBinary: boolean): void {
    if (isBinary) {
      this._emit('raw', data);
      return;
    }

    // Coerce to string in case the adapter delivers a typed-array for text frames.
    const text = typeof data === 'string' ? data : String(data);

    let event: ResponsesAPI.BetaResponsesServerEvent;
    try {
      event = JSON.parse(text) as ResponsesAPI.BetaResponsesServerEvent;
    } catch {
      this._emit('raw', data);
      return;
    }

    if (
      event === null ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      !Object.prototype.hasOwnProperty.call(event, 'type') ||
      typeof event.type !== 'string'
    ) {
      this._onError(
        null,
        'received invalid WebSocket event: expected an object with an own string type',
        undefined,
      );
      return;
    }

    const eventType: string = event.type;
    const reservedEventType =
      eventType === 'raw' ||
      eventType === 'close' ||
      eventType === 'event' ||
      eventType === 'reconnecting' ||
      eventType === 'reconnected' ||
      eventType === 'open' ||
      eventType === 'error';
    if (reservedEventType && eventType !== 'error') {
      this._onError(null, 'received reserved WebSocket event type', undefined);
      return;
    }

    webSocketEventBytes.set(event, rawByteLength(data));
    webSocketEventPayloads.set(event, text);
    try {
      this._emit('event', event);
    } finally {
      webSocketEventBytes.delete(event);
      webSocketEventPayloads.delete(event);
    }

    if (event.type === 'error') {
      this._onError(event);
    } else {
      // @ts-ignore TS isn't smart enough to get the relationship right here
      this._emit(event.type, event);
    }
  }

  protected _prepareReconnectSocket(): Promise<(url: URL) => TSocket> {
    const authHeaders = this._authHeaders();
    return Promise.resolve((url) => this._createSocket(url, authHeaders));
  }

  protected _authHeaders(apiKey = this._client.apiKey): Record<string, string> {
    return typeof apiKey === 'string' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }
}
