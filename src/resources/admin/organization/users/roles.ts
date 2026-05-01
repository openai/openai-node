// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as RolesAPI from '../roles';
import * as UsersAPI from './users';
import { APIPromise } from '../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Roles extends APIResource {
  /**
   * Assigns an organization role to a user within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.create(
   *     'user_id',
   *     { role_id: 'role_id' },
   *   );
   * ```
   */
  create(userID: string, body: RoleCreateParams, options?: RequestOptions): APIPromise<RoleCreateResponse> {
    return this._client.post(path`/organization/users/${userID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists the organization roles assigned to a user within the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const roleListResponse of client.admin.organization.users.roles.list(
   *   'user_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    userID: string,
    query: RoleListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<RoleListResponsesPage, RoleListResponse> {
    return this._client.getAPIList(
      path`/organization/users/${userID}/roles`,
      NextCursorPage<RoleListResponse>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Unassigns an organization role from a user within the organization.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.delete(
   *     'role_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  delete(roleID: string, params: RoleDeleteParams, options?: RequestOptions): APIPromise<RoleDeleteResponse> {
    const { user_id } = params;
    return this._client.delete(path`/organization/users/${user_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type RoleListResponsesPage = NextCursorPage<RoleListResponse>;

/**
 * Role assignment linking a user to a role.
 */
export interface RoleCreateResponse {
  /**
   * Always `user.role`.
   */
  object: 'user.role';

  /**
   * Details about a role that can be assigned through the public Roles API.
   */
  role: RolesAPI.Role;

  /**
   * Represents an individual `user` within an organization.
   */
  user: UsersAPI.OrganizationUser;
}

/**
 * Detailed information about a role assignment entry returned when listing
 * assignments.
 */
export interface RoleListResponse {
  /**
   * Identifier for the role.
   */
  id: string;

  /**
   * When the role was created.
   */
  created_at: number | null;

  /**
   * Identifier of the actor who created the role.
   */
  created_by: string | null;

  /**
   * User details for the actor that created the role, when available.
   */
  created_by_user_obj: { [key: string]: unknown } | null;

  /**
   * Description of the role.
   */
  description: string | null;

  /**
   * Arbitrary metadata stored on the role.
   */
  metadata: { [key: string]: unknown } | null;

  /**
   * Name of the role.
   */
  name: string;

  /**
   * Permissions associated with the role.
   */
  permissions: Array<string>;

  /**
   * Whether the role is predefined by OpenAI.
   */
  predefined_role: boolean;

  /**
   * Resource type the role applies to.
   */
  resource_type: string;

  /**
   * When the role was last updated.
   */
  updated_at: number | null;
}

/**
 * Confirmation payload returned after unassigning a role.
 */
export interface RoleDeleteResponse {
  /**
   * Whether the assignment was removed.
   */
  deleted: boolean;

  /**
   * Identifier for the deleted assignment, such as `group.role.deleted` or
   * `user.role.deleted`.
   */
  object: string;
}

export interface RoleCreateParams {
  /**
   * Identifier of the role to assign.
   */
  role_id: string;
}

export interface RoleListParams extends NextCursorPageParams {
  /**
   * Sort order for the returned organization roles.
   */
  order?: 'asc' | 'desc';
}

export interface RoleDeleteParams {
  /**
   * The ID of the user to modify.
   */
  user_id: string;
}

export declare namespace Roles {
  export {
    type RoleCreateResponse as RoleCreateResponse,
    type RoleListResponse as RoleListResponse,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RoleListResponsesPage as RoleListResponsesPage,
    type RoleCreateParams as RoleCreateParams,
    type RoleListParams as RoleListParams,
    type RoleDeleteParams as RoleDeleteParams,
  };
}
