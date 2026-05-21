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

export class SpendAlerts extends APIResource {
  /**
   * Creates a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.create(
   *     'project_id',
   *     {
   *       currency: 'USD',
   *       interval: 'month',
   *       notification_channel: {
   *         recipients: ['string'],
   *         type: 'email',
   *       },
   *       threshold_amount: 0,
   *     },
   *   );
   * ```
   */
  create(
    projectID: string,
    body: SpendAlertCreateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectSpendAlert> {
    return this._client.post(path`/organization/projects/${projectID}/spend_alerts`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.update(
   *     'alert_id',
   *     {
   *       project_id: 'project_id',
   *       currency: 'USD',
   *       interval: 'month',
   *       notification_channel: {
   *         recipients: ['string'],
   *         type: 'email',
   *       },
   *       threshold_amount: 0,
   *     },
   *   );
   * ```
   */
  update(
    alertID: string,
    params: SpendAlertUpdateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectSpendAlert> {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists project spend alerts.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectSpendAlert of client.admin.organization.projects.spendAlerts.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query: SpendAlertListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectSpendAlertsPage, ProjectSpendAlert> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/spend_alerts`,
      ConversationCursorPage<ProjectSpendAlert>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Deletes a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlertDeleted =
   *   await client.admin.organization.projects.spendAlerts.delete(
   *     'alert_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(
    alertID: string,
    params: SpendAlertDeleteParams,
    options?: RequestOptions,
  ): APIPromise<ProjectSpendAlertDeleted> {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectSpendAlertsPage = ConversationCursorPage<ProjectSpendAlert>;

/**
 * Represents a spend alert configured at the project level.
 */
export interface ProjectSpendAlert {
  /**
   * The identifier, which can be referenced in API endpoints.
   */
  id: string;

  /**
   * The currency for the threshold amount.
   */
  currency: 'USD';

  /**
   * The time interval for evaluating spend against the threshold.
   */
  interval: 'month';

  /**
   * Email notification settings for a spend alert.
   */
  notification_channel: ProjectSpendAlert.NotificationChannel;

  /**
   * The object type, which is always `project.spend_alert`.
   */
  object: 'project.spend_alert';

  /**
   * The alert threshold amount, in cents.
   */
  threshold_amount: number;
}

export namespace ProjectSpendAlert {
  /**
   * Email notification settings for a spend alert.
   */
  export interface NotificationChannel {
    /**
     * Email addresses that receive the spend alert notification.
     */
    recipients: Array<string>;

    /**
     * The notification channel type. Currently only `email` is supported.
     */
    type: 'email';

    /**
     * Optional subject prefix for alert emails.
     */
    subject_prefix?: string | null;
  }
}

/**
 * Confirmation payload returned after deleting a project spend alert.
 */
export interface ProjectSpendAlertDeleted {
  /**
   * The deleted spend alert ID.
   */
  id: string;

  /**
   * Whether the spend alert was deleted.
   */
  deleted: boolean;

  /**
   * Always `project.spend_alert.deleted`.
   */
  object: 'project.spend_alert.deleted';
}

export interface SpendAlertCreateParams {
  /**
   * The currency for the threshold amount.
   */
  currency: 'USD';

  /**
   * The time interval for evaluating spend against the threshold.
   */
  interval: 'month';

  /**
   * Email notification settings for a spend alert.
   */
  notification_channel: SpendAlertCreateParams.NotificationChannel;

  /**
   * The alert threshold amount, in cents.
   */
  threshold_amount: number;
}

export namespace SpendAlertCreateParams {
  /**
   * Email notification settings for a spend alert.
   */
  export interface NotificationChannel {
    /**
     * Email addresses that receive the spend alert notification.
     */
    recipients: Array<string>;

    /**
     * The notification channel type. Currently only `email` is supported.
     */
    type: 'email';

    /**
     * Optional subject prefix for alert emails.
     */
    subject_prefix?: string | null;
  }
}

export interface SpendAlertUpdateParams {
  /**
   * Path param: The ID of the project to update.
   */
  project_id: string;

  /**
   * Body param: The currency for the threshold amount.
   */
  currency: 'USD';

  /**
   * Body param: The time interval for evaluating spend against the threshold.
   */
  interval: 'month';

  /**
   * Body param: Email notification settings for a spend alert.
   */
  notification_channel: SpendAlertUpdateParams.NotificationChannel;

  /**
   * Body param: The alert threshold amount, in cents.
   */
  threshold_amount: number;
}

export namespace SpendAlertUpdateParams {
  /**
   * Email notification settings for a spend alert.
   */
  export interface NotificationChannel {
    /**
     * Email addresses that receive the spend alert notification.
     */
    recipients: Array<string>;

    /**
     * The notification channel type. Currently only `email` is supported.
     */
    type: 'email';

    /**
     * Optional subject prefix for alert emails.
     */
    subject_prefix?: string | null;
  }
}

export interface SpendAlertListParams extends ConversationCursorPageParams {
  /**
   * Cursor for pagination. Provide the ID of the first spend alert from the previous
   * response to fetch the previous page.
   */
  before?: string;

  /**
   * Sort order for the returned spend alerts.
   */
  order?: 'asc' | 'desc';
}

export interface SpendAlertDeleteParams {
  /**
   * The ID of the project to update.
   */
  project_id: string;
}

export declare namespace SpendAlerts {
  export {
    type ProjectSpendAlert as ProjectSpendAlert,
    type ProjectSpendAlertDeleted as ProjectSpendAlertDeleted,
    type ProjectSpendAlertsPage as ProjectSpendAlertsPage,
    type SpendAlertCreateParams as SpendAlertCreateParams,
    type SpendAlertUpdateParams as SpendAlertUpdateParams,
    type SpendAlertListParams as SpendAlertListParams,
    type SpendAlertDeleteParams as SpendAlertDeleteParams,
  };
}
