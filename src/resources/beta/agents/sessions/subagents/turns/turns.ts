// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../../core/resource';
import * as TurnsAPI from '../../turns';
import { TurnsPage } from '../../turns';
import * as ItemsAPI from './items';
import { ItemListParams, Items } from './items';
import { APIPromise } from '../../../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../../../core/pagination';
import { buildHeaders } from '../../../../../../internal/headers';
import { RequestOptions } from '../../../../../../internal/request-options';
import { path } from '../../../../../../internal/utils/path';

export class Turns extends APIResource {
  items: ItemsAPI.Items = new ItemsAPI.Items(this._client);

  /**
   * Retrieves a turn belonging to this subagent. See
   * [subagent workflows](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
   *
   * @example
   * ```ts
   * const turn =
   *   await client.beta.agents.sessions.subagents.turns.retrieve(
   *     'turn_id',
   *     {
   *       session_id: 'session_id',
   *       subagent_id: 'subagent_id',
   *     },
   *   );
   * ```
   */
  retrieve(turnID: string, params: TurnRetrieveParams, options?: RequestOptions): APIPromise<TurnsAPI.Turn> {
    const { session_id, subagent_id } = params;
    return this._client.get(path`/agents/sessions/${session_id}/subagents/${subagent_id}/turns/${turnID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists all turns of this subagent, including turns after a resume. See
   * [subagent workflows](https://developers.openai.com/api/docs/guides/agents-api/multi-agent).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const turn of client.beta.agents.sessions.subagents.turns.list(
   *   'subagent_id',
   *   { session_id: 'session_id' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    subagentID: string,
    params: TurnListParams,
    options?: RequestOptions,
  ): PagePromise<TurnsPage, TurnsAPI.Turn> {
    const { session_id, ...query } = params;
    return this._client.getAPIList(
      path`/agents/sessions/${session_id}/subagents/${subagentID}/turns`,
      CursorPage<TurnsAPI.Turn>,
      {
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      },
    );
  }
}

export interface TurnRetrieveParams {
  /**
   * The ID of the session.
   */
  session_id: string;

  /**
   * The ID of the subagent in this session.
   */
  subagent_id: string;
}

export interface TurnListParams extends CursorPageParams {
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

Turns.Items = Items;

export declare namespace Turns {
  export { type TurnRetrieveParams as TurnRetrieveParams, type TurnListParams as TurnListParams };

  export { Items as Items, type ItemListParams as ItemListParams };
}

export { type TurnsPage };
