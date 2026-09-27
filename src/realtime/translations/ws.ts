import * as WS from 'ws';
import type { ClientOptions, OpenAI } from '../../client';
import { EventEmitter } from '../../lib/EventEmitter';
import { assertX509WebSocketSupported } from '../../internal/auth/x509-workload-identity-auth';
import { brand_privateBedrockClient } from '../../internal/bedrock';
import { isRunningInBrowser } from '../../internal/detect-platform';
import { resolveRealtimeAPIKey } from '../../internal/realtime-credentials';
import { snapshotWebSocketCredentials } from '../../internal/ws';
import { ReadyState } from '../../internal/ws-adapter';
import { NodeWebSocket } from '../../internal/ws-adapter-node';
import type {
  RealtimeErrorEvent,
  RealtimeTranslationClientEvent,
  RealtimeTranslationServerEvent,
} from '../../resources/realtime/realtime';
import { isAzure, OpenAIRealtimeError } from '../internal-base';

/** An event envelope, including event types added by the service in the future. */
export interface RealtimeTranslationEvent {
  type: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Future wire events retain fields whose schema is not yet known to this SDK.
  [key: string]: unknown;
}

/** Options for a Node.js translation session. */
export interface RealtimeTranslationConnectOptions {
  /** Translation model used to create the session. */
  model: string;
  /** Node `ws` options. Redirects are always disabled. */
  options?:
    | (Omit<WS.ClientOptions, 'headers'> & {
        /** Case-insensitive overrides; null removes a default and undefined preserves it. */
        headers?: Record<string, string | null | undefined> | undefined;
      })
    | undefined;
}

type TranslationEvents = {
  event: (event: RealtimeTranslationServerEvent | RealtimeTranslationEvent) => void;
  error: (error: OpenAIRealtimeError) => void;
} & {
  [Type in Exclude<RealtimeTranslationServerEvent['type'], 'error'>]: (
    event: Extract<RealtimeTranslationServerEvent, { type: Type }>,
  ) => void;
};

function parseEvent(data: string): RealtimeTranslationEvent {
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    throw new OpenAIRealtimeError('Could not parse translation WebSocket event as JSON.', null);
  }
  if (
    typeof event !== 'object' ||
    event === null ||
    Array.isArray(event) ||
    typeof Object.getOwnPropertyDescriptor(event, 'type')?.value !== 'string'
  ) {
    throw new OpenAIRealtimeError('Translation event must be an object with a string type.', null);
  }
  // SAFETY: The envelope was checked above; payload fields remain unknown until selected by event type.
  return event as RealtimeTranslationEvent;
}

function buildTranslationURL(client: OpenAI, model: string): URL {
  if (typeof model !== 'string' || !model) {
    throw new Error('A translation model is required.');
  }
  const endpoint = new URL(client.baseURL);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, '')}/realtime/translations`;
  const url = new URL(client.buildURL(endpoint.toString(), { model }));
  if (url.protocol !== 'https:') {
    throw new Error('The translation endpoint must use HTTPS.');
  }
  if (url.searchParams.has('intent')) {
    throw new Error('Realtime translation does not accept an intent query parameter.');
  }
  url.protocol = 'wss:';
  return url;
}

/**
 * Node.js translation WebSocket. Install the optional `ws` peer dependency.
 * Wait for `socket` to open before sending. Events are never buffered or replayed.
 */
// oxlint-disable-next-line unicorn/prefer-event-target -- Reuse the SDK typed emitter and its public on/off event contract.
export class OpenAIRealtimeTranslationWS extends EventEmitter<TranslationEvents> {
  /** Adapter exposing lifecycle events and the underlying Node socket as `platformSocket`. */
  readonly socket: NodeWebSocket;
  /** The configured endpoint and model for this connection. */
  readonly url: URL;
  /** Sends the protocol close once; use `finish` to await trailing output. */
  readonly session = { close: (): void => this.send({ type: 'session.close' }) };

  private _inputClosed = false;
  private _terminalReceived = false;
  private _terminalDelivered = false;
  private _transportClosed = false;
  private _failure: OpenAIRealtimeError | undefined;
  private _finishPromise: Promise<void> | undefined;
  private _resolveFinish: (() => void) | undefined;
  private _rejectFinish: ((error: OpenAIRealtimeError) => void) | undefined;
  private _finishTimer: ReturnType<typeof setTimeout> | undefined;
  private _closeTimer: ReturnType<typeof setTimeout> | undefined;
  private _signal: AbortSignal | undefined;

  private constructor(url: URL, options: WS.ClientOptions) {
    super();
    this.url = url;
    this.socket = new NodeWebSocket(new WS.WebSocket(url, options));
    this.socket.on('message', this._onMessage);
    this.socket.on('error', this._onError);
    this.socket.on('close', this._onClose);
  }

  /** Resolves the API key and starts connecting; resolves before the socket opens. */
  static async create(
    client: OpenAI,
    props: RealtimeTranslationConnectOptions,
  ): Promise<OpenAIRealtimeTranslationWS> {
    // SAFETY: Probe optional host capabilities without requiring Node ambient types in published source.
    const scope = globalThis as { process?: { versions?: { node?: string } } };
    if (isRunningInBrowser() || !scope.process?.versions?.node) {
      throw new Error('Realtime translation WebSockets require Node.js.');
    }
    assertX509WebSocketSupported(client);
    // SAFETY: OpenAI owns these options; this read only rejects unsupported authentication modes.
    const clientOptions: ClientOptions = client['_options'];
    if (
      isAzure(client) ||
      brand_privateBedrockClient in client ||
      clientOptions.provider ||
      clientOptions.workloadIdentity
    ) {
      throw new Error('Realtime translation WebSockets require an ordinary OpenAI API-key client.');
    }
    const url = buildTranslationURL(client, props.model);
    const { apiKey } = await resolveRealtimeAPIKey(client);
    if (!apiKey) {
      throw new Error('Realtime translation WebSockets require an API key.');
    }
    const headers = new Map(
      Object.entries(client._buildWebSocketHeaders({ Authorization: `Bearer ${apiKey}` })),
    );
    for (const [name, value] of Object.entries(props.options?.headers ?? {})) {
      if (value === null) {
        headers.delete(name.toLowerCase());
      } else if (value !== undefined) {
        headers.set(name.toLowerCase(), value);
      }
    }
    const options = { ...props.options, headers: Object.fromEntries(headers), followRedirects: false };
    snapshotWebSocketCredentials(options);
    return new OpenAIRealtimeTranslationWS(url, options);
  }

  /** Sends a typed event, future event envelope, or raw JSON envelope after the socket opens. */
  send(event: RealtimeTranslationClientEvent | RealtimeTranslationEvent | string): void {
    const data = typeof event === 'string' ? event : JSON.stringify(event);
    const envelope = parseEvent(data);
    if (envelope.type === 'session.close') {
      if (this._inputClosed) {
        return;
      }
      this._inputClosed = true;
    } else if (this._inputClosed) {
      throw new OpenAIRealtimeError('Translation input is closed.', null);
    }
    try {
      if (this.socket.readyState !== ReadyState.OPEN) {
        throw new Error('The translation WebSocket is not open.');
      }
      this.socket.send(data);
    } catch {
      const error = new OpenAIRealtimeError('Could not send translation WebSocket event.', null);
      this._fail(error);
      throw error;
    }
  }

  /**
   * Stops input, sends `session.close` once, and delivers all events through `session.closed`.
   * The first call owns the finite deadline and optional cancellation signal. Repeated calls
   * share its result. API error events remain observable and do not end the drain.
   * A timeout, abort, or transport failure rejects; no connection or input is replayed.
   * Resolves after terminal delivery and transport closure. The deadline includes transport
   * cleanup; a stalled close handshake is terminated and rejects the operation.
   */
  finish({ timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal | undefined }): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      return Promise.reject(
        new Error('timeoutMs must be a positive finite WebSocket deadline of at most 2147483647.'),
      );
    }
    if (this._finishPromise) {
      return this._finishPromise;
    }
    // oxlint-disable-next-line promise/avoid-new -- The existing socket dispatcher settles this completion; there is no second event reader.
    this._finishPromise = new Promise<void>((resolve, reject) => {
      this._resolveFinish = resolve;
      this._rejectFinish = reject;
    });
    if (this._transportClosed) {
      this._settleFinish();
      return this._finishPromise;
    }
    clearTimeout(this._closeTimer);
    this._closeTimer = undefined;
    this._signal = signal;
    this._finishTimer = setTimeout(() => {
      this._fail(
        new OpenAIRealtimeError(
          'Timed out finishing the translation session and closing its transport.',
          null,
        ),
      );
    }, timeoutMs);
    signal?.addEventListener('abort', this._onAbort, { once: true });
    if (signal?.aborted) {
      this._onAbort();
    } else if (!this._terminalReceived && !this._failure) {
      try {
        this.session.close();
      } catch {
        // send already records the failure and terminates the connection.
      }
    }
    this._settleFinish();
    return this._finishPromise;
  }

  /** Closes the transport without waiting for terminal output. Prefer `finish` for a complete session. */
  close(): void {
    this._inputClosed = true;
    this._closeTransport();
  }

  private _onMessage = (data: string | Buffer): void => {
    if (this._terminalReceived) {
      return;
    }
    let event: RealtimeTranslationEvent;
    try {
      event = parseEvent(data.toString());
    } catch (error) {
      // SAFETY: parseEvent only throws normalized, payload-free OpenAIRealtimeError instances.
      this._emit('error', error as OpenAIRealtimeError);
      return;
    }
    const { type } = event;
    const terminal = type === 'session.closed' && typeof event['event_id'] === 'string';
    if (terminal) {
      this._inputClosed = true;
      this._terminalReceived = true;
    }
    try {
      try {
        this._emit('event', event);
      } finally {
        if (type === 'error') {
          // SAFETY: The error envelope is preserved as server data, as for other Realtime events.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Forward server error fields unchanged through the existing Realtime error wrapper.
          const apiErrorEvent = event as unknown as RealtimeErrorEvent;
          this._emit('error', new OpenAIRealtimeError('Translation API error.', apiErrorEvent));
        } else if (type !== 'event' && (type !== 'session.closed' || terminal)) {
          // SAFETY: The wire discriminator selects its listener; future event names remain visible on `event`.
          this._emit(type as Exclude<keyof TranslationEvents, 'event' | 'error'>, event as never);
        }
      }
    } finally {
      if (terminal) {
        this._terminalDelivered = true;
        try {
          this._closeTransport();
        } finally {
          this._settleFinish();
        }
      }
    }
  };

  private _onError = (): void => {
    const error = new OpenAIRealtimeError('Translation WebSocket transport failed.', null);
    this._fail(error);
    this._emit('error', error);
  };

  private _onClose = (code: number): void => {
    this._inputClosed = true;
    this._transportClosed = true;
    clearTimeout(this._closeTimer);
    this.socket.off('message', this._onMessage);
    this.socket.off('error', this._onError);
    this.socket.off('close', this._onClose);
    if (!this._terminalReceived) {
      this._failure ??= new OpenAIRealtimeError('Translation WebSocket closed before session.closed.', null);
    } else if (code === 1006) {
      this._failure ??= new OpenAIRealtimeError(
        'Translation transport closed abnormally after session.closed.',
        null,
      );
    }
    this._settleFinish();
  };

  private _onAbort = (): void => {
    this._fail(new OpenAIRealtimeError('Translation finish was aborted.', null));
  };

  private _fail(error: OpenAIRealtimeError): void {
    this._inputClosed = true;
    this._failure ??= error;
    this._settleFinish();
    if (this.socket.readyState !== ReadyState.CLOSED) {
      this.socket.platformSocket.terminate();
    }
  }

  private _settleFinish(): void {
    if (!this._transportClosed || (!this._failure && !this._terminalDelivered)) {
      return;
    }
    clearTimeout(this._finishTimer);
    this._signal?.removeEventListener('abort', this._onAbort);
    this._signal = undefined;
    if (this._failure) {
      this._rejectFinish?.(this._failure);
    } else {
      this._resolveFinish?.();
    }
    this._resolveFinish = undefined;
    this._rejectFinish = undefined;
  }

  private _closeTransport(): void {
    if (this.socket.readyState === ReadyState.CLOSED || this.socket.readyState === ReadyState.CLOSING) {
      return;
    }
    if (!this._finishPromise) {
      this._closeTimer = setTimeout(() => {
        this._fail(new OpenAIRealtimeError('Timed out closing the translation transport.', null));
      }, 1000);
      const timer: unknown = this._closeTimer;
      if (
        typeof timer === 'object' &&
        timer !== null &&
        'unref' in timer &&
        typeof timer.unref === 'function'
      ) {
        timer.unref();
      }
    }
    try {
      this.socket.close(1000, 'OK');
    } catch {
      const error = new OpenAIRealtimeError('Could not close the translation transport.', null);
      this._fail(error);
      this._emit('error', error);
    }
  }
}
