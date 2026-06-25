import { RealtimeClientEvent, RealtimeServerEvent, ErrorEvent } from '../../resources/beta/realtime/realtime';
import { EventEmitter } from '../../lib/EventEmitter';
import { OpenAIError } from '../../error';
import OpenAI, { AzureOpenAI } from '../../index';

export class OpenAIRealtimeError extends OpenAIError {
  /**
   * The error data that the API sent back in an `error` event.
   */
  error?: ErrorEvent.Error | undefined;

  /**
   * The unique ID of the server event.
   */
  event_id?: string | undefined;

  constructor(message: string, event: ErrorEvent | null) {
    super(message);

    this.error = event?.error;
    this.event_id = event?.event_id;
  }
}

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type RealtimeEvents = Simplify<
  {
    event: (event: RealtimeServerEvent) => void;
    error: (error: OpenAIRealtimeError) => void;
  } & {
    [EventType in Exclude<RealtimeServerEvent['type'], 'error'>]: (
      event: Extract<RealtimeServerEvent, { type: EventType }>,
    ) => unknown;
  }
>;

export abstract class OpenAIRealtimeEmitter extends EventEmitter<RealtimeEvents> {
  /**
   * Send an event to the API.
   */
  abstract send(event: RealtimeClientEvent): void;

  /**
   * Close the websocket connection.
   */
  abstract close(props?: { code: number; reason: string }): void;

  protected _onError(event: null, message: string, cause: any): void;
  protected _onError(event: ErrorEvent, message?: string | undefined): void;
  protected _onError(event: ErrorEvent | null, message?: string | undefined, cause?: any): void {
    message =
      event?.error ?
        `${event.error.message} code=${event.error.code} param=${event.error.param} type=${event.error.type} event_id=${event.error.event_id}`
      : message ?? 'unknown error';

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

export function isAzure(client: Pick<OpenAI, 'apiKey' | 'baseURL'>): client is AzureOpenAI {
  return client instanceof AzureOpenAI;
}

export type RealtimeConnectionConfig =
  | {
      /**
       * Start a new Realtime session using the given model.
       */
      model: string;
      callID?: undefined;
    }
  | {
      model?: undefined;
      /**
       * Attach to an in-progress Realtime call over a sideband control connection.
       */
      callID: string;
    };

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
  } else {
    if (hasCallID) {
      url.searchParams.set('call_id', config.callID!);
    } else {
      url.searchParams.set('model', config.model!);
    }
  }
  return url;
}
