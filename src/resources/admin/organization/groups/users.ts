// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Users extends APIResource {
  /**
   * Adds a user to a group.
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.groups.users.create(
   *     'group_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  create(groupID: string, body: UserCreateParams, options?: RequestOptions): APIPromise<UserCreateResponse> {
    return this._client.post(path`/organization/groups/${groupID}/users`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists the users assigned to a group.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationGroupUser of client.admin.organization.groups.users.list(
   *   'group_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    groupID: string,
    query: UserListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<OrganizationGroupUsersPage, OrganizationGroupUser> {
    return this._client.getAPIList(
      path`/organization/groups/${groupID}/users`,
      NextCursorPage<OrganizationGroupUser>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Removes a user from a group.
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.groups.users.delete(
   *     'user_id',
   *     { group_id: 'group_id' },
   *   );
   * ```
   */
  delete(userID: string, params: UserDeleteParams, options?: RequestOptions): APIPromise<UserDeleteResponse> {
    const { group_id } = params;
    return this._client.delete(path`/organization/groups/${group_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type OrganizationGroupUsersPage = NextCursorPage<OrganizationGroupUser>;

/**
 * Represents an individual user returned when inspecting group membership.
 */
export interface OrganizationGroupUser {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The email address of the user.
   */
  email: string | null;

  /**
   * The name of the user.
   */
  name: string;
}

/**
 * Confirmation payload returned after adding a user to a group.
 */
export interface UserCreateResponse {
  /**
   * Identifier of the group the user was added to.
   */
  group_id: string;

  /**
   * Always `group.user`.
   */
  object: 'group.user';

  /**
   * Identifier of the user that was added.
   */
  user_id: string;
}

/**
 * Confirmation payload returned after removing a user from a group.
 */
export interface UserDeleteResponse {
  /**
   * Whether the group membership was removed.
   */
  deleted: boolean;

  /**
   * Always `group.user.deleted`.
   */
  object: 'group.user.deleted';
}

export interface UserCreateParams {
  /**
   * Identifier of the user to add to the group.
   */
  user_id: string;
}

export interface UserListParams extends NextCursorPageParams {
  /**
   * Specifies the sort order of users in the list.
   */
  order?: 'asc' | 'desc';
}

export interface UserDeleteParams {
  /**
   * The ID of the group to update.
   */
  group_id: string;
}

export declare namespace Users {
  export {
    type OrganizationGroupUser as OrganizationGroupUser,
    type UserCreateResponse as UserCreateResponse,
    type UserDeleteResponse as UserDeleteResponse,
    type OrganizationGroupUsersPage as OrganizationGroupUsersPage,
    type UserCreateParams as UserCreateParams,
    type UserListParams as UserListParams,
    type UserDeleteParams as UserDeleteParams,
  };
}
