import type { OpenAI } from '../client';

/** Selects a captured credential without treating an explicit null as absent. @internal */
export function getRealtimeAPIKey(
  client: Pick<OpenAI, 'apiKey'> | undefined,
  captured: string | null | undefined,
): string | null | undefined {
  return captured === undefined ? client?.apiKey : captured;
}

/**
 * Captures the key belonging to this factory invocation while retaining the
 * existing boolean credential-hook contract. Legacy overrides that do not
 * capture a key keep their shared-property behavior and remain responsible for
 * synchronizing concurrent credential updates.
 * @internal
 */
export async function resolveRealtimeAPIKey(client: Pick<OpenAI, 'apiKey' | '_callApiKey'>): Promise<{
  apiKey: string | null;
  isProvider: boolean;
}> {
  let apiKey: string | null | undefined;
  const isProvider = await client._callApiKey((resolved) => {
    apiKey = resolved;
  });
  return { apiKey: apiKey === undefined ? client.apiKey : apiKey, isProvider };
}
