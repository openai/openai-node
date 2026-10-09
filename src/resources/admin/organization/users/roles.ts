// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as RolesAPI from '../roles';
import * as UsersAPI from './users';
import { APIPromise } from '../../../../core/api-promise';
import { NextCursorPage, type NextCursorPageParams, PagePromise } from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

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
    return this._client.post(
      path`/organization/users/${userID}/roles`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Retrieves an organization role assigned to a user.
   *
   * @example
   * ```ts
   * const role =
   *   await client.admin.organization.users.roles.retrieve(
   *     'role_id',
   *     { user_id: 'user_id' },
   *   );
   * ```
   */
  retrieve(
    roleID: string,
    params: RoleRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<RoleRetrieveResponse> {
    const { user_id } = params;
    return this._client.get(
      path`/organization/users/${user_id}/roles/${roleID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
    query?:
      | (RoleListParams &
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
  ): PagePromise<RoleListResponsesPage, RoleListResponse>;
  list(
    userID: string,
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
  ): PagePromise<RoleListResponsesPage, RoleListResponse>;
  list(
    userID: string,
    query:
      | RoleListParams
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
  ): PagePromise<RoleListResponsesPage, RoleListResponse> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as RoleListParams | null | undefined;
    return this._client.getAPIList(
      path`/organization/users/${userID}/roles`,
      NextCursorPage<RoleListResponse>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
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
    return this._client.delete(
      path`/organization/users/${user_id}/roles/${roleID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
export interface RoleRetrieveResponse {
  /**
   * Identifier for the role.
   */
  id: string;

  /**
   * Principals from which the role assignment is inherited, when available.
   */
  assignment_sources: Array<RoleRetrieveResponse.AssignmentSource> | null;

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

export namespace RoleRetrieveResponse {
  export interface AssignmentSource {
    principal_id: string;

    principal_type: string;
  }
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
   * Principals from which the role assignment is inherited, when available.
   */
  assignment_sources: Array<RoleListResponse.AssignmentSource> | null;

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

export namespace RoleListResponse {
  export interface AssignmentSource {
    principal_id: string;

    principal_type: string;
  }
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

export interface RoleRetrieveParams {
  /**
   * The ID of the user to inspect.
   */
  user_id: string;
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
