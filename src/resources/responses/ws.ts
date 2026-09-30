// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket, snapshotNodeWebSocketOptions } from '../../internal/ws-adapter-node';
import { ResponsesWSBase, type ResponsesWSBaseOptions } from './ws-base';
import { OpenAI } from '../../client';
import { OpenAIError } from '../../core/error';
import {
  buildWebSocketOptions,
  mergeWebSocketAuthHeaders,
  snapshotWebSocketCredentials,
  WEBSOCKET_METADATA_HEADERS,
} from '../../internal/ws';
import { resolveRealtimeAPIKey } from '../../internal/realtime-credentials';

export type { WebSocketStreamOptions } from '../../internal/ws';

export type { ResponsesWSReconnectOptions } from './ws-base';

export interface ResponsesWSClientOptions extends WS.ClientOptions, ResponsesWSBaseOptions {
  /** Basic authentication forwarded by the Node `ws` transport. */
  auth?: string;
}

export class ResponsesWS extends ResponsesWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;
  private _initialAuthUsedAPIKey = false;
  private _preparedSocketOptions:
    | {
        options: ResponsesWSClientOptions;
        removedHeaders: ReadonlySet<string>;
        apiKey?: string | null | undefined;
      }
    | undefined;

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

  protected override _authHeaders(apiKey?: string | null): Record<string, string> {
    const headers = super._authHeaders(apiKey === undefined ? this._preparedSocketOptions?.apiKey : apiKey);
    if (!this.socket) {
      this._initialAuthUsedAPIKey = Boolean(headers['Authorization']);
    }
    return headers;
  }

  protected _createSocket(url: URL, authHeaders: Record<string, string>): NodeWebSocket {
    const prepared = this._preparedSocketOptions;
    let socketOptions: ResponsesWSClientOptions;
    const capturedAuthHeaders = { ...authHeaders };
    if (prepared) {
      socketOptions = mergeWebSocketAuthHeaders(
        prepared.options,
        capturedAuthHeaders,
        prepared.removedHeaders,
      );
    } else {
      if (this._client._hasApiKeyProvider()) {
        const removedHeaders = new Set<string>();
        socketOptions = buildWebSocketOptions(this._client, {}, this._wsOptions, removedHeaders);
        if (!snapshotWebSocketCredentials(socketOptions, WEBSOCKET_METADATA_HEADERS)) {
          socketOptions = mergeWebSocketAuthHeaders(socketOptions, capturedAuthHeaders, removedHeaders);
        }
      } else {
        socketOptions = buildWebSocketOptions(this._client, capturedAuthHeaders, this._wsOptions);
      }
    }
    if (
      this._client._hasApiKeyProvider() &&
      !capturedAuthHeaders['Authorization'] &&
      !snapshotWebSocketCredentials(socketOptions, WEBSOCKET_METADATA_HEADERS)
    ) {
      throw new OpenAIError(
        'Cannot open a Responses WebSocket with an unresolved function-based apiKey. Resolve it before constructing the WebSocket or provide explicit WebSocket credentials.',
      );
    }

    const ws = new WS.WebSocket(url, socketOptions);
    return new NodeWebSocket(ws);
  }

  private _createPreparedSocket(
    url: URL,
    authHeaders: Record<string, string>,
    socketOptions: ResponsesWSClientOptions,
    removedHeaders: ReadonlySet<string>,
    apiKey?: string | null,
  ): NodeWebSocket {
    const previous = this._preparedSocketOptions;
    this._preparedSocketOptions = { options: socketOptions, removedHeaders, apiKey };
    try {
      // Preserve the original two-argument transport hook for subclass overrides.
      return this._createSocket(url, apiKey === undefined ? authHeaders : this._authHeaders(apiKey));
    } finally {
      this._preparedSocketOptions = previous;
    }
  }

  protected override async _prepareReconnectSocket(): Promise<(url: URL) => NodeWebSocket> {
    if (!this._client._hasApiKeyProvider()) {
      return super._prepareReconnectSocket();
    }
    // Exclude the client's derived key from this decision so an earlier resolution cannot
    // masquerade as a caller credential. Client default headers and transport auth still count.
    const removedHeaders = new Set<string>();
    const options = buildWebSocketOptions(
      this._client,
      {},
      snapshotNodeWebSocketOptions(this._wsOptions),
      removedHeaders,
    );
    if (snapshotWebSocketCredentials(options, WEBSOCKET_METADATA_HEADERS)) {
      return (url) => this._createPreparedSocket(url, {}, options, removedHeaders);
    }
    // Preserve explicit removals/empty Authorization after an earlier key resolution.
    if (
      removedHeaders.has('authorization') ||
      options.headers?.['authorization'] !== undefined ||
      !this._initialAuthUsedAPIKey
    ) {
      const authHeaders = this._authHeaders();
      return (url) => this._createPreparedSocket(url, authHeaders, options, removedHeaders);
    }
    const { commit } = await resolveRealtimeAPIKey(this._client, true);
    return (url) => this._createPreparedSocket(url, {}, options, removedHeaders, commit());
  }
}
