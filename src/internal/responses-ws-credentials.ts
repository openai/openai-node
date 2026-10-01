import { OpenAIError } from '../core/error';
import type { OpenAI } from '../client';
import { resolveRealtimeAPIKey } from './realtime-credentials';
import {
  buildWebSocketOptions,
  mergeWebSocketAuthHeaders,
  snapshotWebSocketCredentials,
  WEBSOCKET_METADATA_HEADERS,
} from './ws';
import type { CredentialedWebSocketOptions } from './ws';

/**
 * Record reads of the initially supplied bearer before transport hooks can transform its bytes.
 * An override that assigns its own credential without reading the bearer remains caller-owned.
 */
function trackWebSocketAPIKeyUse(headers: Record<string, string>, onUse: () => void): void {
  const authorization = headers['Authorization'];
  if (!authorization) {
    return;
  }
  Object.defineProperty(headers, 'Authorization', {
    configurable: true,
    enumerable: true,
    get: () => {
      onUse();
      return authorization;
    },
    set: (value: string) => {
      Object.defineProperty(headers, 'Authorization', {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    },
  });
}

/**
 * Keep caller credential admission distinct from the hook's final provider-key transform.
 * The latter reuses captured base headers so no caller getters are reread after the refresh.
 */
function buildResponsesWebSocketOptions<Options extends CredentialedWebSocketOptions>(
  client: OpenAI,
  authHeaders: Record<string, string>,
  options: Options | null | undefined,
  prepared?: {
    options: ReturnType<typeof buildWebSocketOptions>;
    removedHeaders: Set<string>;
    apiKey?: string | null | undefined;
  },
) {
  if (prepared) {
    return prepared.apiKey === undefined
      ? mergeWebSocketAuthHeaders(prepared.options, authHeaders, prepared.removedHeaders)
      : buildWebSocketOptions(client, authHeaders, prepared.options, prepared.removedHeaders, true);
  }
  if (!client._hasApiKeyProvider()) {
    return buildWebSocketOptions(client, authHeaders, options);
  }
  const removedHeaders = new Set<string>();
  const provided = buildWebSocketOptions(client, {}, options, removedHeaders);
  return snapshotWebSocketCredentials(provided, WEBSOCKET_METADATA_HEADERS)
    ? provided
    : buildWebSocketOptions(client, authHeaders, provided, removedHeaders, true);
}

/**
 * Classify reconnect credentials without treating the previous SDK key as a caller override.
 * Capture routing and caller options before any asynchronous key refresh.
 */
function prepareResponsesWebSocketReconnect<Options extends CredentialedWebSocketOptions>(
  client: OpenAI,
  socketOptions: Options | null | undefined,
  initialAuthUsedAPIKey: boolean,
) {
  const removedHeaders = new Set<string>();
  const options = buildWebSocketOptions(client, {}, socketOptions, removedHeaders);
  let authentication: 'provided' | 'cached' | 'refresh';
  if (snapshotWebSocketCredentials(options, WEBSOCKET_METADATA_HEADERS)) {
    authentication = 'provided';
  } else if (
    removedHeaders.has('authorization') ||
    options.headers?.['authorization'] !== undefined ||
    !initialAuthUsedAPIKey
  ) {
    authentication = 'cached';
  } else {
    authentication = 'refresh';
  }
  return { options, removedHeaders, authentication };
}

/** Per-connection Responses credential state shared by the stable and beta Node transports. */
export class ResponsesWebSocketCredentials {
  private initialAuthUsedAPIKey = false;
  private prepared:
    | {
        options: ReturnType<typeof buildWebSocketOptions>;
        removedHeaders: Set<string>;
        apiKey?: string | null | undefined;
      }
    | undefined;

  get preparedAPIKey(): string | null | undefined {
    return this.prepared?.apiKey;
  }

  trackInitialHeaders(client: OpenAI, headers: Record<string, string>, hasSocket: () => boolean): void {
    if (!hasSocket() && client._hasApiKeyProvider()) {
      trackWebSocketAPIKeyUse(headers, () => {
        if (!hasSocket()) {
          this.initialAuthUsedAPIKey = true;
        }
      });
    }
  }

  build<Options extends CredentialedWebSocketOptions>(
    client: OpenAI,
    authHeaders: Record<string, string>,
    options: Options | null | undefined,
  ) {
    const capturedAuthHeaders = { ...authHeaders };
    const socketOptions = buildResponsesWebSocketOptions(client, capturedAuthHeaders, options, this.prepared);
    if (
      client._hasApiKeyProvider() &&
      !capturedAuthHeaders['Authorization'] &&
      !snapshotWebSocketCredentials(socketOptions, WEBSOCKET_METADATA_HEADERS)
    ) {
      throw new OpenAIError(
        'Cannot open a Responses WebSocket with an unresolved function-based apiKey. Resolve it before constructing the WebSocket or provide explicit WebSocket credentials.',
      );
    }
    return socketOptions;
  }

  async prepare<Socket, Options extends CredentialedWebSocketOptions>(
    client: OpenAI,
    socketOptions: Options | null | undefined,
    authHeaders: (apiKey?: string | null) => Record<string, string>,
    createSocket: (url: URL, headers: Record<string, string>) => Socket,
  ): Promise<(url: URL) => Socket> {
    const { options, removedHeaders, authentication } = prepareResponsesWebSocketReconnect(
      client,
      socketOptions,
      this.initialAuthUsedAPIKey,
    );
    const createPreparedSocket = (url: URL, headers: Record<string, string>, apiKey?: string | null) => {
      const previous = this.prepared;
      this.prepared = { options, removedHeaders, apiKey };
      try {
        // Resolve headers inside the scope so legacy zero-argument overrides see this attempt's key.
        return createSocket(url, apiKey === undefined ? headers : authHeaders(apiKey));
      } finally {
        this.prepared = previous;
      }
    };
    if (authentication !== 'refresh') {
      const headers = authentication === 'provided' ? {} : authHeaders();
      return (url) => createPreparedSocket(url, headers);
    }
    const { commit } = await resolveRealtimeAPIKey(client, true);
    return (url) => createPreparedSocket(url, {}, commit());
  }
}
