import { createRealtimeRecovery, validateRealtimeRecovery } from '../internal/realtime-recovery';
import { NodeWebSocket, snapshotNodeWebSocketOptions } from '../internal/ws-adapter-node';
import type { WebSocketConnection } from '../internal/ws-connection-controller';
import type { UnsentMessage } from '../internal/ws';
import { resolveRealtimeAPIKey } from '../internal/realtime-credentials';
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
  private _recovery?: WebSocketConnection<NodeWebSocket, RealtimeClientEvent, never, Error>;

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
      /**
       * Options for the underlying `ws.WebSocket` constructor.
       * Incoming messages have no size limit by default. Set `maxPayload` to a byte limit to cap them.
       * Compression is off by default, including when `maxPayload` is finite.
       * Set `perMessageDeflate` to `true` or a `ws` configuration object to opt in.
       */
      options?: WS.ClientOptions | undefined;

      /** Indicates that a function-based credential was resolved by an async factory. @internal */
      __resolvedApiKey?: boolean;
      /** Credential captured by an async factory for this connection. @internal */
      __apiKey?: string | null;
    },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();
    validateRealtimeRecovery(props);
    if (props.reconnect && !props.model) {
      throw new Error('Automatic Realtime recovery requires a model session');
    }
    const connectionClient = client ?? new OpenAI();
    const apiKey = props.__apiKey === undefined ? connectionClient.apiKey : props.__apiKey;
    // SAFETY: The supplied OpenAI client owns _options; this read detects its existing API-key provider without changing its public surface.
    const hasProvider = typeof (connectionClient as any)?._options?.apiKey === 'function';
    if (hasProvider && !props.__resolvedApiKey) {
      throw new Error(
        [
          'Cannot open Realtime WebSocket with a function-based apiKey.',
          'Use the .create() method so that the key is resolved before connecting.',
        ].join('\n'),
      );
    }
    const terminalErrors = new WeakMap<WS.WebSocket, Error>();
    const open = (
      attemptKey: string | null,
      resolvedApiKey: boolean,
      capturedURL?: URL,
      options: typeof props.options | ReturnType<typeof snapshotNodeWebSocketOptions> = props.options,
    ) => {
      const url = capturedURL ?? buildRealtimeURL(connectionClient, props);
      validateRealtimeRecovery(props, url);
      assertBedrockWebSocketOrigin(connectionClient, url);
      if (isAzure(connectionClient) && props.__apiKey !== undefined && !attemptKey) {
        throw new Error('Azure OpenAI Realtime requires an API key');
      }
      const azureKey = isAzure(connectionClient) && !resolvedApiKey;
      const headers = {
        'User-Agent': `${connectionClient.constructor.name}/JS ${VERSION}`,
        ...options?.headers,
        // Credentials remain own data properties without invoking inherited setters.
        ...(azureKey && props.__apiKey !== undefined ? { 'api-key': attemptKey ?? '' } : {}),
        ...(azureKey ? {} : { Authorization: `Bearer ${attemptKey}` }),
      };

      const { maxPayload, ...nativeOptions } = options ?? {};
      const socketOptions: WS.ClientOptions = {
        perMessageDeflate: false,
        ...nativeOptions,
        maxPayload: maxPayload ?? 0,
        headers,
      };
      socketOptions.perMessageDeflate ??= false;
      const socket = new WS.WebSocket(url, protectWebSocketOptionsFromCredentialRedirects(socketOptions));

      socket.on('message', (wsEvent) => {
        if (this._recovery && (socket !== this.socket || this._recovery.isClosed)) {
          return;
        }
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

          if (this._recovery?.isClosed) {
            return;
          }
          if (event.type === 'error') {
            this._onError(event);
          } else if (!this._recovery || !['close', 'reconnecting', 'reconnected'].includes(event.type)) {
            // @ts-expect-error TS cannot relate the event discriminant to the mapped callback type.
            this._emit(event.type, event);
          }
        }
      });

      if (props.reconnect) {
        socket.on('unexpected-response', (_request, response) => {
          if (![408, 429, 500, 502, 503, 504].includes(response.statusCode ?? 0)) {
            terminalErrors.set(
              socket,
              new Error(`Unexpected server response: ${response.statusCode ?? 'unknown'}`),
            );
          }
          response.resume();
          socket.terminate();
        });
      }
      socket.on('error', (err) => {
        if (this._recovery) {
          if (
            'code' in err &&
            typeof err.code === 'string' &&
            (err.code.startsWith('ERR_TLS_') ||
              err.code.startsWith('CERT_') ||
              [
                'DEPTH_ZERO_SELF_SIGNED_CERT',
                'SELF_SIGNED_CERT_IN_CHAIN',
                'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
              ].includes(err.code))
          ) {
            terminalErrors.set(socket, err);
          }
          return;
        }
        this._onError(null, err.message, err);
      });
      return { url, socket };
    };
    const initial = open(apiKey, props.__resolvedApiKey === true);
    this.url = initial.url;
    this.socket = initial.socket;
    if (props.reconnect) {
      this._recovery = createRealtimeRecovery<NodeWebSocket, RealtimeClientEvent>(this, props, {
        buildURL: () => buildRealtimeURL(connectionClient, props),
        adaptSocket: (socket) => new NodeWebSocket(socket),
        prepare: async () => {
          const { maxPayload, headers, ...nativeOptions } = props.options ?? {};
          const options = snapshotNodeWebSocketOptions({ ...nativeOptions, maxPayload, headers });
          // SAFETY: The branch checks _callApiKey before using the client's credential resolver.
          const credential =
            '_callApiKey' in connectionClient && typeof connectionClient._callApiKey === 'function'
              ? await resolveRealtimeAPIKey(connectionClient as Pick<OpenAI, 'apiKey' | '_callApiKey'>, true)
              : { isProvider: false, commit: () => connectionClient.apiKey };
          return (url) => open(credential.commit(), credential.isProvider, url, options).socket;
        },
        shouldReconnect: () => !terminalErrors.has(this.socket),
        onError: (message, cause) => {
          const terminal = terminalErrors.get(this.socket);
          this._onError(
            null,
            terminal && terminal.message !== message ? `${message}: ${terminal.message}` : message,
            terminal ?? cause,
          );
        },
        onReconnecting: (event) => this._emit('reconnecting', event),
        onReconnected: () => this._emit('reconnected'),
        onClose: (code, reason, unsent) => {
          terminalErrors.delete(this.socket);
          this._emit('close', code, reason, unsent);
        },
      });
    }
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
    const { apiKey, isProvider: resolvedApiKey } = await resolveRealtimeAPIKey(client);
    const buildURL = props.buildRealtimeURL;
    return new OpenAIRealtimeWS(
      {
        ...props,
        ...(buildURL
          ? { buildRealtimeURL: (connectionClient) => buildURL.call(props, connectionClient, props) }
          : {}),
        __resolvedApiKey: resolvedApiKey,
        __apiKey: apiKey,
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
    const { apiKey, isProvider: isApiKeyProvider } = await resolveRealtimeAPIKey(client);
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
            // A credential must be an own data property without invoking an inherited setter.
            ...(isApiKeyProvider ? {} : { 'api-key': apiKey }),
          },
        },
        __resolvedApiKey: isApiKeyProvider,
        __apiKey: apiKey,
      },
      client,
    );
  }

  /**
   * Serializes and sends a Realtime client event after the WebSocket has opened.
   * Serialization and transport failures are delivered to the SDK `error` event.
   */
  send(event: RealtimeClientEvent): void {
    if (this._recovery) {
      return this._recovery.send(event);
    }
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      this._onError(null, 'could not send data', err);
    }
  }

  /** Explicitly flush never-attempted events after restoring the replacement session. */
  flushPending(): void {
    this._recovery?.flushPending();
  }

  /** Remove retained events without transmitting them. */
  takePending(): UnsentMessage<RealtimeClientEvent>[] {
    return this._recovery?.takePending() ?? [];
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
    if (this._recovery) {
      return this._recovery.close(props);
    }
    try {
      this.socket.close(props?.code ?? 1000, props?.reason ?? 'OK');
    } catch (err) {
      this._onError(null, 'could not close the connection', err);
    }
  }
}
