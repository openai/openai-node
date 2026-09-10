// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as ForksAPI from './forks';
import * as LiveAPI from '../live';
import { OpenAI } from '../../../client';
import { EventEmitter } from '../../../core/EventEmitter';
import { OpenAIError } from '../../../core/error';
import { path } from '../../../internal/utils/path';

import type { RawWebSocketData, ReconnectingEvent, UnsentMessage } from '../../../internal/ws';
import { ForksWSParameters } from './ws-base';

export type ForksStreamMessage =
  | { type: 'connecting' | 'open' | 'closing' }
  | { type: 'close'; code: number; reason: string; unsent: UnsentMessage<ForksAPI.ForkClientEvent>[] }
  | { type: 'reconnecting'; reconnect: ReconnectingEvent<ForksWSParameters> }
  | { type: 'reconnected' }
  | { type: 'message'; message: ForksAPI.ForkServerEvent }
  | { type: 'raw'; data: RawWebSocketData }
  | { type: 'error'; error: WebSocketError };

export class WebSocketError extends OpenAIError {
  /**
   * The error data that the API sent back in an error event.
   */
  error?: LiveAPI.ErrorEvent | undefined;

  constructor(message: string, event: LiveAPI.ErrorEvent | null) {
    super(message);

    this.error = event ?? undefined;
  }
}

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type WebSocketEvents = Simplify<
  {
    event: (event: ForksAPI.ForkServerEvent) => void;
    raw: (data: RawWebSocketData) => void;
    error: (error: WebSocketError) => void;
    close: (code: number, reason: string, unsent: UnsentMessage<ForksAPI.ForkClientEvent>[]) => void;
    reconnecting: (event: ReconnectingEvent<ForksWSParameters>) => void;
    reconnected: () => void;
  } & {
    [EventType in Exclude<NonNullable<ForksAPI.ForkServerEvent['type']>, 'error'>]: (
      event: Extract<ForksAPI.ForkServerEvent, { type?: EventType }>,
    ) => unknown;
  }
>;

export abstract class ForksEmitter extends EventEmitter<WebSocketEvents> {
  /**
   * Send an event to the API.
   */
  abstract send(event: ForksAPI.ForkClientEvent): void;

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
    message = message ?? safeJSONStringify(event) ?? 'unknown error';

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
  const { session_id: path0, ...query } = parameters;
  const endpoint = path`/live/sessions/${path0}/fork`;
  const url = new URL(client.buildURL(endpoint, query, undefined));
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  return url;
}

function safeJSONStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
