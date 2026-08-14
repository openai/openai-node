import type {
  RealtimeClientEvent,
  RealtimeServerEvent,
  ErrorEvent,
} from '../../resources/beta/realtime/realtime';
import { EventEmitter } from '../../lib/EventEmitter';
import { OpenAIError } from '../../error';
import type OpenAI from '../../index';
import { AzureOpenAI } from '../../index';

function safeErrorValue(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unserializable error value]';
  }
}

/** An API-reported or client-side error encountered by a beta Realtime connection. */
export class OpenAIRealtimeError extends OpenAIError {
  /** Stable error name used to identify Realtime connection failures. */
  override name = 'OpenAIRealtimeError';

  /**
   * The error data that the API sent back in an `error` event.
   */
  error?: ErrorEvent.Error | undefined;

  /**
   * The unique ID of the server event.
   */
  event_id?: string | undefined;

  /**
   * Creates a beta Realtime error, preserving server-provided details when available.
   *
   * @param message Human-readable API or connection error description.
   * @param event Server error event, or `null` for a client-side failure.
   */
  constructor(message: string, event: ErrorEvent | null) {
    super(message);

    this.error = event?.error;
    this.event_id = event?.event_id;
  }
}

/** Materializes mapped beta Realtime listener properties without changing their public types. */
// oxlint-disable-next-line typescript/ban-types -- The empty intersection materializes the mapped event shape without changing its public type.
type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

/**
 * Maps beta Realtime server event types to their corresponding strongly typed listener callbacks.
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
 * Typed event emitter shared by the beta Realtime WebSocket implementations.
 *
 * Listen for `event` to receive all server events, or subscribe to a specific
 * server event's `type`. Always register an `error` listener; otherwise API and
 * transport failures are reported as unhandled promise rejections.
 */
export abstract class OpenAIRealtimeEmitter extends EventEmitter<RealtimeEvents> {
  /**
   * Serializes and sends a client event after the underlying WebSocket is open.
   * Serialization and transport failures are delivered to the `error` event.
   */
  abstract send(event: RealtimeClientEvent): void;

  /**
   * Closes the WebSocket with status code `1000` and reason `OK` by default.
   * Connection-closing failures are delivered to the `error` event.
   */
  abstract close(props?: {
    /** WebSocket close status code; defaults to `1000`. */
    code: number;

    /** WebSocket close reason; defaults to `OK`. */
    reason: string;
  }): void;

  protected _onError(event: null, message: string, cause: any): void;
  protected _onError(event: ErrorEvent, message?: string | undefined): void;
  protected _onError(event: ErrorEvent | null, message?: string | undefined, cause?: any): void {
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

/** Starts a beta Realtime model session or attaches to one existing non-Azure call. */
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

/**
 * Builds the secure WebSocket URL for a beta Realtime session or non-Azure sideband call.
 *
 * @throws {Error} If both `model` and `callID`, or neither, are supplied, or an
 * Azure sideband call is requested through the beta helpers.
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

  const path = '/realtime';
  const url = new URL(baseURL + (baseURL.endsWith('/') ? path.slice(1) : path));

  if (hasModel === hasCallID) {
    throw new Error('Pass exactly one of `model` or `callID` when opening a Realtime WebSocket.');
  }

  url.protocol = 'wss';
  // Sideband control connections attach to an existing call via `call_id`.
  if (azure) {
    if (hasCallID) {
      throw new Error('Azure `callID` connections require the stable Realtime helpers.');
    }
    url.searchParams.set('api-version', client.apiVersion);
    url.searchParams.set('deployment', config.model!);
  } else if (hasCallID) {
    url.searchParams.set('call_id', config.callID!);
  } else {
    url.searchParams.set('model', config.model!);
  }
  return url;
}
