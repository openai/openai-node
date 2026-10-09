import type { WritableStream } from '../../../internal/shim-types';
import { agentItems } from './pages';
import { OpenAIError } from '../../../core/error';
import type { RequestOptions } from '../../../internal/request-options';
import type { Artifacts, SessionArtifact } from '../../../resources/beta/agents/sessions/artifacts';
import type { AgentTurnResult } from './agent-turn-result';

/** Beta: artifacts from the exact session and turn represented by a result. */
export class AgentResultArtifacts {
  readonly #resource: Artifacts;
  readonly #sessionID: string;
  readonly #turnID: string;
  constructor(resource: Artifacts, result: AgentTurnResult) {
    this.#resource = resource;
    this.#sessionID = result.session_id;
    this.#turnID = result.turn_id;
  }

  /** Find one immutable artifact by its exact hosted path, across all pages. */
  async retrieve(path: string, options?: RequestOptions): Promise<SessionArtifact> {
    let selected: SessionArtifact | undefined;
    for await (const artifact of agentItems((after) =>
      this.#resource.list(
        this.#sessionID,
        {},
        { ...options, query: { ...options?.query, after, environment_id: undefined } },
      ),
    )) {
      if (
        artifact.session_id === this.#sessionID &&
        artifact.turn_id === this.#turnID &&
        artifact.path === path
      ) {
        if (selected) {
          throw new OpenAIError('Multiple artifacts match this result and path');
        }
        selected = artifact;
      }
    }
    if (!selected) {
      throw new OpenAIError('No artifact matches this result and path');
    }
    return selected;
  }

  /** Return the native binary response for this result's exact artifact path. */
  async content(path: string, options?: RequestOptions): Promise<Response> {
    const artifact = await this.retrieve(path, options);
    return this.#resource.content(artifact.id, { session_id: this.#sessionID }, options);
  }

  /** Stream bytes to a caller-chosen destination; the hosted path never selects a local path. */
  async download(
    params: { path: string; to: WritableStream<Uint8Array> },
    options?: RequestOptions,
  ): Promise<SessionArtifact> {
    const { path, to } = params;
    const artifact = await this.retrieve(path, options);
    const response = await this.#resource.content(artifact.id, { session_id: this.#sessionID }, options);
    if (!response.body) {
      throw new OpenAIError('Artifact response has no content stream');
    }
    try {
      await response.body.pipeTo(to, options?.signal ? { signal: options.signal } : {});
    } catch (error) {
      // pipeTo can reject before acquiring a reader, for example when the destination is locked.
      try {
        await response.body.cancel();
      } catch {
        /* already cancelled or owned by pipeTo */
      }
      throw error;
    }
    return artifact;
  }
}
