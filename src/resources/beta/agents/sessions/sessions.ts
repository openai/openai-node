// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as SessionsAPI from './sessions';
import * as AgentsAPI from '../agents';
import { AgentSessionsPage } from '../agents';
import * as ArtifactsAPI from './artifacts';
import {
  ArtifactContentParams,
  ArtifactDeleteParams,
  ArtifactListParams,
  ArtifactRetrieveParams,
  Artifacts,
  SessionArtifact,
  SessionArtifactDeleted,
  SessionArtifactsPage,
} from './artifacts';
import * as EventsAPI from './events';
import { EventCreateParams, Events } from './events';
import * as ItemsAPI from './items';
import { ItemListParams, Items } from './items';
import * as TurnsAPI from './turns';
import { Turn, TurnListParams, TurnRetrieveParams, Turns, TurnsPage } from './turns';
import * as SubagentsAPI from './subagents/subagents';
import { SubagentListParams, SubagentRetrieveParams, Subagents } from './subagents/subagents';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { Stream } from '../../../../core/streaming';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Sessions extends APIResource {
  subagents: SubagentsAPI.Subagents = new SubagentsAPI.Subagents(this._client);
  artifacts: ArtifactsAPI.Artifacts = new ArtifactsAPI.Artifacts(this._client);
  items: ItemsAPI.Items = new ItemsAPI.Items(this._client);
  events: EventsAPI.Events = new EventsAPI.Events(this._client);
  turns: TurnsAPI.Turns = new TurnsAPI.Turns(this._client);

  /**
   * Creates a managed agent session, optionally submits initial input, and returns
   * the session or streams its events when stream is true. See
   * [running sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions).
   *
   * @example
   * ```ts
   * const agentSession =
   *   await client.beta.agents.sessions.create({
   *     environment: { type: 'none' },
   *   });
   * ```
   */
  create(body: SessionCreateParamsNonStreaming, options?: RequestOptions): APIPromise<AgentsAPI.AgentSession>;
  create(
    body: SessionCreateParamsStreaming,
    options?: RequestOptions,
  ): APIPromise<Stream<AgentsAPI.AgentSessionEvent>>;
  create(
    body: SessionCreateParamsBase,
    options?: RequestOptions,
  ): APIPromise<Stream<AgentsAPI.AgentSessionEvent> | AgentsAPI.AgentSession>;
  create(
    body: SessionCreateParams,
    options?: RequestOptions,
  ): APIPromise<AgentsAPI.AgentSession> | APIPromise<Stream<AgentsAPI.AgentSessionEvent>> {
    return this._client.post('/agents/sessions', {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      stream: body.stream ?? false,
      __security: { bearerAuth: true },
    }) as APIPromise<AgentsAPI.AgentSession> | APIPromise<Stream<AgentsAPI.AgentSessionEvent>>;
  }

  /**
   * Retrieves the current state of a managed agent session. See
   * [managing sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
   *
   * @example
   * ```ts
   * const agentSession =
   *   await client.beta.agents.sessions.retrieve('session_id');
   * ```
   */
  retrieve(sessionID: string, options?: RequestOptions): APIPromise<AgentsAPI.AgentSession> {
    return this._client.get(path`/agents/sessions/${sessionID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Updates session metadata. Omitted fields are unchanged. See
   * [managing sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
   *
   * @example
   * ```ts
   * const agentSession =
   *   await client.beta.agents.sessions.update('session_id');
   * ```
   */
  update(
    sessionID: string,
    body: SessionUpdateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<AgentsAPI.AgentSession> {
    return this._client.post(path`/agents/sessions/${sessionID}`, {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists managed agent sessions using ID-based pagination and the requested sort
   * order. See
   * [managing sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const agentSession of client.beta.agents.sessions.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: SessionListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AgentSessionsPage, AgentsAPI.AgentSession> {
    return this._client.getAPIList('/agents/sessions', CursorPage<AgentsAPI.AgentSession>, {
      query,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Removes a managed agent session from the public API and returns a deletion
   * confirmation. Physical cleanup may continue asynchronously. See
   * [managing sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage).
   *
   * @example
   * ```ts
   * const agentSessionDeleted =
   *   await client.beta.agents.sessions.delete('session_id');
   * ```
   */
  delete(sessionID: string, options?: RequestOptions): APIPromise<AgentsAPI.AgentSessionDeleted> {
    return this._client.delete(path`/agents/sessions/${sessionID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type SessionCreateParams = SessionCreateParamsNonStreaming | SessionCreateParamsStreaming;

export interface SessionCreateParamsBase {
  /**
   * An inline execution environment or a reference to an environment template.
   */
  environment: AgentsAPI.EnvironmentParam;

  /**
   * Agent configuration. With `agent_id`, supplied fields override the saved agent
   * for this session. Without `agent_id`, `model` is required.
   */
  agent?: SessionCreateParams.Agent;

  /**
   * The ID of a saved reusable agent. Omit `agent` to use its configuration
   * unchanged.
   */
  agent_id?: string;

  /**
   * Initial input submitted when creating a session.
   */
  input?: string | Array<AgentsAPI.AgentSessionInputMessageParam> | null;

  /**
   * Up to 16 string key-value pairs, with keys up to 64 and values up to 512
   * characters. Omission or null defaults to an empty map.
   */
  metadata?: { [key: string]: string } | null;

  /**
   * Whether to stream session events as server-sent events. Defaults to `false`.
   */
  stream?: boolean;

  /**
   * The IDs of vaults made available to the session.
   */
  vault_ids?: Array<string> | null;
}

export namespace SessionCreateParams {
  /**
   * Agent configuration. With `agent_id`, supplied fields override the saved agent
   * for this session. Without `agent_id`, `model` is required.
   */
  export interface Agent {
    /**
     * Additional instructions appended to the agent's default base instructions. Omit
     * to leave unchanged.
     */
    instructions?: string | null;

    /**
     * The model to use for the agent. The requested model name is preserved.
     */
    model?: string;

    /**
     * Explicit configuration for creating and coordinating subagents.
     */
    multi_agent?: AgentsAPI.MultiAgentConfigParam | null;

    /**
     * Reasoning configuration for the agent.
     */
    reasoning?: AgentsAPI.AgentReasoningParam | null;

    /**
     * The service tier used for model requests.
     *
     * - `auto` - Selects the service tier automatically.
     * - `default` - Uses the default service tier.
     * - `flex` - Uses the flex service tier.
     * - `priority` - Uses the priority service tier.
     * - `fast` - Uses the fast service tier.
     */
    service_tier?: 'auto' | 'default' | 'flex' | 'priority' | 'fast' | null;

    /**
     * Configuration for text generated by the agent.
     */
    text?: AgentsAPI.AgentTextParam | null;

    /**
     * Tools available to the agent. Omit to inherit, or pass null to clear them.
     */
    tools?: Array<AgentsAPI.AgentToolParam> | null;
  }

  export type SessionCreateParamsNonStreaming = SessionsAPI.SessionCreateParamsNonStreaming;
  export type SessionCreateParamsStreaming = SessionsAPI.SessionCreateParamsStreaming;
}

export interface SessionCreateParamsNonStreaming extends SessionCreateParamsBase {
  /**
   * Whether to stream session events as server-sent events. Defaults to `false`.
   */
  stream?: false;
}

export interface SessionCreateParamsStreaming extends SessionCreateParamsBase {
  /**
   * Whether to stream session events as server-sent events. Defaults to `false`.
   */
  stream: true;
}

export interface SessionUpdateParams {
  /**
   * Replaces all metadata. Omit to leave unchanged, or pass null or {} to clear it.
   * Up to 16 string key-value pairs, with keys up to 64 and values up to 512
   * characters.
   */
  metadata?: { [key: string]: string } | null;
}

export interface SessionListParams extends CursorPageParams {
  /**
   * Only return sessions whose root agent has this ID. Omit to return sessions for
   * all agents.
   */
  agent_id?: string;

  /**
   * Sort order by the `created_at` timestamp. Use `asc` for ascending order or
   * `desc` for descending order. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

Sessions.Subagents = Subagents;
Sessions.Artifacts = Artifacts;
Sessions.Items = Items;
Sessions.Events = Events;
Sessions.Turns = Turns;

export declare namespace Sessions {
  export {
    type SessionCreateParams as SessionCreateParams,
    type SessionCreateParamsNonStreaming as SessionCreateParamsNonStreaming,
    type SessionCreateParamsStreaming as SessionCreateParamsStreaming,
    type SessionUpdateParams as SessionUpdateParams,
    type SessionListParams as SessionListParams,
  };

  export {
    Subagents as Subagents,
    type SubagentRetrieveParams as SubagentRetrieveParams,
    type SubagentListParams as SubagentListParams,
  };

  export {
    Artifacts as Artifacts,
    type SessionArtifact as SessionArtifact,
    type SessionArtifactDeleted as SessionArtifactDeleted,
    type SessionArtifactsPage as SessionArtifactsPage,
    type ArtifactRetrieveParams as ArtifactRetrieveParams,
    type ArtifactListParams as ArtifactListParams,
    type ArtifactDeleteParams as ArtifactDeleteParams,
    type ArtifactContentParams as ArtifactContentParams,
  };

  export { Items as Items, type ItemListParams as ItemListParams };

  export { Events as Events, type EventCreateParams as EventCreateParams };

  export {
    Turns as Turns,
    type Turn as Turn,
    type TurnsPage as TurnsPage,
    type TurnRetrieveParams as TurnRetrieveParams,
    type TurnListParams as TurnListParams,
  };
}

export { type AgentSessionsPage };
