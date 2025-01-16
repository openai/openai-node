import { RealtimeClientEvent, RealtimeServerEvent, ErrorEvent } from '../../resources/beta/realtime/realtime';
import { EventEmitter } from '../../lib/EventEmitter';
import { OpenAIError } from '../../error';

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

export function buildRealtimeURL(props: { baseURL: string; model: string }): URL {
  const path = '/realtime';

  const url = new URL(props.baseURL + (props.baseURL.endsWith('/') ? path.slice(1) : path));
  url.protocol = 'wss';
  url.searchParams.set('model', props.model);
  return url;
}
