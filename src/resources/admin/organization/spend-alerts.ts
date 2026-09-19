// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

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
   * Creates an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.create({
   *     currency: 'USD',
   *     interval: 'month',
   *     notification_channel: {
   *       recipients: ['string'],
   *       type: 'email',
   *     },
   *     threshold_amount: 0,
   *   });
   * ```
   */
  create(body: SpendAlertCreateParams, options?: RequestOptions): APIPromise<OrganizationSpendAlert> {
    return this._client.post('/organization/spend_alerts', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Retrieves an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.retrieve(
   *     'alert_id',
   *   );
   * ```
   */
  retrieve(alertID: string, options?: RequestOptions): APIPromise<OrganizationSpendAlert> {
    return this._client.get(path`/organization/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlert =
   *   await client.admin.organization.spendAlerts.update(
   *     'alert_id',
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
  update(
    alertID: string,
    body: SpendAlertUpdateParams,
    options?: RequestOptions,
  ): APIPromise<OrganizationSpendAlert> {
    return this._client.post(path`/organization/spend_alerts/${alertID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists organization spend alerts.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationSpendAlert of client.admin.organization.spendAlerts.list()) {
   *   // ...
   * }
   * ```
   */
  list(
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
  ): PagePromise<OrganizationSpendAlertsPage, OrganizationSpendAlert>;
  list(
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
  ): PagePromise<OrganizationSpendAlertsPage, OrganizationSpendAlert>;
  list(
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
  ): PagePromise<OrganizationSpendAlertsPage, OrganizationSpendAlert> {
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
      '/organization/spend_alerts',
      ConversationCursorPage<OrganizationSpendAlert>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Deletes an organization spend alert.
   *
   * @example
   * ```ts
   * const organizationSpendAlertDeleted =
   *   await client.admin.organization.spendAlerts.delete(
   *     'alert_id',
   *   );
   * ```
   */
  delete(alertID: string, options?: RequestOptions): APIPromise<OrganizationSpendAlertDeleted> {
    return this._client.delete(path`/organization/spend_alerts/${alertID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type OrganizationSpendAlertsPage = ConversationCursorPage<OrganizationSpendAlert>;

/**
 * Represents a spend alert configured at the organization level.
 */
export interface OrganizationSpendAlert {
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
  notification_channel: OrganizationSpendAlert.NotificationChannel;

  /**
   * The object type, which is always `organization.spend_alert`.
   */
  object: 'organization.spend_alert';

  /**
   * The alert threshold amount, in cents.
   */
  threshold_amount: number;
}

export namespace OrganizationSpendAlert {
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
 * Confirmation payload returned after deleting an organization spend alert.
 */
export interface OrganizationSpendAlertDeleted {
  /**
   * The deleted spend alert ID.
   */
  id: string;

  /**
   * Whether the spend alert was deleted.
   */
  deleted: boolean;

  /**
   * Always `organization.spend_alert.deleted`.
   */
  object: 'organization.spend_alert.deleted';
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
  notification_channel: SpendAlertUpdateParams.NotificationChannel;

  /**
   * The alert threshold amount, in cents.
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

export declare namespace SpendAlerts {
  export {
    type OrganizationSpendAlert as OrganizationSpendAlert,
    type OrganizationSpendAlertDeleted as OrganizationSpendAlertDeleted,
    type OrganizationSpendAlertsPage as OrganizationSpendAlertsPage,
    type SpendAlertCreateParams as SpendAlertCreateParams,
    type SpendAlertUpdateParams as SpendAlertUpdateParams,
    type SpendAlertListParams as SpendAlertListParams,
  };
}
