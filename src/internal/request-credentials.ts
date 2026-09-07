import type { OpenAI } from '../client';

/**
 * One HTTP attempt's resolved credentials, kept separate from caller
 * options and request metadata. Overrides of preparation and authentication
 * hooks must forward this context to preserve per-attempt credentials. Legacy
 * overrides that omit it retain their shared `client.apiKey` behavior.
 * To transform a captured provider credential in a forwarding hook, update
 * `context.apiKey`; assigning `client.apiKey` only updates shared client state.
 * @internal
 */
export interface RequestCredentialContext {
  apiKey?: string | null;
  /** Subject-token authorization resolved for this HTTP attempt. @internal */
  workloadAuthorization?: string;
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
