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
      ? `${event.error.message} code=${event.error.code} param=${event.error.param} type=${event.error.type} event_id=${event.error.event_id}`
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

/** Starts a model-backed Realtime session or attaches to exactly one existing call. */
export type RealtimeConnectionConfig =
  | {
      /**
       * Start a new Realtime session using the given model.
       */
      model: string;

      /** Existing call identifier; cannot be supplied when starting a model-backed session. */
      callID?: undefined;
    }
  | {
      /** Model name; cannot be supplied when attaching to an existing call. */
      model?: undefined;
      /**
       * Attach to an in-progress Realtime call over a sideband control connection.
       */
      callID: string;
    };

/** Starts an Azure deployment-backed session or attaches to an existing Azure Realtime call. */
export type AzureRealtimeConnectionConfig =
  | {
      /**
       * Override the deployment configured on the Azure client.
       */
      deploymentName?: string;

      /** Existing call identifier; cannot be combined with `deploymentName`. */
      callID?: undefined;
    }
  | {
      /** Deployment override; cannot be supplied when attaching to an existing call. */
      deploymentName?: undefined;
      /**
       * Attach to an in-progress Azure Realtime call over a sideband control connection.
       */
      callID: string;
    };

/**
 * Builds the secure WebSocket URL for a new Realtime session or sideband call.
 *
 * Azure model sessions use deployment and API-version query parameters; Azure
 * sideband calls use the versioned GA Realtime endpoint.
 *
 * @throws {Error} If both `model` and `callID`, or neither, are supplied.
 */
export function buildRealtimeURL(
  client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  connection: string | RealtimeConnectionConfig,
): URL {
  const config: RealtimeConnectionConfig =
    typeof connection === 'string' ? { model: connection } : connection;
  const baseURL = client.baseURL;
  const azure = isAzure(client);
  const hasModel = !!config.model;
  const hasCallID = !!config.callID;

  if (hasModel === hasCallID) {
    throw new Error('Pass exactly one of `model` or `callID` when opening a Realtime WebSocket.');
  }

  let url: URL;
  if (azure && hasCallID) {
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
  if (azure) {
    if (hasCallID) {
      url.searchParams.set('call_id', config.callID!);
    } else {
      url.searchParams.set('api-version', client.apiVersion);
      url.searchParams.set('deployment', config.model!);
    }
  } else if (hasCallID) {
    url.searchParams.set('call_id', config.callID!);
  } else {
    url.searchParams.set('model', config.model!);
  }
  return url;
}

/**
 * Resolves an Azure deployment override, the client's default deployment, or an existing call.
 *
 * @throws {Error} If both a deployment and call ID are supplied or no deployment is available.
 */
export function getAzureRealtimeConnection(
  client: Pick<AzureOpenAI, 'deploymentName'>,
  connection: AzureRealtimeConnectionConfig,
): RealtimeConnectionConfig {
  if (connection.callID !== undefined) {
    if (connection.deploymentName !== undefined) {
      throw new Error('Pass either `deploymentName` or `callID`, but not both.');
    }
    return { callID: connection.callID };
  }

  const model = connection.deploymentName ?? client.deploymentName;
  if (!model) {
    throw new Error('No deployment name provided');
  }
  return { model };
}
