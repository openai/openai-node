// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  PagePromise,
} from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Invites extends APIResource {
  /**
   * Create an invite for a user to the organization. The invite must be accepted by
   * the user before they have access to the organization.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.create({
   *     email: 'email',
   *     role: 'reader',
   *   });
   * ```
   */
  create(body: InviteCreateParams, options?: RequestOptions): APIPromise<Invite> {
    return this._client.post('/organization/invites', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Retrieves an invite.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.retrieve(
   *     'invite_id',
   *   );
   * ```
   */
  retrieve(inviteID: string, options?: RequestOptions): APIPromise<Invite> {
    return this._client.get(path`/organization/invites/${inviteID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Returns a list of invites in the organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const invite of client.admin.organization.invites.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: InviteListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<InvitesPage, Invite> {
    return this._client.getAPIList('/organization/invites', ConversationCursorPage<Invite>, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Delete an invite. If the invite has already been accepted, it cannot be deleted.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.admin.organization.invites.delete(
   *     'invite_id',
   *   );
   * ```
   */
  delete(inviteID: string, options?: RequestOptions): APIPromise<InviteDeleteResponse> {
    return this._client.delete(path`/organization/invites/${inviteID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type InvitesPage = ConversationCursorPage<Invite>;

/**
 * Represents an individual `invite` to the organization.
 */
export interface Invite {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) of when the invite was sent.
   */
  created_at: number;

  /**
   * The email address of the individual to whom the invite was sent
   */
  email: string;

  /**
   * The object type, which is always `organization.invite`
   */
  object: 'organization.invite';

  /**
   * The projects that were granted membership upon acceptance of the invite.
   */
  projects: Array<Invite.Project>;

  /**
   * `owner` or `reader`
   */
  role: 'owner' | 'reader';

  /**
   * `accepted`,`expired`, or `pending`
   */
  status: 'accepted' | 'expired' | 'pending';

  /**
   * The Unix timestamp (in seconds) of when the invite was accepted.
   */
  accepted_at?: number | null;

  /**
   * The Unix timestamp (in seconds) of when the invite expires.
   */
  expires_at?: number | null;
}

export namespace Invite {
  export interface Project {
    /**
     * Project's public ID
     */
    id: string;

    /**
     * Project membership role
     */
    role: 'member' | 'owner';
  }
}

export interface InviteDeleteResponse {
  id: string;

  deleted: boolean;

  /**
   * The object type, which is always `organization.invite.deleted`
   */
  object: 'organization.invite.deleted';
}

export interface InviteCreateParams {
  /**
   * Send an email to this address
   */
  email: string;

  /**
   * `owner` or `reader`
   */
  role: 'reader' | 'owner';

  /**
   * An array of projects to which membership is granted at the same time the org
   * invite is accepted. If omitted, the user will be invited to the default project
   * for compatibility with legacy behavior.
   */
  projects?: Array<InviteCreateParams.Project>;
}

export namespace InviteCreateParams {
  export interface Project {
    /**
     * Project's public ID
     */
    id: string;

    /**
     * Project membership role
     */
    role: 'member' | 'owner';
  }
}

export interface InviteListParams extends ConversationCursorPageParams {}

export declare namespace Invites {
  export {
    type Invite as Invite,
    type InviteDeleteResponse as InviteDeleteResponse,
    type InvitesPage as InvitesPage,
    type InviteCreateParams as InviteCreateParams,
    type InviteListParams as InviteListParams,
  };
}
