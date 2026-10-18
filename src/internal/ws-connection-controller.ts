import { OpenAIError } from '../core/error';
import { InternalEventEmitter } from '../core/EventEmitter';
import { sleep } from './utils/sleep';
import { ReadyState } from './ws-adapter';
import type { WebSocketLike } from './ws-adapter';
import { SendQueue, getMaxBufferedEvents, isRecoverableClose } from './ws';
import type {
  RawWebSocketData,
  ReconnectingEvent,
  ReconnectingOverrides,
  UnsentMessage,
  WebSocketStreamOptions,
} from './ws';
import {
  sendWebSocketEvent,
  sendRawWebSocketData,
  flushWebSocketSendQueue,
  waitForWebSocketOpen,
} from './ws-connection';

export interface WebSocketReconnectOptions<TParameters> {
  onReconnecting:
    | ((event: ReconnectingEvent<TParameters>) => ReconnectingOverrides<TParameters>)
    | ((event: ReconnectingEvent<TParameters>) => void);
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
}

export interface WebSocketConnectionOptions<TParameters> {
  reconnect?: WebSocketReconnectOptions<TParameters> | null | undefined;
  maxQueueSize?: number | undefined;
}

export type WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters> =
  | { type: 'connecting' | 'open' | 'closing' }
  | { type: 'close'; code: number; reason: string; unsent: UnsentMessage<TClientEvent>[] }
  | { type: 'reconnecting'; reconnect: ReconnectingEvent<TParameters> }
  | { type: 'reconnected' }
  | { type: 'message'; message: TServerEvent }
  | { type: 'raw'; data: RawWebSocketData }
  | { type: 'error'; error: TError };

interface ConnectionOwner<TSocket> {
  socket: TSocket;
  url: URL;
}

/** API types, decoding and request policy stay with the binding and its SDK helpers. */
export interface WebSocketConnectionHooks<TSocket, TClientEvent, TServerEvent, TError, TParameters> {
  buildURL: () => URL;
  createSocket: (url: URL) => TSocket;
  parameters: TParameters | null | undefined;
  isErrorEvent: (event: TServerEvent) => boolean;
  onMessage: (data: string | ArrayBuffer | ArrayBufferView, isBinary: boolean) => void;
  onSocketError?: (socket: TSocket, error: Error) => void;
  onError: (message: string, cause?: unknown) => void;
  createError: (message: string) => TError;
  subscribe: (
    onEvent: (event: TServerEvent) => void,
    onRaw: (data: RawWebSocketData) => void,
    onError: (error: TError) => void,
  ) => void;
  unsubscribe: (
    onEvent: (event: TServerEvent) => void,
    onRaw: (data: RawWebSocketData) => void,
    onError: (error: TError) => void,
  ) => void;
  emitReconnecting: (event: ReconnectingEvent<TParameters>) => void;
  emitReconnected: () => void;
  emitClose: (code: number, reason: string, unsent: UnsentMessage<TClientEvent>[]) => void;
  /** Existing transports with async credential refresh cancel it when close wins. */
  prepareReconnectSocket?: () => Promise<(url: URL) => TSocket>;
  /** Preserve whether a failed queued write remains in the legacy unsent list. */
  requeueFailed?: boolean;
  /** Retain unsent events until the application explicitly restores state and flushes. */
  manualQueue?: boolean;
  /** Bound retries across this logical connection, rather than per disconnect. */
  lifetimeRetries?: boolean;
  shouldReconnect?: (code: number) => boolean;
}

type WebSocketParameters = NonNullable<ReconnectingEvent['parameters']>;

/** Shared connection lifecycle; public fields and event listeners remain on the binding. */
export class WebSocketConnection<
  TSocket extends WebSocketLike,
  TClientEvent,
  TServerEvent,
  TError extends Error,
  TParameters extends WebSocketParameters = WebSocketParameters,
> {
  private _reconnectOptions: WebSocketReconnectOptions<TParameters> | null;
  private _sendQueue: SendQueue<TClientEvent>;
  private _isReconnecting = false;
  private _intentionallyClosed = false;
  private _closeCode = 1000;
  private _closeReason = 'OK';
  private _lastCloseCode = 1006;
  private _lastCloseReason = '';

  // Necessary to keep the public event interface clean while we manage reconnecting
  private _internalEvents = new InternalEventEmitter<{
    socketSwap: (oldSocket: TSocket, newSocket: TSocket) => void;
    reconnecting: (event: ReconnectingEvent<TParameters>) => void;
    reconnected: () => void;
    close: (code: number, reason: string, unsent: UnsentMessage<TClientEvent>[]) => void;
  }>();

  private readonly _owner: ConnectionOwner<TSocket>;
  private readonly _hooks: WebSocketConnectionHooks<TSocket, TClientEvent, TServerEvent, TError, TParameters>;

  constructor(
    owner: ConnectionOwner<TSocket>,
    hooks: WebSocketConnectionHooks<TSocket, TClientEvent, TServerEvent, TError, TParameters>,
    options?: WebSocketConnectionOptions<TParameters>,
  ) {
    this._owner = owner;
    this._hooks = hooks;
    this._reconnectOptions = options?.reconnect ?? null;
    this._sendQueue = new SendQueue<TClientEvent>(
      options?.maxQueueSize ?? (hooks.manualQueue ? 0 : undefined),
      !hooks.manualQueue,
    );
  }

  private _retryCount = 0;
  private _permanentClosed = false;
  private _backoff = new AbortController();

  /** Whether the logical connection has emitted its terminal close. */
  get isClosed(): boolean {
    return this._permanentClosed;
  }

  takePending(): UnsentMessage<TClientEvent>[] {
    return this._sendQueue.drain();
  }

  flushPending(): void {
    if (
      this._intentionallyClosed ||
      this._permanentClosed ||
      this._isReconnecting ||
      this._owner.socket.readyState !== ReadyState.OPEN
    ) {
      this._hooks.onError('cannot flush before the WebSocket is open');
      return;
    }
    this._flushSendQueue(true);
  }

  private _cancelRefresh: (() => void) | undefined;

  send(event: TClientEvent) {
    if (this._hooks.manualQueue) {
      if (this._intentionallyClosed || this._permanentClosed) {
        this._hooks.onError('cannot send on a closed WebSocket');
        return;
      }
      if (this._isReconnecting) {
        let accepted: boolean;
        try {
          accepted = this._sendQueue.enqueue(event);
        } catch (error) {
          this._hooks.onError('could not send data', error);
          return;
        }
        if (!accepted) {
          this._hooks.onError('send queue is full, message discarded');
        }
        return;
      }
      if (this._owner.socket.readyState === ReadyState.CONNECTING) {
        this._hooks.onError('cannot send before the WebSocket is open');
        return;
      }
    }
    sendWebSocketEvent(
      this._owner,
      event,
      this._sendQueue,
      () => this._isReconnecting,
      (message, cause) => this._hooks.onError(message, cause),
    );
  }

  sendRaw(data: RawWebSocketData) {
    sendRawWebSocketData(
      this._owner,
      data,
      this._sendQueue,
      () => this._isReconnecting,
      (message, cause) => this._hooks.onError(message, cause),
    );
  }

  close(props?: { code: number; reason: string }) {
    if (!this._owner.socket) {
      throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
    }

    this._intentionallyClosed = true;
    this._closeCode = props?.code ?? 1000;
    this._closeReason = props?.reason ?? 'OK';
    this._cancelRefresh?.();
    this._backoff.abort();
    try {
      this._owner.socket.close(this._closeCode, this._closeReason);
    } catch (error) {
      try {
        this._hooks.onError('could not close the connection', error);
      } finally {
        if (this._hooks.manualQueue) {
          try {
            const { socket } = this._owner;
            if (socket.terminate) {
              socket.terminate();
            } else {
              socket.close();
            }
          } finally {
            this._emitPermanentClose(this._closeCode, this._closeReason);
          }
        }
      }
    }
  }

  iterate(
    options?: WebSocketStreamOptions,
  ): AsyncIterableIterator<WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters>> {
    if (!this._owner.socket) {
      throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
    }

    const maxBufferedEvents = getMaxBufferedEvents(options);

    // Two-queue async iterator: `queue` buffers incoming messages,
    // `resolvers` buffers waiting next() calls. A push wakes the
    // oldest next(); a next() drains the oldest message.
    const queue: (WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters> | undefined)[] = [];
    const resolvers: ((() => void) | undefined)[] = [];
    let queueHead = 0;
    let resolverHead = 0;
    let done = false;
    let failure: TError | undefined;
    let currentSocket = this._owner.socket;

    const wakeResolver = () => {
      if (resolverHead >= resolvers.length) {
        return;
      }

      const resolver = resolvers[resolverHead];
      resolvers[resolverHead] = undefined;
      resolverHead += 1;
      if (resolverHead >= 64 && resolverHead * 2 >= resolvers.length) {
        resolvers.splice(0, resolverHead);
        resolverHead = 0;
      }
      resolver?.();
    };

    /* oxlint-disable eslint/no-use-before-define -- These mutually dependent callbacks are initialized before any listener is registered. */
    const push = (msg: WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters>) => {
      if (done) {
        return;
      }

      if (maxBufferedEvents !== undefined && queue.length - queueHead >= maxBufferedEvents) {
        failure = this._hooks.createError(
          `WebSocket stream exceeded maxBufferedEvents (${maxBufferedEvents})`,
        );
        done = true;
        queue.length = 0;
        queueHead = 0;
        cleanup();
        flushResolvers();
        return;
      }

      queue.push(msg);
      wakeResolver();
    };

    const onEvent = (event: TServerEvent) => {
      // Protocol errors are handled by onEmitterError.
      if (this._hooks.isErrorEvent(event)) {
        return;
      }
      push({ type: 'message', message: event });
    };

    const onRaw = (data: RawWebSocketData) => {
      push({ type: 'raw', data });
    };

    // All errors (API + socket) funnel through _onError → 'error' event
    const onEmitterError = (err: TError) => {
      push({ type: 'error', error: err });
    };

    const onOpen = () => {
      push({ type: 'open' });
    };

    const onReconnecting = (evt: ReconnectingEvent<TParameters>) => {
      push({ type: 'reconnecting', reconnect: evt });
    };

    const onReconnected = () => {
      push({ type: 'reconnected' });
    };

    const flushResolvers = () => {
      while (resolverHead < resolvers.length) {
        const resolver = resolvers[resolverHead];
        resolvers[resolverHead] = undefined;
        resolverHead += 1;
        resolver?.();
      }
      resolvers.length = 0;
      resolverHead = 0;
    };

    const onClose = (code: number, reason: string, unsent: UnsentMessage<TClientEvent>[]) => {
      push({ type: 'close', code, reason, unsent });
      done = true;
      flushResolvers();
      cleanup();
    };

    const onSocketSwap = (_oldSocket: TSocket, newSocket: TSocket) => {
      if (currentSocket === newSocket) {
        return;
      }
      currentSocket.off('open', onOpen);
      newSocket.on('open', onOpen);
      currentSocket = newSocket;
    };

    const cleanup = () => {
      this._hooks.unsubscribe(onEvent, onRaw, onEmitterError);
      currentSocket.off('open', onOpen);
      this._internalEvents.off('close', onClose);
      this._internalEvents.off('socketSwap', onSocketSwap);
      this._internalEvents.off('reconnecting', onReconnecting);
      this._internalEvents.off('reconnected', onReconnected);
    };

    /* oxlint-enable eslint/no-use-before-define */
    this._hooks.subscribe(onEvent, onRaw, onEmitterError);
    this._owner.socket.on('open', onOpen);
    this._internalEvents.on('close', onClose);
    this._internalEvents.on('socketSwap', onSocketSwap);
    this._internalEvents.on('reconnecting', onReconnecting);
    this._internalEvents.on('reconnected', onReconnected);

    // Overridden registration hooks may have terminated the iterator before setup finished.
    if (done) {
      cleanup();
    }

    if (this._isReconnecting) {
      // A reconnect is already in flight. The socket may be CLOSED but the
      // instance is still alive. Emit 'reconnecting' so the iterator stays
      // open and receives the upcoming reconnected/message events.
      push({
        type: 'reconnecting',
        reconnect: { attempt: 0, maxAttempts: 0, delay: 0, closeCode: 0, parameters: undefined },
      });
    } else {
      switch (this._owner.socket.readyState) {
        case ReadyState.CONNECTING: {
          push({ type: 'connecting' });
          break;
        }
        case ReadyState.OPEN: {
          push({ type: 'open' });
          break;
        }
        case ReadyState.CLOSING: {
          push({ type: 'closing' });
          break;
        }
        case ReadyState.CLOSED: {
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
        default: {
          break;
        }
      }
    }

    const tryResolve = (
      res: (
        value: IteratorResult<WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters>>,
      ) => void,
      reject: (error: TError) => void,
    ) => {
      if (failure) {
        reject(failure);
      } else if (queueHead < queue.length) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Only consumed queue slots are cleared; the length guard proves this slot is populated.
        const queued = queue[queueHead]!;
        queue[queueHead] = undefined;
        queueHead += 1;
        if (queueHead >= 64 && queueHead * 2 >= queue.length) {
          queue.splice(0, queueHead);
          queueHead = 0;
        }
        res({ value: queued, done: false });
      } else if (done) {
        res({ value: undefined, done: true });
      } else {
        return false;
      }
      return true;
    };

    const next = (): Promise<
      IteratorResult<WebSocketStreamMessage<TClientEvent, TServerEvent, TError, TParameters>>
    > =>
      // oxlint-disable-next-line promise/avoid-new -- Each next() waits for the socket callbacks to produce a record or close.
      new Promise((resolve, reject) => {
        if (tryResolve(resolve, reject)) {
          return;
        }
        resolvers.push(() => {
          tryResolve(resolve, reject);
        });
      });

    return {
      next,
      return: (): Promise<IteratorReturnResult<undefined>> => {
        done = true;
        queue.length = 0;
        queueHead = 0;
        cleanup();
        flushResolvers();
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  connect(
    createSocket: (url: URL) => TSocket = (url) => this._hooks.createSocket(url),
    url: URL = this._hooks.buildURL(),
  ): TSocket {
    this._owner.url = url;

    const socket = createSocket(this._owner.url);

    socket.on('message', (data, isBinary) => {
      if (socket === this._owner.socket) {
        this._hooks.onMessage(data, isBinary);
      }
    });

    socket.on('error', (err: Error) => {
      if (socket !== this._owner.socket) {
        return;
      }
      this._hooks.onSocketError?.(socket, err);
      // Suppress transient errors during reconnection — the retry loop
      // already handles them and will surface a close if retries exhaust.
      if (this._isReconnecting) {
        return;
      }
      this._hooks.onError(err.message, err);
    });

    socket.on('open', () => {
      if (socket !== this._owner.socket) {
        return;
      }
      this._flushSendQueue();
    });

    socket.on('close', (code: number, reason: string) => {
      // Ignore close events from superseded sockets — a stale socket's
      // late close must not kick off a second reconnect loop.
      if (socket !== this._owner.socket) {
        return;
      }
      if (!this._intentionallyClosed && this._canReconnect(code)) {
        this._reconnect(code);
      } else if (!this._isReconnecting) {
        this._emitPermanentClose(code, reason);
      }
    });

    return socket;
  }

  // Reconnect is opt-in via onReconnecting so callers can pass
  // state (e.g. session IDs) into the new connection.
  private _canReconnect(code: number): boolean {
    if (this._intentionallyClosed || this._permanentClosed) {
      return false;
    }
    if (!this._reconnectOptions) {
      return false;
    }
    if (this._reconnectOptions.maxRetries === 0) {
      return false;
    }
    if (!this._reconnectOptions.onReconnecting) {
      return false;
    }
    return this._hooks.shouldReconnect?.(code) ?? isRecoverableClose(code);
  }

  private _reportReconnectFailure(message: string, cause?: unknown): void {
    // Preserve the legacy automatic-queue clients' reconnect error contract.
    this._hooks.onError(message, this._hooks.manualQueue ? cause : undefined);
  }

  private _abortReconnect(closeCode: number, cause?: unknown): boolean {
    if (this._canReconnect(closeCode)) {
      return false;
    }
    this._isReconnecting = false;
    try {
      if (!this._intentionallyClosed && !this._permanentClosed) {
        this._reportReconnectFailure(
          `WebSocket reconnect aborted: non-recoverable close code ${closeCode}`,
          cause,
        );
      }
    } finally {
      this._emitPermanentClose(
        this._intentionallyClosed ? this._closeCode : closeCode,
        this._intentionallyClosed ? this._closeReason : 'reconnect aborted',
      );
    }
    return true;
  }

  private _notifyReconnecting(
    options: WebSocketReconnectOptions<TParameters>,
    initialEvent: ReconnectingEvent<TParameters>,
  ): boolean {
    let reconnectingEvent = initialEvent;
    const { closeCode } = initialEvent;
    let overrides: ReturnType<WebSocketReconnectOptions<TParameters>['onReconnecting']>;
    try {
      overrides = options.onReconnecting(reconnectingEvent);
    } catch (error) {
      this._isReconnecting = false;
      try {
        this._hooks.onError('onReconnecting callback threw', error);
      } finally {
        this._emitPermanentClose(closeCode, 'onReconnecting callback threw');
      }
      return false;
    }

    if (overrides && 'abort' in overrides && overrides.abort) {
      this._isReconnecting = false;
      this._emitPermanentClose(closeCode, 'reconnect aborted by handler');
      return false;
    }

    if (overrides && 'parameters' in overrides) {
      this._hooks.parameters = overrides.parameters;
      reconnectingEvent = { ...reconnectingEvent, parameters: this._hooks.parameters };
    }

    try {
      this._hooks.emitReconnecting(reconnectingEvent);
    } catch (error) {
      if (this._hooks.manualQueue) {
        this._isReconnecting = false;
        try {
          this._hooks.onError('onReconnecting callback threw', error);
        } finally {
          this._emitPermanentClose(closeCode, 'onReconnecting callback threw');
        }
        return false;
      }
      this._hooks.onError('onReconnecting callback threw', error);
    }
    this._internalEvents._emit('reconnecting', reconnectingEvent);
    return true;
  }

  private _hasRetryBudget(attempt: number, maximum: number): boolean {
    return attempt <= maximum && (!this._hooks.lifetimeRetries || this._retryCount < maximum);
  }

  private _nextRetryAttempt(attempt: number): number {
    this._retryCount += 1;
    return this._hooks.lifetimeRetries ? this._retryCount : attempt;
  }

  private async _reconnect(initialCloseCode: number): Promise<void> {
    let closeCode = initialCloseCode;
    if (!this._owner.socket) {
      throw new OpenAIError('Internal error: failed to initialize socket. Please report this issue.');
    }

    if (this._isReconnecting || !this._reconnectOptions) {
      return;
    }
    this._isReconnecting = true;

    const maxRetries = this._reconnectOptions.maxRetries ?? 5;
    const initialDelay = this._reconnectOptions.initialDelay ?? 500;
    const maxDelay = this._reconnectOptions.maxDelay ?? 8000;
    let lastError: unknown;

    /* oxlint-disable eslint/no-await-in-loop -- Reconnect attempts and their credential refresh must run sequentially. */
    for (let attempt = 1; this._hasRetryBudget(attempt, maxRetries); attempt += 1) {
      const reportedAttempt = this._nextRetryAttempt(attempt);
      if (this._abortReconnect(closeCode, lastError)) {
        return;
      }

      const baseDelay = Math.min(initialDelay * 2 ** (attempt - 1), maxDelay);
      // Jitter: rand [0.75, 1.0] to spread out connection attempts without over-delaying
      const jitter = 0.75 + Math.random() * 0.25;
      const actualDelay = Math.round(baseDelay * jitter);

      const reconnectingEvent: ReconnectingEvent<TParameters> = {
        attempt: reportedAttempt,
        maxAttempts: maxRetries,
        delay: actualDelay,
        closeCode,
        parameters: this._hooks.parameters ? { ...this._hooks.parameters } : undefined,
      };

      if (!this._notifyReconnecting(this._reconnectOptions, reconnectingEvent)) {
        return;
      }

      if (this._abortReconnect(closeCode, lastError)) {
        return;
      }

      try {
        await sleep(actualDelay, this._backoff.signal);
      } catch {
        this._abortReconnect(closeCode, lastError);
        return;
      }

      if (this._abortReconnect(closeCode, lastError)) {
        return;
      }

      let closeCodePromise: Promise<number> | undefined;
      const oldSocket = this._owner.socket;
      try {
        if (this._hooks.prepareReconnectSocket) {
          const url = this._hooks.buildURL();
          // oxlint-disable-next-line promise/avoid-new -- Public close cancels the pending credential refresh through this callback.
          const canceled = new Promise<undefined>((resolve) => {
            // oxlint-disable-next-line unicorn/no-useless-undefined -- Promise<undefined> requires an explicit value in TypeScript.
            this._cancelRefresh = () => resolve(undefined);
          });
          let createSocket: ((url: URL) => TSocket) | undefined;
          try {
            createSocket = await Promise.race([this._hooks.prepareReconnectSocket(), canceled]);
          } finally {
            this._cancelRefresh = undefined;
          }
          if (!this._canReconnect(closeCode)) {
            this._isReconnecting = false;
            this._emitPermanentClose(this._closeCode, this._closeReason);
            return;
          }
          this._owner.socket = this.connect(createSocket, url);
        } else {
          this._owner.socket = this.connect();
        }
        // Registered synchronously after _connect() and before any
        // await so the code is captured even when ws emits 'close'
        // in the same tick as 'error' (e.g. abortHandshake).
        // oxlint-disable-next-line promise/avoid-new -- Capture close before awaiting open, including synchronous error/close pairs.
        closeCodePromise = new Promise<number>((resolve) => {
          this._owner.socket.once('close', resolve);
        });

        await waitForWebSocketOpen(this._owner.socket);
      } catch (error) {
        if (this._intentionallyClosed) {
          // A public close observer may have thrown after lifecycle cleanup.
          // Only emit here if the reconnect itself had not already closed.
          if (this._isReconnecting) {
            this._isReconnecting = false;
            this._emitPermanentClose(this._closeCode, this._closeReason);
          }
          return;
        }
        lastError = error;
        if (closeCodePromise) {
          // ws may emit 'error' before 'close', so await the code
          // rather than reading it synchronously.
          closeCode = await closeCodePromise;
        }
        continue;
      }
      this._isReconnecting = false;
      this._internalEvents._emit('socketSwap', oldSocket, this._owner.socket);
      this._flushSendQueue();
      this._hooks.emitReconnected();
      this._internalEvents._emit('reconnected');
      return;
    }

    /* oxlint-enable eslint/no-await-in-loop */
    // All retries exhausted — surface an error so consumers can
    // distinguish retry failure from a clean close.
    this._isReconnecting = false;
    try {
      this._reportReconnectFailure(
        `WebSocket reconnect failed after ${maxRetries} attempts (close code: ${closeCode})`,
        lastError,
      );
    } finally {
      this._emitPermanentClose(closeCode, `reconnect failed after ${maxRetries} attempts`);
    }
  }

  private _flushSendQueue(explicit = false): void {
    if (this._hooks.manualQueue && !explicit) {
      return;
    }
    flushWebSocketSendQueue(
      this._owner,
      this._sendQueue,
      (message, cause) => this._hooks.onError(message, cause),
      this._hooks.requeueFailed === undefined ? undefined : { requeueFailed: this._hooks.requeueFailed },
    );
  }

  /**
   * Emits the public `close` event with unsent messages and the internal
   * `close` event used by the async iterator.
   */
  private _emitPermanentClose(code: number, reason: string): void {
    if (this._permanentClosed) {
      return;
    }
    this._permanentClosed = true;
    this._lastCloseCode = code;
    this._lastCloseReason = reason;
    const unsent = this._sendQueue.drain();
    // Internal close fires first so the async iterator is guaranteed to
    // terminate even if a public 'close' listener throws.
    this._internalEvents._emit('close', code, reason, unsent);
    this._hooks.emitClose(code, reason, unsent);
  }
}
