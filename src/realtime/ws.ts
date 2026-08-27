import * as WS from 'ws';
import { assertBedrockWebSocketOrigin } from '../internal/bedrock';
import { protectWebSocketOptionsFromCredentialRedirects } from '../internal/ws';
import type { AzureOpenAI } from '../index';
import { OpenAI } from '../index';
import { VERSION } from '../version';
import type { RealtimeClientEvent } from '../resources/realtime/realtime';
import {
  OpenAIRealtimeEmitter,
  buildRealtimeURL,
  getAzureRealtimeConnection,
  isAzure,
  parseRealtimeEvent,
} from './internal-base';
import type { AzureRealtimeConnectionConfig, RealtimeConnectionConfig } from './internal-base';

/**
 * Connects to the Realtime API using the Node.js `ws` WebSocket implementation.
 *
 * Install the optional `ws` peer dependency before importing this entrypoint.
 * Subscribe to `socket`'s `open` and `close` events for connection lifecycle,
 * and register an SDK `error` listener for API or transport failures.
 */
export class OpenAIRealtimeWS extends OpenAIRealtimeEmitter {
  /** Secure Realtime WebSocket URL with its model, transcription intent, or call ID. */
  url: URL;

  /** Underlying `ws.WebSocket` instance for connection lifecycle and transport events. */
  socket: WS.WebSocket;

  /**
   * Immediately opens a model or transcription session, or attaches to an existing call.
   *
   * Pass an existing OpenAI client as the second argument to reuse its endpoint
   * and static credentials. Clients with function-based credentials must use
   * {@link OpenAIRealtimeWS.create}; Azure clients should use
   * {@link OpenAIRealtimeWS.azure}.
   *
   * @param props Exactly one model, transcription intent, or call ID, plus `ws` client settings.
   * @param client Existing client whose endpoint and API key should be reused.
   */
  constructor(
    props: RealtimeConnectionConfig & {
      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;

      /** Indicates that a function-based credential was resolved by an async factory. @internal */
      __resolvedApiKey?: boolean;
    },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();
    client ??= new OpenAI();
    const hasProvider = typeof (client as any)?._options?.apiKey === 'function';
    if (hasProvider && !props.__resolvedApiKey) {
      throw new Error(
        [
          'Cannot open Realtime WebSocket with a function-based apiKey.',
          'Use the .create() method so that the key is resolved before connecting.',
        ].join('\n'),
      );
    }
    this.url = buildRealtimeURL(client, props);
    assertBedrockWebSocketOrigin(client, this.url);
    const headers = {
      'User-Agent': `${client.constructor.name}/JS ${VERSION}`,
      ...props.options?.headers,
      ...(isAzure(client) && !props.__resolvedApiKey ? {} : { Authorization: `Bearer ${client.apiKey}` }),
    };

    this.socket = new WS.WebSocket(
      this.url,
      protectWebSocketOptionsFromCredentialRedirects({
        ...props.options,
        headers,
      }),
    );

    this.socket.on('message', (wsEvent) => {
      const event = (() => {
        try {
          const parsedEvent = parseRealtimeEvent(wsEvent.toString());

          if (
            typeof parsedEvent !== 'object' ||
            parsedEvent === null ||
            Array.isArray(parsedEvent) ||
            !Object.getOwnPropertyDescriptor(parsedEvent, 'type') ||
            typeof parsedEvent.type !== 'string'
          ) {
            throw new TypeError('Realtime WebSocket event must be an object with a string type.');
          }

          return parsedEvent;
        } catch (err) {
          this._onError(null, 'could not parse websocket event', err);
          return null;
        }
      })();

      if (event) {
        this._emit('event', event);

        if (event.type === 'error') {
          this._onError(event);
        } else {
          // @ts-expect-error TS isn't smart enough to get the relationship right here
          this._emit(event.type, event);
        }
      }
    });

    this.socket.on('error', (err) => {
      this._onError(null, err.message, err);
    });
  }

  /**
   * Resolves a client's current API credential before opening a Realtime connection.
   *
   * Use this factory instead of the constructor when the client's `apiKey` is a function.
   *
   * @param client OpenAI client that owns the endpoint and refreshable or static credential.
   * @param props Exactly one model, transcription intent, or call ID, plus `ws` client settings.
   */
  static async create(
    client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_callApiKey'>,
    props: RealtimeConnectionConfig & {
      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;
    },
  ): Promise<OpenAIRealtimeWS> {
    const resolvedApiKey = await client._callApiKey();
    const url = buildRealtimeURL(client, props);
    assertBedrockWebSocketOrigin(client, url);
    return new OpenAIRealtimeWS(
      {
        ...props,
        buildRealtimeURL: () => url,
        __resolvedApiKey: resolvedApiKey,
      },
      client,
    );
  }

  /**
   * Opens an Azure deployment or transcription session, or an existing sideband call.
   *
   * Static Azure API keys are sent in the `api-key` header; function-based
   * credentials are resolved first and sent as bearer credentials. The client's
   * configured deployment is used unless a deployment, transcription intent, or call ID is supplied.
   *
   * @param client Azure OpenAI client that supplies the endpoint and credential.
   * @param props Deployment, transcription intent, or call ID, plus `ws` connection settings.
   * @throws {Error} If the Azure credential or required deployment is unavailable.
   */
  static async azure(
    client: Pick<AzureOpenAI, '_callApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>,
    props: AzureRealtimeConnectionConfig & {
      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;
    } = {},
  ): Promise<OpenAIRealtimeWS> {
    const connection = getAzureRealtimeConnection(client, props);
    const isApiKeyProvider = await client._callApiKey();
    const apiKey = client.apiKey;
    if (!apiKey) {
      throw new Error('Azure OpenAI Realtime requires an API key');
    }
    return new OpenAIRealtimeWS(
      {
        ...connection,
        options: {
          ...props.options,
          headers: {
            ...props.options?.headers,
            ...(isApiKeyProvider ? {} : { 'api-key': apiKey }),
          },
        },
        __resolvedApiKey: isApiKeyProvider,
      },
      client,
    );
  }

  /**
   * Serializes and sends a Realtime client event after the WebSocket has opened.
   * Serialization and transport failures are delivered to the SDK `error` event.
   */
  send(event: RealtimeClientEvent): void {
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      this._onError(null, 'could not send data', err);
    }
  }

  /**
   * Closes the WebSocket with status code `1000` and reason `OK` by default.
   * Connection-closing failures are delivered to the SDK `error` event.
   */
  close(props?: {
    /** WebSocket close status code; defaults to `1000`. */
    code: number;

    /** WebSocket close reason; defaults to `OK`. */
    reason: string;
  }): void {
    try {
      this.socket.close(props?.code ?? 1000, props?.reason ?? 'OK');
    } catch (err) {
      this._onError(null, 'could not close the connection', err);
    }
  }
}
