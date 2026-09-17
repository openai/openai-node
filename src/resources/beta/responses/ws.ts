// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../../internal/ws-adapter-node';
import { ResponsesWSBase, type ResponsesWSBaseOptions } from './ws-base';
import { OpenAI } from '../../../client';
import { OpenAIError } from '../../../core/error';
import { snapshotWebSocketCredentials } from '../../../internal/ws';

export type { WebSocketStreamOptions } from '../../../internal/ws';

export type { ResponsesWSReconnectOptions } from './ws-base';

export interface ResponsesWSClientOptions extends WS.ClientOptions, ResponsesWSBaseOptions {
  /** Basic authentication forwarded by the Node `ws` transport. */
  auth?: string;
}

export class ResponsesWS extends ResponsesWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;

  constructor(client: OpenAI, options?: ResponsesWSClientOptions | null | undefined) {
    if (!WS?.WebSocket) {
      throw new Error(
        'ResponsesWS from "openai/resources/beta/responses/ws" requires the "ws" package but it could not be loaded.',
      );
    }
    const { reconnect, maxQueueSize, ...wsOptions } = options ?? {};
    super(client, { reconnect, maxQueueSize });
    this._wsOptions = wsOptions;
    this._connectInitial();
  }

  protected _createSocket(url: URL, authHeaders: Record<string, string>): NodeWebSocket {
    const capturedAuthHeaders = { ...authHeaders };
    const headers = new Map(Object.entries(this._client._buildWebSocketHeaders(capturedAuthHeaders)));
    for (const [name, value] of Object.entries(this._wsOptions?.headers ?? {})) {
      if (value === null) {
        headers.delete(name.toLowerCase());
      } else if (value !== undefined) {
        headers.set(name.toLowerCase(), value);
      }
    }
    const socketOptions: ResponsesWSClientOptions = {
      ...this._wsOptions,
      headers: Object.fromEntries(headers),
      followRedirects: false,
    };
    if (
      this._client._hasApiKeyProvider() &&
      !capturedAuthHeaders['Authorization'] &&
      !snapshotWebSocketCredentials(socketOptions)
    ) {
      throw new OpenAIError(
        'Cannot open a Responses WebSocket with an unresolved function-based apiKey. Resolve it before constructing the WebSocket or provide explicit WebSocket credentials.',
      );
    }

    const ws = new WS.WebSocket(url, socketOptions);
    return new NodeWebSocket(ws);
  }
}
