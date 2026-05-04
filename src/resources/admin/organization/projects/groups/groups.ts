// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../../core/resource';
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
import { APIPromise } from '../../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../../core/pagination';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

export class Groups extends APIResource {
  roles: RolesAPI.Roles = new RolesAPI.Roles(this._client);

  /**
   * Grants a group access to a project.
   *
   * @example
   * ```ts
   * const projectGroup =
   *   await client.admin.organization.projects.groups.create(
   *     'project_id',
   *     { group_id: 'group_id', role: 'role' },
   *   );
   * ```
   */
  create(projectID: string, body: GroupCreateParams, options?: RequestOptions): APIPromise<ProjectGroup> {
    return this._client.post(path`/organization/projects/${projectID}/groups`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Lists the groups that have access to a project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectGroup of client.admin.organization.projects.groups.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query: GroupListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectGroupsPage, ProjectGroup> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/groups`,
      NextCursorPage<ProjectGroup>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Revokes a group's access to a project.
   *
   * @example
   * ```ts
   * const group =
   *   await client.admin.organization.projects.groups.delete(
   *     'group_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(
    groupID: string,
    params: GroupDeleteParams,
    options?: RequestOptions,
  ): APIPromise<GroupDeleteResponse> {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/groups/${groupID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectGroupsPage = NextCursorPage<ProjectGroup>;

/**
 * Details about a group's membership in a project.
 */
export interface ProjectGroup {
  /**
   * Unix timestamp (in seconds) when the group was granted project access.
   */
  created_at: number;

  /**
   * Identifier of the group that has access to the project.
   */
  group_id: string;

  /**
   * Display name of the group.
   */
  group_name: string;

  /**
   * The type of the group.
   */
  group_type: string;

  /**
   * Always `project.group`.
   */
  object: 'project.group';

  /**
   * Identifier of the project.
   */
  project_id: string;
}

/**
 * Confirmation payload returned after removing a group from a project.
 */
export interface GroupDeleteResponse {
  /**
   * Whether the group membership in the project was removed.
   */
  deleted: boolean;

  /**
   * Always `project.group.deleted`.
   */
  object: 'project.group.deleted';
}

export interface GroupCreateParams {
  /**
   * Identifier of the group to add to the project.
   */
  group_id: string;

  /**
   * Identifier of the project role to grant to the group.
   */
  role: string;
}

export interface GroupListParams extends NextCursorPageParams {
  /**
   * Sort order for the returned groups.
   */
  order?: 'asc' | 'desc';
}

export interface GroupDeleteParams {
  /**
   * The ID of the project to update.
   */
  project_id: string;
}

Groups.Roles = Roles;

export declare namespace Groups {
  export {
    type ProjectGroup as ProjectGroup,
    type GroupDeleteResponse as GroupDeleteResponse,
    type ProjectGroupsPage as ProjectGroupsPage,
    type GroupCreateParams as GroupCreateParams,
    type GroupListParams as GroupListParams,
    type GroupDeleteParams as GroupDeleteParams,
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
