// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { RequestOptions } from '../../../internal/request-options';

export class DataRetention extends APIResource {
  /**
   * Retrieves organization data retention controls.
   *
   * @example
   * ```ts
   * const organizationDataRetention =
   *   await client.admin.organization.dataRetention.retrieve();
   * ```
   */
  retrieve(options?: RequestOptions): APIPromise<OrganizationDataRetention> {
    return this._client.get('/organization/data_retention', {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates organization data retention controls.
   *
   * @example
   * ```ts
   * const organizationDataRetention =
   *   await client.admin.organization.dataRetention.update({
   *     retention_type: 'zero_data_retention',
   *   });
   * ```
   */
  update(body: DataRetentionUpdateParams, options?: RequestOptions): APIPromise<OrganizationDataRetention> {
    return this._client.post('/organization/data_retention', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

/**
 * Represents the organization's data retention control setting.
 */
export interface OrganizationDataRetention {
  /**
   * The object type, which is always `organization.data_retention`.
   */
  object: 'organization.data_retention';

  /**
   * The configured organization data retention type.
   */
  type:
    | 'zero_data_retention'
    | 'modified_abuse_monitoring'
    | 'enhanced_zero_data_retention'
    | 'enhanced_modified_abuse_monitoring';
}

export interface DataRetentionUpdateParams {
  /**
   * The desired organization data retention type.
   */
  retention_type:
    | 'zero_data_retention'
    | 'modified_abuse_monitoring'
    | 'enhanced_zero_data_retention'
    | 'enhanced_modified_abuse_monitoring';
}

export declare namespace DataRetention {
  export {
    type OrganizationDataRetention as OrganizationDataRetention,
    type DataRetentionUpdateParams as DataRetentionUpdateParams,
  };
}
