import type {
  RealtimeClientEvent,
  RealtimeServerEvent,
  RealtimeErrorEvent,
  RealtimeError,
} from '../resources/realtime/realtime';
import { EventEmitter } from '../lib/EventEmitter';
import { OpenAIError } from '../error';
import type OpenAI from '../index';
import { AzureOpenAI } from '../index';
import { assertX509WebSocketSupported } from '../internal/auth/x509-workload-identity-auth';

/** Parses frame data without exposing malformed payloads through JSON syntax errors. */
export function parseRealtimeEvent(data: string): RealtimeServerEvent {
  try {
    return JSON.parse(data) as RealtimeServerEvent;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError('Could not parse Realtime WebSocket event data as JSON.');
    }

    throw error;
  }
}

function safeErrorValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unserializable error value]';
  }
}

/** An API-reported or client-side error encountered by an active Realtime connection. */
export class OpenAIRealtimeError extends OpenAIError {
  /** Stable error name used to identify Realtime connection failures. */
  override name = 'OpenAIRealtimeError';

  /**
   * The error data that the API sent back in an `error` event.
   */
  error?: RealtimeError | undefined;

  /**
   * The unique ID of the server event.
   */
  event_id?: string | undefined;

  /**
   * Creates a Realtime error, preserving server-provided details when available.
   *
   * @param message Human-readable API or connection error description.
   * @param event Server error event, or `null` for a client-side failure.
   */
  constructor(message: string, event: RealtimeErrorEvent | null) {
    super(message);

    this.error = event?.error;
    this.event_id = event?.event_id;
  }
}

/** Materializes mapped Realtime listener properties without changing their public types. */
// oxlint-disable-next-line typescript/ban-types -- The empty intersection materializes the mapped event shape without changing its public type.
type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

/**
 * Maps Realtime server event types to their corresponding strongly typed listener callbacks.
 *
 * The `event` listener observes every server event, `error` receives normalized
 * API or transport failures, and other keys match non-error server event types.
 */
type RealtimeEvents = Simplify<
  {
    /** Receives every server event before its event-specific listener is notified. */
    event: (event: RealtimeServerEvent) => void;

    /** Receives API-reported errors and client-side WebSocket failures. */
    error: (error: OpenAIRealtimeError) => void;
  } & {
    /** Dispatches each non-error server event with the payload matching its event type. */
    [EventType in Exclude<RealtimeServerEvent['type'], 'error'>]: (
      event: Extract<
        RealtimeServerEvent,
        {
          /** Server-event discriminator associated with this specific listener. */
          type: EventType;
        }
      >,
    ) => unknown;
  }
>;

/**
 * Typed event emitter shared by Realtime WebSocket client implementations.
 *
 * Listen for `event` to receive all server events, or subscribe to a specific
 * server event's `type`. Always register an `error` listener; otherwise API and
 * transport failures are reported as unhandled promise rejections.
 */
export abstract class OpenAIRealtimeEmitter extends EventEmitter<RealtimeEvents> {
  /**
   * Serializes and sends a client event over the active WebSocket connection.
   *
   * Wait until the underlying socket is open before calling this method.
   * Serialization and transport failures are delivered to the `error` event.
   */
  abstract send(event: RealtimeClientEvent): void;

  /**
   * Closes the WebSocket with status code `1000` and reason `OK` by default.
   *
   * Connection-closing failures are delivered to the `error` event.
   */
  abstract close(props?: {
    /** WebSocket close status code; defaults to `1000`. */
    code: number;

    /** WebSocket close reason; defaults to `OK`. */
    reason: string;
  }): void;

  protected _onError(event: null, message: string, cause: any): void;
  protected _onError(event: RealtimeErrorEvent, message?: string | undefined): void;
  protected _onError(event: RealtimeErrorEvent | null, message?: string | undefined, cause?: any): void {
    message = event?.error
      ? `${safeErrorValue(event.error.message)} code=${safeErrorValue(event.error.code)} param=${safeErrorValue(event.error.param)} type=${safeErrorValue(event.error.type)} event_id=${safeErrorValue(event.error.event_id)}`
      : (message ?? 'unknown error');

    if (!this._hasListener('error')) {
      const error = new OpenAIRealtimeError(
        message +
          `\n\nTo resolve these unhandled rejection errors you should bind an \`error\` callback, e.g. \`rt.on('error', (error) => ...)\` `,
        event,
      );
      // @ts-ignore
      error.cause = cause;
      Promise.reject(error);
      return;
    }

    const error = new OpenAIRealtimeError(message, event);
    // @ts-ignore
    error.cause = cause;

    this._emit('error', error);
  }
}

/** Reports whether the client is an Azure OpenAI client with Azure-specific Realtime routing. */
export function isAzure(client: Pick<OpenAI, 'apiKey' | 'baseURL'>): client is AzureOpenAI {
  return client instanceof AzureOpenAI;
}

interface RealtimeURLBuilderOptions {
  /**
   * Builds the exact WebSocket URL after the connection target has been validated.
   *
   * Return only a trusted `wss:` URL because the client's credentials are sent to
   * that endpoint. Model, call ID, transcription intent, and deployment query
   * parameters are not added to the returned URL.
   */
  buildRealtimeURL?: (
    client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
    connection: RealtimeConnectionConfig,
  ) => URL;
}

/** Starts a model or transcription session, or attaches to exactly one existing call. */
export type RealtimeConnectionConfig =
  | (RealtimeURLBuilderOptions & {
      /**
       * Start a new Realtime session using the given model.
       */
      model: string;

      /** Transcription intent; cannot be supplied when starting a model-backed session. */
      intent?: undefined;

      /** Existing call identifier; cannot be supplied when starting a model-backed session. */
      callID?: undefined;
    })
  | (RealtimeURLBuilderOptions & {
      /** Starts a transcription-only Realtime session without selecting a model. */
      intent: 'transcription';

      /** Model name; cannot be supplied when starting a transcription-only session. */
      model?: undefined;

      /** Existing call identifier; cannot be supplied with transcription intent. */
      callID?: undefined;
    })
  | (RealtimeURLBuilderOptions & {
      /** Model name; cannot be supplied when attaching to an existing call. */
      model?: undefined;

      /** Transcription intent; cannot be supplied when attaching to an existing call. */
      intent?: undefined;

      /**
       * Attach to an in-progress Realtime call over a sideband control connection.
       */
      callID: string;
    });

/** Starts an Azure deployment or transcription session, or attaches to an existing call. */
export type AzureRealtimeConnectionConfig =
  | (RealtimeURLBuilderOptions & {
      /**
       * Override the deployment configured on the Azure client.
       */
      deploymentName?: string;

      /** Transcription intent; cannot be combined with a model deployment. */
      intent?: undefined;

      /** Existing call identifier; cannot be combined with `deploymentName`. */
      callID?: undefined;
    })
  | (RealtimeURLBuilderOptions & {
      /** Starts an Azure transcription session; set its deployment later in `session.update`. */
      intent: 'transcription';

      /** Deployment override; cannot be supplied with transcription intent. */
      deploymentName?: undefined;

      /** Existing call identifier; cannot be supplied with transcription intent. */
      callID?: undefined;
    })
  | (RealtimeURLBuilderOptions & {
      /** Deployment override; cannot be supplied when attaching to an existing call. */
      deploymentName?: undefined;

      /** Transcription intent; cannot be supplied when attaching to an existing call. */
      intent?: undefined;

      /**
       * Attach to an in-progress Azure Realtime call over a sideband control connection.
       */
      callID: string;
    });

/**
 * Builds the secure WebSocket URL for a model or transcription session, or a sideband call.
 *
 * All Azure sessions use the versioned GA Realtime endpoint. Model-backed
 * sessions select their deployment with `model`, transcription sessions use
 * `intent`, and sideband connections use `call_id`.
 *
 * @throws {Error} If the connection target is invalid or a custom URL does not use `wss:`.
 */
export function buildRealtimeURL(
  client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  connection: string | RealtimeConnectionConfig,
): URL {
  assertX509WebSocketSupported(client);
  const config: RealtimeConnectionConfig =
    typeof connection === 'string' ? { model: connection } : connection;
  const baseURL = client.baseURL;
  const azure = isAzure(client);
  const hasModel = config.model !== undefined;
  const hasCallID = config.callID !== undefined;
  const hasIntent = config.intent !== undefined;

  if (
    Number(hasModel) + Number(hasCallID) + Number(hasIntent) !== 1 ||
    (hasModel && !config.model) ||
    (hasCallID && !config.callID) ||
    (hasIntent && config.intent !== 'transcription')
  ) {
    throw new Error(
      'Pass exactly one of `model`, `callID`, or transcription `intent` when opening a Realtime WebSocket.',
    );
  }

  if (config.buildRealtimeURL) {
    const url = new URL(config.buildRealtimeURL(client, config));
    if (url.protocol !== 'wss:') {
      throw new Error('Custom Realtime WebSocket URLs must use the wss: protocol.');
    }
    return url;
  }

  let url: URL;
  if (azure) {
    url = new URL(baseURL);
    const basePath = url.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
    const versionedPath = basePath.endsWith('/v1') ? basePath : `${basePath}/v1`;
    url.pathname = `${versionedPath}/realtime`;
    url.search = '';
    url.hash = '';
  } else {
    const path = '/realtime';
    url = new URL(baseURL + (baseURL.endsWith('/') ? path.slice(1) : path));
  }

  url.protocol = 'wss';
  // Sideband control connections attach to an existing call via `call_id`.
  if (hasCallID) {
    url.searchParams.set('call_id', config.callID!);
  } else if (hasIntent) {
    url.searchParams.set('intent', 'transcription');
  } else {
    url.searchParams.set('model', config.model!);
  }
  return url;
}

/**
 * Resolves an Azure deployment, transcription intent, or an existing Realtime call.
 *
 * @throws {Error} If connection targets conflict, intent is invalid, or no deployment is available.
 */
export function getAzureRealtimeConnection(
  client: Pick<AzureOpenAI, 'deploymentName'>,
  connection: AzureRealtimeConnectionConfig,
): RealtimeConnectionConfig {
  const hasDeploymentName = connection.deploymentName !== undefined;
  const hasCallID = connection.callID !== undefined;
  const hasIntent = connection.intent !== undefined;
  const customURLBuilder = connection.buildRealtimeURL;
  const normalizedOptions = customURLBuilder ? { buildRealtimeURL: customURLBuilder } : {};

  if (
    Number(hasDeploymentName) + Number(hasCallID) + Number(hasIntent) > 1 ||
    (hasIntent && connection.intent !== 'transcription')
  ) {
    throw new Error(
      'Pass exactly one of `deploymentName`, `callID`, or transcription `intent` when opening an Azure Realtime WebSocket.',
    );
  }

  if (hasCallID) {
    return { ...normalizedOptions, callID: connection.callID! };
  }

  if (hasIntent) {
    return { ...normalizedOptions, intent: 'transcription' };
  }

  const model = connection.deploymentName ?? client.deploymentName;
  if (!model) {
    throw new Error('No deployment name provided');
  }
  return { ...normalizedOptions, model };
}
