// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Artifacts extends APIResource {
  /**
   * Retrieves immutable metadata for one durable session artifact. See
   * [session artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files#openai-hosted-artifacts).
   *
   * @example
   * ```ts
   * const sessionArtifact =
   *   await client.beta.agents.sessions.artifacts.retrieve(
   *     'artifact_id',
   *     { session_id: 'session_id' },
   *   );
   * ```
   */
  retrieve(
    artifactID: string,
    params: ArtifactRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<SessionArtifact> {
    const { session_id } = params;
    return this._client.get(path`/agents/sessions/${session_id}/artifacts/${artifactID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists immutable artifacts published by completed hosted session turns. See
   * [session artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files#openai-hosted-artifacts).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const sessionArtifact of client.beta.agents.sessions.artifacts.list(
   *   'session_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    sessionID: string,
    query: ArtifactListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<SessionArtifactsPage, SessionArtifact> {
    return this._client.getAPIList(
      path`/agents/sessions/${sessionID}/artifacts`,
      CursorPage<SessionArtifact>,
      {
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      },
    );
  }

  /**
   * Deletes an immutable session artifact without deleting its live environment file
   * or original Files API object. See
   * [session artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files#openai-hosted-artifacts).
   *
   * @example
   * ```ts
   * const sessionArtifactDeleted =
   *   await client.beta.agents.sessions.artifacts.delete(
   *     'artifact_id',
   *     { session_id: 'session_id' },
   *   );
   * ```
   */
  delete(
    artifactID: string,
    params: ArtifactDeleteParams,
    options?: RequestOptions,
  ): APIPromise<SessionArtifactDeleted> {
    const { session_id } = params;
    return this._client.delete(path`/agents/sessions/${session_id}/artifacts/${artifactID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Downloads immutable session artifact bytes after the execution environment
   * expires. See
   * [session artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files#openai-hosted-artifacts).
   *
   * @example
   * ```ts
   * const response =
   *   await client.beta.agents.sessions.artifacts.content(
   *     'artifact_id',
   *     { session_id: 'session_id' },
   *   );
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  content(artifactID: string, params: ArtifactContentParams, options?: RequestOptions): APIPromise<Response> {
    const { session_id } = params;
    return this._client.get(path`/agents/sessions/${session_id}/artifacts/${artifactID}/content`, {
      ...options,
      headers: buildHeaders([
        { 'OpenAI-Beta': 'agents=v1', Accept: 'application/octet-stream' },
        options?.headers,
      ]),
      __security: { bearerAuth: true },
      __binaryResponse: true,
    });
  }
}

export type SessionArtifactsPage = CursorPage<SessionArtifact>;

/**
 * An immutable file published by a completed hosted session turn.
 */
export interface SessionArtifact {
  /**
   * The immutable artifact ID.
   */
  id: string;

  /**
   * The Unix timestamp, in seconds, when the artifact was published.
   */
  created_at: number;

  /**
   * The ID of the environment that produced the artifact.
   */
  environment_id: string;

  /**
   * The object type. Always `agent.session.artifact`.
   */
  object: 'agent.session.artifact';

  /**
   * The original absolute file path in the execution environment.
   */
  path: string;

  /**
   * The ID of the session that owns the artifact.
   */
  session_id: string;

  /**
   * The immutable artifact size in bytes.
   */
  size_bytes: number;

  /**
   * The ID of the completed turn that published the artifact.
   */
  turn_id: string;
}

/**
 * Confirmation that an immutable session artifact was deleted.
 */
export interface SessionArtifactDeleted {
  /**
   * The ID of the deleted session artifact.
   */
  id: string;

  /**
   * Whether the session artifact was deleted. Always `true`.
   */
  deleted: boolean;

  /**
   * The object type. Always `agent.session.artifact.deleted`.
   */
  object: 'agent.session.artifact.deleted';
}

export interface ArtifactRetrieveParams {
  /**
   * The ID of the session that owns the artifact.
   */
  session_id: string;
}

export interface ArtifactListParams extends CursorPageParams {
  /**
   * Restrict the listing to artifacts produced by this environment.
   */
  environment_id?: string | null;

  /**
   * Sort by creation time and ID. Defaults to descending.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

export interface ArtifactDeleteParams {
  /**
   * The ID of the session that owns the artifact.
   */
  session_id: string;
}

export interface ArtifactContentParams {
  /**
   * The ID of the session that owns the artifact.
   */
  session_id: string;
}

export declare namespace Artifacts {
  export {
    type SessionArtifact as SessionArtifact,
    type SessionArtifactDeleted as SessionArtifactDeleted,
    type SessionArtifactsPage as SessionArtifactsPage,
    type ArtifactRetrieveParams as ArtifactRetrieveParams,
    type ArtifactListParams as ArtifactListParams,
    type ArtifactDeleteParams as ArtifactDeleteParams,
    type ArtifactContentParams as ArtifactContentParams,
  };
}
