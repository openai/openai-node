// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as RolesAPI from './roles';
import {
  RoleCreateParams,
  RoleCreateResponse,
  RoleDeleteParams,
  RoleDeleteResponse,
  RoleListParams,
  RoleListResponse,
  RoleListResponsesPage,
  Roles,
} from './roles';
import { APIPromise } from '../../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Users extends APIResource {
  roles: RolesAPI.Roles = new RolesAPI.Roles(this._client);

  /**
   * Retrieves a user by their identifier.
   *
   * @example
   * ```ts
   * const organizationUser =
   *   await client.admin.organization.users.retrieve('user_id');
   * ```
   */
  retrieve(userID: string, options?: RequestOptions): APIPromise<OrganizationUser> {
    return this._client.get(path`/organization/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Modifies a user's role in the organization.
   *
   * @example
   * ```ts
   * const organizationUser =
   *   await client.admin.organization.users.update('user_id', {
   *     role: 'owner',
   *   });
   * ```
   */
  update(userID: string, body: UserUpdateParams, options?: RequestOptions): APIPromise<OrganizationUser> {
    return this._client.post(path`/organization/users/${userID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists all of the users in the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const organizationUser of client.admin.organization.users.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: UserListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<OrganizationUsersPage, OrganizationUser> {
    return this._client.getAPIList('/organization/users', ConversationCursorPage<OrganizationUser>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Deletes a user from the organization.
   *
   * @example
   * ```ts
   * const user = await client.admin.organization.users.delete(
   *   'user_id',
   * );
   * ```
   */
  delete(userID: string, options?: RequestOptions): APIPromise<UserDeleteResponse> {
    return this._client.delete(path`/organization/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type OrganizationUsersPage = ConversationCursorPage<OrganizationUser>;

/**
 * Represents an individual `user` within an organization.
 */
export interface OrganizationUser {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the user was added.
   */
  added_at: number;

  /**
   * The email address of the user
   */
  email: string;

  /**
   * The name of the user
   */
  name: string;

  /**
   * The object type, which is always `organization.user`
   */
  object: 'organization.user';

  /**
   * `owner` or `reader`
   */
  role: 'owner' | 'reader';
}

export interface UserDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'organization.user.deleted';
}

export interface UserUpdateParams {
  /**
   * `owner` or `reader`
   */
  role: 'owner' | 'reader';
}

export interface UserListParams extends ConversationCursorPageParams {
  /**
   * Filter by the email address of users.
   */
  emails?: Array<string>;
}

Users.Roles = Roles;

export declare namespace Users {
  export {
    type OrganizationUser as OrganizationUser,
    type UserDeleteResponse as UserDeleteResponse,
    type OrganizationUsersPage as OrganizationUsersPage,
    type UserUpdateParams as UserUpdateParams,
    type UserListParams as UserListParams,
  };

  export {
    Roles as Roles,
    type RoleCreateResponse as RoleCreateResponse,
    type RoleListResponse as RoleListResponse,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RoleListResponsesPage as RoleListResponsesPage,
    type RoleCreateParams as RoleCreateParams,
    type RoleListParams as RoleListParams,
    type RoleDeleteParams as RoleDeleteParams,
  };
}
