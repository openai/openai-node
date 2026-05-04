// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  Page,
  PagePromise,
} from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Certificates extends APIResource {
  /**
   * Upload a certificate to the organization. This does **not** automatically
   * activate the certificate.
   *
   * Organizations can upload up to 50 certificates.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.create({
   *     certificate: 'certificate',
   *   });
   * ```
   */
  create(body: CertificateCreateParams, options?: RequestOptions): APIPromise<Certificate> {
    return this._client.post('/organization/certificates', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get a certificate that has been uploaded to the organization.
   *
   * You can get a certificate regardless of whether it is active or not.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.retrieve(
   *     'certificate_id',
   *   );
   * ```
   */
  retrieve(
    certificateID: string,
    query: CertificateRetrieveParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<Certificate> {
    return this._client.get(path`/organization/certificates/${certificateID}`, {
      query,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Modify a certificate. Note that only the name can be modified.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.update(
   *     'certificate_id',
   *   );
   * ```
   */
  update(
    certificateID: string,
    body: CertificateUpdateParams,
    options?: RequestOptions,
  ): APIPromise<Certificate> {
    return this._client.post(path`/organization/certificates/${certificateID}`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * List uploaded certificates for this organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateListResponse of client.admin.organization.certificates.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: CertificateListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<CertificateListResponsesPage, CertificateListResponse> {
    return this._client.getAPIList(
      '/organization/certificates',
      ConversationCursorPage<CertificateListResponse>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Delete a certificate from the organization.
   *
   * The certificate must be inactive for the organization and all projects.
   *
   * @example
   * ```ts
   * const certificate =
   *   await client.admin.organization.certificates.delete(
   *     'certificate_id',
   *   );
   * ```
   */
  delete(certificateID: string, options?: RequestOptions): APIPromise<CertificateDeleteResponse> {
    return this._client.delete(path`/organization/certificates/${certificateID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Activate certificates at the organization level.
   *
   * You can atomically and idempotently activate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateActivateResponse of client.admin.organization.certificates.activate(
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  activate(
    body: CertificateActivateParams,
    options?: RequestOptions,
  ): PagePromise<CertificateActivateResponsesPage, CertificateActivateResponse> {
    return this._client.getAPIList('/organization/certificates/activate', Page<CertificateActivateResponse>, {
      body,
      method: 'post',
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Deactivate certificates at the organization level.
   *
   * You can atomically and idempotently deactivate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificateDeactivateResponse of client.admin.organization.certificates.deactivate(
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  deactivate(
    body: CertificateDeactivateParams,
    options?: RequestOptions,
  ): PagePromise<CertificateDeactivateResponsesPage, CertificateDeactivateResponse> {
    return this._client.getAPIList(
      '/organization/certificates/deactivate',
      Page<CertificateDeactivateResponse>,
      { body, method: 'post', ...options, __security: { adminAPIKeyAuth: true } },
    );
  }
}

export type CertificateListResponsesPage = ConversationCursorPage<CertificateListResponse>;

// Note: no pagination actually occurs yet, this is for forwards-compatibility.
export type CertificateActivateResponsesPage = Page<CertificateActivateResponse>;

// Note: no pagination actually occurs yet, this is for forwards-compatibility.
export type CertificateDeactivateResponsesPage = Page<CertificateDeactivateResponse>;

/**
 * Represents an individual `certificate` uploaded to the organization.
 */
export interface Certificate {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  certificate_details: Certificate.CertificateDetails;

  /**
   * The Unix timestamp (in seconds) of when the certificate was uploaded.
   */
  created_at: number;

  /**
   * The name of the certificate.
   */
  name: string | null;

  /**
   * The object type.
   *
   * - If creating, updating, or getting a specific certificate, the object type is
   *   `certificate`.
   * - If listing, activating, or deactivating certificates for the organization, the
   *   object type is `organization.certificate`.
   * - If listing, activating, or deactivating certificates for a project, the object
   *   type is `organization.project.certificate`.
   */
  object: 'certificate' | 'organization.certificate' | 'organization.project.certificate';

  /**
   * Whether the certificate is currently active at the specified scope. Not returned
   * when getting details for a specific certificate.
   */
  active?: boolean;
}

export namespace Certificate {
  export interface CertificateDetails {
    /**
     * The content of the certificate in PEM format.
     */
    content?: string;

    /**
     * The Unix timestamp (in seconds) of when the certificate expires.
     */
    expires_at?: number;

    /**
     * The Unix timestamp (in seconds) of when the certificate becomes valid.
     */
    valid_at?: number;
  }
}

/**
 * Represents an individual certificate configured at the organization level.
 */
export interface CertificateListResponse {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * Whether the certificate is currently active at the organization level.
   */
  active: boolean;

  certificate_details: CertificateListResponse.CertificateDetails;

  /**
   * The Unix timestamp (in seconds) of when the certificate was uploaded.
   */
  created_at: number;

  /**
   * The name of the certificate.
   */
  name: string | null;

  /**
   * The object type, which is always `organization.certificate`.
   */
  object: 'organization.certificate';
}

export namespace CertificateListResponse {
  export interface CertificateDetails {
    /**
     * The Unix timestamp (in seconds) of when the certificate expires.
     */
    expires_at?: number;

    /**
     * The Unix timestamp (in seconds) of when the certificate becomes valid.
     */
    valid_at?: number;
  }
}

export interface CertificateDeleteResponse {
  /**
   * The ID of the certificate that was deleted.
   */
  id: string;

  /**
   * The object type, must be `certificate.deleted`.
   */
  object: 'certificate.deleted';
}

/**
 * Represents an individual certificate configured at the organization level.
 */
export interface CertificateActivateResponse {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * Whether the certificate is currently active at the organization level.
   */
  active: boolean;

  certificate_details: CertificateActivateResponse.CertificateDetails;

  /**
   * The Unix timestamp (in seconds) of when the certificate was uploaded.
   */
  created_at: number;

  /**
   * The name of the certificate.
   */
  name: string | null;

  /**
   * The object type, which is always `organization.certificate`.
   */
  object: 'organization.certificate';
}

export namespace CertificateActivateResponse {
  export interface CertificateDetails {
    /**
     * The Unix timestamp (in seconds) of when the certificate expires.
     */
    expires_at?: number;

    /**
     * The Unix timestamp (in seconds) of when the certificate becomes valid.
     */
    valid_at?: number;
  }
}

/**
 * Represents an individual certificate configured at the organization level.
 */
export interface CertificateDeactivateResponse {
  /**
   * The identifier, which can be referenced in API endpoints
   */
  id: string;

  /**
   * Whether the certificate is currently active at the organization level.
   */
  active: boolean;

  certificate_details: CertificateDeactivateResponse.CertificateDetails;

  /**
   * The Unix timestamp (in seconds) of when the certificate was uploaded.
   */
  created_at: number;

  /**
   * The name of the certificate.
   */
  name: string | null;

  /**
   * The object type, which is always `organization.certificate`.
   */
  object: 'organization.certificate';
}

export namespace CertificateDeactivateResponse {
  export interface CertificateDetails {
    /**
     * The Unix timestamp (in seconds) of when the certificate expires.
     */
    expires_at?: number;

    /**
     * The Unix timestamp (in seconds) of when the certificate becomes valid.
     */
    valid_at?: number;
  }
}

export interface CertificateCreateParams {
  /**
   * The certificate content in PEM format
   */
  certificate: string;

  /**
   * An optional name for the certificate
   */
  name?: string;
}

export interface CertificateRetrieveParams {
  /**
   * A list of additional fields to include in the response. Currently the only
   * supported value is `content` to fetch the PEM content of the certificate.
   */
  include?: Array<'content'>;
}

export interface CertificateUpdateParams {
  /**
   * The updated name for the certificate
   */
  name?: string;
}

export interface CertificateListParams extends ConversationCursorPageParams {
  /**
   * Sort order by the `created_at` timestamp of the objects. `asc` for ascending
   * order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';
}

export interface CertificateActivateParams {
  certificate_ids: Array<string>;
}

export interface CertificateDeactivateParams {
  certificate_ids: Array<string>;
}

export declare namespace Certificates {
  export {
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
}
