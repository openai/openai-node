import * as WS from 'ws';
import { assertBedrockWebSocketOrigin } from '../../internal/bedrock';
import { protectWebSocketOptionsFromCredentialRedirects } from '../../internal/ws';
import type { AzureOpenAI } from '../../index';
import { OpenAI } from '../../index';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../../resources/beta/realtime/realtime';
import { OpenAIRealtimeEmitter, buildRealtimeURL, isAzure } from './internal-base';
import type { RealtimeConnectionConfig } from './internal-base';

/**
 * Connects to the beta Realtime API using the Node.js `ws` WebSocket implementation.
 *
 * Install the optional `ws` peer dependency before importing this entrypoint.
 * Register an SDK `error` listener and wait for `socket`'s `open` event before
 * sending client events. Use the stable Realtime helper for Azure sideband calls.
 */
function resolveRealtimeURL(
  client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  props: RealtimeConnectionConfig & { __url?: URL | undefined },
): URL {
  return props.__url ?? buildRealtimeURL(client, props);
}

export class OpenAIRealtimeWS extends OpenAIRealtimeEmitter {
  /** Secure beta Realtime WebSocket URL, including the model or non-Azure call ID. */
  url: URL;

  /** Underlying `ws.WebSocket` instance for connection lifecycle and transport events. */
  socket: WS.WebSocket;

  /**
   * Immediately opens a beta Realtime model session or attaches to an existing non-Azure call.
   *
   * Clients with function-based credentials must use
   * {@link OpenAIRealtimeWS.create}; Azure deployment sessions should use
   * {@link OpenAIRealtimeWS.azure}.
   *
   * @param props Exactly one of `model` or `callID`, plus optional `ws` client settings.
   * @param client Existing client whose endpoint and API key should be reused.
   */
  constructor(
    props: RealtimeConnectionConfig & {
      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;

      /** Indicates that a function-based credential was resolved by an async factory. @internal */
      __resolvedApiKey?: boolean;

      /** Final URL validated before an asynchronous credential provider ran. @internal */
      __url?: URL;
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
    this.url = resolveRealtimeURL(client, props);
    assertBedrockWebSocketOrigin(client, this.url);
    const headers = {
      ...props.options?.headers,
      ...(isAzure(client) && !props.__resolvedApiKey ? {} : { Authorization: `Bearer ${client.apiKey}` }),
      'OpenAI-Beta': 'realtime=v1',
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
          return JSON.parse(wsEvent.toString()) as RealtimeServerEvent;
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
   * Resolves a client's current API credential before opening a beta Realtime connection.
   *
   * Use this factory instead of the constructor when the client's `apiKey` is a function.
   *
   * @param client OpenAI client that owns the endpoint and refreshable or static credential.
   * @param props Exactly one of `model` or `callID`, plus optional `ws` client settings.
   */
  static async create(
    client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_callApiKey'>,
    props: RealtimeConnectionConfig & {
      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;
    },
  ): Promise<OpenAIRealtimeWS> {
    const url = buildRealtimeURL(client, props);
    assertBedrockWebSocketOrigin(client, url);
    const resolvedApiKey = await client._callApiKey();
    return new OpenAIRealtimeWS({ ...props, __resolvedApiKey: resolvedApiKey, __url: url }, client);
  }

  /**
   * Opens a beta Azure OpenAI Realtime session for the selected model deployment.
   *
   * Static Azure API keys are sent in the `api-key` header; function-based
   * credentials are resolved first and sent as bearer credentials. Use the
   * stable Realtime helper when attaching to an existing Azure call.
   *
   * @param client Azure OpenAI client that supplies the endpoint and credential.
   * @param props Optional deployment override and `ws` connection settings.
   * @throws {Error} If the Azure credential or required deployment is unavailable.
   */
  static async azure(
    client: Pick<AzureOpenAI, '_callApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>,
    props: {
      /** Azure model deployment; defaults to the deployment configured on the client. */
      deploymentName?: string;

      /** Options passed directly to the underlying `ws.WebSocket` constructor. */
      options?: WS.ClientOptions | undefined;
    } = {},
  ): Promise<OpenAIRealtimeWS> {
    const isApiKeyProvider = await client._callApiKey();
    const apiKey = client.apiKey;
    if (!apiKey) {
      throw new Error('Azure OpenAI Realtime requires an API key');
    }
    const deploymentName = props.deploymentName ?? client.deploymentName;
    if (!deploymentName) {
      throw new Error('No deployment name provided');
    }
    return new OpenAIRealtimeWS(
      {
        model: deploymentName,
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
   * Serializes and sends a beta Realtime client event after the WebSocket has opened.
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
