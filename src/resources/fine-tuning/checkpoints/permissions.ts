// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { Page, PagePromise } from '../../../core/pagination';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Permissions extends APIResource {
  /**
   * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
   *
   * This enables organization owners to share fine-tuned models with other projects
   * in their organization.
   */
  create(
    fineTunedModelCheckpoint: string,
    body: PermissionCreateParams,
    options?: RequestOptions,
  ): PagePromise<PermissionCreateResponsesPage, PermissionCreateResponse> {
    return this._client.getAPIList(
      path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`,
      Page<PermissionCreateResponse>,
      { body, method: 'post', ...options },
    );
  }

  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   */
  retrieve(
    fineTunedModelCheckpoint: string,
    query: PermissionRetrieveParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<PermissionRetrieveResponse> {
    return this._client.get(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
      query,
      ...options,
    });
  }

  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to delete a permission for a
   * fine-tuned model checkpoint.
   */
  delete(fineTunedModelCheckpoint: string, options?: RequestOptions): APIPromise<PermissionDeleteResponse> {
    return this._client.delete(
      path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`,
      options,
    );
  }
}

// Note: no pagination actually occurs yet, this is for forwards-compatibility.
export type PermissionCreateResponsesPage = Page<PermissionCreateResponse>;

/**
 * The `checkpoint.permission` object represents a permission for a fine-tuned
 * model checkpoint.
 */
export interface PermissionCreateResponse {
  /**
   * The permission identifier, which can be referenced in the API endpoints.
   */
  id: string;

  /**
   * The Unix timestamp (in seconds) for when the permission was created.
   */
  created_at: number;

  /**
   * The object type, which is always "checkpoint.permission".
   */
  object: 'checkpoint.permission';

  /**
   * The project identifier that the permission is for.
   */
  project_id: string;
}

export interface PermissionRetrieveResponse {
  data: Array<PermissionRetrieveResponse.Data>;

  has_more: boolean;

  object: 'list';

  first_id?: string | null;

  last_id?: string | null;
}

export namespace PermissionRetrieveResponse {
  /**
   * The `checkpoint.permission` object represents a permission for a fine-tuned
   * model checkpoint.
   */
  export interface Data {
    /**
     * The permission identifier, which can be referenced in the API endpoints.
     */
    id: string;

    /**
     * The Unix timestamp (in seconds) for when the permission was created.
     */
    created_at: number;

    /**
     * The object type, which is always "checkpoint.permission".
     */
    object: 'checkpoint.permission';

    /**
     * The project identifier that the permission is for.
     */
    project_id: string;
  }
}

export interface PermissionDeleteResponse {
  /**
   * The ID of the fine-tuned model checkpoint permission that was deleted.
   */
  id: string;

  /**
   * Whether the fine-tuned model checkpoint permission was successfully deleted.
   */
  deleted: boolean;

  /**
   * The object type, which is always "checkpoint.permission".
   */
  object: 'checkpoint.permission';
}

export interface PermissionCreateParams {
  /**
   * The project identifiers to grant access to.
   */
  project_ids: Array<string>;
}

export interface PermissionRetrieveParams {
  /**
   * Identifier for the last permission ID from the previous pagination request.
   */
  after?: string;

  /**
   * Number of permissions to retrieve.
   */
  limit?: number;

  /**
   * The order in which to retrieve permissions.
   */
  order?: 'ascending' | 'descending';

  /**
   * The ID of the project to get permissions for.
   */
  project_id?: string;
}

export declare namespace Permissions {
  export {
    type PermissionCreateResponse as PermissionCreateResponse,
    type PermissionRetrieveResponse as PermissionRetrieveResponse,
    type PermissionDeleteResponse as PermissionDeleteResponse,
    type PermissionCreateResponsesPage as PermissionCreateResponsesPage,
    type PermissionCreateParams as PermissionCreateParams,
    type PermissionRetrieveParams as PermissionRetrieveParams,
  };
}
