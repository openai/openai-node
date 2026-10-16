// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { SidebandEmitter, SidebandStreamMessage, WebSocketError, buildURL } from './internal-base';
import { WebSocketConnection } from '../../../internal/ws-connection-controller';
import type { WebSocketLike } from '../../../internal/ws-adapter';
import {
  type WebSocketStreamOptions,
  type RawWebSocketData,
  type ReconnectingEvent,
  type ReconnectingOverrides,
} from '../../../internal/ws';
import * as SidebandAPI from './sideband';
import { OpenAI } from '../../../client';

export interface SidebandWSParameters extends Record<string, unknown> {
  /**
   * Opt in to the graceful WebSocket closing handshake when the session ends. The
   * server may also enable this behavior by default.
   */
  graceful_close?: boolean;

  session_id: string;
}

export interface SidebandWSReconnectOptions {
  /**
   * Called before each reconnect attempt. Return an object with
   * `parameters` to override query parameters for the next connection.
   */
  onReconnecting(
    event: ReconnectingEvent<SidebandWSParameters>,
  ): ReconnectingOverrides<SidebandWSParameters> | void;

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

export interface SidebandWSBaseOptions {
  /**
   * Options for automatic reconnection on recoverable close codes.
   * Automatic reconnection is only enabled when this has a non-null value.
   */
  reconnect?: SidebandWSReconnectOptions | null | undefined;

  /**
   * Byte budget for outgoing messages queued while the socket is connecting
   * or reconnecting. An empty queue accepts one message even if it exceeds
   * this budget. Further messages are discarded and an `error` event is emitted
   * if the total queued size would exceed the budget.
   * Default: 1 MiB (1,048,576 bytes).
   */
  maxQueueSize?: number | undefined;
}

export abstract class SidebandWSBase<TSocket extends WebSocketLike> extends SidebandEmitter {
  url!: URL;
  socket!: TSocket;

  protected _client: OpenAI;
  protected _parameters: SidebandWSParameters | null | undefined;
  #connection: WebSocketConnection<
    TSocket,
    SidebandAPI.ConnectClientEvent,
    SidebandAPI.ConnectServerEvent,
    WebSocketError,
    SidebandWSParameters
  >;

  constructor(client: OpenAI, parameters: SidebandWSParameters, options?: SidebandWSBaseOptions | undefined) {
    super();
    this._client = client;
    this._parameters = parameters ?? undefined;
    const owner = this;
    this.#connection = new WebSocketConnection<
      TSocket,
      SidebandAPI.ConnectClientEvent,
      SidebandAPI.ConnectServerEvent,
      WebSocketError,
      SidebandWSParameters
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
        requeueFailed: false,
      },
      options,
    );
  }

  /** Establishes the initial WebSocket connection. */
  protected _connectInitial(): void {
    this.url = buildURL(this._client, this._parameters ?? {});
    this.socket = this.#connection.connect();
  }

  /** Creates a platform-specific WebSocket for the given URL and auth headers. */
  protected abstract _createSocket(url: URL, authHeaders: Record<string, string>): TSocket;

  send(event: SidebandAPI.ConnectClientEvent) {
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
  stream(options?: WebSocketStreamOptions): AsyncIterableIterator<SidebandStreamMessage> {
    return options === undefined ? this[Symbol.asyncIterator]() : this[Symbol.asyncIterator](options);
  }

  [Symbol.asyncIterator](options?: WebSocketStreamOptions): AsyncIterableIterator<SidebandStreamMessage> {
    return this.#connection.iterate(options);
  }

  #onMessage(data: string | ArrayBuffer | ArrayBufferView, isBinary: boolean): void {
    if (isBinary) {
      this._emit('raw', data);
      return;
    }

    // Coerce to string in case the adapter delivers a typed-array for text frames.
    const text = typeof data === 'string' ? data : String(data);

    let event: SidebandAPI.ConnectServerEvent;
    try {
      event = JSON.parse(text) as SidebandAPI.ConnectServerEvent;
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

    this._emit('event', event);

    if (event.type === 'error') {
      this._onError(event);
    } else {
      // @ts-ignore TS isn't smart enough to get the relationship right here
      this._emit(event.type, event);
    }
  }

  protected _authHeaders(): Record<string, string> {
    if (this._client.apiKey) {
      return { Authorization: `Bearer ${this._client.apiKey}` };
    }
    return {};
  }
}
