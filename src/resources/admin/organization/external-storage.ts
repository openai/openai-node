// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

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
    return this._client.post(
      '/organization/external_storage',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
    return this._client.get(
      path`/organization/external_storage/${externalStorageID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
    query?:
      | (ExternalStorageListParams &
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
  ): PagePromise<ExternalStorageConfigurationsPage, ExternalStorageConfiguration>;
  list(
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
  ): PagePromise<ExternalStorageConfigurationsPage, ExternalStorageConfiguration>;
  list(
    query:
      | ExternalStorageListParams
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
  ): PagePromise<ExternalStorageConfigurationsPage, ExternalStorageConfiguration> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'project_id'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as ExternalStorageListParams | null | undefined;
    return this._client.getAPIList(
      '/organization/external_storage',
      CursorPage<ExternalStorageConfiguration>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Disconnect a customer-managed external storage configuration. Removing the
   * project's last configuration restores organization-default retention if
   * customer-managed retention was active. Repeating a deletion also completes any
   * interrupted retention update. Cloud storage is unchanged.
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
    return this._client.delete(
      path`/organization/external_storage/${externalStorageID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
    return this._client.post(
      path`/organization/external_storage/${externalStorageID}/validate`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
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
