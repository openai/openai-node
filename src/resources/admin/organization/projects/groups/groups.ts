// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

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
  RoleRetrieveParams,
  RoleRetrieveResponse,
  Roles,
} from './roles';
import { APIPromise } from '../../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../../core/pagination';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

// Recognizable options across SDK runtime versions. Keep this independent of
// private RequestOptions fields so older handwritten runtimes still compile.
const normalizeRequestOptionsForQueryKeys = new Set([
  'method',
  'path',
  'query',
  'body',
  'headers',
  'maxRetries',
  'stream',
  'timeout',
  'httpAgent',
  'fetchOptions',
  'signal',
  'idempotencyKey',
  'defaultBaseURL',
  '__metadata',
  '__binaryRequest',
  '__binaryResponse',
  '__streamClass',
  '__security',
  '__synthesizeEventData',
]);

function normalizeRequestOptionsForQuery(
  value: unknown,
  queryKeys: ReadonlyArray<string>,
  options: RequestOptions | undefined,
):
  | ({
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    })
  | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Optional never fields can still be explicitly undefined unless consumers
  // enable exactOptionalPropertyTypes. Snapshot data without invoking getters.
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([, descriptor]) => descriptor.enumerable && (!('value' in descriptor) || descriptor.value !== undefined),
  );
  const keys = entries.map(([key]) => key);
  const requestOnly = keys.some(
    (key) => normalizeRequestOptionsForQueryKeys.has(key) && !queryKeys.includes(key),
  );
  if (!requestOnly) return undefined;
  // Declared query fields, including stream, must use the query argument.
  // Mixing them with request-only options is ambiguous and could change the return type.
  if (
    options !== undefined ||
    keys.some((key) => !normalizeRequestOptionsForQueryKeys.has(key) || queryKeys.includes(key))
  ) {
    throw new TypeError('Query parameters and request options must be passed as separate arguments.');
  }
  // The query position must not gain authority to change the request destination
  // or transport. Those overrides require the explicit request options argument.
  if (
    keys.some(
      (key) => !['headers', 'maxRetries', 'timeout', 'signal', 'idempotencyKey', 'query'].includes(key),
    )
  ) {
    throw new TypeError('Pass transport overrides in the explicit request options argument.');
  }
  // Copy only the validated fields. Spreading value would reintroduce undefined
  // transport overrides, and deleting them would mutate the caller's object.
  return Object.fromEntries(
    entries.map(([key, descriptor]) => {
      if ('value' in descriptor) return [key, descriptor.value];
      return [key, descriptor.get ? Reflect.apply(descriptor.get, value, []) : undefined];
    }),
  ) as {
    [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
  } & {
    [
      K in
        | 'method'
        | 'path'
        | 'body'
        | 'stream'
        | 'httpAgent'
        | 'fetchOptions'
        | 'defaultBaseURL'
        | '__metadata'
        | '__binaryRequest'
        | '__binaryResponse'
        | '__streamClass'
        | '__security'
        | '__synthesizeEventData'
    ]?: never;
  };
}

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
    return this._client.post(
      path`/organization/projects/${projectID}/groups`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Retrieves a project's group.
   *
   * @example
   * ```ts
   * const projectGroup =
   *   await client.admin.organization.projects.groups.retrieve(
   *     'group_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(groupID: string, params: GroupRetrieveParams, options?: RequestOptions): APIPromise<ProjectGroup> {
    const { project_id, ...query } = params;
    return this._client.get(
      path`/organization/projects/${project_id}/groups/${groupID}`,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
    query?:
      | (GroupListParams &
          (
            | {
                [
                  K in
                    | 'method'
                    | 'path'
                    | 'query'
                    | 'body'
                    | 'headers'
                    | 'maxRetries'
                    | 'stream'
                    | 'timeout'
                    | 'httpAgent'
                    | 'fetchOptions'
                    | 'signal'
                    | 'idempotencyKey'
                    | 'defaultBaseURL'
                    | '__metadata'
                    | '__binaryRequest'
                    | '__binaryResponse'
                    | '__streamClass'
                    | '__security'
                    | '__synthesizeEventData'
                ]?: never;
              }
            | null
            | undefined
          ))
      | null
      | undefined,
    options?: RequestOptions,
  ): PagePromise<ProjectGroupsPage, ProjectGroup>;
  list(
    projectID: string,
    options?: {
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    },
  ): PagePromise<ProjectGroupsPage, ProjectGroup>;
  list(
    projectID: string,
    query:
      | GroupListParams
      | ({
          [
            K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query'
          ]?: RequestOptions[K];
        } & {
          [
            K in
              | 'method'
              | 'path'
              | 'body'
              | 'stream'
              | 'httpAgent'
              | 'fetchOptions'
              | 'defaultBaseURL'
              | '__metadata'
              | '__binaryRequest'
              | '__binaryResponse'
              | '__streamClass'
              | '__security'
              | '__synthesizeEventData'
          ]?: never;
        })
      | null
      | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectGroupsPage, ProjectGroup> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as GroupListParams | null | undefined;
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/groups`,
      NextCursorPage<ProjectGroup>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
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
    return this._client.delete(
      path`/organization/projects/${project_id}/groups/${groupID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
  group_type: 'group' | 'tenant_group';

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

export interface GroupRetrieveParams {
  /**
   * Path param: The ID of the project to inspect.
   */
  project_id: string;

  /**
   * Query param: The type of group to retrieve.
   */
  group_type?: 'group' | 'tenant_group';
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
    type GroupRetrieveParams as GroupRetrieveParams,
    type GroupListParams as GroupListParams,
    type GroupDeleteParams as GroupDeleteParams,
  };

  export {
    Roles as Roles,
    type RoleCreateResponse as RoleCreateResponse,
    type RoleRetrieveResponse as RoleRetrieveResponse,
    type RoleListResponse as RoleListResponse,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RoleListResponsesPage as RoleListResponsesPage,
    type RoleCreateParams as RoleCreateParams,
    type RoleRetrieveParams as RoleRetrieveParams,
    type RoleListParams as RoleListParams,
    type RoleDeleteParams as RoleDeleteParams,
  };
}
