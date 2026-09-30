import type { OpenAI } from '../client';
import { assertValidBedrockBearerCredential, brand_privateBedrockClient } from './bedrock';

type CaptureAPIKey = (apiKey: string | null) => void;
const deferredAPIKeyCaches = new WeakMap<CaptureAPIKey, (commit: () => string | null) => void>();

/** Defers only a Realtime invocation that will not use its result until it opens a socket. @internal */
export function deferRealtimeAPIKeyCache(capture: CaptureAPIKey, commit: () => string | null): boolean {
  const defer = deferredAPIKeyCaches.get(capture);
  if (!defer) {
    return false;
  }
  defer(commit);
  return true;
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
  const capture: CaptureAPIKey = (resolved) => {
    apiKey = resolved;
  };
  let commit = () => (apiKey === undefined ? client.apiKey : apiKey);
  if (deferCache) {
    deferredAPIKeyCaches.set(capture, (resolvedCommit) => (commit = resolvedCommit));
  }
  try {
    const isProvider = await client._callApiKey(capture);
    return {
      apiKey: apiKey === undefined ? client.apiKey : apiKey,
      isProvider,
      commit: () => validateCapturedAPIKey(client, commit()),
    };
  } finally {
    deferredAPIKeyCaches.delete(capture);
  }
}
