// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../internal/ws-adapter-node';
import { LiveWSBase, type LiveWSBaseOptions } from './ws-base';
import { OpenAI } from '../../client';

export type { WebSocketStreamOptions } from '../../internal/ws';

export type { LiveWSReconnectOptions } from './ws-base';

/**
 * Native Node WebSocket options.
 *
 * `maxPayload` defaults to 0 (unlimited). Set a byte limit supported by `ws` to cap incoming messages.
 * `perMessageDeflate` defaults to false, including with a finite payload limit.
 * Set it to true or a `ws` configuration object to enable compression.
 */
export interface LiveWSClientOptions extends WS.ClientOptions, LiveWSBaseOptions {}

export class LiveWS extends LiveWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;

  constructor(client: OpenAI, options?: LiveWSClientOptions | null | undefined) {
    if (!WS?.WebSocket) {
      throw new Error(
        'LiveWS from "openai/resources/live/ws" requires the "ws" package but it could not be loaded.',
      );
    }

    const { reconnect, maxQueueSize, ...wsOptions } = options ?? {};
    super(client, { reconnect, maxQueueSize });
    this._wsOptions = wsOptions;
    this._connectInitial();
  }

  protected _createSocket(url: URL, authHeaders: Record<string, string>): NodeWebSocket {
    const socketOptions: WS.ClientOptions = {
      maxPayload: 0,
      perMessageDeflate: false,
      ...this._wsOptions,
      headers: {
        ...this._client._buildWebSocketHeaders(authHeaders),
        ...Object.fromEntries(
          Object.entries(this._wsOptions?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
        ),
      },
      followRedirects: false,
    };
    socketOptions.maxPayload ??= 0;
    socketOptions.perMessageDeflate ??= false;
    const ws = new WS.WebSocket(url, socketOptions);
    return new NodeWebSocket(ws);
  }
}
