import {
  RealtimeClientEvent,
  RealtimeServerEvent,
  RealtimeErrorEvent,
  RealtimeError,
} from '../resources/realtime/realtime';
import { EventEmitter } from '../lib/EventEmitter';
import { OpenAIError } from '../error';
import OpenAI, { AzureOpenAI } from '../index';

export class OpenAIRealtimeError extends OpenAIError {
  /**
   * The error data that the API sent back in an `error` event.
   */
  error?: RealtimeError | undefined;

  /**
   * The unique ID of the server event.
   */
  event_id?: string | undefined;

  constructor(message: string, event: RealtimeErrorEvent | null) {
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
  protected _onError(event: RealtimeErrorEvent, message?: string | undefined): void;
  protected _onError(event: RealtimeErrorEvent | null, message?: string | undefined, cause?: any): void {
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
      intent?: undefined;
      callID?: undefined;
    }
  | {
      /**
       * Connect to the Realtime API with transcription intent.
       */
      intent: 'transcription';
      model?: undefined;
      callID?: undefined;
    }
  | {
      model?: undefined;
      intent?: undefined;
      /**
       * Attach to an in-progress Realtime call over a sideband control connection.
       */
      callID: string;
    };

export type AzureRealtimeConnectionConfig =
  | {
      /**
       * Override the deployment configured on the Azure client.
       */
      deploymentName?: string;
      intent?: undefined;
      callID?: undefined;
    }
  | {
      /**
       * Connect to the Azure Realtime API with transcription intent.
       */
      intent: 'transcription';
      deploymentName?: undefined;
      callID?: undefined;
    }
  | {
      deploymentName?: undefined;
      intent?: undefined;
      /**
       * Attach to an in-progress Azure Realtime call over a sideband control connection.
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
  const hasIntent = config.intent === 'transcription';

  if ([hasModel, hasCallID, hasIntent].filter(Boolean).length !== 1) {
    throw new Error(
      'Pass exactly one of `model`, `callID`, or transcription `intent` when opening a Realtime WebSocket.',
    );
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
      if (hasIntent) {
        url.searchParams.set('intent', config.intent!);
      } else {
        url.searchParams.set('deployment', config.model!);
      }
    }
  } else {
    if (hasCallID) {
      url.searchParams.set('call_id', config.callID!);
    } else if (hasIntent) {
      url.searchParams.set('intent', config.intent!);
    } else {
      url.searchParams.set('model', config.model!);
    }
  }
  return url;
}

export function getAzureRealtimeConnection(
  client: Pick<AzureOpenAI, 'deploymentName'>,
  connection: AzureRealtimeConnectionConfig,
): RealtimeConnectionConfig {
  const hasDeploymentName = connection.deploymentName !== undefined;
  const hasCallID = connection.callID !== undefined;
  const hasIntent = connection.intent === 'transcription';

  if ([hasDeploymentName, hasCallID, hasIntent].filter(Boolean).length > 1) {
    throw new Error(
      'Pass exactly one of `deploymentName`, `callID`, or transcription `intent` when opening an Azure Realtime WebSocket.',
    );
  }

  if (hasCallID) {
    return { callID: connection.callID! };
  }

  if (hasIntent) {
    return { intent: connection.intent! };
  }

  const model = connection.deploymentName ?? client.deploymentName;
  if (!model) {
    throw new Error('No deployment name provided');
  }
  return { model };
}
