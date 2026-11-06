import type { OpenAI } from '../client';
import { assertValidBedrockBearerCredential, brand_privateBedrockClient } from './bedrock';
import { buildWebSocketOptions } from './ws';

type CaptureAPIKey = (apiKey: string | null) => void;

/** Native Realtime accepts routing metadata through these two server-supported subprotocols. */
export function realtimeRoutingProtocols(
  client: Pick<OpenAI, 'apiKey' | 'baseURL'>,
  apiKey: string | null,
): string[] {
  const protocols = [];
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Structural partial clients may omit the callable header hook; check it before using the client's header contract.
  if ('_buildWebSocketHeaders' in client && typeof client._buildWebSocketHeaders === 'function') {
    // SAFETY: The checked client hook owns header precedence; no other OpenAI members are used.
    const { headers } = buildWebSocketOptions(client as OpenAI, { Authorization: `Bearer ${apiKey}` }, null);
    for (const field of ['organization', 'project']) {
      const value = headers[`openai-${field}`];
      if (value !== undefined) {
        protocols.push(`openai-${field}.${value}`);
      }
    }
    return protocols;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Realtime accepts structural partial clients; optional routing fields enter from that untyped client boundary.
  if ('organization' in client && typeof client.organization === 'string') {
    protocols.push(`openai-organization.${client.organization}`);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only the supported string field can be emitted to the native protocol boundary.
  if ('project' in client && typeof client.project === 'string') {
    protocols.push(`openai-project.${client.project}`);
  }
  return protocols;
}
export interface DeferredAPIKeyCache {
  client: Pick<OpenAI, 'apiKey'>;
  providerKey?: string;
  commit: () => string | null;
}
interface RealtimeAPIKeyCacheContext {
  run: <T>(cache: DeferredAPIKeyCache | undefined, operation: () => T) => T;
  getStore: () => DeferredAPIKeyCache | undefined;
}
// Only the key crosses module formats: the context belongs to each participating client.
const realtimeCacheContext = Symbol.for('openai.realtimeAPIKeyCacheContext');
type CredentialClient = Pick<OpenAI, 'apiKey'> & {
  [realtimeCacheContext]?: RealtimeAPIKeyCacheContext;
};
let cacheContext: RealtimeAPIKeyCacheContext | undefined;

/** Installs the Node transport's invocation context without loading Node in the base client. @internal */
export function setRealtimeAPIKeyCacheContext(context: RealtimeAPIKeyCacheContext): void {
  cacheContext = context;
}

/** Reserves a deferred commit when the base hook is entered for this invocation. @internal */
export function getDeferredRealtimeAPIKeyCache(client: CredentialClient): DeferredAPIKeyCache | undefined {
  const deferred = client[realtimeCacheContext]?.getStore();
  return deferred?.client === client ? deferred : undefined;
}

/** Applies the Bedrock getter's validation when a captured credential does not enter the cache. @internal */
export function validateCapturedAPIKey(
  client: Pick<OpenAI, 'apiKey'>,
  credential: string | null,
): string | null {
  if (credential !== null && brand_privateBedrockClient in client) {
    assertValidBedrockBearerCredential(credential);
  }
  return credential;
}

/** Selects a captured credential without treating an explicit null as absent. @internal */
export function getRealtimeAPIKey(
  client: Pick<OpenAI, 'apiKey'> | undefined,
  captured: string | null | undefined,
): string | null | undefined {
  return captured === undefined ? client?.apiKey : captured;
}

/**
 * Captures the key belonging to this request or factory invocation while retaining the
 * existing boolean credential-hook contract. Legacy overrides that do not
 * capture a key keep their shared-property behavior and remain responsible for
 * synchronizing concurrent credential updates.
 * @internal
 */
export async function resolveRealtimeAPIKey(
  client: CredentialClient & Pick<OpenAI, '_callApiKey'>,
  deferCache = false,
): Promise<{
  apiKey: string | null;
  isProvider: boolean;
  commit: () => string | null;
}> {
  let apiKey: string | null | undefined;
  const current: DeferredAPIKeyCache = {
    client,
    commit: () => (apiKey === undefined ? client.apiKey : apiKey),
  };
  const capture: CaptureAPIKey = (resolved) => {
    apiKey = resolved;
  };
  const invoke = () => client._callApiKey(capture);
  const context = client[realtimeCacheContext] ?? cacheContext;
  if (deferCache && context && !client[realtimeCacheContext]) {
    Object.defineProperty(client, realtimeCacheContext, { value: context });
  }
  // An HTTP or ordinary Realtime request nested inside a WebSocket hook owns its own cache writes.
  const isProvider = await (context ? context.run(deferCache ? current : undefined, invoke) : invoke());
  return {
    apiKey: apiKey === undefined ? client.apiKey : apiKey,
    isProvider,
    commit: () => {
      const hookKey =
        current.providerKey !== undefined && apiKey !== undefined && apiKey !== current.providerKey
          ? validateCapturedAPIKey(client, apiKey)
          : undefined;
      const cached = current.commit();
      return hookKey === undefined ? validateCapturedAPIKey(client, cached) : hookKey;
    },
  };
}
