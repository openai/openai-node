// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import {
  normalizeRequestOptionsForQuery,
  type LegacyRequestOptions,
  type QueryOptions,
} from '../../../../internal/legacy-query-options';
import { path } from '../../../../internal/utils/path';

export class Turns extends APIResource {
  /**
   * Retrieves a turn's current status, timestamps, usage, and error. Returns 404 if
   * the turn does not belong to the session. See
   * [session turns](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage#inspect-session-turns).
   *
   * @example
   * ```ts
   * const turn =
   *   await client.beta.agents.sessions.turns.retrieve(
   *     'turn_id',
   *     { session_id: 'session_id' },
   *   );
   * ```
   */
  retrieve(turnID: string, params: TurnRetrieveParams, options?: RequestOptions): APIPromise<Turn> {
    const { session_id } = params;
    return this._client.get(path`/agents/sessions/${session_id}/turns/${turnID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists turns by creation time and turn ID. The after cursor is exclusive in the
   * selected order. See
   * [session turns](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage#inspect-session-turns).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const turn of client.beta.agents.sessions.turns.list(
   *   'session_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(sessionID: string, options?: LegacyRequestOptions): PagePromise<TurnsPage, Turn>;
  list(
    sessionID: string,
    query?: QueryOptions<TurnListParams> | null | undefined,
    options?: RequestOptions,
  ): PagePromise<TurnsPage, Turn>;
  list(
    sessionID: string,
    query: TurnListParams | LegacyRequestOptions | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<TurnsPage, Turn> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as TurnListParams | null | undefined;
    return this._client.getAPIList(path`/agents/sessions/${sessionID}/turns`, CursorPage<Turn>, {
      query,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type TurnsPage = CursorPage<Turn>;

/**
 * The canonical public representation of a session turn.
 */
export interface Turn {
  /**
   * The ID of the turn.
   */
  id: string;

  /**
   * The ID of the agent that ran the turn.
   */
  agent_id: string;

  /**
   * The Unix timestamp, in seconds, when the turn reached a terminal state.
   */
  completed_at: number | null;

  /**
   * The Unix timestamp, in seconds, used to order the turn by creation time.
   * Subagent turns use their start time, falling back to completion time or the
   * subagent opening time when the preceding timestamps are unavailable.
   */
  created_at: number;

  /**
   * A customer-safe error. Non-null only for a failed turn.
   */
  error: AgentsAPI.SessionTurnError | null;

  /**
   * The object type. Always `agent.session.turn`.
   */
  object: 'agent.session.turn';

  /**
   * The ID of the session that owns the turn.
   */
  session_id: string;

  /**
   * The Unix timestamp, in seconds, when the turn started.
   */
  started_at: number | null;

  /**
   * The current status of the turn.
   *
   * - `queued` - The turn is waiting to start.
   * - `in_progress` - The turn is in progress.
   * - `waiting` - The turn is waiting for external input.
   * - `completed` - The turn completed successfully.
   * - `failed` - The turn failed.
   * - `cancelled` - The turn was cancelled.
   */
  status: 'queued' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'cancelled';

  /**
   * The ID of the subagent that ran the turn, if applicable.
   */
  subagent_id: string | null;

  /**
   * Best-effort token usage for the turn, or null if unknown. Recorded usage may
   * change.
   */
  usage: AgentsAPI.TokenUsage | null;
}

export interface TurnRetrieveParams {
  /**
   * The ID of the session that owns the turn.
   */
  session_id: string;
}

export interface TurnListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Turns {
  export {
    type Turn as Turn,
    type TurnsPage as TurnsPage,
    type TurnRetrieveParams as TurnRetrieveParams,
    type TurnListParams as TurnListParams,
  };
}
