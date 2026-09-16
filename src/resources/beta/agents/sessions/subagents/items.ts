// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../core/resource';
import * as AgentsAPI from '../../agents';
import { AgentSessionItemsPage } from '../../agents';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../../core/pagination';
import { buildHeaders } from '../../../../../internal/headers';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

export class Items extends APIResource {
  /**
   * Lists this subagent's own items across all of its turns. See
   * [subagent workflows](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const agentSessionItem of client.beta.agents.sessions.subagents.items.list(
   *   'subagent_id',
   *   { session_id: 'session_id' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    subagentID: string,
    params: ItemListParams,
    options?: RequestOptions,
  ): PagePromise<AgentSessionItemsPage, AgentsAPI.AgentSessionItem> {
    const { session_id, ...query } = params;
    return this._client.getAPIList(
      path`/agents/sessions/${session_id}/subagents/${subagentID}/items`,
      CursorPage<AgentsAPI.AgentSessionItem>,
      {
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      },
    );
  }
}

export interface ItemListParams extends CursorPageParams {
  /**
   * Path param: The ID of the session.
   */
  session_id: string;

  /**
   * Query param: The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Items {
  export { type ItemListParams as ItemListParams };
}

export { type AgentSessionItemsPage };
