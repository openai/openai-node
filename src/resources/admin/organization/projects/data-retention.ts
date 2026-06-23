// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class DataRetention extends APIResource {
  /**
   * Retrieves project data retention controls.
   *
   * @example
   * ```ts
   * const projectDataRetention =
   *   await client.admin.organization.projects.dataRetention.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectDataRetention> {
    return this._client.get(path`/organization/projects/${projectID}/data_retention`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates project data retention controls.
   *
   * @example
   * ```ts
   * const projectDataRetention =
   *   await client.admin.organization.projects.dataRetention.update(
   *     'project_id',
   *     { retention_type: 'organization_default' },
   *   );
   * ```
   */
  update(
    projectID: string,
    body: DataRetentionUpdateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectDataRetention> {
    return this._client.post(path`/organization/projects/${projectID}/data_retention`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

/**
 * Represents a project's data retention control setting.
 */
export interface ProjectDataRetention {
  /**
   * The object type, which is always `project.data_retention`.
   */
  object: 'project.data_retention';

  /**
   * The configured project data retention type.
   */
  type:
    | 'organization_default'
    | 'none'
    | 'zero_data_retention'
    | 'modified_abuse_monitoring'
    | 'enhanced_zero_data_retention'
    | 'enhanced_modified_abuse_monitoring';
}

export interface DataRetentionUpdateParams {
  /**
   * The desired project data retention type.
   */
  retention_type:
    | 'organization_default'
    | 'none'
    | 'zero_data_retention'
    | 'modified_abuse_monitoring'
    | 'enhanced_zero_data_retention'
    | 'enhanced_modified_abuse_monitoring';
}

export declare namespace DataRetention {
  export {
    type ProjectDataRetention as ProjectDataRetention,
    type DataRetentionUpdateParams as DataRetentionUpdateParams,
  };
}
