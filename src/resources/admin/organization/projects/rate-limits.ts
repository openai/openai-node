// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class RateLimits extends APIResource {
  /**
   * Returns the rate limits per model for a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectRateLimit of client.admin.organization.projects.rateLimits.listRateLimits(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  listRateLimits(
    projectID: string,
    query: RateLimitListRateLimitsParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectRateLimitsPage, ProjectRateLimit> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/rate_limits`,
      ConversationCursorPage<ProjectRateLimit>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Updates a project rate limit.
   *
   * @example
   * ```ts
   * const projectRateLimit =
   *   await client.admin.organization.projects.rateLimits.updateRateLimit(
   *     'rate_limit_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  updateRateLimit(
    rateLimitID: string,
    params: RateLimitUpdateRateLimitParams,
    options?: RequestOptions,
  ): APIPromise<ProjectRateLimit> {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/rate_limits/${rateLimitID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectRateLimitsPage = ConversationCursorPage<ProjectRateLimit>;

/**
 * Represents a project rate limit config.
 */
export interface ProjectRateLimit {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The maximum requests per minute.
   */
  max_requests_per_1_minute: number;

  /**
   * The maximum tokens per minute.
   */
  max_tokens_per_1_minute: number;

  /**
   * The model this rate limit applies to.
   */
  model: string;

  /**
   * The object type, which is always `project.rate_limit`
   */
  object: 'project.rate_limit';

  /**
   * The maximum batch input tokens per day. Only present for relevant models.
   */
  batch_1_day_max_input_tokens?: number;

  /**
   * The maximum audio megabytes per minute. Only present for relevant models.
   */
  max_audio_megabytes_per_1_minute?: number;

  /**
   * The maximum images per minute. Only present for relevant models.
   */
  max_images_per_1_minute?: number;

  /**
   * The maximum requests per day. Only present for relevant models.
   */
  max_requests_per_1_day?: number;
}

export interface RateLimitListRateLimitsParams extends ConversationCursorPageParams {
  /**
   * A cursor for use in pagination. `before` is an object ID that defines your place
   * in the list. For instance, if you make a list request and receive 100 objects,
   * beginning with obj_foo, your subsequent call can include before=obj_foo in order
   * to fetch the previous page of the list.
   */
  before?: string;
}

export interface RateLimitUpdateRateLimitParams {
  /**
   * Path param: The ID of the project.
   */
  project_id: string;

  /**
   * Body param: The maximum batch input tokens per day. Only relevant for certain
   * models.
   */
  batch_1_day_max_input_tokens?: number;

  /**
   * Body param: The maximum audio megabytes per minute. Only relevant for certain
   * models.
   */
  max_audio_megabytes_per_1_minute?: number;

  /**
   * Body param: The maximum images per minute. Only relevant for certain models.
   */
  max_images_per_1_minute?: number;

  /**
   * Body param: The maximum requests per day. Only relevant for certain models.
   */
  max_requests_per_1_day?: number;

  /**
   * Body param: The maximum requests per minute.
   */
  max_requests_per_1_minute?: number;

  /**
   * Body param: The maximum tokens per minute.
   */
  max_tokens_per_1_minute?: number;
}

export declare namespace RateLimits {
  export {
    type ProjectRateLimit as ProjectRateLimit,
    type ProjectRateLimitsPage as ProjectRateLimitsPage,
    type RateLimitListRateLimitsParams as RateLimitListRateLimitsParams,
    type RateLimitUpdateRateLimitParams as RateLimitUpdateRateLimitParams,
  };
}
