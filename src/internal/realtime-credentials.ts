import type { OpenAI } from '../client';
import { assertValidBedrockBearerCredential, brand_privateBedrockClient } from './bedrock';

type CaptureAPIKey = (apiKey: string | null) => void;
interface DeferredAPIKeyCache {
  client: Pick<OpenAI, 'apiKey'>;
  providerKey?: string;
  commit: () => string | null;
}
const deferredCaches = new WeakMap<CaptureAPIKey, DeferredAPIKeyCache>();
// This exists only during synchronous _callApiKey entry, never across a provider or hook await.
let activeCache: DeferredAPIKeyCache | undefined;

/** Reserves a deferred commit when the base hook is entered for this invocation. @internal */
export function getDeferredRealtimeAPIKeyCache(
  client: Pick<OpenAI, 'apiKey'>,
  capture?: CaptureAPIKey,
): DeferredAPIKeyCache | undefined {
  const deferred = capture ? deferredCaches.get(capture) : undefined;
  if (deferred?.client === client) {
    return deferred;
  }
  return activeCache?.client === client ? activeCache : undefined;
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
  client: Pick<OpenAI, 'apiKey' | '_callApiKey'>,
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
  if (deferCache) {
    deferredCaches.set(capture, current);
  }
  try {
    const previous = activeCache;
    let pending: Promise<boolean>;
    activeCache = deferCache ? current : undefined;
    try {
      pending = client._callApiKey(capture);
    } finally {
      activeCache = previous;
    }
    const isProvider = await pending;
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
  } finally {
    deferredCaches.delete(capture);
  }
}
