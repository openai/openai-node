import type { OpenAI } from '../client';

/**
 * One HTTP attempt's resolved credentials, kept separate from caller
 * options and request metadata. Overrides of preparation and authentication
 * hooks must forward this context to preserve per-attempt credentials. Legacy
 * overrides that omit it retain their shared `client.apiKey` behavior.
 * After forwarding preparation, set `apiKey` on this context to replace the
 * current attempt's function credential; changing `client.apiKey` only updates
 * the shared client property and cannot identify the attempt that changed it.
 * @internal
 */
export interface RequestCredentialContext {
  /** The current attempt's credential, or undefined to use the shared client key. */
  apiKey?: string | null;
}

/** Resolves once per attempt while retaining the existing credential-hook contract. @internal */
export async function prepareRequestAPIKey(
  client: Pick<OpenAI, 'apiKey' | '_callApiKey'>,
  context?: RequestCredentialContext,
): Promise<void> {
  if (!context) {
    await client._callApiKey();
    return;
  }
  let apiKey: string | null | undefined;
  const isProvider = await client._callApiKey((resolved) => {
    apiKey = resolved;
  });
  if (isProvider) {
    context.apiKey = apiKey === undefined ? client.apiKey : apiKey;
  }
}
