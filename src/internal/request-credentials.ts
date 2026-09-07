import type { OpenAI } from '../client';

/**
 * One HTTP attempt's resolved credentials, kept separate from caller
 * options and request metadata. Preparation overrides forward this context to
 * capture per-attempt credentials; legacy preparation overrides that omit it
 * retain their shared `client.apiKey` behavior. Later construction and
 * authentication hooks can recover the context from original options identifying
 * one active build. Copies and concurrent options reuse require explicit forwarding.
 * After forwarding preparation, set `apiKey` on this context to replace the
 * current attempt's function credential; changing `client.apiKey` only updates
 * the shared client property and cannot identify the attempt that changed it.
 * @internal
 */
export interface RequestCredentialContext {
  /** The current attempt's credential, or undefined to use the shared client key. */
  apiKey?: string | null;
}

/** Associates original options with one active build without modifying caller-owned objects. @internal */
export class RequestCredentialContexts {
  private readonly contexts = new WeakMap<object, Set<RequestCredentialContext>>();

  register(options: object, context: RequestCredentialContext): () => void {
    const contexts = this.contexts.get(options) ?? new Set<RequestCredentialContext>();
    contexts.add(context);
    this.contexts.set(options, contexts);
    return () => {
      if (!contexts.delete(context)) {
        return;
      }
      if (contexts.size === 0) {
        this.contexts.delete(options);
      }
    };
  }

  get(options: object): RequestCredentialContext | undefined {
    const contexts = this.contexts.get(options);
    return contexts?.size === 1 ? contexts.values().next().value : undefined;
  }
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
