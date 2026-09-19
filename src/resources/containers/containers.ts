// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as ResponsesAPI from '../responses/responses';
import * as FilesAPI from './files/files';
import {
  FileCreateParams,
  FileCreateResponse,
  FileDeleteParams,
  FileListParams,
  FileListResponse,
  FileListResponsesPage,
  FileRetrieveParams,
  FileRetrieveResponse,
  Files,
} from './files/files';
import { APIPromise } from '../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../core/pagination';
import { buildHeaders } from '../../internal/headers';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

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

export class Containers extends APIResource {
  files: FilesAPI.Files = new FilesAPI.Files(this._client);

  /**
   * Create Container
   */
  create(body: ContainerCreateParams, options?: RequestOptions): APIPromise<ContainerCreateResponse> {
    return this._client.post('/containers', { body, ...options, __security: { bearerAuth: true } });
  }

  /**
   * Retrieve Container
   */
  retrieve(containerID: string, options?: RequestOptions): APIPromise<ContainerRetrieveResponse> {
    return this._client.get(path`/containers/${containerID}`, {
      ...options,
      __security: { bearerAuth: true },
    });
  }

  /**
   * List Containers
   */
  list(
    query?:
      | (ContainerListParams &
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
  ): PagePromise<ContainerListResponsesPage, ContainerListResponse>;
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
  ): PagePromise<ContainerListResponsesPage, ContainerListResponse>;
  list(
    query:
      | ContainerListParams
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
  ): PagePromise<ContainerListResponsesPage, ContainerListResponse> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'name', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as ContainerListParams | null | undefined;
    return this._client.getAPIList('/containers', CursorPage<ContainerListResponse>, {
      query,
      ...options,
      __security: { bearerAuth: true },
    });
  }

  /**
   * Delete Container
   */
  delete(containerID: string, options?: RequestOptions): APIPromise<void> {
    return this._client.delete(path`/containers/${containerID}`, {
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type ContainerListResponsesPage = CursorPage<ContainerListResponse>;

export interface ContainerCreateResponse {
  /**
   * Unique identifier for the container.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the container was created.
   */
  created_at: number;

  /**
   * Name of the container.
   */
  name: string;

  /**
   * The type of this object.
   */
  object: string;

  /**
   * Status of the container (e.g., active, deleted).
   */
  status: string;

  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  expires_after?: ContainerCreateResponse.ExpiresAfter;

  /**
   * Unix timestamp (in seconds) when the container was last active.
   */
  last_active_at?: number;

  /**
   * The memory limit configured for the container.
   */
  memory_limit?: '1g' | '4g' | '16g' | '64g';

  /**
   * Network access policy for the container.
   */
  network_policy?: ContainerCreateResponse.NetworkPolicy;
}

export namespace ContainerCreateResponse {
  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  export interface ExpiresAfter {
    /**
     * The reference point for the expiration.
     */
    anchor?: 'last_active_at';

    /**
     * The number of minutes after the anchor before the container expires.
     */
    minutes?: number;
  }

  /**
   * Network access policy for the container.
   */
  export interface NetworkPolicy {
    /**
     * The network policy mode.
     */
    type: 'allowlist' | 'disabled';

    /**
     * Allowed outbound domains when `type` is `allowlist`.
     */
    allowed_domains?: Array<string>;
  }
}

export interface ContainerRetrieveResponse {
  /**
   * Unique identifier for the container.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the container was created.
   */
  created_at: number;

  /**
   * Name of the container.
   */
  name: string;

  /**
   * The type of this object.
   */
  object: string;

  /**
   * Status of the container (e.g., active, deleted).
   */
  status: string;

  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  expires_after?: ContainerRetrieveResponse.ExpiresAfter;

  /**
   * Unix timestamp (in seconds) when the container was last active.
   */
  last_active_at?: number;

  /**
   * The memory limit configured for the container.
   */
  memory_limit?: '1g' | '4g' | '16g' | '64g';

  /**
   * Network access policy for the container.
   */
  network_policy?: ContainerRetrieveResponse.NetworkPolicy;
}

export namespace ContainerRetrieveResponse {
  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  export interface ExpiresAfter {
    /**
     * The reference point for the expiration.
     */
    anchor?: 'last_active_at';

    /**
     * The number of minutes after the anchor before the container expires.
     */
    minutes?: number;
  }

  /**
   * Network access policy for the container.
   */
  export interface NetworkPolicy {
    /**
     * The network policy mode.
     */
    type: 'allowlist' | 'disabled';

    /**
     * Allowed outbound domains when `type` is `allowlist`.
     */
    allowed_domains?: Array<string>;
  }
}

export interface ContainerListResponse {
  /**
   * Unique identifier for the container.
   */
  id: string;

  /**
   * Unix timestamp (in seconds) when the container was created.
   */
  created_at: number;

  /**
   * Name of the container.
   */
  name: string;

  /**
   * The type of this object.
   */
  object: string;

  /**
   * Status of the container (e.g., active, deleted).
   */
  status: string;

  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  expires_after?: ContainerListResponse.ExpiresAfter;

  /**
   * Unix timestamp (in seconds) when the container was last active.
   */
  last_active_at?: number;

  /**
   * The memory limit configured for the container.
   */
  memory_limit?: '1g' | '4g' | '16g' | '64g';

  /**
   * Network access policy for the container.
   */
  network_policy?: ContainerListResponse.NetworkPolicy;
}

export namespace ContainerListResponse {
  /**
   * The container will expire after this time period. The anchor is the reference
   * point for the expiration. The minutes is the number of minutes after the anchor
   * before the container expires.
   */
  export interface ExpiresAfter {
    /**
     * The reference point for the expiration.
     */
    anchor?: 'last_active_at';

    /**
     * The number of minutes after the anchor before the container expires.
     */
    minutes?: number;
  }

  /**
   * Network access policy for the container.
   */
  export interface NetworkPolicy {
    /**
     * The network policy mode.
     */
    type: 'allowlist' | 'disabled';

    /**
     * Allowed outbound domains when `type` is `allowlist`.
     */
    allowed_domains?: Array<string>;
  }
}

export interface ContainerCreateParams {
  /**
   * Name of the container to create.
   */
  name: string;

  /**
   * Container expiration time in seconds relative to the 'anchor' time.
   */
  expires_after?: ContainerCreateParams.ExpiresAfter;

  /**
   * IDs of files to copy to the container.
   */
  file_ids?: Array<string>;

  /**
   * Optional memory limit for the container. Defaults to "1g".
   */
  memory_limit?: '1g' | '4g' | '16g' | '64g';

  /**
   * Network access policy for the container.
   */
  network_policy?: ResponsesAPI.ContainerNetworkPolicyDisabled | ResponsesAPI.ContainerNetworkPolicyAllowlist;

  /**
   * An optional list of skills referenced by id or inline data.
   */
  skills?: Array<ResponsesAPI.SkillReference | ResponsesAPI.InlineSkill>;
}

export namespace ContainerCreateParams {
  /**
   * Container expiration time in seconds relative to the 'anchor' time.
   */
  export interface ExpiresAfter {
    /**
     * Time anchor for the expiration time. Currently only 'last_active_at' is
     * supported.
     */
    anchor: 'last_active_at';

    minutes: number;
  }
}

export interface ContainerListParams extends CursorPageParams {
  /**
   * Filter results by container name.
   */
  name?: string;

  /**
   * Sort order by the `created_at` timestamp of the objects. `asc` for ascending
   * order and `desc` for descending order.
   */
  order?: 'asc' | 'desc';
}

Containers.Files = Files;

export declare namespace Containers {
  export {
    type ContainerCreateResponse as ContainerCreateResponse,
    type ContainerRetrieveResponse as ContainerRetrieveResponse,
    type ContainerListResponse as ContainerListResponse,
    type ContainerListResponsesPage as ContainerListResponsesPage,
    type ContainerCreateParams as ContainerCreateParams,
    type ContainerListParams as ContainerListParams,
  };

  export {
    Files as Files,
    type FileCreateResponse as FileCreateResponse,
    type FileRetrieveResponse as FileRetrieveResponse,
    type FileListResponse as FileListResponse,
    type FileListResponsesPage as FileListResponsesPage,
    type FileCreateParams as FileCreateParams,
    type FileRetrieveParams as FileRetrieveParams,
    type FileListParams as FileListParams,
    type FileDeleteParams as FileDeleteParams,
  };
}
