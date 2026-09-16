// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import { AgentSessionItemsPage } from '../agents';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Items extends APIResource {
  /**
   * Lists items produced by the session's root agent, including its interactions
   * with subagents. Each subagent has its own item history. See
   * [inspecting agent output](https://developers.openai.com/api/docs/guides/agents-api/observability).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const agentSessionItem of client.beta.agents.sessions.items.list(
   *   'session_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    sessionID: string,
    query: ItemListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AgentSessionItemsPage, AgentsAPI.AgentSessionItem> {
    return this._client.getAPIList(
      path`/agents/sessions/${sessionID}/items`,
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
   * The order in which resources are returned. Defaults to `desc`.
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
