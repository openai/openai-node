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
  RealtimeError,
  RealtimeErrorEvent,
  RealtimeTranslationClientEvent,
  RealtimeTranslationServerEvent,
  RealtimeTranslationSession,
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

/** Copies a freshly parsed JSON tree's containers, sharing its immutable string payloads. */
function copyEvent(event: RealtimeTranslationEvent): RealtimeTranslationEvent {
  const copy = { ...event };
  const containers: object[] = [copy];
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (typeof value === 'object' && value !== null) {
        const child = Array.isArray(value) ? [...value] : { ...value };
        Object.defineProperty(container, key, {
          value: child,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        containers.push(child);
      }
    }
  }
  return copy;
}

type RequiredFields<T> = {
  [Key in keyof T as T[Key] extends Required<T>[Key] ? Key : never]-?: (value: unknown) => boolean;
};

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function hasRequiredFields(value: unknown, fields: Record<string, (field: unknown) => boolean>): boolean {
  return (
    isObject(value) &&
    Object.entries(fields).every(([key, check]) => check(Object.getOwnPropertyDescriptor(value, key)?.value))
  );
}

function hasOptionalFields(value: unknown, fields: Record<string, (field: unknown) => boolean>): boolean {
  return (
    isObject(value) &&
    Object.entries(fields).every(([key, check]) => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      return field === undefined || check(field.value);
    })
  );
}

const inputAudioFields = {
  transcription: (value: unknown) => value === null || hasRequiredFields(value, { model: isString }),
  noise_reduction: (value: unknown) =>
    value === null ||
    hasRequiredFields(value, {
      type: (kind: unknown) => kind === 'near_field' || kind === 'far_field',
    }),
} satisfies RequiredFields<Required<RealtimeTranslationSession.Audio.Input>>;

const audioFields = {
  input: (value: unknown) => hasOptionalFields(value, inputAudioFields),
  output: (value: unknown) => hasOptionalFields(value, { language: isString }),
} satisfies RequiredFields<Required<RealtimeTranslationSession.Audio>>;

const sessionFields = {
  id: isString,
  model: isString,
  expires_at: (value: unknown) => typeof value === 'number',
  type: (value: unknown) => value === 'translation',
  audio: (value: unknown) => hasOptionalFields(value, audioFields),
} satisfies RequiredFields<RealtimeTranslationSession>;

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || isString(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

const errorFields = {
  message: isString,
  type: isString,
  code: isOptionalNullableString,
  event_id: isOptionalNullableString,
  param: isOptionalNullableString,
} satisfies RequiredFields<Required<RealtimeError>>;
const commonFields = { type: isString, event_id: isString };
const deltaFields = {
  ...commonFields,
  delta: isString,
  elapsed_ms: (value: unknown) => value === null || isOptionalNumber(value),
};
const sessionEventFields = {
  ...commonFields,
  session: (value: unknown) => hasRequiredFields(value, sessionFields),
};

// Regeneration that adds an event or field must also update its dispatcher.
const translationEventFields = {
  'session.closed': commonFields,
  'session.input_transcript.delta': deltaFields,
  'session.output_transcript.delta': deltaFields,
  'session.output_audio.delta': {
    ...deltaFields,
    channels: isOptionalNumber,
    format: (value: unknown) => value === undefined || value === 'pcm16',
    sample_rate: isOptionalNumber,
  },
  'session.created': sessionEventFields,
  'session.updated': sessionEventFields,
  error: { ...commonFields, error: (value: unknown) => hasRequiredFields(value, errorFields) },
} satisfies {
  [Event in RealtimeTranslationServerEvent as Event['type']]: RequiredFields<Required<Event>>;
};

/** Check the required fields before exposing an envelope through a typed listener. */
function isCompleteTranslationEvent(event: RealtimeTranslationEvent): boolean {
  // SAFETY: Only the above schema-checked map's own data properties can supply a validator.
  const fields = Object.getOwnPropertyDescriptor(translationEventFields, event.type)?.value as
    | Record<string, (field: unknown) => boolean>
    | undefined;
  return fields !== undefined && hasRequiredFields(event, fields);
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
  url.hash = '';
  url.protocol = 'wss:';
  return url;
}

/**
 * Node.js translation WebSocket. Install the optional `ws` peer dependency.
 * Wait for `socket` to open before sending. Events are never buffered or replayed.
 * Compression is off by default; set `options.perMessageDeflate` to opt in.
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
    const options = {
      ...props.options,
      maxPayload: props.options?.maxPayload ?? 0,
      perMessageDeflate: props.options?.perMessageDeflate ?? false,
      headers: Object.fromEntries(headers),
      followRedirects: false,
    };
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
    if (this._finishPromise) {
      return this._finishPromise;
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      return Promise.reject(
        new Error('timeoutMs must be a positive finite WebSocket deadline of at most 2147483647.'),
      );
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
    const wireData = data.toString();
    let event: RealtimeTranslationEvent;
    try {
      event = parseEvent(wireData);
    } catch (error) {
      // SAFETY: parseEvent only throws normalized, payload-free OpenAIRealtimeError instances.
      this._reportError(error as OpenAIRealtimeError);
      return;
    }
    const { type } = event;
    const typed = isCompleteTranslationEvent(event);
    const terminal = type === 'session.closed' && typed;
    if (terminal) {
      this._inputClosed = true;
      this._terminalReceived = true;
    }
    try {
      try {
        // Raw listeners may mutate their event. Keep typed dispatch and finish
        // anchored to the original validated wire event, including nested data.
        if (this._hasListener('event')) {
          this._emit('event', typed ? copyEvent(event) : event);
        }
      } finally {
        if (type === 'error' && typed) {
          // SAFETY: The error envelope is preserved as server data, as for other Realtime events.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Forward server error fields unchanged through the existing Realtime error wrapper.
          const apiErrorEvent = event as unknown as RealtimeErrorEvent;
          const error = new OpenAIRealtimeError(
            `Translation API error: ${apiErrorEvent.error.message}`,
            apiErrorEvent,
          );
          this._reportError(error);
        } else if (type !== 'error' && typed) {
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

  private _onError = (cause: Error): void => {
    // Closing before open also emits a ws error. The caller already requested
    // cleanup; _onClose still records an incomplete drain for a later finish().
    if (this._closeTimer !== undefined && !this._terminalReceived && !this._failure) {
      return;
    }
    const error = new OpenAIRealtimeError('Translation WebSocket transport failed.', null);
    Object.defineProperty(error, 'cause', { value: cause, writable: true, configurable: true });
    this._fail(error);
    // finish already rejects transport failures; don't report that same failure a second time.
    if (this._hasListener('error') || !this._finishPromise) {
      this._reportError(error);
    }
  };

  private _reportError(error: OpenAIRealtimeError): void {
    if (this._hasListener('error')) {
      this._emit('error', error);
    } else {
      error.message += " Bind an error listener, e.g. connection.on('error', (error) => ...).";
      // oxlint-disable-next-line promise/no-promise-in-callback -- Match Realtime's explicit unhandled rejection contract when no SDK listener or completion operation observes the error.
      Promise.reject(error);
    }
  }

  private _onClose = (code: number): void => {
    const reportPrematureClose =
      !this._terminalReceived && !this._failure && !this._finishPromise && this._closeTimer === undefined;
    this._inputClosed = true;
    this._transportClosed = true;
    clearTimeout(this._closeTimer);
    this.socket.off('message', this._onMessage);
    this.socket.off('error', this._onError);
    this.socket.off('close', this._onClose);
    if (!this._terminalReceived) {
      this._failure ??= new OpenAIRealtimeError('Translation WebSocket closed before session.closed.', null);
    } else if (code !== 1000 && code !== 1001 && code !== 1005) {
      this._failure ??= new OpenAIRealtimeError(
        'Translation transport closed abnormally after session.closed.',
        null,
      );
    }
    this._settleFinish();
    if (reportPrematureClose && this._failure) {
      this._reportError(this._failure);
    }
  };

  private _onAbort = (): void => {
    const error = new OpenAIRealtimeError('Translation finish was aborted.', null);
    Object.defineProperty(error, 'cause', {
      value: this._signal?.reason,
      writable: true,
      configurable: true,
    });
    this._fail(error);
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
        const error = new OpenAIRealtimeError('Timed out closing the translation transport.', null);
        this._fail(error);
        this._reportError(error);
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
