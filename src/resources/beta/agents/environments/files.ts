// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { PagePromise, TokenPage, type TokenPageParams } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Files extends APIResource {
  /**
   * Copies inline bytes or a Files API file into a connected execution environment.
   * See
   * [environment files](https://developers.openai.com/api/docs/guides/agents-api/environments/files).
   *
   * @example
   * ```ts
   * const environmentFile =
   *   await client.beta.agents.environments.files.create(
   *     'environment_id',
   *     {
   *       type: 'inline',
   *       path: '/workspace/example.txt',
   *       data: 'SGVsbG8K',
   *     },
   *   );
   * ```
   */
  create(
    environmentID: string,
    body: FileCreateParams,
    options?: RequestOptions,
  ): APIPromise<EnvironmentFile> {
    return this._client.post(path`/agents/environments/${environmentID}/files`, {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists live files on a connected execution environment with optional directory
   * filtering and opaque cursor pagination. See
   * [environment files](https://developers.openai.com/api/docs/guides/agents-api/environments/files).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const environmentFile of client.beta.agents.environments.files.list(
   *   'environment_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    environmentID: string,
    query: FileListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<EnvironmentFilesPage, EnvironmentFile> {
    return this._client.getAPIList(
      path`/agents/environments/${environmentID}/files`,
      TokenPage<EnvironmentFile>,
      {
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      },
    );
  }
}

export type EnvironmentFilesPage = TokenPage<EnvironmentFile>;

/**
 * A live file in an execution environment.
 */
export interface EnvironmentFile {
  /**
   * The ID of the environment containing this file.
   */
  environment_id: string;

  /**
   * The object type. Always `agent.environment.file`.
   */
  object: 'agent.environment.file';

  /**
   * The absolute file path inside the environment's workspace.
   */
  path: string;

  /**
   * The file size in bytes.
   */
  size_bytes: number;
}

export type FileCreateParams =
  | FileCreateParams.HostedEnvironmentFileParamFileID
  | FileCreateParams.HostedEnvironmentFileParamInline;

export declare namespace FileCreateParams {
  export interface HostedEnvironmentFileParamFileID {
    /**
     * The ID of the uploaded file.
     */
    file_id: string;

    /**
     * The absolute destination path inside `/workspace`.
     */
    path: string;

    /**
     * The type of the object. Always `file_id`.
     */
    type: 'file_id';
  }

  export interface HostedEnvironmentFileParamInline {
    /**
     * The standard-base64-encoded file contents.
     */
    data: string;

    /**
     * The absolute destination path inside `/workspace`.
     */
    path: string;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

export interface FileListParams extends TokenPageParams {
  /**
   * Sort by case-sensitive path components. Defaults to descending.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * Restrict the listing to this absolute workspace directory.
   */
  path?: string | null;
}

export declare namespace Files {
  export {
    type EnvironmentFile as EnvironmentFile,
    type EnvironmentFilesPage as EnvironmentFilesPage,
    type FileCreateParams as FileCreateParams,
    type FileListParams as FileListParams,
  };
}
