// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class ExternalStorage extends APIResource {
  /**
   * Register one customer-managed external storage configuration.
   *
   * @example
   * ```ts
   * const externalStorageConfiguration =
   *   await client.admin.organization.externalStorage.create({
   *     project_id: 'proj_123',
   *     provider: {
   *       bucket: 'bucket',
   *       role_arn: 'role_arn',
   *       type: 'aws',
   *     },
   *   });
   * ```
   */
  create(
    body: ExternalStorageCreateParams,
    options?: RequestOptions,
  ): APIPromise<ExternalStorageConfiguration> {
    return this._client.post('/organization/external_storage', {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Get one customer-managed external storage configuration.
   *
   * @example
   * ```ts
   * const externalStorageConfiguration =
   *   await client.admin.organization.externalStorage.retrieve(
   *     'extstorage_123',
   *   );
   * ```
   */
  retrieve(externalStorageID: string, options?: RequestOptions): APIPromise<ExternalStorageConfiguration> {
    return this._client.get(path`/organization/external_storage/${externalStorageID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * List the organization's customer-managed external storage configurations.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const externalStorageConfiguration of client.admin.organization.externalStorage.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: ExternalStorageListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<ExternalStorageConfigurationsPage, ExternalStorageConfiguration> {
    return this._client.getAPIList(
      '/organization/external_storage',
      CursorPage<ExternalStorageConfiguration>,
      { query, ...options, __security: { adminAPIKeyAuth: true } },
    );
  }

  /**
   * Soft-delete one customer-managed external storage configuration.
   *
   * @example
   * ```ts
   * const externalStorageDeleted =
   *   await client.admin.organization.externalStorage.delete(
   *     'extstorage_123',
   *   );
   * ```
   */
  delete(externalStorageID: string, options?: RequestOptions): APIPromise<ExternalStorageDeleted> {
    return this._client.delete(path`/organization/external_storage/${externalStorageID}`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Validate one customer-managed external storage configuration.
   *
   * @example
   * ```ts
   * const externalStorageConfiguration =
   *   await client.admin.organization.externalStorage.validate(
   *     'extstorage_123',
   *   );
   * ```
   */
  validate(externalStorageID: string, options?: RequestOptions): APIPromise<ExternalStorageConfiguration> {
    return this._client.post(path`/organization/external_storage/${externalStorageID}/validate`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

export type ExternalStorageConfigurationsPage = CursorPage<ExternalStorageConfiguration>;

export interface AwsExternalStorageProvider {
  account_id: string;

  bucket: string;

  external_id: string;

  region: string;

  role_arn: string;

  type: 'aws';
}

export interface AzureExternalStorageProvider {
  account_name: string;

  container: string;

  region: string;

  resource_group: string;

  subscription_id: string;

  tenant_id: string;

  type: 'azure';
}

export interface ExternalStorageConfiguration {
  id: string;

  created_at: number;

  geography: string;

  object: 'organization.external_storage';

  project_id: string;

  provider: AwsExternalStorageProvider | AzureExternalStorageProvider;

  status: 'pending' | 'validated' | 'unhealthy';
}

export interface ExternalStorageDeleted {
  id: string;

  deleted: boolean;

  object: 'organization.external_storage.deleted';
}

export interface ExternalStorageCreateParams {
  project_id: string;

  provider: ExternalStorageCreateParams.Aws | ExternalStorageCreateParams.Azure;
}

export namespace ExternalStorageCreateParams {
  export interface Aws {
    bucket: string;

    role_arn: string;

    type: 'aws';
  }

  export interface Azure {
    account_name: string;

    container: string;

    resource_group: string;

    subscription_id: string;

    tenant_id: string;

    type: 'azure';
  }
}

export interface ExternalStorageListParams extends Omit<CursorPageParams, 'after'> {
  /**
   * Return external storage configurations after this ID.
   */
  after?: string | null;

  order?: 'asc' | 'desc';

  project_id?: string | null;
}

export declare namespace ExternalStorage {
  export {
    type AwsExternalStorageProvider as AwsExternalStorageProvider,
    type AzureExternalStorageProvider as AzureExternalStorageProvider,
    type ExternalStorageConfiguration as ExternalStorageConfiguration,
    type ExternalStorageDeleted as ExternalStorageDeleted,
    type ExternalStorageConfigurationsPage as ExternalStorageConfigurationsPage,
    type ExternalStorageCreateParams as ExternalStorageCreateParams,
    type ExternalStorageListParams as ExternalStorageListParams,
  };
}
