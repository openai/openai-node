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

export class ExternalKeys extends APIResource {
  /**
   * Add an external key config for an organization
   *
   * @example
   * ```ts
   * const externalKey =
   *   await client.admin.organization.externalKeys.create({
   *     external_id: 'external_id',
   *     kms_arn: 'kms_arn',
   *     name: 'name',
   *     role_arn: 'arn:aws:iam::123456789012:role/example-role',
   *     type: 'aws',
   *   });
   * ```
   */
  create(body: ExternalKeyCreateParams, options?: RequestOptions): APIPromise<ExternalKey> {
    return this._client.post(
      '/organization/external_keys',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Retrieve a stored external key registration for the user's organization.
   *
   * @example
   * ```ts
   * const externalKey =
   *   await client.admin.organization.externalKeys.retrieve(
   *     'external_key_id',
   *   );
   * ```
   */
  retrieve(externalKeyID: string, options?: RequestOptions): APIPromise<ExternalKey> {
    return this._client.get(
      path`/organization/external_keys/${externalKeyID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * List the external key configs registered on the user's organization
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const externalKey of client.admin.organization.externalKeys.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (ExternalKeyListParams &
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
  ): PagePromise<ExternalKeysPage, ExternalKey>;
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
  ): PagePromise<ExternalKeysPage, ExternalKey>;
  list(
    query:
      | ExternalKeyListParams
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
  ): PagePromise<ExternalKeysPage, ExternalKey> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'purpose'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as ExternalKeyListParams | null | undefined;
    return this._client.getAPIList(
      '/organization/external_keys',
      CursorPage<ExternalKey>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Delete an external key config for the user's organization
   *
   * @example
   * ```ts
   * const externalKey =
   *   await client.admin.organization.externalKeys.delete(
   *     'external_key_id',
   *   );
   * ```
   */
  delete(externalKeyID: string, options?: RequestOptions): APIPromise<ExternalKey> {
    return this._client.delete(
      path`/organization/external_keys/${externalKeyID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Validate an external key config for the user's organization
   *
   * @example
   * ```ts
   * const response =
   *   await client.admin.organization.externalKeys.validate(
   *     'external_key_id',
   *   );
   * ```
   */
  validate(externalKeyID: string, options?: RequestOptions): APIPromise<ExternalKeyValidateResponse> {
    return this._client.post(
      path`/organization/external_keys/${externalKeyID}/validate`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }
}

export type ExternalKeysPage = CursorPage<ExternalKey>;

export interface ExternalKey {
  id: string;

  api_project_ids: Array<string>;

  created_at: number;

  name: string;

  object: string;

  type: string;

  workspace_id: string;

  audience?: string;

  external_id?: string;

  key_name?: string;

  key_version?: string;

  kms_arn?: string;

  kms_key_location?: string;

  kms_key_name?: string;

  kms_key_ring_name?: string;

  kms_key_version?: string;

  kms_project_id?: string;

  purpose?: 'ekm' | 'psp_decryption';

  role_arn?: string;

  tenant_id?: string;

  vault_uri?: string;

  workload_identity_pool_id?: string;

  workload_identity_project_number?: string;

  workload_identity_provider_id?: string;
}

export interface ExternalKeyValidateResponse {
  status: string;
}

export type ExternalKeyCreateParams =
  | ExternalKeyCreateParams.AwsExternalKeyParams
  | ExternalKeyCreateParams.GcpExternalKeyParams
  | ExternalKeyCreateParams.AzureExternalKeyParams;

export declare namespace ExternalKeyCreateParams {
  export interface AwsExternalKeyParams {
    /**
     * The ExternalID that OpenAI will pass in the AssumeRole call for the customer's
     * AWS account. This must be the OpenAI organization ID or an API project ID that
     * belongs to the organization.
     */
    external_id: string;

    /**
     * The Key Management System ARN for the master key you manage
     */
    kms_arn: string;

    /**
     * A friendly name to identify this config
     */
    name: string;

    /**
     * The Role ARN that OpenAI will assume to call your KMS
     */
    role_arn: string;

    type: 'aws';

    purpose?: 'ekm' | 'psp_decryption';
  }

  export interface GcpExternalKeyParams {
    /**
     * The aud field in the identity token OpenAI will pass in the call to the
     * customer's GCP STS. This must be the OpenAI organization ID or an API project ID
     * that belongs to the organization.
     */
    audience: string;

    /**
     * The region where your Key Management System master key is located
     */
    kms_key_location: string;

    /**
     * The name of the Key Management System master key you manage
     */
    kms_key_name: string;

    /**
     * The Key Management System key ring for the master key you manage
     */
    kms_key_ring_name: string;

    /**
     * The string GCP project name where your KMS resides
     */
    kms_project_id: string;

    /**
     * A friendly name to identify this config
     */
    name: string;

    type: 'gcp';

    /**
     * The pool containing the Workload Identity provider that you registered for
     * OpenAI
     */
    workload_identity_pool_id: string;

    /**
     * The numeric GCP project number where you registered OpenAI's workload identity
     */
    workload_identity_project_number: string;

    /**
     * The Workload Identity provider that you registered for OpenAI
     */
    workload_identity_provider_id: string;

    /**
     * An exact CryptoKeyVersion number. Required for PSP decryption; not accepted for
     * EKM.
     */
    kms_key_version?: string;

    purpose?: 'ekm' | 'psp_decryption';
  }

  export interface AzureExternalKeyParams {
    /**
     * The name of the Azure Key Vault master key that you manage
     */
    key_name: string;

    /**
     * A friendly name to identify this config
     */
    name: string;

    /**
     * Your Azure tenant UUID
     */
    tenant_id: string;

    type: 'azure';

    /**
     * The URI of the Azure vault containing the master key you manage
     */
    vault_uri: string;

    /**
     * An exact Azure Key Vault key version. Required for PSP decryption; not accepted
     * for EKM.
     */
    key_version?: string;

    purpose?: 'ekm' | 'psp_decryption';
  }
}

export interface ExternalKeyListParams extends Omit<CursorPageParams, 'after'> {
  after?: string | null;

  order?: 'asc' | 'desc';

  /**
   * Filter by key purpose. When omitted, returns keys of all purposes.
   */
  purpose?: 'ekm' | 'psp_decryption';
}

export declare namespace ExternalKeys {
  export {
    type ExternalKey as ExternalKey,
    type ExternalKeyValidateResponse as ExternalKeyValidateResponse,
    type ExternalKeysPage as ExternalKeysPage,
    type ExternalKeyCreateParams as ExternalKeyCreateParams,
    type ExternalKeyListParams as ExternalKeyListParams,
  };
}
