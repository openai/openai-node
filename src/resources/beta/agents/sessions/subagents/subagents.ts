// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../core/resource';
import * as AgentsAPI from '../../agents';
import { SubagentsPage } from '../../agents';
import * as ItemsAPI from './items';
import { ItemListParams, Items } from './items';
import * as TurnsAPI from './turns/turns';
import { TurnListParams, TurnRetrieveParams, Turns } from './turns/turns';
import { APIPromise } from '../../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../../core/pagination';
import { buildHeaders } from '../../../../../internal/headers';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

export class Subagents extends APIResource {
  items: ItemsAPI.Items = new ItemsAPI.Items(this._client);
  turns: TurnsAPI.Turns = new TurnsAPI.Turns(this._client);

  /**
   * Retrieves a subagent belonging to this session. See
   * [subagent workflows](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
   *
   * @example
   * ```ts
   * const subagent =
   *   await client.beta.agents.sessions.subagents.retrieve(
   *     'subagent_id',
   *     { session_id: 'session_id' },
   *   );
   * ```
   */
  retrieve(
    subagentID: string,
    params: SubagentRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<AgentsAPI.Subagent> {
    const { session_id } = params;
    return this._client.get(path`/agents/sessions/${session_id}/subagents/${subagentID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists subagents in a session, including nested and closed subagents. See
   * [subagent workflows](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const subagent of client.beta.agents.sessions.subagents.list(
   *   'session_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    sessionID: string,
    query: SubagentListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<SubagentsPage, AgentsAPI.Subagent> {
    return this._client.getAPIList(
      path`/agents/sessions/${sessionID}/subagents`,
      CursorPage<AgentsAPI.Subagent>,
      {
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      },
    );
  }
}

export interface SubagentRetrieveParams {
  /**
   * The ID of the session.
   */
  session_id: string;
}

export interface SubagentListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

Subagents.Items = Items;
Subagents.Turns = Turns;

export declare namespace Subagents {
  export {
    type SubagentRetrieveParams as SubagentRetrieveParams,
    type SubagentListParams as SubagentListParams,
  };

  export { Items as Items, type ItemListParams as ItemListParams };

  export {
    Turns as Turns,
    type TurnRetrieveParams as TurnRetrieveParams,
    type TurnListParams as TurnListParams,
  };
}

export { type SubagentsPage };
