// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as ServiceAccountsAPI from './service-accounts';
import * as UsersAPI from './users/users';
import { APIPromise } from '../../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class APIKeys extends APIResource {
  /**
   * Retrieves an API key in the project.
   *
   * @example
   * ```ts
   * const projectAPIKey =
   *   await client.admin.organization.projects.apiKeys.retrieve(
   *     'key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(keyID: string, params: APIKeyRetrieveParams, options?: RequestOptions): APIPromise<ProjectAPIKey> {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Returns a list of API keys in the project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectAPIKey of client.admin.organization.projects.apiKeys.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query: APIKeyListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectAPIKeysPage, ProjectAPIKey> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/api_keys`,
      ConversationCursorPage<ProjectAPIKey>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Deletes an API key from the project.
   *
   * Returns confirmation of the key deletion, or an error if the key belonged to a
   * service account.
   *
   * @example
   * ```ts
   * const apiKey =
   *   await client.admin.organization.projects.apiKeys.delete(
   *     'key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(
    keyID: string,
    params: APIKeyDeleteParams,
    options?: RequestOptions,
  ): APIPromise<APIKeyDeleteResponse> {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectAPIKeysPage = ConversationCursorPage<ProjectAPIKey>;

/**
 * Represents an individual API key in a project.
 */
export interface ProjectAPIKey {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the API key was created
   */
  created_at: number;

  /**
   * The Unix timestamp (in seconds) of when the API key was last used.
   */
  last_used_at: number;

  /**
   * The name of the API key
   */
  name: string;

  /**
   * The object type, which is always `organization.project.api_key`
   */
  object: 'organization.project.api_key';

  owner: ProjectAPIKey.Owner;

  /**
   * The redacted value of the API key
   */
  redacted_value: string;
}

export namespace ProjectAPIKey {
  export interface Owner {
    /**
     * Represents an individual service account in a project.
     */
    service_account?: ServiceAccountsAPI.ProjectServiceAccount;

    /**
     * `user` or `service_account`
     */
    type?: 'user' | 'service_account';

    /**
     * Represents an individual user in a project.
     */
    user?: UsersAPI.ProjectUser;
  }
}

export interface APIKeyDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'organization.project.api_key.deleted';
}

export interface APIKeyRetrieveParams {
  /**
   * The ID of the project.
   */
  project_id: string;
}

export interface APIKeyListParams extends ConversationCursorPageParams {}

export interface APIKeyDeleteParams {
  /**
   * The ID of the project.
   */
  project_id: string;
}

export declare namespace APIKeys {
  export {
    type ProjectAPIKey as ProjectAPIKey,
    type APIKeyDeleteResponse as APIKeyDeleteResponse,
    type ProjectAPIKeysPage as ProjectAPIKeysPage,
    type APIKeyRetrieveParams as APIKeyRetrieveParams,
    type APIKeyListParams as APIKeyListParams,
    type APIKeyDeleteParams as APIKeyDeleteParams,
  };
}
