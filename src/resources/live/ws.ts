// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../internal/ws-adapter-node';
import { LiveWSBase, type LiveWSBaseOptions } from './ws-base';
import { OpenAI } from '../../client';
import { VERSION } from '../../version';

export type { LiveWSReconnectOptions } from './ws-base';

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
    const ws = new WS.WebSocket(url, {
      ...this._wsOptions,
      headers: {
        'User-Agent': `${this._client.constructor.name}/JS ${VERSION}`,

        ...authHeaders,
        ...this._wsOptions?.headers,
      },
      followRedirects: false,
    });
    return new NodeWebSocket(ws);
  }
}
