// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

// Recognizable options across SDK runtime versions. Keep this independent of
// private RequestOptions fields so older handwritten runtimes still compile.
const normalizeRequestOptionsForQueryKeys = new Set([
  'method',
  'path',
  'query',
  'body',
  'headers',
  'maxRetries',
  'stream',
  'timeout',
  'httpAgent',
  'fetchOptions',
  'signal',
  'idempotencyKey',
  'defaultBaseURL',
  '__metadata',
  '__binaryRequest',
  '__binaryResponse',
  '__streamClass',
  '__security',
  '__synthesizeEventData',
]);

function normalizeRequestOptionsForQuery(
  value: unknown,
  queryKeys: ReadonlyArray<string>,
  options: RequestOptions | undefined,
):
  | ({
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    })
  | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Optional never fields can still be explicitly undefined unless consumers
  // enable exactOptionalPropertyTypes. Snapshot data without invoking getters.
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([, descriptor]) => descriptor.enumerable && (!('value' in descriptor) || descriptor.value !== undefined),
  );
  const keys = entries.map(([key]) => key);
  const requestOnly = keys.some(
    (key) => normalizeRequestOptionsForQueryKeys.has(key) && !queryKeys.includes(key),
  );
  if (!requestOnly) return undefined;
  // Declared query fields, including stream, must use the query argument.
  // Mixing them with request-only options is ambiguous and could change the return type.
  if (
    options !== undefined ||
    keys.some((key) => !normalizeRequestOptionsForQueryKeys.has(key) || queryKeys.includes(key))
  ) {
    throw new TypeError('Query parameters and request options must be passed as separate arguments.');
  }
  // The query position must not gain authority to change the request destination
  // or transport. Those overrides require the explicit request options argument.
  if (
    keys.some(
      (key) => !['headers', 'maxRetries', 'timeout', 'signal', 'idempotencyKey', 'query'].includes(key),
    )
  ) {
    throw new TypeError('Pass transport overrides in the explicit request options argument.');
  }
  // Copy only the validated fields. Spreading value would reintroduce undefined
  // transport overrides, and deleting them would mutate the caller's object.
  return Object.fromEntries(
    entries.map(([key, descriptor]) => {
      if ('value' in descriptor) return [key, descriptor.value];
      return [key, descriptor.get ? Reflect.apply(descriptor.get, value, []) : undefined];
    }),
  ) as {
    [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
  } & {
    [
      K in
        | 'method'
        | 'path'
        | 'body'
        | 'stream'
        | 'httpAgent'
        | 'fetchOptions'
        | 'defaultBaseURL'
        | '__metadata'
        | '__binaryRequest'
        | '__binaryResponse'
        | '__streamClass'
        | '__security'
        | '__synthesizeEventData'
    ]?: never;
  };
}

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
   * Retrieves a project spend alert.
   *
   * @example
   * ```ts
   * const projectSpendAlert =
   *   await client.admin.organization.projects.spendAlerts.retrieve(
   *     'alert_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(
    alertID: string,
    params: SpendAlertRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<ProjectSpendAlert> {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/spend_alerts/${alertID}`, {
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
    query?:
      | (SpendAlertListParams &
          (
            | {
                [
                  K in
                    | 'method'
                    | 'path'
                    | 'query'
                    | 'body'
                    | 'headers'
                    | 'maxRetries'
                    | 'stream'
                    | 'timeout'
                    | 'httpAgent'
                    | 'fetchOptions'
                    | 'signal'
                    | 'idempotencyKey'
                    | 'defaultBaseURL'
                    | '__metadata'
                    | '__binaryRequest'
                    | '__binaryResponse'
                    | '__streamClass'
                    | '__security'
                    | '__synthesizeEventData'
                ]?: never;
              }
            | null
            | undefined
          ))
      | null
      | undefined,
    options?: RequestOptions,
  ): PagePromise<ProjectSpendAlertsPage, ProjectSpendAlert>;
  list(
    projectID: string,
    options?: {
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    },
  ): PagePromise<ProjectSpendAlertsPage, ProjectSpendAlert>;
  list(
    projectID: string,
    query:
      | SpendAlertListParams
      | ({
          [
            K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query'
          ]?: RequestOptions[K];
        } & {
          [
            K in
              | 'method'
              | 'path'
              | 'body'
              | 'stream'
              | 'httpAgent'
              | 'fetchOptions'
              | 'defaultBaseURL'
              | '__metadata'
              | '__binaryRequest'
              | '__binaryResponse'
              | '__streamClass'
              | '__security'
              | '__synthesizeEventData'
          ]?: never;
        })
      | null
      | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectSpendAlertsPage, ProjectSpendAlert> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'before', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as SpendAlertListParams | null | undefined;
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

export interface SpendAlertRetrieveParams {
  /**
   * The ID of the project.
   */
  project_id: string;
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
    type SpendAlertRetrieveParams as SpendAlertRetrieveParams,
    type SpendAlertUpdateParams as SpendAlertUpdateParams,
    type SpendAlertListParams as SpendAlertListParams,
    type SpendAlertDeleteParams as SpendAlertDeleteParams,
  };
}
