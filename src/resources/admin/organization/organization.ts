// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as AdminAPIKeysAPI from './admin-api-keys';
import {
  AdminAPIKey,
  AdminAPIKeyCreateParams,
  AdminAPIKeyCreateResponse,
  AdminAPIKeyDeleteResponse,
  AdminAPIKeyListParams,
  AdminAPIKeys,
  AdminAPIKeysPage,
} from './admin-api-keys';
import * as AuditLogsAPI from './audit-logs';
import { AuditLogListParams, AuditLogListResponse, AuditLogListResponsesPage, AuditLogs } from './audit-logs';
import * as CertificatesAPI from './certificates';
import {
  Certificate,
  CertificateActivateParams,
  CertificateActivateResponse,
  CertificateActivateResponsesPage,
  CertificateCreateParams,
  CertificateDeactivateParams,
  CertificateDeactivateResponse,
  CertificateDeactivateResponsesPage,
  CertificateDeleteResponse,
  CertificateListParams,
  CertificateListResponse,
  CertificateListResponsesPage,
  CertificateRetrieveParams,
  CertificateUpdateParams,
  Certificates,
} from './certificates';
import * as InvitesAPI from './invites';
import {
  Invite,
  InviteCreateParams,
  InviteDeleteResponse,
  InviteListParams,
  Invites,
  InvitesPage,
} from './invites';
import * as RolesAPI from './roles';
import {
  Role,
  RoleCreateParams,
  RoleDeleteResponse,
  RoleListParams,
  RoleUpdateParams,
  Roles,
  RolesPage,
} from './roles';
import * as UsageAPI from './usage';
import {
  Usage,
  UsageAudioSpeechesParams,
  UsageAudioSpeechesResponse,
  UsageAudioTranscriptionsParams,
  UsageAudioTranscriptionsResponse,
  UsageCodeInterpreterSessionsParams,
  UsageCodeInterpreterSessionsResponse,
  UsageCompletionsParams,
  UsageCompletionsResponse,
  UsageCostsParams,
  UsageCostsResponse,
  UsageEmbeddingsParams,
  UsageEmbeddingsResponse,
  UsageImagesParams,
  UsageImagesResponse,
  UsageModerationsParams,
  UsageModerationsResponse,
  UsageVectorStoresParams,
  UsageVectorStoresResponse,
} from './usage';
import * as GroupsAPI from './groups/groups';
import {
  Group,
  GroupCreateParams,
  GroupDeleteResponse,
  GroupListParams,
  GroupUpdateParams,
  GroupUpdateResponse,
  Groups,
  GroupsPage,
} from './groups/groups';
import * as ProjectsAPI from './projects/projects';
import {
  Project,
  ProjectCreateParams,
  ProjectListParams,
  ProjectUpdateParams,
  Projects,
  ProjectsPage,
} from './projects/projects';
import * as UsersAPI from './users/users';
import {
  OrganizationUser,
  OrganizationUsersPage,
  UserDeleteResponse,
  UserListParams,
  UserUpdateParams,
  Users,
} from './users/users';

export class Organization extends APIResource {
  auditLogs: AuditLogsAPI.AuditLogs = new AuditLogsAPI.AuditLogs(this._client);
  adminAPIKeys: AdminAPIKeysAPI.AdminAPIKeys = new AdminAPIKeysAPI.AdminAPIKeys(this._client);
  usage: UsageAPI.Usage = new UsageAPI.Usage(this._client);
  invites: InvitesAPI.Invites = new InvitesAPI.Invites(this._client);
  users: UsersAPI.Users = new UsersAPI.Users(this._client);
  groups: GroupsAPI.Groups = new GroupsAPI.Groups(this._client);
  roles: RolesAPI.Roles = new RolesAPI.Roles(this._client);
  certificates: CertificatesAPI.Certificates = new CertificatesAPI.Certificates(this._client);
  projects: ProjectsAPI.Projects = new ProjectsAPI.Projects(this._client);
}

Organization.AuditLogs = AuditLogs;
Organization.AdminAPIKeys = AdminAPIKeys;
Organization.Usage = Usage;
Organization.Invites = Invites;
Organization.Users = Users;
Organization.Groups = Groups;
Organization.Roles = Roles;
Organization.Certificates = Certificates;
Organization.Projects = Projects;

export declare namespace Organization {
  export {
    AuditLogs as AuditLogs,
    type AuditLogListResponse as AuditLogListResponse,
    type AuditLogListResponsesPage as AuditLogListResponsesPage,
    type AuditLogListParams as AuditLogListParams,
  };

  export {
    AdminAPIKeys as AdminAPIKeys,
    type AdminAPIKey as AdminAPIKey,
    type AdminAPIKeyCreateResponse as AdminAPIKeyCreateResponse,
    type AdminAPIKeyDeleteResponse as AdminAPIKeyDeleteResponse,
    type AdminAPIKeysPage as AdminAPIKeysPage,
    type AdminAPIKeyCreateParams as AdminAPIKeyCreateParams,
    type AdminAPIKeyListParams as AdminAPIKeyListParams,
  };

  export {
    Usage as Usage,
    type UsageAudioSpeechesResponse as UsageAudioSpeechesResponse,
    type UsageAudioTranscriptionsResponse as UsageAudioTranscriptionsResponse,
    type UsageCodeInterpreterSessionsResponse as UsageCodeInterpreterSessionsResponse,
    type UsageCompletionsResponse as UsageCompletionsResponse,
    type UsageCostsResponse as UsageCostsResponse,
    type UsageEmbeddingsResponse as UsageEmbeddingsResponse,
    type UsageImagesResponse as UsageImagesResponse,
    type UsageModerationsResponse as UsageModerationsResponse,
    type UsageVectorStoresResponse as UsageVectorStoresResponse,
    type UsageAudioSpeechesParams as UsageAudioSpeechesParams,
    type UsageAudioTranscriptionsParams as UsageAudioTranscriptionsParams,
    type UsageCodeInterpreterSessionsParams as UsageCodeInterpreterSessionsParams,
    type UsageCompletionsParams as UsageCompletionsParams,
    type UsageCostsParams as UsageCostsParams,
    type UsageEmbeddingsParams as UsageEmbeddingsParams,
    type UsageImagesParams as UsageImagesParams,
    type UsageModerationsParams as UsageModerationsParams,
    type UsageVectorStoresParams as UsageVectorStoresParams,
  };

  export {
    Invites as Invites,
    type Invite as Invite,
    type InviteDeleteResponse as InviteDeleteResponse,
    type InvitesPage as InvitesPage,
    type InviteCreateParams as InviteCreateParams,
    type InviteListParams as InviteListParams,
  };

  export {
    Users as Users,
    type OrganizationUser as OrganizationUser,
    type UserDeleteResponse as UserDeleteResponse,
    type OrganizationUsersPage as OrganizationUsersPage,
    type UserUpdateParams as UserUpdateParams,
    type UserListParams as UserListParams,
  };

  export {
    Groups as Groups,
    type Group as Group,
    type GroupUpdateResponse as GroupUpdateResponse,
    type GroupDeleteResponse as GroupDeleteResponse,
    type GroupsPage as GroupsPage,
    type GroupCreateParams as GroupCreateParams,
    type GroupUpdateParams as GroupUpdateParams,
    type GroupListParams as GroupListParams,
  };

  export {
    Roles as Roles,
    type Role as Role,
    type RoleDeleteResponse as RoleDeleteResponse,
    type RolesPage as RolesPage,
    type RoleCreateParams as RoleCreateParams,
    type RoleUpdateParams as RoleUpdateParams,
    type RoleListParams as RoleListParams,
  };

  export {
    Certificates as Certificates,
    type Certificate as Certificate,
    type CertificateListResponse as CertificateListResponse,
    type CertificateDeleteResponse as CertificateDeleteResponse,
    type CertificateActivateResponse as CertificateActivateResponse,
    type CertificateDeactivateResponse as CertificateDeactivateResponse,
    type CertificateListResponsesPage as CertificateListResponsesPage,
    type CertificateActivateResponsesPage as CertificateActivateResponsesPage,
    type CertificateDeactivateResponsesPage as CertificateDeactivateResponsesPage,
    type CertificateCreateParams as CertificateCreateParams,
    type CertificateRetrieveParams as CertificateRetrieveParams,
    type CertificateUpdateParams as CertificateUpdateParams,
    type CertificateListParams as CertificateListParams,
    type CertificateActivateParams as CertificateActivateParams,
    type CertificateDeactivateParams as CertificateDeactivateParams,
  };

  export {
    Projects as Projects,
    type Project as Project,
    type ProjectsPage as ProjectsPage,
    type ProjectCreateParams as ProjectCreateParams,
    type ProjectUpdateParams as ProjectUpdateParams,
    type ProjectListParams as ProjectListParams,
  };
}
