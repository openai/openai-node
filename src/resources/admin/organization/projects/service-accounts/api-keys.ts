// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../core/resource';
import { APIPromise } from '../../../../../core/api-promise';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

export class APIKeys extends APIResource {
  /**
   * Creates an API key for a service account in the project.
   *
   * @example
   * ```ts
   * const apiKey =
   *   await client.admin.organization.projects.serviceAccounts.apiKeys.create(
   *     'service_account_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  create(
    serviceAccountID: string,
    params: APIKeyCreateParams,
    options?: RequestOptions,
  ): APIPromise<APIKeyCreateResponse> {
    const { project_id, ...body } = params;
    return this._client.post(
      path`/organization/projects/${project_id}/service_accounts/${serviceAccountID}/api_keys`,
      { body, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }
}

export interface APIKeyCreateResponse {
  /**
   * The identifier of the API key.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) when the API key was created.
   */
  created_at: number;

  /**
   * The name of the API key.
   */
  name: string;

  /**
   * The object type, which is always `organization.project.service_account.api_key`
   */
  object: 'organization.project.service_account.api_key';

  /**
   * The unredacted API key value.
   */
  value: string;
}

export interface APIKeyCreateParams {
  /**
   * Path param: The ID of the project.
   */
  project_id: string;

  /**
   * Body param: API key name.
   */
  name?: string;

  /**
   * Body param: API key scopes.
   */
  scopes?: Array<string>;
}

export declare namespace APIKeys {
  export { type APIKeyCreateResponse as APIKeyCreateResponse, type APIKeyCreateParams as APIKeyCreateParams };
}
