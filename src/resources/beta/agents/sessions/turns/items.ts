// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../core/resource';
import * as AgentsAPI from '../../agents';
import { AgentSessionItemsPage } from '../../agents';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../../core/pagination';
import { buildHeaders } from '../../../../../internal/headers';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class Items extends APIResource {
  /**
   * Lists items belonging to one root-agent turn, including its interactions with
   * subagents. See
   * [inspecting agent output](https://developers.openai.com/api/docs/guides/agents-api/observability).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const agentSessionItem of client.beta.agents.sessions.turns.items.list(
   *   'turn_id',
   *   { session_id: 'session_id' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    turnID: string,
    params: ItemListParams,
    options?: RequestOptions,
  ): PagePromise<AgentSessionItemsConversationCursorPage, AgentsAPI.AgentSessionItem> {
    const { session_id, ...query } = params;
    return this._client.getAPIList(
      path`/agents/sessions/${session_id}/turns/${turnID}/items`,
      ConversationCursorPage<AgentsAPI.AgentSessionItem>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }
}

export type AgentSessionItemsConversationCursorPage = ConversationCursorPage<AgentsAPI.AgentSessionItem>;

export interface ItemListParams extends ConversationCursorPageParams {
  /**
   * Path param: The ID of the session that owns the turn.
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
