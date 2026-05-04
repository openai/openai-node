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
   *   await client.admin.organization.users.update('user_id');
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
   * The object type, which is always `organization.user`
   */
  object: 'organization.user';

  /**
   * The Unix timestamp (in seconds) of the user's last API key usage.
   */
  api_key_last_used_at?: number | null;

  /**
   * The Unix timestamp (in seconds) of when the user was created.
   */
  created?: number;

  /**
   * The developer persona metadata for the user.
   */
  developer_persona?: string | null;

  /**
   * The email address of the user
   */
  email?: string | null;

  /**
   * Whether this is the organization's default user.
   */
  is_default?: boolean;

  /**
   * Whether the user is an authorized purchaser for Scale Tier.
   */
  is_scale_tier_authorized_purchaser?: boolean | null;

  /**
   * Whether the user is managed through SCIM.
   */
  is_scim_managed?: boolean;

  /**
   * Whether the user is a service account.
   */
  is_service_account?: boolean;

  /**
   * The name of the user
   */
  name?: string | null;

  /**
   * Projects associated with the user, if included.
   */
  projects?: OrganizationUser.Projects | null;

  /**
   * `owner` or `reader`
   */
  role?: string | null;

  /**
   * The technical level metadata for the user.
   */
  technical_level?: string | null;

  /**
   * Nested user details.
   */
  user?: OrganizationUser.User;
}

export namespace OrganizationUser {
  /**
   * Projects associated with the user, if included.
   */
  export interface Projects {
    data: Array<Projects.Data>;

    object: 'list';
  }

  export namespace Projects {
    export interface Data {
      id?: string | null;

      name?: string | null;

      role?: string | null;
    }
  }

  /**
   * Nested user details.
   */
  export interface User {
    id: string;

    object: 'user';

    banned?: boolean | null;

    banned_at?: number | null;

    email?: string | null;

    enabled?: boolean | null;

    name?: string | null;

    picture?: string | null;
  }
}

export interface UserDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'organization.user.deleted';
}

export interface UserUpdateParams {
  /**
   * Developer persona metadata.
   */
  developer_persona?: string | null;

  /**
   * `owner` or `reader`
   */
  role?: string | null;

  /**
   * Role ID to assign to the user.
   */
  role_id?: string | null;

  /**
   * Technical level metadata.
   */
  technical_level?: string | null;
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
