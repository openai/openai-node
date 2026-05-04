// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';

/**
 * List user actions and configuration changes within this organization.
 */
export class AuditLogs extends APIResource {
  /**
   * List user actions and configuration changes within this organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const auditLogListResponse of client.admin.organization.auditLogs.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: AuditLogListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AuditLogListResponsesPage, AuditLogListResponse> {
    return this._client.getAPIList('/organization/audit_logs', ConversationCursorPage<AuditLogListResponse>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type AuditLogListResponsesPage = ConversationCursorPage<AuditLogListResponse>;

/**
 * A log of a user action or configuration change within this organization.
 */
export interface AuditLogListResponse {
  /**
   * The ID of this log.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of the event.
   */
  effective_at: number;

  /**
   * The event type.
   */
  type:
    | 'api_key.created'
    | 'api_key.updated'
    | 'api_key.deleted'
    | 'certificate.created'
    | 'certificate.updated'
    | 'certificate.deleted'
    | 'certificates.activated'
    | 'certificates.deactivated'
    | 'checkpoint.permission.created'
    | 'checkpoint.permission.deleted'
    | 'external_key.registered'
    | 'external_key.removed'
    | 'group.created'
    | 'group.updated'
    | 'group.deleted'
    | 'invite.sent'
    | 'invite.accepted'
    | 'invite.deleted'
    | 'ip_allowlist.created'
    | 'ip_allowlist.updated'
    | 'ip_allowlist.deleted'
    | 'ip_allowlist.config.activated'
    | 'ip_allowlist.config.deactivated'
    | 'login.succeeded'
    | 'login.failed'
    | 'logout.succeeded'
    | 'logout.failed'
    | 'organization.updated'
    | 'project.created'
    | 'project.updated'
    | 'project.archived'
    | 'project.deleted'
    | 'rate_limit.updated'
    | 'rate_limit.deleted'
    | 'resource.deleted'
    | 'tunnel.created'
    | 'tunnel.updated'
    | 'tunnel.deleted'
    | 'role.created'
    | 'role.updated'
    | 'role.deleted'
    | 'role.assignment.created'
    | 'role.assignment.deleted'
    | 'scim.enabled'
    | 'scim.disabled'
    | 'service_account.created'
    | 'service_account.updated'
    | 'service_account.deleted'
    | 'user.added'
    | 'user.updated'
    | 'user.deleted';

  /**
   * The actor who performed the audit logged action.
   */
  actor?: AuditLogListResponse.Actor | null;

  /**
   * The details for events with this `type`.
   */
  'api_key.created'?: AuditLogListResponse.APIKeyCreated;

  /**
   * The details for events with this `type`.
   */
  'api_key.deleted'?: AuditLogListResponse.APIKeyDeleted;

  /**
   * The details for events with this `type`.
   */
  'api_key.updated'?: AuditLogListResponse.APIKeyUpdated;

  /**
   * The details for events with this `type`.
   */
  'certificate.created'?: AuditLogListResponse.CertificateCreated;

  /**
   * The details for events with this `type`.
   */
  'certificate.deleted'?: AuditLogListResponse.CertificateDeleted;

  /**
   * The details for events with this `type`.
   */
  'certificate.updated'?: AuditLogListResponse.CertificateUpdated;

  /**
   * The details for events with this `type`.
   */
  'certificates.activated'?: AuditLogListResponse.CertificatesActivated;

  /**
   * The details for events with this `type`.
   */
  'certificates.deactivated'?: AuditLogListResponse.CertificatesDeactivated;

  /**
   * The project and fine-tuned model checkpoint that the checkpoint permission was
   * created for.
   */
  'checkpoint.permission.created'?: AuditLogListResponse.CheckpointPermissionCreated;

  /**
   * The details for events with this `type`.
   */
  'checkpoint.permission.deleted'?: AuditLogListResponse.CheckpointPermissionDeleted;

  /**
   * The details for events with this `type`.
   */
  'external_key.registered'?: AuditLogListResponse.ExternalKeyRegistered;

  /**
   * The details for events with this `type`.
   */
  'external_key.removed'?: AuditLogListResponse.ExternalKeyRemoved;

  /**
   * The details for events with this `type`.
   */
  'group.created'?: AuditLogListResponse.GroupCreated;

  /**
   * The details for events with this `type`.
   */
  'group.deleted'?: AuditLogListResponse.GroupDeleted;

  /**
   * The details for events with this `type`.
   */
  'group.updated'?: AuditLogListResponse.GroupUpdated;

  /**
   * The details for events with this `type`.
   */
  'invite.accepted'?: AuditLogListResponse.InviteAccepted;

  /**
   * The details for events with this `type`.
   */
  'invite.deleted'?: AuditLogListResponse.InviteDeleted;

  /**
   * The details for events with this `type`.
   */
  'invite.sent'?: AuditLogListResponse.InviteSent;

  /**
   * The details for events with this `type`.
   */
  'ip_allowlist.config.activated'?: AuditLogListResponse.IPAllowlistConfigActivated;

  /**
   * The details for events with this `type`.
   */
  'ip_allowlist.config.deactivated'?: AuditLogListResponse.IPAllowlistConfigDeactivated;

  /**
   * The details for events with this `type`.
   */
  'ip_allowlist.created'?: AuditLogListResponse.IPAllowlistCreated;

  /**
   * The details for events with this `type`.
   */
  'ip_allowlist.deleted'?: AuditLogListResponse.IPAllowlistDeleted;

  /**
   * The details for events with this `type`.
   */
  'ip_allowlist.updated'?: AuditLogListResponse.IPAllowlistUpdated;

  /**
   * The details for events with this `type`.
   */
  'login.failed'?: AuditLogListResponse.LoginFailed;

  /**
   * This event has no additional fields beyond the standard audit log attributes.
   */
  'login.succeeded'?: unknown;

  /**
   * The details for events with this `type`.
   */
  'logout.failed'?: AuditLogListResponse.LogoutFailed;

  /**
   * This event has no additional fields beyond the standard audit log attributes.
   */
  'logout.succeeded'?: unknown;

  /**
   * The details for events with this `type`.
   */
  'organization.updated'?: AuditLogListResponse.OrganizationUpdated;

  /**
   * The project that the action was scoped to. Absent for actions not scoped to
   * projects. Note that any admin actions taken via Admin API keys are associated
   * with the default project.
   */
  project?: AuditLogListResponse.Project;

  /**
   * The details for events with this `type`.
   */
  'project.archived'?: AuditLogListResponse.ProjectArchived;

  /**
   * The details for events with this `type`.
   */
  'project.created'?: AuditLogListResponse.ProjectCreated;

  /**
   * The details for events with this `type`.
   */
  'project.deleted'?: AuditLogListResponse.ProjectDeleted;

  /**
   * The details for events with this `type`.
   */
  'project.updated'?: AuditLogListResponse.ProjectUpdated;

  /**
   * The details for events with this `type`.
   */
  'rate_limit.deleted'?: AuditLogListResponse.RateLimitDeleted;

  /**
   * The details for events with this `type`.
   */
  'rate_limit.updated'?: AuditLogListResponse.RateLimitUpdated;

  /**
   * The details for events with this `type`.
   */
  'role.assignment.created'?: AuditLogListResponse.RoleAssignmentCreated;

  /**
   * The details for events with this `type`.
   */
  'role.assignment.deleted'?: AuditLogListResponse.RoleAssignmentDeleted;

  /**
   * The details for events with this `type`.
   */
  'role.created'?: AuditLogListResponse.RoleCreated;

  /**
   * The details for events with this `type`.
   */
  'role.deleted'?: AuditLogListResponse.RoleDeleted;

  /**
   * The details for events with this `type`.
   */
  'role.updated'?: AuditLogListResponse.RoleUpdated;

  /**
   * The details for events with this `type`.
   */
  'scim.disabled'?: AuditLogListResponse.ScimDisabled;

  /**
   * The details for events with this `type`.
   */
  'scim.enabled'?: AuditLogListResponse.ScimEnabled;

  /**
   * The details for events with this `type`.
   */
  'service_account.created'?: AuditLogListResponse.ServiceAccountCreated;

  /**
   * The details for events with this `type`.
   */
  'service_account.deleted'?: AuditLogListResponse.ServiceAccountDeleted;

  /**
   * The details for events with this `type`.
   */
  'service_account.updated'?: AuditLogListResponse.ServiceAccountUpdated;

  /**
   * The details for events with this `type`.
   */
  'user.added'?: AuditLogListResponse.UserAdded;

  /**
   * The details for events with this `type`.
   */
  'user.deleted'?: AuditLogListResponse.UserDeleted;

  /**
   * The details for events with this `type`.
   */
  'user.updated'?: AuditLogListResponse.UserUpdated;
}

export namespace AuditLogListResponse {
  /**
   * The actor who performed the audit logged action.
   */
  export interface Actor {
    /**
     * The API Key used to perform the audit logged action.
     */
    api_key?: Actor.APIKey;

    /**
     * The session in which the audit logged action was performed.
     */
    session?: Actor.Session;

    /**
     * The type of actor. Is either `session` or `api_key`.
     */
    type?: 'session' | 'api_key';
  }

  export namespace Actor {
    /**
     * The API Key used to perform the audit logged action.
     */
    export interface APIKey {
      /**
       * The tracking id of the API key.
       */
      id?: string;

      /**
       * The service account that performed the audit logged action.
       */
      service_account?: APIKey.ServiceAccount;

      /**
       * The type of API key. Can be either `user` or `service_account`.
       */
      type?: 'user' | 'service_account';

      /**
       * The user who performed the audit logged action.
       */
      user?: APIKey.User;
    }

    export namespace APIKey {
      /**
       * The service account that performed the audit logged action.
       */
      export interface ServiceAccount {
        /**
         * The service account id.
         */
        id?: string;
      }

      /**
       * The user who performed the audit logged action.
       */
      export interface User {
        /**
         * The user id.
         */
        id?: string;

        /**
         * The user email.
         */
        email?: string;
      }
    }

    /**
     * The session in which the audit logged action was performed.
     */
    export interface Session {
      /**
       * The IP address from which the action was performed.
       */
      ip_address?: string;

      /**
       * The user who performed the audit logged action.
       */
      user?: Session.User;
    }

    export namespace Session {
      /**
       * The user who performed the audit logged action.
       */
      export interface User {
        /**
         * The user id.
         */
        id?: string;

        /**
         * The user email.
         */
        email?: string;
      }
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface APIKeyCreated {
    /**
     * The tracking ID of the API key.
     */
    id?: string;

    /**
     * The payload used to create the API key.
     */
    data?: APIKeyCreated.Data;
  }

  export namespace APIKeyCreated {
    /**
     * The payload used to create the API key.
     */
    export interface Data {
      /**
       * A list of scopes allowed for the API key, e.g. `["api.model.request"]`
       */
      scopes?: Array<string>;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface APIKeyDeleted {
    /**
     * The tracking ID of the API key.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface APIKeyUpdated {
    /**
     * The tracking ID of the API key.
     */
    id?: string;

    /**
     * The payload used to update the API key.
     */
    changes_requested?: APIKeyUpdated.ChangesRequested;
  }

  export namespace APIKeyUpdated {
    /**
     * The payload used to update the API key.
     */
    export interface ChangesRequested {
      /**
       * A list of scopes allowed for the API key, e.g. `["api.model.request"]`
       */
      scopes?: Array<string>;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface CertificateCreated {
    /**
     * The certificate ID.
     */
    id?: string;

    /**
     * The name of the certificate.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface CertificateDeleted {
    /**
     * The certificate ID.
     */
    id?: string;

    /**
     * The certificate content in PEM format.
     */
    certificate?: string;

    /**
     * The name of the certificate.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface CertificateUpdated {
    /**
     * The certificate ID.
     */
    id?: string;

    /**
     * The name of the certificate.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface CertificatesActivated {
    certificates?: Array<CertificatesActivated.Certificate>;
  }

  export namespace CertificatesActivated {
    export interface Certificate {
      /**
       * The certificate ID.
       */
      id?: string;

      /**
       * The name of the certificate.
       */
      name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface CertificatesDeactivated {
    certificates?: Array<CertificatesDeactivated.Certificate>;
  }

  export namespace CertificatesDeactivated {
    export interface Certificate {
      /**
       * The certificate ID.
       */
      id?: string;

      /**
       * The name of the certificate.
       */
      name?: string;
    }
  }

  /**
   * The project and fine-tuned model checkpoint that the checkpoint permission was
   * created for.
   */
  export interface CheckpointPermissionCreated {
    /**
     * The ID of the checkpoint permission.
     */
    id?: string;

    /**
     * The payload used to create the checkpoint permission.
     */
    data?: CheckpointPermissionCreated.Data;
  }

  export namespace CheckpointPermissionCreated {
    /**
     * The payload used to create the checkpoint permission.
     */
    export interface Data {
      /**
       * The ID of the fine-tuned model checkpoint.
       */
      fine_tuned_model_checkpoint?: string;

      /**
       * The ID of the project that the checkpoint permission was created for.
       */
      project_id?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface CheckpointPermissionDeleted {
    /**
     * The ID of the checkpoint permission.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ExternalKeyRegistered {
    /**
     * The ID of the external key configuration.
     */
    id?: string;

    /**
     * The configuration for the external key.
     */
    data?: unknown;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ExternalKeyRemoved {
    /**
     * The ID of the external key configuration.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface GroupCreated {
    /**
     * The ID of the group.
     */
    id?: string;

    /**
     * Information about the created group.
     */
    data?: GroupCreated.Data;
  }

  export namespace GroupCreated {
    /**
     * Information about the created group.
     */
    export interface Data {
      /**
       * The group name.
       */
      group_name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface GroupDeleted {
    /**
     * The ID of the group.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface GroupUpdated {
    /**
     * The ID of the group.
     */
    id?: string;

    /**
     * The payload used to update the group.
     */
    changes_requested?: GroupUpdated.ChangesRequested;
  }

  export namespace GroupUpdated {
    /**
     * The payload used to update the group.
     */
    export interface ChangesRequested {
      /**
       * The updated group name.
       */
      group_name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface InviteAccepted {
    /**
     * The ID of the invite.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface InviteDeleted {
    /**
     * The ID of the invite.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface InviteSent {
    /**
     * The ID of the invite.
     */
    id?: string;

    /**
     * The payload used to create the invite.
     */
    data?: InviteSent.Data;
  }

  export namespace InviteSent {
    /**
     * The payload used to create the invite.
     */
    export interface Data {
      /**
       * The email invited to the organization.
       */
      email?: string;

      /**
       * The role the email was invited to be. Is either `owner` or `member`.
       */
      role?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface IPAllowlistConfigActivated {
    /**
     * The configurations that were activated.
     */
    configs?: Array<IPAllowlistConfigActivated.Config>;
  }

  export namespace IPAllowlistConfigActivated {
    export interface Config {
      /**
       * The ID of the IP allowlist configuration.
       */
      id?: string;

      /**
       * The name of the IP allowlist configuration.
       */
      name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface IPAllowlistConfigDeactivated {
    /**
     * The configurations that were deactivated.
     */
    configs?: Array<IPAllowlistConfigDeactivated.Config>;
  }

  export namespace IPAllowlistConfigDeactivated {
    export interface Config {
      /**
       * The ID of the IP allowlist configuration.
       */
      id?: string;

      /**
       * The name of the IP allowlist configuration.
       */
      name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface IPAllowlistCreated {
    /**
     * The ID of the IP allowlist configuration.
     */
    id?: string;

    /**
     * The IP addresses or CIDR ranges included in the configuration.
     */
    allowed_ips?: Array<string>;

    /**
     * The name of the IP allowlist configuration.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface IPAllowlistDeleted {
    /**
     * The ID of the IP allowlist configuration.
     */
    id?: string;

    /**
     * The IP addresses or CIDR ranges that were in the configuration.
     */
    allowed_ips?: Array<string>;

    /**
     * The name of the IP allowlist configuration.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface IPAllowlistUpdated {
    /**
     * The ID of the IP allowlist configuration.
     */
    id?: string;

    /**
     * The updated set of IP addresses or CIDR ranges in the configuration.
     */
    allowed_ips?: Array<string>;
  }

  /**
   * The details for events with this `type`.
   */
  export interface LoginFailed {
    /**
     * The error code of the failure.
     */
    error_code?: string;

    /**
     * The error message of the failure.
     */
    error_message?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface LogoutFailed {
    /**
     * The error code of the failure.
     */
    error_code?: string;

    /**
     * The error message of the failure.
     */
    error_message?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface OrganizationUpdated {
    /**
     * The organization ID.
     */
    id?: string;

    /**
     * The payload used to update the organization settings.
     */
    changes_requested?: OrganizationUpdated.ChangesRequested;
  }

  export namespace OrganizationUpdated {
    /**
     * The payload used to update the organization settings.
     */
    export interface ChangesRequested {
      /**
       * How your organization logs data from supported API calls. One of `disabled`,
       * `enabled_per_call`, `enabled_for_all_projects`, or
       * `enabled_for_selected_projects`
       */
      api_call_logging?: string;

      /**
       * The list of project ids if api_call_logging is set to
       * `enabled_for_selected_projects`
       */
      api_call_logging_project_ids?: string;

      /**
       * The organization description.
       */
      description?: string;

      /**
       * The organization name.
       */
      name?: string;

      /**
       * Visibility of the threads page which shows messages created with the Assistants
       * API and Playground. One of `ANY_ROLE`, `OWNERS`, or `NONE`.
       */
      threads_ui_visibility?: string;

      /**
       * The organization title.
       */
      title?: string;

      /**
       * Visibility of the usage dashboard which shows activity and costs for your
       * organization. One of `ANY_ROLE` or `OWNERS`.
       */
      usage_dashboard_visibility?: string;
    }
  }

  /**
   * The project that the action was scoped to. Absent for actions not scoped to
   * projects. Note that any admin actions taken via Admin API keys are associated
   * with the default project.
   */
  export interface Project {
    /**
     * The project ID.
     */
    id?: string;

    /**
     * The project title.
     */
    name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ProjectArchived {
    /**
     * The project ID.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ProjectCreated {
    /**
     * The project ID.
     */
    id?: string;

    /**
     * The payload used to create the project.
     */
    data?: ProjectCreated.Data;
  }

  export namespace ProjectCreated {
    /**
     * The payload used to create the project.
     */
    export interface Data {
      /**
       * The project name.
       */
      name?: string;

      /**
       * The title of the project as seen on the dashboard.
       */
      title?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface ProjectDeleted {
    /**
     * The project ID.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ProjectUpdated {
    /**
     * The project ID.
     */
    id?: string;

    /**
     * The payload used to update the project.
     */
    changes_requested?: ProjectUpdated.ChangesRequested;
  }

  export namespace ProjectUpdated {
    /**
     * The payload used to update the project.
     */
    export interface ChangesRequested {
      /**
       * The title of the project as seen on the dashboard.
       */
      title?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface RateLimitDeleted {
    /**
     * The rate limit ID
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface RateLimitUpdated {
    /**
     * The rate limit ID
     */
    id?: string;

    /**
     * The payload used to update the rate limits.
     */
    changes_requested?: RateLimitUpdated.ChangesRequested;
  }

  export namespace RateLimitUpdated {
    /**
     * The payload used to update the rate limits.
     */
    export interface ChangesRequested {
      /**
       * The maximum batch input tokens per day. Only relevant for certain models.
       */
      batch_1_day_max_input_tokens?: number;

      /**
       * The maximum audio megabytes per minute. Only relevant for certain models.
       */
      max_audio_megabytes_per_1_minute?: number;

      /**
       * The maximum images per minute. Only relevant for certain models.
       */
      max_images_per_1_minute?: number;

      /**
       * The maximum requests per day. Only relevant for certain models.
       */
      max_requests_per_1_day?: number;

      /**
       * The maximum requests per minute.
       */
      max_requests_per_1_minute?: number;

      /**
       * The maximum tokens per minute.
       */
      max_tokens_per_1_minute?: number;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface RoleAssignmentCreated {
    /**
     * The identifier of the role assignment.
     */
    id?: string;

    /**
     * The principal (user or group) that received the role.
     */
    principal_id?: string;

    /**
     * The type of principal (user or group) that received the role.
     */
    principal_type?: string;

    /**
     * The resource the role assignment is scoped to.
     */
    resource_id?: string;

    /**
     * The type of resource the role assignment is scoped to.
     */
    resource_type?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface RoleAssignmentDeleted {
    /**
     * The identifier of the role assignment.
     */
    id?: string;

    /**
     * The principal (user or group) that had the role removed.
     */
    principal_id?: string;

    /**
     * The type of principal (user or group) that had the role removed.
     */
    principal_type?: string;

    /**
     * The resource the role assignment was scoped to.
     */
    resource_id?: string;

    /**
     * The type of resource the role assignment was scoped to.
     */
    resource_type?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface RoleCreated {
    /**
     * The role ID.
     */
    id?: string;

    /**
     * The permissions granted by the role.
     */
    permissions?: Array<string>;

    /**
     * The resource the role is scoped to.
     */
    resource_id?: string;

    /**
     * The type of resource the role belongs to.
     */
    resource_type?: string;

    /**
     * The name of the role.
     */
    role_name?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface RoleDeleted {
    /**
     * The role ID.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface RoleUpdated {
    /**
     * The role ID.
     */
    id?: string;

    /**
     * The payload used to update the role.
     */
    changes_requested?: RoleUpdated.ChangesRequested;
  }

  export namespace RoleUpdated {
    /**
     * The payload used to update the role.
     */
    export interface ChangesRequested {
      /**
       * The updated role description, when provided.
       */
      description?: string;

      /**
       * Additional metadata stored on the role.
       */
      metadata?: unknown;

      /**
       * The permissions added to the role.
       */
      permissions_added?: Array<string>;

      /**
       * The permissions removed from the role.
       */
      permissions_removed?: Array<string>;

      /**
       * The resource the role is scoped to.
       */
      resource_id?: string;

      /**
       * The type of resource the role belongs to.
       */
      resource_type?: string;

      /**
       * The updated role name, when provided.
       */
      role_name?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface ScimDisabled {
    /**
     * The ID of the SCIM was disabled for.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ScimEnabled {
    /**
     * The ID of the SCIM was enabled for.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ServiceAccountCreated {
    /**
     * The service account ID.
     */
    id?: string;

    /**
     * The payload used to create the service account.
     */
    data?: ServiceAccountCreated.Data;
  }

  export namespace ServiceAccountCreated {
    /**
     * The payload used to create the service account.
     */
    export interface Data {
      /**
       * The role of the service account. Is either `owner` or `member`.
       */
      role?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface ServiceAccountDeleted {
    /**
     * The service account ID.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface ServiceAccountUpdated {
    /**
     * The service account ID.
     */
    id?: string;

    /**
     * The payload used to updated the service account.
     */
    changes_requested?: ServiceAccountUpdated.ChangesRequested;
  }

  export namespace ServiceAccountUpdated {
    /**
     * The payload used to updated the service account.
     */
    export interface ChangesRequested {
      /**
       * The role of the service account. Is either `owner` or `member`.
       */
      role?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface UserAdded {
    /**
     * The user ID.
     */
    id?: string;

    /**
     * The payload used to add the user to the project.
     */
    data?: UserAdded.Data;
  }

  export namespace UserAdded {
    /**
     * The payload used to add the user to the project.
     */
    export interface Data {
      /**
       * The role of the user. Is either `owner` or `member`.
       */
      role?: string;
    }
  }

  /**
   * The details for events with this `type`.
   */
  export interface UserDeleted {
    /**
     * The user ID.
     */
    id?: string;
  }

  /**
   * The details for events with this `type`.
   */
  export interface UserUpdated {
    /**
     * The project ID.
     */
    id?: string;

    /**
     * The payload used to update the user.
     */
    changes_requested?: UserUpdated.ChangesRequested;
  }

  export namespace UserUpdated {
    /**
     * The payload used to update the user.
     */
    export interface ChangesRequested {
      /**
       * The role of the user. Is either `owner` or `member`.
       */
      role?: string;
    }
  }
}

export interface AuditLogListParams extends ConversationCursorPageParams {
  /**
   * Return only events performed by users with these emails.
   */
  actor_emails?: Array<string>;

  /**
   * Return only events performed by these actors. Can be a user ID, a service
   * account ID, or an api key tracking ID.
   */
  actor_ids?: Array<string>;

  /**
   * A cursor for use in pagination. `before` is an object ID that defines your place
   * in the list. For instance, if you make a list request and receive 100 objects,
   * starting with obj_foo, your subsequent call can include before=obj_foo in order
   * to fetch the previous page of the list.
   */
  before?: string;

  /**
   * Return only events whose `effective_at` (Unix seconds) is in this range.
   */
  effective_at?: AuditLogListParams.EffectiveAt;

  /**
   * Return only events with a `type` in one of these values. For example,
   * `project.created`. For all options, see the documentation for the
   * [audit log object](https://platform.openai.com/docs/api-reference/audit-logs/object).
   */
  event_types?: Array<
    | 'api_key.created'
    | 'api_key.updated'
    | 'api_key.deleted'
    | 'certificate.created'
    | 'certificate.updated'
    | 'certificate.deleted'
    | 'certificates.activated'
    | 'certificates.deactivated'
    | 'checkpoint.permission.created'
    | 'checkpoint.permission.deleted'
    | 'external_key.registered'
    | 'external_key.removed'
    | 'group.created'
    | 'group.updated'
    | 'group.deleted'
    | 'invite.sent'
    | 'invite.accepted'
    | 'invite.deleted'
    | 'ip_allowlist.created'
    | 'ip_allowlist.updated'
    | 'ip_allowlist.deleted'
    | 'ip_allowlist.config.activated'
    | 'ip_allowlist.config.deactivated'
    | 'login.succeeded'
    | 'login.failed'
    | 'logout.succeeded'
    | 'logout.failed'
    | 'organization.updated'
    | 'project.created'
    | 'project.updated'
    | 'project.archived'
    | 'project.deleted'
    | 'rate_limit.updated'
    | 'rate_limit.deleted'
    | 'resource.deleted'
    | 'tunnel.created'
    | 'tunnel.updated'
    | 'tunnel.deleted'
    | 'role.created'
    | 'role.updated'
    | 'role.deleted'
    | 'role.assignment.created'
    | 'role.assignment.deleted'
    | 'scim.enabled'
    | 'scim.disabled'
    | 'service_account.created'
    | 'service_account.updated'
    | 'service_account.deleted'
    | 'user.added'
    | 'user.updated'
    | 'user.deleted'
  >;

  /**
   * Return only events for these projects.
   */
  project_ids?: Array<string>;

  /**
   * Return only events performed on these targets. For example, a project ID
   * updated.
   */
  resource_ids?: Array<string>;
}

export namespace AuditLogListParams {
  /**
   * Return only events whose `effective_at` (Unix seconds) is in this range.
   */
  export interface EffectiveAt {
    /**
     * Return only events whose `effective_at` (Unix seconds) is greater than this
     * value.
     */
    gt?: number;

    /**
     * Return only events whose `effective_at` (Unix seconds) is greater than or equal
     * to this value.
     */
    gte?: number;

    /**
     * Return only events whose `effective_at` (Unix seconds) is less than this value.
     */
    lt?: number;

    /**
     * Return only events whose `effective_at` (Unix seconds) is less than or equal to
     * this value.
     */
    lte?: number;
  }
}

export declare namespace AuditLogs {
  export {
    type AuditLogListResponse as AuditLogListResponse,
    type AuditLogListResponsesPage as AuditLogListResponsesPage,
    type AuditLogListParams as AuditLogListParams,
  };
}
