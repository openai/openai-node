import type { AzureOpenAI } from '../index';
import { assertBedrockWebSocketOrigin } from '../internal/bedrock';
import { OpenAI } from '../index';
import { OpenAIError } from '../error';
import type { RealtimeClientEvent, RealtimeServerEvent } from '../resources/realtime/realtime';
import {
  OpenAIRealtimeEmitter,
  buildRealtimeURL,
  getAzureRealtimeConnection,
  isAzure,
} from './internal-base';
import type { AzureRealtimeConnectionConfig, RealtimeConnectionConfig } from './internal-base';
import { isRunningInBrowser } from '../internal/detect-platform';

interface MessageEvent {
  data: string;
}

/** Native WebSocket instance supplied by the current JavaScript runtime. */
type _WebSocket = typeof globalThis extends {
  /** Runtime-provided WebSocket constructor used for native Realtime connections. */
  WebSocket: infer ws extends abstract new (...args: any) => any;
}
  ? // @ts-ignore
    InstanceType<ws>
  : any;

/** Removes Azure credential query values from the publicly exposed connection URL. */
function redactAzureCredentials(url: URL): void {
  const hasAuthorization = url.searchParams.has('Authorization');
  if (url.searchParams.has('api-key') || !hasAuthorization) {
    url.searchParams.set('api-key', '<REDACTED>');
  }
  if (hasAuthorization) {
    url.searchParams.set('Authorization', '<REDACTED>');
  }
}

/**
 * Connects to the Realtime API using the runtime's native `WebSocket` implementation.
 *
 * Browser use is blocked by default to prevent secret API-key exposure. Use an
 * ephemeral Realtime credential in browser clients; set
 * `dangerouslyAllowBrowser` only after independently securing the credential.
 * Register an SDK `error` listener and wait for `socket`'s `open` event before
 * sending Realtime client events.
 */
export class OpenAIRealtimeWebSocket extends OpenAIRealtimeEmitter {
  /** Secure Realtime WebSocket URL; Azure authentication query parameters are redacted. */
  url: URL;

  /** Underlying runtime-native WebSocket instance for connection lifecycle events. */
  socket: _WebSocket;

  /**
   * Immediately opens a native WebSocket session or attaches to an existing call.
   *
   * Clients with function-based credentials must use
   * {@link OpenAIRealtimeWebSocket.create}; Azure clients should use
   * {@link OpenAIRealtimeWebSocket.azure}. An ephemeral credential whose value
   * starts with `ek_` is permitted in browser runtimes automatically.
   *
   * @param props Exactly one model, transcription intent, or call ID, plus browser-safety settings.
   * @param client Existing client whose endpoint and API key should be reused.
   * @throws {OpenAIError} If browser access would expose an unapproved credential.
   */
  constructor(
    props: RealtimeConnectionConfig & {
      /** Allows browser execution; use only when the credential cannot expose a secret API key. */
      dangerouslyAllowBrowser?: boolean;

      /**
       * Callback to mutate the URL, needed for Azure.
       * @internal
       */
      onURL?: (url: URL) => void;
      /** Indicates the token was resolved by the factory just before connecting. @internal */
      __resolvedApiKey?: boolean;
    },
    client?: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  ) {
    super();
    const hasProvider = typeof (client as any)?._options?.apiKey === 'function';
    const dangerouslyAllowBrowser =
      props.dangerouslyAllowBrowser ??
      (client as any)?._options?.dangerouslyAllowBrowser ??
      (client?.apiKey?.startsWith('ek_') ? true : null);
    if (!dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\n\nYou can avoid this error by creating an ephemeral session token:\nhttps://platform.openai.com/docs/api-reference/realtime-sessions\n",
      );
    }

    client ??= new OpenAI({ dangerouslyAllowBrowser });

    if (hasProvider && !props?.__resolvedApiKey) {
      throw new Error(
        [
          'Cannot open Realtime WebSocket with a function-based apiKey.',
          'Use the .create() method so that the key is resolved before connecting.',
        ].join('\n'),
      );
    }

    this.url = buildRealtimeURL(client, props);
    props.onURL?.(this.url);
    assertBedrockWebSocketOrigin(client, this.url);

    // @ts-ignore
    this.socket = new WebSocket(this.url.toString(), [
      'realtime',
      ...(isAzure(client) ? [] : [`openai-insecure-api-key.${client.apiKey}`]),
    ]);

    this.socket.addEventListener('message', (websocketEvent: MessageEvent) => {
      const event = (() => {
        try {
          return JSON.parse(websocketEvent.data.toString()) as RealtimeServerEvent;
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

    this.socket.addEventListener('error', (event: any) => {
      this._onError(null, event.message, null);
    });

    if (isAzure(client)) {
      redactAzureCredentials(this.url);
    }
  }

  /**
   * Resolves a client's current API credential before opening a native Realtime WebSocket.
   *
   * Use this factory instead of the constructor when the client's `apiKey` is a function.
   *
   * @param client OpenAI client that owns the endpoint and refreshable or static credential.
   * @param props Exactly one model, transcription intent, or call ID, plus browser-safety settings.
   */
  static async create(
    client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_callApiKey'>,
    props: RealtimeConnectionConfig & {
      /** Allows browser execution after the caller has secured the supplied credential. */
      dangerouslyAllowBrowser?: boolean;
    },
  ): Promise<OpenAIRealtimeWebSocket> {
    const resolvedApiKey = await client._callApiKey();
    const url = buildRealtimeURL(client, props);
    assertBedrockWebSocketOrigin(client, url);
    return new OpenAIRealtimeWebSocket(
      {
        ...props,
        buildRealtimeURL: () => url,
        __resolvedApiKey: resolvedApiKey,
      },
      client,
    );
  }

  /**
   * Opens a native Azure deployment or transcription session, or an existing sideband call.
   *
   * Azure credentials are included only in the initial connection URL and are
   * redacted from the exposed `url` property immediately after connection setup.
   *
   * @param client Azure OpenAI client that supplies the endpoint and credential.
   * @param options Deployment, transcription intent, or call ID, plus browser-safety settings.
   * @throws {Error} If the Azure credential or required deployment is unavailable.
   */
  static async azure(
    client: Pick<AzureOpenAI, '_callApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>,
    options: AzureRealtimeConnectionConfig & {
      /** Allows browser execution after the caller has secured the supplied Azure credential. */
      dangerouslyAllowBrowser?: boolean;
    } = {},
  ): Promise<OpenAIRealtimeWebSocket> {
    const connection = getAzureRealtimeConnection(client, options);
    const isApiKeyProvider = await client._callApiKey();
    const apiKey = client.apiKey;
    if (!apiKey) {
      throw new Error('Azure OpenAI Realtime requires an API key');
    }
    const azureApiKey = apiKey;
    function onURL(url: URL) {
      if (isApiKeyProvider) {
        url.searchParams.set('Authorization', `Bearer ${azureApiKey}`);
      } else {
        url.searchParams.set('api-key', azureApiKey);
      }
    }
    const { dangerouslyAllowBrowser } = options;
    return new OpenAIRealtimeWebSocket(
      {
        ...connection,
        onURL,
        ...(dangerouslyAllowBrowser === undefined ? {} : { dangerouslyAllowBrowser }),
        __resolvedApiKey: isApiKeyProvider,
      },
      client,
    );
  }

  /**
   * Serializes and sends a Realtime client event after the native WebSocket has opened.
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
