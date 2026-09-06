// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../internal/ws-adapter-node';
import { ResponsesWSBase, type ResponsesWSBaseOptions } from './ws-base';
import { OpenAI } from '../../client';
import { VERSION } from '../../version';
import { OpenAIError } from '../../core/error';

export type { ResponsesWSReconnectOptions } from './ws-base';

export interface ResponsesWSClientOptions extends WS.ClientOptions, ResponsesWSBaseOptions {}

export class ResponsesWS extends ResponsesWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;

  constructor(client: OpenAI, options?: ResponsesWSClientOptions | null | undefined) {
    if (!WS?.WebSocket) {
      throw new Error(
        'ResponsesWS from "openai/resources/responses/ws" requires the "ws" package but it could not be loaded.',
      );
    }
    const { reconnect, maxQueueSize, ...wsOptions } = options ?? {};
    super(client, { reconnect, maxQueueSize });
    this._wsOptions = wsOptions;
    this._connectInitial();
  }

  protected _createSocket(url: URL, authHeaders: Record<string, string>): NodeWebSocket {
    const headers = {
      'User-Agent': `${this._client.constructor.name}/JS ${VERSION}`,
      ...authHeaders,
      ...this._wsOptions?.headers,
    };
    const hasExplicitAuthorization = Object.entries(this._wsOptions?.headers ?? {}).some(
      ([name, value]) => name.toLowerCase() === 'authorization' && value != null,
    );
    if (this._client._hasUnresolvedApiKey() && !hasExplicitAuthorization) {
      throw new OpenAIError(
        'Cannot open a Responses WebSocket with an unresolved function-based apiKey. Resolve it before constructing the WebSocket or provide an Authorization header.',
      );
    }

    const ws = new WS.WebSocket(url, {
      ...this._wsOptions,
      headers,
      followRedirects: false,
    });
    return new NodeWebSocket(ws);
  }
}
