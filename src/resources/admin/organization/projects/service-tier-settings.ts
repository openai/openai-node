// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class ServiceTierSettings extends APIResource {
  /**
   * Retrieve the configured default and enabled service tiers for a project.
   *
   * @example
   * ```ts
   * const projectServiceTierSettings =
   *   await client.admin.organization.projects.serviceTierSettings.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectServiceTierSettings> {
    return this._client.get(
      path`/organization/projects/${projectID}/service_tier_settings`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Update the default or enabled service tiers atomically. Supply at least one
   * field. Omitted fields keep their current values.
   *
   * @example
   * ```ts
   * const projectServiceTierSettings =
   *   await client.admin.organization.projects.serviceTierSettings.update(
   *     'project_id',
   *     { default: 'standard' },
   *   );
   * ```
   */
  update(
    projectID: string,
    body: ServiceTierSettingUpdateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectServiceTierSettings> {
    return this._client.post(
      path`/organization/projects/${projectID}/service_tier_settings`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }
}

export type ProjectOptionalServiceTier = 'flex' | 'fast' | 'ultrafast';

export interface ProjectServiceTierSettings {
  /**
   * Default tier for requests that omit service_tier or use auto.
   */
  default: 'standard' | 'fast' | 'scale';

  /**
   * Additional service tiers enabled for this project. "all" includes future tiers.
   * An empty array allows only Standard. Organization policy and eligibility still
   * apply.
   */
  enabled_tiers: 'all' | Array<ProjectOptionalServiceTier>;

  object: 'project.service_tier_settings';
}

export interface ServiceTierSettingUpdateParams {
  /**
   * Default tier for requests that omit service_tier or use auto.
   */
  default?: 'standard' | 'fast' | 'scale';

  /**
   * Additional service tiers enabled for this project. "all" includes future tiers.
   * An empty array allows only Standard. Organization policy and eligibility still
   * apply.
   */
  enabled_tiers?: 'all' | Array<ProjectOptionalServiceTier>;
}

export declare namespace ServiceTierSettings {
  export {
    type ProjectOptionalServiceTier as ProjectOptionalServiceTier,
    type ProjectServiceTierSettings as ProjectServiceTierSettings,
    type ServiceTierSettingUpdateParams as ServiceTierSettingUpdateParams,
  };
}
