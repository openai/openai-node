// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as APIKeysAPI from './api-keys';
import {
  APIKeyDeleteParams,
  APIKeyDeleteResponse,
  APIKeyListParams,
  APIKeyRetrieveParams,
  APIKeys,
  ProjectAPIKey,
  ProjectAPIKeysPage,
} from './api-keys';
import * as CertificatesAPI from './certificates';
import {
  CertificateActivateParams,
  CertificateActivateResponse,
  CertificateActivateResponsesPage,
  CertificateDeactivateParams,
  CertificateDeactivateResponse,
  CertificateDeactivateResponsesPage,
  CertificateListParams,
  CertificateListResponse,
  CertificateListResponsesPage,
  Certificates,
} from './certificates';
import * as RateLimitsAPI from './rate-limits';
import {
  ProjectRateLimit,
  ProjectRateLimitsPage,
  RateLimitListRateLimitsParams,
  RateLimitUpdateRateLimitParams,
  RateLimits,
} from './rate-limits';
import * as RolesAPI from './roles';
import {
  RoleCreateParams,
  RoleDeleteParams,
  RoleDeleteResponse,
  RoleListParams,
  RoleUpdateParams,
  Roles,
} from './roles';
import * as ServiceAccountsAPI from './service-accounts';
import {
  ProjectServiceAccount,
  ProjectServiceAccountsPage,
  ServiceAccountCreateParams,
  ServiceAccountCreateResponse,
  ServiceAccountDeleteParams,
  ServiceAccountDeleteResponse,
  ServiceAccountListParams,
  ServiceAccountRetrieveParams,
  ServiceAccounts,
} from './service-accounts';
import * as GroupsAPI from './groups/groups';
import {
  GroupCreateParams,
  GroupDeleteParams,
  GroupDeleteResponse,
  GroupListParams,
  Groups,
  ProjectGroup,
  ProjectGroupsPage,
} from './groups/groups';
import * as UsersAPI from './users/users';
import {
  ProjectUser,
  ProjectUsersPage,
  UserCreateParams,
  UserDeleteParams,
  UserDeleteResponse,
  UserListParams,
  UserRetrieveParams,
  UserUpdateParams,
  Users,
} from './users/users';
import { APIPromise } from '../../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Projects extends APIResource {
  users: UsersAPI.Users = new UsersAPI.Users(this._client);
  serviceAccounts: ServiceAccountsAPI.ServiceAccounts = new ServiceAccountsAPI.ServiceAccounts(this._client);
  apiKeys: APIKeysAPI.APIKeys = new APIKeysAPI.APIKeys(this._client);
  rateLimits: RateLimitsAPI.RateLimits = new RateLimitsAPI.RateLimits(this._client);
  groups: GroupsAPI.Groups = new GroupsAPI.Groups(this._client);
  roles: RolesAPI.Roles = new RolesAPI.Roles(this._client);
  certificates: CertificatesAPI.Certificates = new CertificatesAPI.Certificates(this._client);

  /**
   * Create a new project in the organization. Projects can be created and archived,
   * but cannot be deleted.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.create({
   *     name: 'name',
   *   });
   * ```
   */
  create(body: ProjectCreateParams, options?: RequestOptions): APIPromise<Project> {
    return this._client.post('/organization/projects', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Retrieves a project.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID: string, options?: RequestOptions): APIPromise<Project> {
    return this._client.get(path`/organization/projects/${projectID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Modifies a project in the organization.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.update(
   *     'project_id',
   *   );
   * ```
   */
  update(projectID: string, body: ProjectUpdateParams, options?: RequestOptions): APIPromise<Project> {
    return this._client.post(path`/organization/projects/${projectID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Returns a list of projects.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const project of client.admin.organization.projects.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: ProjectListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ProjectsPage, Project> {
    return this._client.getAPIList('/organization/projects', ConversationCursorPage<Project>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Archives a project in the organization. Archived projects cannot be used or
   * updated.
   *
   * @example
   * ```ts
   * const project =
   *   await client.admin.organization.projects.archive(
   *     'project_id',
   *   );
   * ```
   */
  archive(projectID: string, options?: RequestOptions): APIPromise<Project> {
    return this._client.post(path`/organization/projects/${projectID}/archive`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ProjectsPage = ConversationCursorPage<Project>;

/**
 * Represents an individual project.
 */
export interface Project {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the project was created.
   */
  created_at: number;

  /**
   * The object type, which is always `organization.project`
   */
  object: 'organization.project';

  /**
   * The Unix timestamp (in seconds) of when the project was archived or `null`.
   */
  archived_at?: number | null;

  /**
   * The external key associated with the project.
   */
  external_key_id?: string | null;

  /**
   * The name of the project. This appears in reporting.
   */
  name?: string | null;

  /**
   * `active` or `archived`
   */
  status?: string | null;
}

export interface ProjectCreateParams {
  /**
   * The friendly name of the project, this name appears in reports.
   */
  name: string;

  /**
   * External key ID to associate with the project.
   */
  external_key_id?: string | null;

  /**
   * Create the project with the specified data residency region. Your organization
   * must have access to Data residency functionality in order to use. See
   * [data residency controls](https://platform.openai.com/docs/guides/your-data#data-residency-controls)
   * to review the functionality and limitations of setting this field.
   */
  geography?: string | null;
}

export interface ProjectUpdateParams {
  /**
   * External key ID to associate with the project.
   */
  external_key_id?: string | null;

  /**
   * Geography for the project.
   */
  geography?: string | null;

  /**
   * The updated name of the project, this name appears in reports.
   */
  name?: string | null;
}

export interface ProjectListParams extends ConversationCursorPageParams {
  /**
   * If `true` returns all projects including those that have been `archived`.
   * Archived projects are not included by default.
   */
  include_archived?: boolean;
}

Projects.Users = Users;
Projects.ServiceAccounts = ServiceAccounts;
Projects.APIKeys = APIKeys;
Projects.RateLimits = RateLimits;
Projects.Groups = Groups;
Projects.Roles = Roles;
Projects.Certificates = Certificates;

export declare namespace Projects {
  export {
    type Project as Project,
    type ProjectsPage as ProjectsPage,
    type ProjectCreateParams as ProjectCreateParams,
    type ProjectUpdateParams as ProjectUpdateParams,
    type ProjectListParams as ProjectListParams,
  };

  export {
    Users as Users,
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
    ServiceAccounts as ServiceAccounts,
    type ProjectServiceAccount as ProjectServiceAccount,
    type ServiceAccountCreateResponse as ServiceAccountCreateResponse,
    type ServiceAccountDeleteResponse as ServiceAccountDeleteResponse,
    type ProjectServiceAccountsPage as ProjectServiceAccountsPage,
    type ServiceAccountCreateParams as ServiceAccountCreateParams,
    type ServiceAccountRetrieveParams as ServiceAccountRetrieveParams,
    type ServiceAccountListParams as ServiceAccountListParams,
    type ServiceAccountDeleteParams as ServiceAccountDeleteParams,
  };

  export {
    APIKeys as APIKeys,
    type ProjectAPIKey as ProjectAPIKey,
    type APIKeyDeleteResponse as APIKeyDeleteResponse,
    type ProjectAPIKeysPage as ProjectAPIKeysPage,
    type APIKeyRetrieveParams as APIKeyRetrieveParams,
    type APIKeyListParams as APIKeyListParams,
    type APIKeyDeleteParams as APIKeyDeleteParams,
  };

  export {
    RateLimits as RateLimits,
    type ProjectRateLimit as ProjectRateLimit,
    type ProjectRateLimitsPage as ProjectRateLimitsPage,
    type RateLimitListRateLimitsParams as RateLimitListRateLimitsParams,
    type RateLimitUpdateRateLimitParams as RateLimitUpdateRateLimitParams,
  };

  export {
    Groups as Groups,
    type ProjectGroup as ProjectGroup,
    type GroupDeleteResponse as GroupDeleteResponse,
    type ProjectGroupsPage as ProjectGroupsPage,
    type GroupCreateParams as GroupCreateParams,
    type GroupListParams as GroupListParams,
    type GroupDeleteParams as GroupDeleteParams,
  };

  export {
    Roles as Roles,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RoleCreateParams as RoleCreateParams,
    type RoleUpdateParams as RoleUpdateParams,
    type RoleListParams as RoleListParams,
    type RoleDeleteParams as RoleDeleteParams,
  };

  export {
    Certificates as Certificates,
    type CertificateListResponse as CertificateListResponse,
    type CertificateActivateResponse as CertificateActivateResponse,
    type CertificateDeactivateResponse as CertificateDeactivateResponse,
    type CertificateListResponsesPage as CertificateListResponsesPage,
    type CertificateActivateResponsesPage as CertificateActivateResponsesPage,
    type CertificateDeactivateResponsesPage as CertificateDeactivateResponsesPage,
    type CertificateListParams as CertificateListParams,
    type CertificateActivateParams as CertificateActivateParams,
    type CertificateDeactivateParams as CertificateDeactivateParams,
  };
}
