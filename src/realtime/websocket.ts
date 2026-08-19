import type { AzureOpenAI } from '../index';
import { assertBedrockWebSocketOrigin } from '../internal/bedrock';
import { OpenAI } from '../index';
import { OpenAIError } from '../error';
import type { RealtimeClientEvent } from '../resources/realtime/realtime';
import {
  OpenAIRealtimeEmitter,
  buildRealtimeURL,
  getAzureRealtimeConnection,
  isAzure,
  parseRealtimeEvent,
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

type RuntimeScope = typeof globalThis & {
  process?: { versions?: { node?: string } };
  WorkerGlobalScope?: typeof Object;
  WorkerNavigator?: typeof Object;
  Deno?: { version?: { deno?: string } };
  Bun?: { version?: string };
  EdgeRuntime?: unknown;
  WebSocketPair?: unknown;
};

/** Identifies browser pages and workers without blocking trusted server runtimes. */
function isRunningInBrowserOrBrowserWorker(): boolean {
  if (isRunningInBrowser()) {
    return true;
  }

  const scope = globalThis as RuntimeScope;
  return (
    typeof scope.WorkerGlobalScope === 'function' &&
    scope instanceof scope.WorkerGlobalScope &&
    typeof scope.WorkerNavigator === 'function' &&
    scope.navigator instanceof scope.WorkerNavigator &&
    typeof scope.navigator?.userAgent === 'string' &&
    scope.navigator.userAgent !== 'Cloudflare-Workers' &&
    scope.process?.versions?.node === undefined &&
    scope.Deno === undefined &&
    scope.Bun === undefined &&
    scope.EdgeRuntime === undefined &&
    scope.WebSocketPair === undefined
  );
}

/** Reports whether the runtime supports request headers in native WebSocket options. */
function supportsWebSocketRequestHeaders(): boolean {
  const scope = globalThis as RuntimeScope;
  if (
    isRunningInBrowserOrBrowserWorker() ||
    scope.EdgeRuntime !== undefined ||
    scope.WebSocketPair !== undefined ||
    scope.navigator?.userAgent === 'Cloudflare-Workers'
  ) {
    return false;
  }

  if (scope.Deno !== undefined) {
    const [major, minor] = (scope.Deno.version?.deno ?? '').split('.').map(Number);
    return major !== undefined && minor !== undefined && (major > 2 || (major === 2 && minor >= 5));
  }

  if (typeof scope.Bun?.version === 'string') {
    return true;
  }

  return (
    Object.prototype.toString.call(scope.process) === '[object process]' &&
    typeof scope.process?.versions?.node === 'string'
  );
}

/** Removes Azure credentials while preserving the existing public URL redaction contract. */
function redactAzureCredentials(url: URL, isBearerToken: boolean): void {
  let hasApiKey = !isBearerToken;
  let hasAuthorization = isBearerToken;
  const parameterNames = [...url.searchParams.keys()];

  for (const name of parameterNames) {
    if (name.toLowerCase() === 'api-key') {
      hasApiKey = true;
      url.searchParams.delete(name);
    } else if (name.toLowerCase() === 'authorization') {
      hasAuthorization = true;
      url.searchParams.delete(name);
    }
  }

  if (hasApiKey) {
    url.searchParams.set('api-key', '<REDACTED>');
  }
  if (hasAuthorization) {
    url.searchParams.set('Authorization', '<REDACTED>');
  }
}

/** Opens an Azure native socket with header authentication and a credential-free URL. */
function createAzureWebSocket(
  url: URL,
  apiKey: string | null,
  isBearerToken: boolean,
  protocols: string[],
): _WebSocket {
  if (!supportsWebSocketRequestHeaders()) {
    throw new OpenAIError(
      'Azure OpenAI Realtime credentials require a WebSocket transport that supports request headers; use openai/realtime/ws or a server-side authentication proxy.',
    );
  }
  if (!apiKey) {
    throw new Error('Azure OpenAI Realtime requires an API key');
  }

  redactAzureCredentials(url, isBearerToken);
  const socketURL = new URL(url);
  socketURL.searchParams.delete('api-key');
  socketURL.searchParams.delete('Authorization');
  const headers = isBearerToken ? { Authorization: `Bearer ${apiKey}` } : { 'api-key': apiKey };

  // @ts-ignore
  return new WebSocket(socketURL.toString(), { protocols, headers });
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
    if (!dangerouslyAllowBrowser && isRunningInBrowserOrBrowserWorker()) {
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
    if (this.url.protocol !== 'wss:') {
      throw new OpenAIError('Realtime WebSocket URLs must use the wss: protocol.');
    }
    assertBedrockWebSocketOrigin(client, this.url);

    const azure = isAzure(client);
    const protocols = ['realtime', ...(azure ? [] : [`openai-insecure-api-key.${client.apiKey}`])];

    this.socket = azure
      ? createAzureWebSocket(this.url, client.apiKey, props.__resolvedApiKey === true, protocols)
      : new WebSocket(this.url.toString(), protocols);

    this.socket.addEventListener('message', (websocketEvent: MessageEvent) => {
      const event = (() => {
        try {
          const parsedEvent = parseRealtimeEvent(websocketEvent.data.toString());

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

    this.socket.addEventListener('error', (event: any) => {
      this._onError(null, event.message, null);
    });
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
   * Azure credentials are sent in WebSocket handshake headers and never appear
   * in the native socket URL. Browser WebSockets cannot set these headers;
   * use a server-side authentication proxy or the Node.js `ws` transport.
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
    const { dangerouslyAllowBrowser } = options;
    return new OpenAIRealtimeWebSocket(
      {
        ...connection,
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
