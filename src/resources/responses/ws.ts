// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as WS from 'ws';
import { NodeWebSocket } from '../../internal/ws-adapter-node';
import { ResponsesWSBase, type ResponsesWSBaseOptions } from './ws-base';
import { OpenAI } from '../../client';
import { VERSION } from '../../version';
import { OpenAIError } from '../../core/error';

export type { ResponsesWSReconnectOptions } from './ws-base';

export interface ResponsesWSClientOptions extends WS.ClientOptions, ResponsesWSBaseOptions {
  /** Basic authentication forwarded by the Node `ws` transport. */
  auth?: string;
}

const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
]);

function hasCredentialValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialValue);
  return value != null && String(value).trim().length > 0;
}

function hasExplicitWebSocketCredential(options: ResponsesWSClientOptions): boolean {
  if (hasCredentialValue(options.auth)) return true;
  return Object.entries(options.headers ?? {}).some(
    ([name, value]) => CREDENTIAL_HEADERS.has(name.toLowerCase()) && hasCredentialValue(value),
  );
}

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
    const socketOptions: ResponsesWSClientOptions = {
      ...this._wsOptions,
      headers: {
        'User-Agent': `${this._client.constructor.name}/JS ${VERSION}`,
        ...authHeaders,
        ...this._wsOptions?.headers,
      },
      followRedirects: false,
    };
    if (this._client._hasUnresolvedApiKey() && !hasExplicitWebSocketCredential(socketOptions)) {
      throw new OpenAIError(
        'Cannot open a Responses WebSocket with an unresolved function-based apiKey. Resolve it before constructing the WebSocket or provide explicit WebSocket credentials.',
      );
    }

    const ws = new WS.WebSocket(url, socketOptions);
    return new NodeWebSocket(ws);
  }
}
