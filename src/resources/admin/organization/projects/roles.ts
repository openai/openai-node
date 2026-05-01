// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as RolesAPI from '../roles';
import { RolesPage } from '../roles';
import { APIPromise } from '../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Roles extends APIResource {
  /**
   * Creates a custom role for a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.create(
   *     'project_id',
   *     { permissions: ['string'], role_name: 'role_name' },
   *   );
   * ```
   */
  create(projectID: string, body: RoleCreateParams, options?: RequestOptions): APIPromise<RolesAPI.Role> {
    return this._client.post(path`/projects/${projectID}/roles`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates an existing project role.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.update(
   *     'role_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  update(roleID: string, params: RoleUpdateParams, options?: RequestOptions): APIPromise<RolesAPI.Role> {
    const { project_id, ...body } = params;
    return this._client.post(path`/projects/${project_id}/roles/${roleID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists the roles configured for a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const role of client.admin.organization.projects.roles.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query: RoleListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<RolesPage, RolesAPI.Role> {
    return this._client.getAPIList(path`/projects/${projectID}/roles`, NextCursorPage<RolesAPI.Role>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Deletes a custom role from a project.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.projects.roles.delete(
   *     'role_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(roleID: string, params: RoleDeleteParams, options?: RequestOptions): APIPromise<RoleDeleteResponse> {
    const { project_id } = params;
    return this._client.delete(path`/projects/${project_id}/roles/${roleID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
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
   * Path param: The ID of the project to update.
   */
  project_id: string;

  /**
   * Body param: New description for the role.
   */
  description?: string | null;

  /**
   * Body param: Updated set of permissions for the role.
   */
  permissions?: Array<string> | null;

  /**
   * Body param: New name for the role.
   */
  role_name?: string | null;
}

export interface RoleListParams extends NextCursorPageParams {
  /**
   * Sort order for the returned roles.
   */
  order?: 'asc' | 'desc';
}

export interface RoleDeleteParams {
  /**
   * The ID of the project to update.
   */
  project_id: string;
}

export declare namespace Roles {
  export {
    type RoleDeleteResponse as RoleDeleteResponse,
    type RoleCreateParams as RoleCreateParams,
    type RoleUpdateParams as RoleUpdateParams,
    type RoleListParams as RoleListParams,
    type RoleDeleteParams as RoleDeleteParams,
  };
}

export { type RolesPage };
