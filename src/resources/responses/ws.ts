// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { ResponsesEmitter, ResponsesStreamMessage, WebSocketError, buildURL } from './internal-base';
import { InternalEventEmitter } from '../../core/EventEmitter';
import { sleep } from '../../internal/utils/sleep';
import {
  SendQueue,
  isRecoverableClose,
  type ReconnectingEvent,
  type ReconnectingOverrides,
} from '../../internal/ws';
import * as ResponsesAPI from './responses';
import { OpenAI } from '../../client';

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

export interface ResponsesWSClientOptions extends WS.ClientOptions {
  /**
   * Options for automatic reconnection on recoverable close codes.
   * Automatic reconnection is only enabled when this has a non-null value.
   */
  reconnect?: ResponsesWSReconnectOptions | null;

  /**
   * Maximum size of the outgoing message queue in bytes.
   * Messages queued while the socket is connecting or reconnecting are held
   * in memory up to this limit. Once the limit is reached, new messages are
   * discarded and an `error` event is emitted.
   * Default: 1 MB
   */
  maxQueueSize?: number;
}

export class ResponsesWS extends ResponsesEmitter {
  url: URL;
  socket: WS.WebSocket;

  private _client: OpenAI;
  private _parameters: Record<string, unknown> | null | undefined;
  private _wsOptions: WS.ClientOptions | null | undefined;
  private _reconnectOptions: ResponsesWSReconnectOptions | null;
  private _sendQueue: SendQueue<ResponsesAPI.ResponsesClientEvent>;
  private _isReconnecting: boolean = false;
  private _intentionallyClosed = false;
  private _closeCode: number = 1000;
  private _closeReason: string = 'OK';
  private _lastCloseCode: number = 1006;
  private _lastCloseReason: string = '';

  // Necessary to keep the public event interface clean while we manage reconnecting
  private _internalEvents = new InternalEventEmitter<{
    socketSwap: (oldSocket: WS.WebSocket, newSocket: WS.WebSocket) => void;
    reconnecting: (event: ReconnectingEvent<Record<string, unknown>>) => void;
    reconnected: () => void;
    close: (code: number, reason: string, unsent: ResponsesAPI.ResponsesClientEvent[]) => void;
  }>();

  constructor(client: OpenAI, options?: ResponsesWSClientOptions | null | undefined) {
    super();
    this._client = client;
    this._parameters = undefined;
    const { reconnect, maxQueueSize, ...wsOptions } = options ?? {};
    this._wsOptions = wsOptions;
    this._reconnectOptions = reconnect ?? null;
    this._sendQueue = new SendQueue<ResponsesAPI.ResponsesClientEvent>(maxQueueSize);
    this.url = buildURL(client, {});
    this.socket = this._connect();
  }

  send(event: ResponsesAPI.ResponsesClientEvent) {
    if (this._isReconnecting || this.socket.readyState === WS.WebSocket.CONNECTING) {
      if (!this._sendQueue.enqueue(event)) {
        this._onError(null, 'send queue is full, message discarded', undefined);
      }
      return;
    }
    if (this.socket.readyState !== WS.WebSocket.OPEN) {
      this._onError(null, 'cannot send on a closed WebSocket', undefined);
      return;
    }
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      this._onError(null, 'could not send data', err);
    }
  }

  close(props?: { code: number; reason: string }) {
    this._intentionallyClosed = true;
    this._closeCode = props?.code ?? 1000;
    this._closeReason = props?.reason ?? 'OK';
    try {
      this.socket.close(this._closeCode, this._closeReason);
    } catch (err) {
      this._onError(null, 'could not close the connection', err);
    }
  }

  /**
   * Returns an async iterator over WebSocket lifecycle and message events,
   * providing an alternative to the event-based `.on()` API.
   * The iterator will exit if the socket closes but exiting the iterator
   * does not close the socket.
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
  stream(): AsyncIterableIterator<ResponsesStreamMessage> {
    return this[Symbol.asyncIterator]();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ResponsesStreamMessage> {
    // Two-queue async iterator: `queue` buffers incoming messages,
    // `resolvers` buffers waiting next() calls. A push wakes the
    // oldest next(); a next() drains the oldest message.
    const queue: ResponsesStreamMessage[] = [];
    const resolvers: (() => void)[] = [];
    let done = false;
    let currentSocket = this.socket;

    const push = (msg: ResponsesStreamMessage) => {
      queue.push(msg);
      resolvers.shift()?.();
    };

    const onEvent = (event: ResponsesAPI.ResponsesServerEvent) => {
      if (event.type === 'error') return; // handled by onEmitterError
      push({ type: 'message', message: event });
    };

    // All errors (API + socket) funnel through _onError → 'error' event
    const onEmitterError = (err: WebSocketError) => {
      push({ type: 'error', error: err });
    };

    const onOpen = () => {
      push({ type: 'open' });
    };

    const onReconnecting = (evt: ReconnectingEvent<Record<string, unknown>>) => {
      push({ type: 'reconnecting', reconnect: evt });
    };

    const onReconnected = () => {
      push({ type: 'reconnected' });
    };

    const flushResolvers = () => {
      for (let resolver = resolvers.shift(); resolver; resolver = resolvers.shift()) {
        resolver();
      }
    };

    const onClose = (code: number, reason: string, unsent: ResponsesAPI.ResponsesClientEvent[]) => {
      push({ type: 'close', code, reason, unsent });
      done = true;
      flushResolvers();
      cleanup();
    };

    const onSocketSwap = (oldSocket: WS.WebSocket, newSocket: WS.WebSocket) => {
      oldSocket.off('open', onOpen);
      newSocket.on('open', onOpen);
      currentSocket = newSocket;
    };

    const cleanup = () => {
      this.off('event', onEvent);
      this.off('error', onEmitterError);
      currentSocket.off('open', onOpen);
      this._internalEvents.off('close', onClose);
      this._internalEvents.off('socketSwap', onSocketSwap);
      this._internalEvents.off('reconnecting', onReconnecting);
      this._internalEvents.off('reconnected', onReconnected);
    };

    this.on('event', onEvent);
    this.on('error', onEmitterError);
    this.socket.on('open', onOpen);
    this._internalEvents.on('close', onClose);
    this._internalEvents.on('socketSwap', onSocketSwap);
    this._internalEvents.on('reconnecting', onReconnecting);
    this._internalEvents.on('reconnected', onReconnected);

    if (this._isReconnecting) {
      // A reconnect is already in flight. The socket may be CLOSED but the
      // instance is still alive. Emit 'reconnecting' so the iterator stays
      // open and receives the upcoming reconnected/message events.
      push({
        type: 'reconnecting',
        reconnect: { attempt: 0, maxAttempts: 0, delay: 0, closeCode: 0, parameters: undefined },
      });
    } else {
      switch (this.socket.readyState) {
        case WS.WebSocket.CONNECTING:
          push({ type: 'connecting' });
          break;
        case WS.WebSocket.OPEN:
          push({ type: 'open' });
          break;
        case WS.WebSocket.CLOSING:
          push({ type: 'closing' });
          break;
        case WS.WebSocket.CLOSED:
          push({
            type: 'close',
            code: this._lastCloseCode,
            reason: this._lastCloseReason,
            unsent: this._sendQueue.drain(),
          });
          done = true;
          cleanup();
          break;
      }
    }

    const resolve = (res: (value: IteratorResult<ResponsesStreamMessage>) => void) => {
      if (queue.length > 0) {
        res({ value: queue.shift()!, done: false });
      } else if (done) {
        res({ value: undefined, done: true });
      } else {
        return false;
      }
      return true;
    };

    const next = (): Promise<IteratorResult<ResponsesStreamMessage>> =>
      new Promise((res) => {
        if (resolve(res)) return;
        resolvers.push(() => {
          resolve(res);
        });
      });

    return {
      next,
      return: (): Promise<IteratorReturnResult<undefined>> => {
        done = true;
        cleanup();
        flushResolvers();
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  private _connect(): WS.WebSocket {
    this.url = buildURL(this._client, {});

    const socket = new WS.WebSocket(this.url, {
      ...this._wsOptions,
      headers: {
        ...this._authHeaders(),
        ...this._wsOptions?.headers,
      },
    });

    socket.on('message', (wsEvent) => {
      const event = (() => {
        try {
          return JSON.parse(wsEvent.toString()) as ResponsesAPI.ResponsesServerEvent;
        } catch (err) {
          this._onError(null, 'could not parse websocket event', err);
          return null;
        }
      })();

      if (event) {
        this._emit('event', event);

        if (event.type === 'error') {
          this._onError(event);
        } else {
          // @ts-ignore TS isn't smart enough to get the relationship right here
          this._emit(event.type, event);
        }
      }
    });

    socket.on('error', (err) => {
      // Suppress transient errors during reconnection — the retry loop
      // already handles them and will surface a close if retries exhaust.
      if (this._isReconnecting) return;
      this._onError(null, err.message, err);
    });

    socket.on('open', () => {
      this._flushSendQueue();
    });

    socket.on('close', (code: number, reason: Buffer) => {
      // Ignore close events from superseded sockets — a stale socket's
      // late close must not kick off a second reconnect loop.
      if (socket !== this.socket) return;
      if (!this._intentionallyClosed && this._canReconnect(code)) {
        this._reconnect(code);
      } else if (!this._isReconnecting) {
        this._emitPermanentClose(code, reason.toString());
      }
    });

    return socket;
  }

  // Reconnect is opt-in via onReconnecting so callers can pass
  // state (e.g. session IDs) into the new connection.
  private _canReconnect(code: number): boolean {
    if (this._intentionallyClosed) return false;
    if (!this._reconnectOptions) return false;
    if (this._reconnectOptions.maxRetries === 0) return false;
    if (!this._reconnectOptions.onReconnecting) return false;
    return isRecoverableClose(code);
  }

  private async _reconnect(closeCode: number): Promise<void> {
    if (this._isReconnecting || !this._reconnectOptions) return;
    this._isReconnecting = true;

    const maxRetries = this._reconnectOptions.maxRetries ?? 5;
    const initialDelay = this._reconnectOptions.initialDelay ?? 500;
    const maxDelay = this._reconnectOptions.maxDelay ?? 8000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!this._canReconnect(closeCode)) {
        this._isReconnecting = false;
        if (!this._intentionallyClosed) {
          this._onError(
            null,
            `WebSocket reconnect aborted: non-recoverable close code ${closeCode}`,
            undefined,
          );
        }
        this._emitPermanentClose(
          this._intentionallyClosed ? this._closeCode : closeCode,
          this._intentionallyClosed ? this._closeReason : 'reconnect aborted',
        );
        return;
      }

      const baseDelay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      // Jitter: rand [0.75, 1.0] to spread out connection attempts without over-delaying
      const jitter = 0.75 + Math.random() * 0.25;
      const actualDelay = Math.round(baseDelay * jitter);

      let reconnectingEvent: ReconnectingEvent<Record<string, unknown>> = {
        attempt,
        maxAttempts: maxRetries,
        delay: actualDelay,
        closeCode,
        parameters: this._parameters ? { ...this._parameters } : undefined,
      };

      let overrides: ReconnectingOverrides<Record<string, unknown>> | void;
      try {
        overrides = this._reconnectOptions.onReconnecting(reconnectingEvent);
      } catch (err) {
        this._isReconnecting = false;
        this._onError(null, 'onReconnecting callback threw', err);
        this._emitPermanentClose(closeCode, 'onReconnecting callback threw');
        return;
      }

      if (overrides && 'abort' in overrides && overrides.abort) {
        this._isReconnecting = false;
        this._emitPermanentClose(closeCode, 'reconnect aborted by handler');
        return;
      }

      if (overrides && 'parameters' in overrides) {
        this._parameters = overrides.parameters;
        reconnectingEvent = { ...reconnectingEvent, parameters: this._parameters };
      }

      try {
        this._emit('reconnecting', reconnectingEvent);
      } catch (err) {
        this._onError(null, 'onReconnecting callback threw', err);
      }
      this._internalEvents._emit('reconnecting', reconnectingEvent);

      if (!this._canReconnect(closeCode)) {
        this._isReconnecting = false;
        if (!this._intentionallyClosed) {
          this._onError(
            null,
            `WebSocket reconnect aborted: non-recoverable close code ${closeCode}`,
            undefined,
          );
        }
        this._emitPermanentClose(
          this._intentionallyClosed ? this._closeCode : closeCode,
          this._intentionallyClosed ? this._closeReason : 'reconnect aborted',
        );
        return;
      }

      await sleep(actualDelay);

      if (!this._canReconnect(closeCode)) {
        this._isReconnecting = false;
        if (!this._intentionallyClosed) {
          this._onError(
            null,
            `WebSocket reconnect aborted: non-recoverable close code ${closeCode}`,
            undefined,
          );
        }
        this._emitPermanentClose(
          this._intentionallyClosed ? this._closeCode : closeCode,
          this._intentionallyClosed ? this._closeReason : 'reconnect aborted',
        );
        return;
      }

      let closeCodePromise: Promise<number> | undefined;
      try {
        const oldSocket = this.socket;
        this.socket = this._connect();
        // Registered synchronously after _connect() and before any
        // await so the code is captured even when ws emits 'close'
        // in the same tick as 'error' (e.g. abortHandshake).
        closeCodePromise = new Promise<number>((resolve) => {
          this.socket.once('close', resolve);
        });

        await this._awaitOpen(this.socket);

        this._internalEvents._emit('socketSwap', oldSocket, this.socket);
        this._isReconnecting = false;
        this._flushSendQueue();
        this._emit('reconnected');
        this._internalEvents._emit('reconnected');
        return;
      } catch {
        if (closeCodePromise) {
          // ws may emit 'error' before 'close', so await the code
          // rather than reading it synchronously.
          closeCode = await closeCodePromise;
        }
      }
    }

    // All retries exhausted — surface an error so consumers can
    // distinguish retry failure from a clean close.
    this._isReconnecting = false;
    this._onError(
      null,
      `WebSocket reconnect failed after ${maxRetries} attempts (close code: ${closeCode})`,
      undefined,
    );
    this._emitPermanentClose(closeCode, `reconnect failed after ${maxRetries} attempts`);
  }

  /**
   * Resolves once the socket is open, rejects if it errors or closes first
   */
  private _awaitOpen(socket: WS.WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.off('open', onOpen);
        socket.off('error', onError);
        socket.off('close', onFail);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onFail = () => {
        cleanup();
        reject(new Error('socket closed before open'));
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('close', onFail);
    });
  }

  private _flushSendQueue(): void {
    try {
      this._sendQueue.flush((data) => this.socket.send(data));
    } catch (err) {
      this._onError(null, 'could not send queued data', err);
    }
  }

  /**
   * Emits the public `close` event with unsent messages and the internal
   * `close` event used by the async iterator.
   */
  private _emitPermanentClose(code: number, reason: string): void {
    this._lastCloseCode = code;
    this._lastCloseReason = reason;
    const unsent = this._sendQueue.drain();
    // Internal close fires first so the async iterator is guaranteed to
    // terminate even if a public 'close' listener throws.
    this._internalEvents._emit('close', code, reason, unsent);
    this._emit('close', code, reason, unsent);
  }

  private _authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this._client.apiKey}` };
    return {};
  }
}
