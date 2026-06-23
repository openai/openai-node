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

export class APIKeys extends APIResource {
  /**
   * Retrieves an API key in the project.
   *
   * @example
   * ```ts
   * const projectAPIKey =
   *   await client.admin.organization.projects.apiKeys.retrieve(
   *     'api_key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(
    apiKeyID: string,
    params: APIKeyRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<ProjectAPIKey> {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/api_keys/${apiKeyID}`, {
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
   *     'api_key_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(
    apiKeyID: string,
    params: APIKeyDeleteParams,
    options?: RequestOptions,
  ): APIPromise<APIKeyDeleteResponse> {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/api_keys/${apiKeyID}`, {
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
  last_used_at: number | null;

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
     * The service account that owns a project API key.
     */
    service_account?: Owner.ServiceAccount;

    /**
     * `user` or `service_account`
     */
    type?: 'user' | 'service_account';

    /**
     * The user that owns a project API key.
     */
    user?: Owner.User;
  }

  export namespace Owner {
    /**
     * The service account that owns a project API key.
     */
    export interface ServiceAccount {
      /**
       * The identifier, which can be referenced in API endpoints
       */
      id: string;

      /**
       * The Unix timestamp (in seconds) of when the service account was created.
       */
      created_at: number;

      /**
       * The name of the service account.
       */
      name: string;

      /**
       * The service account's project role.
       */
      role: string;
    }

    /**
     * The user that owns a project API key.
     */
    export interface User {
      /**
       * The identifier, which can be referenced in API endpoints
       */
      id: string;

      /**
       * The Unix timestamp (in seconds) of when the user was created.
       */
      created_at: number;

      /**
       * The email address of the user.
       */
      email: string;

      /**
       * The name of the user.
       */
      name: string;

      /**
       * The user's project role.
       */
      role: string;
    }
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
