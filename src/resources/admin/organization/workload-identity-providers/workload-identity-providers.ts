// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as FederationRulesAPI from './federation-rules';
import {
  FederationRule,
  FederationRuleCreateParams,
  FederationRuleDeleteParams,
  FederationRuleDeleted,
  FederationRuleListParams,
  FederationRuleRetrieveParams,
  FederationRuleUpdateParams,
  FederationRules,
  FederationRulesPage,
} from './federation-rules';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
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
  '__streamMode',
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
          | '__streamMode'
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
        | '__streamMode'
        | '__security'
        | '__synthesizeEventData'
    ]?: never;
  };
}

export class WorkloadIdentityProviders extends APIResource {
  federationRules: FederationRulesAPI.FederationRules = new FederationRulesAPI.FederationRules(this._client);

  /**
   * Register an OIDC provider for keyless project service-account authentication.
   *
   * @example
   * ```ts
   * const workloadIdentityProvider =
   *   await client.admin.organization.workloadIdentityProviders.create(
   *     {
   *       audience: 'x',
   *       issuer: 'x',
   *       name: 'x',
   *       type: 'oidc',
   *     },
   *   );
   * ```
   */
  create(
    body: WorkloadIdentityProviderCreateParams,
    options?: RequestOptions,
  ): APIPromise<WorkloadIdentityProvider> {
    return this._client.post(
      '/organization/workload_identity_providers',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Retrieve an OIDC provider in the authenticated organization.
   *
   * @example
   * ```ts
   * const workloadIdentityProvider =
   *   await client.admin.organization.workloadIdentityProviders.retrieve(
   *     'x',
   *   );
   * ```
   */
  retrieve(
    workloadIdentityProviderID: string,
    options?: RequestOptions,
  ): APIPromise<WorkloadIdentityProvider> {
    return this._client.get(
      path`/organization/workload_identity_providers/${workloadIdentityProviderID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Update supplied provider fields, preserving omitted fields.
   *
   * @example
   * ```ts
   * const workloadIdentityProvider =
   *   await client.admin.organization.workloadIdentityProviders.update(
   *     'x',
   *   );
   * ```
   */
  update(
    workloadIdentityProviderID: string,
    body: WorkloadIdentityProviderUpdateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<WorkloadIdentityProvider> {
    return this._client.post(
      path`/organization/workload_identity_providers/${workloadIdentityProviderID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * List OIDC providers in the authenticated Admin API key's organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const workloadIdentityProvider of client.admin.organization.workloadIdentityProviders.list(
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (WorkloadIdentityProviderListParams &
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
                    | '__streamMode'
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
  ): PagePromise<WorkloadIdentityProvidersPage, WorkloadIdentityProvider>;
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
          | '__streamMode'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    },
  ): PagePromise<WorkloadIdentityProvidersPage, WorkloadIdentityProvider>;
  list(
    query:
      | WorkloadIdentityProviderListParams
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
              | '__streamMode'
              | '__security'
              | '__synthesizeEventData'
          ]?: never;
        })
      | null
      | undefined = {},
    options?: RequestOptions,
  ): PagePromise<WorkloadIdentityProvidersPage, WorkloadIdentityProvider> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as WorkloadIdentityProviderListParams | null | undefined;
    return this._client.getAPIList(
      '/organization/workload_identity_providers',
      CursorPage<WorkloadIdentityProvider>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Delete a provider after deleting all its federation rules.
   *
   * @example
   * ```ts
   * const workloadIdentityProviderDeleted =
   *   await client.admin.organization.workloadIdentityProviders.delete(
   *     'x',
   *   );
   * ```
   */
  delete(
    workloadIdentityProviderID: string,
    options?: RequestOptions,
  ): APIPromise<WorkloadIdentityProviderDeleted> {
    return this._client.delete(
      path`/organization/workload_identity_providers/${workloadIdentityProviderID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }
}

export type WorkloadIdentityProvidersPage = CursorPage<WorkloadIdentityProvider>;

export interface WorkloadIdentityProvider {
  id: string;

  attribute_transformations: Array<WorkloadIdentityProvider.AttributeTransformation>;

  audience: string;

  created_at: number;

  description: string | null;

  enabled: boolean;

  issuer: string;

  name: string;

  object: 'organization.workload_identity_provider';

  type: 'oidc';

  updated_at: number;

  verification: WorkloadIdentityProvider.Discovery | WorkloadIdentityProvider.UploadedJwks;
}

export namespace WorkloadIdentityProvider {
  export interface AttributeTransformation {
    attribute: string;

    expression: string;
  }

  export interface Discovery {
    discovery_url: string | null;

    type: 'discovery';
  }

  export interface UploadedJwks {
    jwks: { [key: string]: unknown };

    type: 'uploaded_jwks';
  }
}

export interface WorkloadIdentityProviderDeleted {
  id: string;

  deleted: boolean;

  object: 'organization.workload_identity_provider.deleted';
}

export interface WorkloadIdentityProviderCreateParams {
  audience: string;

  issuer: string;

  name: string;

  type: 'oidc';

  attribute_transformations?: Array<WorkloadIdentityProviderCreateParams.AttributeTransformation>;

  description?: string;

  enabled?: boolean;

  verification?:
    | WorkloadIdentityProviderCreateParams.Discovery
    | WorkloadIdentityProviderCreateParams.UploadedJwks;
}

export namespace WorkloadIdentityProviderCreateParams {
  export interface AttributeTransformation {
    attribute: string;

    expression: string;
  }

  export interface Discovery {
    discovery_url: string | null;

    type: 'discovery';
  }

  export interface UploadedJwks {
    jwks: { [key: string]: unknown };

    type: 'uploaded_jwks';
  }
}

export interface WorkloadIdentityProviderUpdateParams {
  attribute_transformations?: Array<WorkloadIdentityProviderUpdateParams.AttributeTransformation>;

  audience?: string;

  description?: string | null;

  enabled?: boolean;

  issuer?: string;

  name?: string;

  verification?:
    | WorkloadIdentityProviderUpdateParams.DiscoveryVerificationParam
    | WorkloadIdentityProviderUpdateParams.UploadedJwksVerificationParam;
}

export namespace WorkloadIdentityProviderUpdateParams {
  export interface AttributeTransformation {
    attribute: string;

    expression: string;
  }

  export interface DiscoveryVerificationParam {
    discovery_url: string | null;

    type: 'discovery';
  }

  export interface UploadedJwksVerificationParam {
    jwks: { [key: string]: unknown };

    type: 'uploaded_jwks';
  }
}

export interface WorkloadIdentityProviderListParams extends CursorPageParams {
  order?: 'asc' | 'desc';
}

WorkloadIdentityProviders.FederationRules = FederationRules;

export declare namespace WorkloadIdentityProviders {
  export {
    type WorkloadIdentityProvider as WorkloadIdentityProvider,
    type WorkloadIdentityProviderDeleted as WorkloadIdentityProviderDeleted,
    type WorkloadIdentityProvidersPage as WorkloadIdentityProvidersPage,
    type WorkloadIdentityProviderCreateParams as WorkloadIdentityProviderCreateParams,
    type WorkloadIdentityProviderUpdateParams as WorkloadIdentityProviderUpdateParams,
    type WorkloadIdentityProviderListParams as WorkloadIdentityProviderListParams,
  };

  export {
    FederationRules as FederationRules,
    type FederationRule as FederationRule,
    type FederationRuleDeleted as FederationRuleDeleted,
    type FederationRulesPage as FederationRulesPage,
    type FederationRuleCreateParams as FederationRuleCreateParams,
    type FederationRuleRetrieveParams as FederationRuleRetrieveParams,
    type FederationRuleUpdateParams as FederationRuleUpdateParams,
    type FederationRuleListParams as FederationRuleListParams,
    type FederationRuleDeleteParams as FederationRuleDeleteParams,
  };
}
