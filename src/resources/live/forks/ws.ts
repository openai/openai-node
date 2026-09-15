// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../../internal/ws-adapter-node';
import { ForksWSBase, type ForksWSBaseOptions, type ForksWSParameters } from './ws-base';
import { OpenAI } from '../../../client';
import { VERSION } from '../../../version';

export type { ForksWSParameters, ForksWSReconnectOptions } from './ws-base';

export interface ForksWSClientOptions extends WS.ClientOptions, ForksWSBaseOptions {}

export class ForksWS extends ForksWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;

  constructor(
    client: OpenAI,
    parameters: ForksWSParameters,
    options?: ForksWSClientOptions | null | undefined,
  ) {
    if (!WS?.WebSocket) {
      throw new Error(
        'ForksWS from "openai/resources/live/forks/ws" requires the "ws" package but it could not be loaded.',
      );
    }

    const { reconnect, maxQueueSize, ...wsOptions } = options ?? {};
    super(client, parameters, { reconnect, maxQueueSize });
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
