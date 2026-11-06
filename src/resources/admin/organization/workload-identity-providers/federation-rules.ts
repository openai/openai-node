// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
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

export class FederationRules extends APIResource {
  /**
   * Bind verified token attributes to an existing project service account.
   *
   * @example
   * ```ts
   * const federationRule =
   *   await client.admin.organization.workloadIdentityProviders.federationRules.create(
   *     'x',
   *     {
   *       attribute_matchers: { foo: 'string' },
   *       project_id: 'x',
   *       service_account_id: 'x',
   *     },
   *   );
   * ```
   */
  create(
    workloadIdentityProviderID: string,
    body: FederationRuleCreateParams,
    options?: RequestOptions,
  ): APIPromise<FederationRule> {
    return this._client.post(
      path`/organization/workload_identity_providers/${workloadIdentityProviderID}/federation_rules`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Retrieve a federation rule owned by the authenticated organization and provider.
   *
   * @example
   * ```ts
   * const federationRule =
   *   await client.admin.organization.workloadIdentityProviders.federationRules.retrieve(
   *     'x',
   *     { workload_identity_provider_id: 'x' },
   *   );
   * ```
   */
  retrieve(
    workloadIdentityFederationRuleID: string,
    params: FederationRuleRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<FederationRule> {
    const { workload_identity_provider_id } = params;
    return this._client.get(
      path`/organization/workload_identity_providers/${workload_identity_provider_id}/federation_rules/${workloadIdentityFederationRuleID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Update supplied matcher, permission, metadata, or enabled fields.
   *
   * @example
   * ```ts
   * const federationRule =
   *   await client.admin.organization.workloadIdentityProviders.federationRules.update(
   *     'x',
   *     { workload_identity_provider_id: 'x' },
   *   );
   * ```
   */
  update(
    workloadIdentityFederationRuleID: string,
    params: FederationRuleUpdateParams,
    options?: RequestOptions,
  ): APIPromise<FederationRule> {
    const { workload_identity_provider_id, ...body } = params;
    return this._client.post(
      path`/organization/workload_identity_providers/${workload_identity_provider_id}/federation_rules/${workloadIdentityFederationRuleID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * List the provider's federation rules to project service accounts.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const federationRule of client.admin.organization.workloadIdentityProviders.federationRules.list(
   *   'x',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    workloadIdentityProviderID: string,
    query?:
      | (FederationRuleListParams &
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
  ): PagePromise<FederationRulesPage, FederationRule>;
  list(
    workloadIdentityProviderID: string,
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
  ): PagePromise<FederationRulesPage, FederationRule>;
  list(
    workloadIdentityProviderID: string,
    query:
      | FederationRuleListParams
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
  ): PagePromise<FederationRulesPage, FederationRule> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'service_account_id'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as FederationRuleListParams | null | undefined;
    return this._client.getAPIList(
      path`/organization/workload_identity_providers/${workloadIdentityProviderID}/federation_rules`,
      CursorPage<FederationRule>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }

  /**
   * Delete a federation rule to a project service account.
   *
   * @example
   * ```ts
   * const federationRuleDeleted =
   *   await client.admin.organization.workloadIdentityProviders.federationRules.delete(
   *     'x',
   *     { workload_identity_provider_id: 'x' },
   *   );
   * ```
   */
  delete(
    workloadIdentityFederationRuleID: string,
    params: FederationRuleDeleteParams,
    options?: RequestOptions,
  ): APIPromise<FederationRuleDeleted> {
    const { workload_identity_provider_id } = params;
    return this._client.delete(
      path`/organization/workload_identity_providers/${workload_identity_provider_id}/federation_rules/${workloadIdentityFederationRuleID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        __security: { adminAPIKeyAuth: true },
      })),
    );
  }
}

export type FederationRulesPage = CursorPage<FederationRule>;

export interface FederationRule {
  id: string;

  attribute_matchers: { [key: string]: string | boolean | number };

  created_at: number;

  description: string | null;

  enabled: boolean;

  name: string | null;

  object: 'organization.workload_identity_federation_rule';

  permissions: FederationRule.ServiceAccountDefault | FederationRule.Restricted;

  project_id: string;

  service_account_id: string;

  updated_at: number;

  workload_identity_provider_id: string;
}

export namespace FederationRule {
  export interface ServiceAccountDefault {
    type: 'service_account_default';
  }

  export interface Restricted {
    scopes: Array<string>;

    type: 'restricted';
  }
}

export interface FederationRuleDeleted {
  id: string;

  deleted: boolean;

  object: 'organization.workload_identity_federation_rule.deleted';
}

export interface FederationRuleCreateParams {
  attribute_matchers: { [key: string]: string | boolean | number };

  project_id: string;

  service_account_id: string;

  description?: string;

  enabled?: boolean;

  name?: string;

  permissions?: FederationRuleCreateParams.ServiceAccountDefault | FederationRuleCreateParams.Restricted;
}

export namespace FederationRuleCreateParams {
  export interface ServiceAccountDefault {
    type: 'service_account_default';
  }

  export interface Restricted {
    scopes: Array<string>;

    type: 'restricted';
  }
}

export interface FederationRuleRetrieveParams {
  workload_identity_provider_id: string;
}

export interface FederationRuleUpdateParams {
  /**
   * Path param
   */
  workload_identity_provider_id: string;

  /**
   * Body param
   */
  attribute_matchers?: { [key: string]: string | boolean | number };

  /**
   * Body param
   */
  description?: string | null;

  /**
   * Body param
   */
  enabled?: boolean;

  /**
   * Body param
   */
  name?: string | null;

  /**
   * Body param
   */
  permissions?:
    | FederationRuleUpdateParams.DefaultPermissionsParam
    | FederationRuleUpdateParams.RestrictedPermissionsParam;
}

export namespace FederationRuleUpdateParams {
  export interface DefaultPermissionsParam {
    type: 'service_account_default';
  }

  export interface RestrictedPermissionsParam {
    scopes: Array<string>;

    type: 'restricted';
  }
}

export interface FederationRuleListParams extends CursorPageParams {
  order?: 'asc' | 'desc';

  service_account_id?: string;
}

export interface FederationRuleDeleteParams {
  workload_identity_provider_id: string;
}

export declare namespace FederationRules {
  export {
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
