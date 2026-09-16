// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as LiveAPI from './live';
import { OpenAI } from '../../client';
import { EventEmitter } from '../../core/EventEmitter';
import { OpenAIError } from '../../core/error';

import type { RawWebSocketData, ReconnectingEvent, UnsentMessage } from '../../internal/ws';

export type LiveStreamMessage =
  | { type: 'connecting' | 'open' | 'closing' }
  | { type: 'close'; code: number; reason: string; unsent: UnsentMessage<LiveAPI.ClientEvent>[] }
  | { type: 'reconnecting'; reconnect: ReconnectingEvent }
  | { type: 'reconnected' }
  | { type: 'message'; message: LiveAPI.ServerEvent }
  | { type: 'raw'; data: RawWebSocketData }
  | { type: 'error'; error: WebSocketError };

export class WebSocketError extends OpenAIError {
  /**
   * The error data that the API sent back in an error event.
   *
   * This property is non-enumerable to avoid exposing the event through
   * JSON serialization, object spread, or Object.assign.
   */
  error?: LiveAPI.ErrorEvent | undefined;

  constructor(message: string, event: LiveAPI.ErrorEvent | null) {
    super(message);

    Object.defineProperty(this, 'error', {
      value: event ?? undefined,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type WebSocketEvents = Simplify<
  {
    event: (event: LiveAPI.ServerEvent) => void;
    raw: (data: RawWebSocketData) => void;
    error: (error: WebSocketError) => void;
    close: (code: number, reason: string, unsent: UnsentMessage<LiveAPI.ClientEvent>[]) => void;
    reconnecting: (event: ReconnectingEvent) => void;
    reconnected: () => void;
  } & {
    [EventType in Exclude<NonNullable<LiveAPI.ServerEvent['type']>, 'error'>]: (
      event: Extract<LiveAPI.ServerEvent, { type?: EventType }>,
    ) => unknown;
  }
>;

export abstract class LiveEmitter extends EventEmitter<WebSocketEvents> {
  /**
   * Send an event to the API.
   */
  abstract send(event: LiveAPI.ClientEvent): void;

  /**
   * Send raw data over the WebSocket without JSON serialization.
   */
  abstract sendRaw(data: RawWebSocketData): void;

  /**
   * Close the WebSocket connection.
   */
  abstract close(props?: { code: number; reason: string }): void;

  protected _onError(event: null, message: string, cause: any): void;
  protected _onError(event: LiveAPI.ErrorEvent, message?: string | undefined): void;
  protected _onError(event: LiveAPI.ErrorEvent | null, message?: string | undefined, cause?: any): void {
    const safeMessage = safeWebSocketErrorMessage(event, message);
    message = safeMessage ?? 'unknown error';

    if (!this._hasListener('error')) {
      const error = new WebSocketError(
        message +
          `\n\nTo resolve these unhandled rejection errors you should bind an \`error\` callback, e.g. \`ws.on('error', (error) => ...)\` `,
        event,
      );
      // @ts-ignore
      error.cause = cause;
      Promise.reject(error);
      return;
    }

    const error = new WebSocketError(message, event);
    // @ts-ignore
    error.cause = cause;

    this._emit('error', error);
  }
}

export function buildURL(client: OpenAI, parameters: Record<string, unknown>): URL {
  const { ...query } = parameters;
  const endpoint = '/live/sessions';
  const url = new URL(client.buildURL(endpoint, query, undefined));
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  return url;
}

function safeWebSocketErrorMessage(event: unknown, message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  if (typeof event !== 'object' || event === null) return undefined;

  try {
    const error = Object.getOwnPropertyDescriptor(event, 'error')?.value;
    const nestedMessage =
      typeof error === 'object' && error !== null
        ? Object.getOwnPropertyDescriptor(error, 'message')?.value
        : undefined;
    const eventMessage = Object.getOwnPropertyDescriptor(event, 'message')?.value;
    const candidate = typeof nestedMessage === 'string' ? nestedMessage : eventMessage;
    return typeof candidate === 'string' ? candidate : undefined;
  } catch {
    return undefined;
  }
}
