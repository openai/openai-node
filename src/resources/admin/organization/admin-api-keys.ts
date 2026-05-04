// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class AdminAPIKeys extends APIResource {
  /**
   * Create an organization admin API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.create({
   *     name: 'New Admin Key',
   *   });
   * ```
   */
  create(body: AdminAPIKeyCreateParams, options?: RequestOptions): APIPromise<AdminAPIKeyCreateResponse> {
    return this._client.post('/organization/admin_api_keys', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Retrieve a single organization API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.retrieve(
   *     'key_id',
   *   );
   * ```
   */
  retrieve(keyID: string, options?: RequestOptions): APIPromise<AdminAPIKey> {
    return this._client.get(path`/organization/admin_api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * List organization API keys
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const adminAPIKey of client.admin.organization.adminAPIKeys.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: AdminAPIKeyListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AdminAPIKeysPage, AdminAPIKey> {
    return this._client.getAPIList('/organization/admin_api_keys', CursorPage<AdminAPIKey>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Delete an organization admin API key
   *
   * @example
   * ```ts
   * const adminAPIKey =
   *   await client.admin.organization.adminAPIKeys.delete(
   *     'key_id',
   *   );
   * ```
   */
  delete(keyID: string, options?: RequestOptions): APIPromise<AdminAPIKeyDeleteResponse> {
    return this._client.delete(path`/organization/admin_api_keys/${keyID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type AdminAPIKeysPage = CursorPage<AdminAPIKey>;

/**
 * Represents an individual Admin API key in an org.
 */
export interface AdminAPIKey {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the API key was created
   */
  created_at: number;

  /**
   * The object type, which is always `organization.admin_api_key`
   */
  object: 'organization.admin_api_key';

  owner: AdminAPIKey.Owner;

  /**
   * The redacted value of the API key
   */
  redacted_value: string;

  /**
   * The Unix timestamp (in seconds) of when the API key was last used
   */
  last_used_at?: number | null;

  /**
   * The name of the API key
   */
  name?: string | null;
}

export namespace AdminAPIKey {
  export interface Owner {
    /**
     * The identifier, which can be referenced in API endpoints
     */
    id?: string;

    /**
     * The Unix timestamp (in seconds) of when the user was created
     */
    created_at?: number;

    /**
     * The name of the user
     */
    name?: string;

    /**
     * The object type, which is always organization.user
     */
    object?: string;

    /**
     * Always `owner`
     */
    role?: string;

    /**
     * Always `user`
     */
    type?: string;
  }
}

/**
 * Represents an individual Admin API key in an org.
 */
export interface AdminAPIKeyCreateResponse extends AdminAPIKey {
  /**
   * The value of the API key. Only shown on create.
   */
  value: string;
}

export interface AdminAPIKeyDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'organization.admin_api_key.deleted';
}

export interface AdminAPIKeyCreateParams {
  name: string;
}

export interface AdminAPIKeyListParams extends CursorPageParams {
  /**
   * Order results by creation time, ascending or descending.
   */
  order?: 'asc' | 'desc';
}

export declare namespace AdminAPIKeys {
  export {
    type AdminAPIKey as AdminAPIKey,
    type AdminAPIKeyCreateResponse as AdminAPIKeyCreateResponse,
    type AdminAPIKeyDeleteResponse as AdminAPIKeyDeleteResponse,
    type AdminAPIKeysPage as AdminAPIKeysPage,
    type AdminAPIKeyCreateParams as AdminAPIKeyCreateParams,
    type AdminAPIKeyListParams as AdminAPIKeyListParams,
  };
}
