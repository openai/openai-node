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
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../../core/pagination';
import { RequestOptions } from '../../../../../internal/request-options';
import { path } from '../../../../../internal/utils/path';

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

export class Users extends APIResource {
  roles: RolesAPI.Roles = new RolesAPI.Roles(this._client);

  /**
   * Adds a user to the project. Users must already be members of the organization to
   * be added to a project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.create(
   *     'project_id',
   *     { role: 'role' },
   *   );
   * ```
   */
  create(projectID: string, body: UserCreateParams, options?: RequestOptions): APIPromise<ProjectUser> {
    return this._client.post(path`/organization/projects/${projectID}/users`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Retrieves a user in the project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.retrieve(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  retrieve(userID: string, params: UserRetrieveParams, options?: RequestOptions): APIPromise<ProjectUser> {
    const { project_id } = params;
    return this._client.get(path`/organization/projects/${project_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Modifies a user's role in the project.
   *
   * @example
   * ```ts
   * const projectUser =
   *   await client.admin.organization.projects.users.update(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  update(userID: string, params: UserUpdateParams, options?: RequestOptions): APIPromise<ProjectUser> {
    const { project_id, ...body } = params;
    return this._client.post(path`/organization/projects/${project_id}/users/${userID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Returns a list of users in the project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const projectUser of client.admin.organization.projects.users.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query?:
      | (UserListParams &
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
  ): PagePromise<ProjectUsersPage, ProjectUser>;
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
  ): PagePromise<ProjectUsersPage, ProjectUser>;
  list(
    projectID: string,
    query:
      | UserListParams
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
  ): PagePromise<ProjectUsersPage, ProjectUser> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as UserListParams | null | undefined;
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/users`,
      ConversationCursorPage<ProjectUser>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Deletes a user from the project.
   *
   * Returns confirmation of project user deletion, or an error if the project is
   * archived (archived projects have no users).
   *
   * @example
   * ```ts
   * const user =
   *   await client.admin.organization.projects.users.delete(
   *     'user_id',
   *     { project_id: 'project_id' },
   *   );
   * ```
   */
  delete(userID: string, params: UserDeleteParams, options?: RequestOptions): APIPromise<UserDeleteResponse> {
    const { project_id } = params;
    return this._client.delete(path`/organization/projects/${project_id}/users/${userID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectUsersPage = ConversationCursorPage<ProjectUser>;

/**
 * Represents an individual user in a project.
 */
export interface ProjectUser {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the project was added.
   */
  added_at: number;

  /**
   * The object type, which is always `organization.project.user`
   */
  object: 'organization.project.user';

  /**
   * `owner` or `member`
   */
  role: string;

  /**
   * The email address of the user
   */
  email?: string | null;

  /**
   * The name of the user
   */
  name?: string | null;
}

export interface UserDeleteResponse {
  id: string;

  deleted: boolean;

  object: 'organization.project.user.deleted';
}

export interface UserCreateParams {
  /**
   * `owner` or `member`
   */
  role: string;

  /**
   * Email of the user to add.
   */
  email?: string | null;

  /**
   * The ID of the user.
   */
  user_id?: string | null;
}

export interface UserRetrieveParams {
  /**
   * The ID of the project.
   */
  project_id: string;
}

export interface UserUpdateParams {
  /**
   * Path param: The ID of the project.
   */
  project_id: string;

  /**
   * Body param: `owner` or `member`
   */
  role?: string | null;
}

export interface UserListParams extends ConversationCursorPageParams {}

export interface UserDeleteParams {
  /**
   * The ID of the project.
   */
  project_id: string;
}

Users.Roles = Roles;

export declare namespace Users {
  export {
    type ProjectUser as ProjectUser,
    type UserDeleteResponse as UserDeleteResponse,
    type ProjectUsersPage as ProjectUsersPage,
    type UserCreateParams as UserCreateParams,
    type UserRetrieveParams as UserRetrieveParams,
    type UserUpdateParams as UserUpdateParams,
    type UserListParams as UserListParams,
    type UserDeleteParams as UserDeleteParams,
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
