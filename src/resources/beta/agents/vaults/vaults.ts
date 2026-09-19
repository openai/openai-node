// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as CredentialsAPI from './credentials';
import {
  Credential,
  CredentialAuth,
  CredentialAuthCreateParam,
  CredentialAuthRotateParam,
  CredentialCreateParams,
  CredentialDeleteParams,
  CredentialDeleted,
  CredentialListParams,
  CredentialNetworking,
  CredentialNetworkingParam,
  CredentialRetrieveParams,
  CredentialUpdateParams,
  Credentials,
  CredentialsPage,
  McpOauthTokenEndpointAuth,
  McpOauthTokenEndpointAuthCreateParam,
  McpOauthTokenEndpointAuthRotateParam,
} from './credentials';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

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

export class Vaults extends APIResource {
  credentials: CredentialsAPI.Credentials = new CredentialsAPI.Credentials(this._client);

  /**
   * Creates a vault for the current project. See
   * [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).
   *
   * @example
   * ```ts
   * const vault = await client.beta.agents.vaults.create();
   * ```
   */
  create(body: VaultCreateParams | null | undefined = {}, options?: RequestOptions): APIPromise<Vault> {
    return this._client.post('/vaults', {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Retrieves a vault by its ID. See
   * [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).
   *
   * @example
   * ```ts
   * const vault = await client.beta.agents.vaults.retrieve(
   *   'vault_id',
   * );
   * ```
   */
  retrieve(vaultID: string, options?: RequestOptions): APIPromise<Vault> {
    return this._client.get(path`/vaults/${vaultID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists vaults using ID-based pagination. See
   * [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const vault of client.beta.agents.vaults.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (VaultListParams &
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
  ): PagePromise<VaultsPage, Vault>;
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
  ): PagePromise<VaultsPage, Vault>;
  list(
    query:
      | VaultListParams
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
  ): PagePromise<VaultsPage, Vault> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'status'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as VaultListParams | null | undefined;
    return this._client.getAPIList('/vaults', CursorPage<Vault>, {
      query,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Deletes a vault and all its credentials. See
   * [vaults](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults).
   *
   * @example
   * ```ts
   * const vaultDeleted = await client.beta.agents.vaults.delete(
   *   'vault_id',
   * );
   * ```
   */
  delete(vaultID: string, options?: RequestOptions): APIPromise<VaultDeleted> {
    return this._client.delete(path`/vaults/${vaultID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type VaultsPage = CursorPage<Vault>;

/**
 * A collection of credentials for MCP servers and OpenAI-hosted environments.
 */
export interface Vault {
  /**
   * The ID of the vault.
   */
  id: string;

  /**
   * The Unix timestamp, in seconds, when the vault was created.
   */
  created_at: number;

  /**
   * Key-value pairs associated with the vault, such as an application or team
   * identifier.
   */
  metadata: { [key: string]: string };

  /**
   * The human-readable name of the vault, if set.
   */
  name: string | null;

  /**
   * The object type. Always `vault`.
   */
  object: 'vault';
}

/**
 * Confirmation that a vault was deleted.
 */
export interface VaultDeleted {
  /**
   * The ID of the deleted vault.
   */
  id: string;

  /**
   * Whether the resource was deleted. Always `true`.
   */
  deleted: boolean;

  /**
   * The object type. Always `vault.deleted`.
   */
  object: 'vault.deleted';
}

/**
 * Whether a vault or credential is active or archived.
 */
export type VaultStatus = 'active' | 'archived';

/**
 * One or more lifecycle statuses to include when listing vaults or credentials.
 */
export type VaultStatusFilter = VaultStatus | Array<VaultStatus>;

export interface VaultCreateParams {
  /**
   * Key-value pairs to associate with the vault, such as an application or team
   * identifier.
   */
  metadata?: { [key: string]: string } | null;

  /**
   * The name is trimmed before storage. It must contain 1 to 256 UTF-8 bytes after
   * trimming.
   */
  name?: string;
}

export interface VaultListParams extends Omit<CursorPageParams, 'limit'> {
  /**
   * The maximum number of resources to return. Defaults to 20. Values are clamped
   * between 1 and 100.
   */
  limit?: number | null;

  /**
   * Sort order by the `created_at` timestamp. Use `asc` for ascending order or
   * `desc` for descending order. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * Filter by one status or a list, such as `status=active` or
   * `status[]=active&status[]=archived`. Both statuses are included by default.
   */
  status?: VaultStatusFilter;
}

Vaults.Credentials = Credentials;

export declare namespace Vaults {
  export {
    type Vault as Vault,
    type VaultDeleted as VaultDeleted,
    type VaultStatus as VaultStatus,
    type VaultStatusFilter as VaultStatusFilter,
    type VaultsPage as VaultsPage,
    type VaultCreateParams as VaultCreateParams,
    type VaultListParams as VaultListParams,
  };

  export {
    Credentials as Credentials,
    type Credential as Credential,
    type CredentialAuth as CredentialAuth,
    type CredentialAuthCreateParam as CredentialAuthCreateParam,
    type CredentialAuthRotateParam as CredentialAuthRotateParam,
    type CredentialDeleted as CredentialDeleted,
    type CredentialNetworking as CredentialNetworking,
    type CredentialNetworkingParam as CredentialNetworkingParam,
    type McpOauthTokenEndpointAuth as McpOauthTokenEndpointAuth,
    type McpOauthTokenEndpointAuthCreateParam as McpOauthTokenEndpointAuthCreateParam,
    type McpOauthTokenEndpointAuthRotateParam as McpOauthTokenEndpointAuthRotateParam,
    type CredentialsPage as CredentialsPage,
    type CredentialCreateParams as CredentialCreateParams,
    type CredentialRetrieveParams as CredentialRetrieveParams,
    type CredentialUpdateParams as CredentialUpdateParams,
    type CredentialListParams as CredentialListParams,
    type CredentialDeleteParams as CredentialDeleteParams,
  };
}
