// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Roles extends APIResource {
  /**
   * Creates a custom role for the organization.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.create({
   *   permissions: ['string'],
   *   role_name: 'role_name',
   * });
   * ```
   */
  create(body: RoleCreateParams, options?: RequestOptions): APIPromise<Role> {
    return this._client.post('/organization/roles', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates an existing organization role.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.update(
   *   'role_id',
   * );
   * ```
   */
  update(roleID: string, body: RoleUpdateParams, options?: RequestOptions): APIPromise<Role> {
    return this._client.post(path`/organization/roles/${roleID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists the roles configured for the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const role of client.admin.organization.roles.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: RoleListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<RolesPage, Role> {
    return this._client.getAPIList('/organization/roles', NextCursorPage<Role>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Deletes a custom role from the organization.
   *
   * @example
   * ```ts
   * const role = await client.admin.organization.roles.delete(
   *   'role_id',
   * );
   * ```
   */
  delete(roleID: string, options?: RequestOptions): APIPromise<RoleDeleteResponse> {
    return this._client.delete(path`/organization/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type RolesPage = NextCursorPage<Role>;

/**
 * Details about a role that can be assigned through the public Roles API.
 */
export interface Role {
  /**
   * Identifier for the role.
   */
  id: string;

  /**
   * Optional description of the role.
   */
  description: string | null;

  /**
   * Unique name for the role.
   */
  name: string;

  /**
   * Always `role`.
   */
  object: 'role';

  /**
   * Permissions granted by the role.
   */
  permissions: Array<string>;

  /**
   * Whether the role is predefined and managed by OpenAI.
   */
  predefined_role: boolean;

  /**
   * Resource type the role is bound to (for example `api.organization` or
   * `api.project`).
   */
  resource_type: string;
}

/**
 * Confirmation payload returned after deleting a role.
 */
export interface RoleDeleteResponse {
  /**
   * Identifier of the deleted role.
   */
  id: string;

  /**
   * Whether the role was deleted.
   */
  deleted: boolean;

  /**
   * Always `role.deleted`.
   */
  object: 'role.deleted';
}

export interface RoleCreateParams {
  /**
   * Permissions to grant to the role.
   */
  permissions: Array<string>;

  /**
   * Unique name for the role.
   */
  role_name: string;

  /**
   * Optional description of the role.
   */
  description?: string | null;
}

export interface RoleUpdateParams {
  /**
   * New description for the role.
   */
  description?: string | null;

  /**
   * Updated set of permissions for the role.
   */
  permissions?: Array<string> | null;

  /**
   * New name for the role.
   */
  role_name?: string | null;
}

export interface RoleListParams extends NextCursorPageParams {
  /**
   * Sort order for the returned roles.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Roles {
  export {
    type Role as Role,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RolesPage as RolesPage,
    type RoleCreateParams as RoleCreateParams,
    type RoleUpdateParams as RoleUpdateParams,
    type RoleListParams as RoleListParams,
  };
}
