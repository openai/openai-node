// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as CertificatesAPI from '../certificates';
import { CertificatesPage } from '../certificates';
import {
  ConversationCursorPage,
  type ConversationCursorPageParams,
  Page,
  PagePromise,
} from '../../../../core/pagination';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Certificates extends APIResource {
  /**
   * List certificates for this project.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificate of client.admin.organization.projects.certificates.list(
   *   'project_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    projectID: string,
    query: CertificateListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<CertificatesPage, CertificatesAPI.Certificate> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/certificates`,
      ConversationCursorPage<CertificatesAPI.Certificate>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Activate certificates at the project level.
   *
   * You can atomically and idempotently activate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificate of client.admin.organization.projects.certificates.activate(
   *   'project_id',
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  activate(
    projectID: string,
    body: CertificateActivateParams,
    options?: RequestOptions,
  ): PagePromise<CertificatesPage, CertificatesAPI.Certificate> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/certificates/activate`,
      Page<CertificatesAPI.Certificate>,
      { body, method: 'post', ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Deactivate certificates at the project level. You can atomically and
   * idempotently deactivate up to 10 certificates at a time.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const certificate of client.admin.organization.projects.certificates.deactivate(
   *   'project_id',
   *   { certificate_ids: ['cert_abc'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  deactivate(
    projectID: string,
    body: CertificateDeactivateParams,
    options?: RequestOptions,
  ): PagePromise<CertificatesPage, CertificatesAPI.Certificate> {
    return this._client.getAPIList(
      path`/organization/projects/${projectID}/certificates/deactivate`,
      Page<CertificatesAPI.Certificate>,
      { body, method: 'post', ...options, __security: { adminAPIKeyAuth: true } },
    );
  }
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
    type CertificateListParams as CertificateListParams,
    type CertificateActivateParams as CertificateActivateParams,
    type CertificateDeactivateParams as CertificateDeactivateParams,
  };
}

export { type CertificatesPage };
