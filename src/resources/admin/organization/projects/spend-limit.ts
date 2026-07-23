// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class SpendLimit extends APIResource {
  /**
   * Get a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimit =
   *   await client.admin.organization.projects.spendLimit.retrieve(
   *     'proj_123',
   *   );
   * ```
   */
  retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectSpendLimit> {
    return this._client.get(path`/organization/projects/${projectID}/spend_limit`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Create or replace a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimit =
   *   await client.admin.organization.projects.spendLimit.update(
   *     'proj_123',
   *     {
   *       currency: 'USD',
   *       interval: 'month',
   *       threshold_amount: 1,
   *     },
   *   );
   * ```
   */
  update(
    projectID: string,
    body: SpendLimitUpdateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectSpendLimit> {
    return this._client.post(path`/organization/projects/${projectID}/spend_limit`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Delete a project's hard spend limit.
   *
   * @example
   * ```ts
   * const projectSpendLimitDeleted =
   *   await client.admin.organization.projects.spendLimit.delete(
   *     'proj_123',
   *   );
   * ```
   */
  delete(projectID: string, options?: RequestOptions): APIPromise<ProjectSpendLimitDeleted> {
    return this._client.delete(path`/organization/projects/${projectID}/spend_limit`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

/**
 * Represents a hard spend limit configured at the project level.
 */
export interface ProjectSpendLimit {
  /**
   * The currency for the threshold amount. Currently, only `USD` is supported.
   */
  currency: (string & {}) | 'USD';

  /**
   * The current enforcement state of the hard spend limit.
   */
  enforcement: ProjectSpendLimit.Enforcement;

  /**
   * The time interval for evaluating spend against the threshold. Currently, only
   * `month` is supported.
   */
  interval: (string & {}) | 'month';

  /**
   * The object type, which is always `project.spend_limit`.
   */
  object: 'project.spend_limit';

  /**
   * The hard spend limit amount, in cents.
   */
  threshold_amount: number;
}

export namespace ProjectSpendLimit {
  /**
   * The current enforcement state of the hard spend limit.
   */
  export interface Enforcement {
    /**
     * Whether the hard spend limit is currently enforcing.
     */
    status: (string & {}) | 'inactive' | 'enforcing';
  }
}

/**
 * Confirmation payload returned after deleting a project hard spend limit.
 */
export interface ProjectSpendLimitDeleted {
  /**
   * Whether the hard spend limit was deleted.
   */
  deleted: boolean;

  /**
   * The object type, which is always `project.spend_limit.deleted`.
   */
  object: 'project.spend_limit.deleted';
}

export interface SpendLimitUpdateParams {
  /**
   * The currency for the threshold amount. Currently, only `USD` is supported.
   */
  currency: 'USD';

  /**
   * The time interval for evaluating spend against the threshold. Currently, only
   * `month` is supported.
   */
  interval: 'month';

  /**
   * The hard spend limit amount, in cents.
   */
  threshold_amount: number;
}

export declare namespace SpendLimit {
  export {
    type ProjectSpendLimit as ProjectSpendLimit,
    type ProjectSpendLimitDeleted as ProjectSpendLimitDeleted,
    type SpendLimitUpdateParams as SpendLimitUpdateParams,
  };
}
