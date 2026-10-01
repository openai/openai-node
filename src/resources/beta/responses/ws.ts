// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket, snapshotNodeWebSocketOptions } from '../../../internal/ws-adapter-node';
import { ResponsesWSBase, type ResponsesWSBaseOptions } from './ws-base';
import { OpenAI } from '../../../client';
import { ResponsesWebSocketCredentials } from '../../../internal/responses-ws-credentials';

export type { WebSocketStreamOptions } from '../../../internal/ws';

export type { ResponsesWSReconnectOptions } from './ws-base';

export interface ResponsesWSClientOptions extends WS.ClientOptions, ResponsesWSBaseOptions {
  /** Basic authentication forwarded by the Node `ws` transport. */
  auth?: string;
}

export class ResponsesWS extends ResponsesWSBase<NodeWebSocket> {
  private _wsOptions: WS.ClientOptions | null | undefined;
  private _credentials = new ResponsesWebSocketCredentials();

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

  protected override _authHeaders(apiKey?: string | null): Record<string, string> {
    const headers = super._authHeaders(apiKey === undefined ? this._credentials.preparedAPIKey : apiKey);
    this._credentials.trackInitialHeaders(this._client, headers, () => !!this.socket);
    return headers;
  }

  /**
   * Whether credentials passed to the Node transport use the SDK key.
   * The SDK recognizes its key, including copies and additions in credential headers.
   * Override and return true if your socket hook signs or otherwise irreversibly transforms it.
   * Explicit caller options and header removals still take precedence on reconnect.
   */
  protected _usesSDKAPIKey(authHeaders: Record<string, string>): boolean {
    return this._credentials.usesAPIKey(this._client, authHeaders);
  }

  protected _createSocket(url: URL, authHeaders: Record<string, string>): NodeWebSocket {
    const capturedAuthHeaders = { ...authHeaders };
    const socketOptions = this._credentials.build(
      this._client,
      capturedAuthHeaders,
      this._wsOptions,
      !this.socket ? this._usesSDKAPIKey(capturedAuthHeaders) : undefined,
    );
    return new NodeWebSocket(new WS.WebSocket(url, socketOptions));
  }

  protected override async _prepareReconnectSocket(): Promise<(url: URL) => NodeWebSocket> {
    if (!this._client._hasApiKeyProvider()) {
      return super._prepareReconnectSocket();
    }
    return this._credentials.prepare(
      this._client,
      snapshotNodeWebSocketOptions(this._wsOptions),
      (...args) => this._authHeaders(...args),
      (url, headers) => this._createSocket(url, headers),
    );
  }
}
