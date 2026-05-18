// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import { APIPromise } from '../../../../core/api-promise';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class HostedToolPermissions extends APIResource {
  /**
   * Returns hosted tool permissions for a project.
   *
   * @example
   * ```ts
   * const projectHostedToolPermissions =
   *   await client.admin.organization.projects.hostedToolPermissions.retrieve(
   *     'project_id',
   *   );
   * ```
   */
  retrieve(projectID: string, options?: RequestOptions): APIPromise<ProjectHostedToolPermissions> {
    return this._client.get(path`/organization/projects/${projectID}/hosted_tool_permissions`, {
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }

  /**
   * Updates hosted tool permissions for a project.
   *
   * @example
   * ```ts
   * const projectHostedToolPermissions =
   *   await client.admin.organization.projects.hostedToolPermissions.update(
   *     'project_id',
   *   );
   * ```
   */
  update(
    projectID: string,
    body: HostedToolPermissionUpdateParams,
    options?: RequestOptions,
  ): APIPromise<ProjectHostedToolPermissions> {
    return this._client.post(path`/organization/projects/${projectID}/hosted_tool_permissions`, {
      body,
      ...options,
      __security: { adminAPIKeyAuth: true },
    });
  }
}

/**
 * Represents hosted tool permissions for a project.
 */
export interface ProjectHostedToolPermissions {
  /**
   * Permission state for a single hosted tool on a project.
   */
  code_interpreter: ProjectHostedToolPermissions.CodeInterpreter;

  /**
   * Permission state for a single hosted tool on a project.
   */
  file_search: ProjectHostedToolPermissions.FileSearch;

  /**
   * Permission state for a single hosted tool on a project.
   */
  image_generation: ProjectHostedToolPermissions.ImageGeneration;

  /**
   * Permission state for a single hosted tool on a project.
   */
  mcp: ProjectHostedToolPermissions.Mcp;

  /**
   * Permission state for a single hosted tool on a project.
   */
  web_search: ProjectHostedToolPermissions.WebSearch;
}

export namespace ProjectHostedToolPermissions {
  /**
   * Permission state for a single hosted tool on a project.
   */
  export interface CodeInterpreter {
    /**
     * Whether the hosted tool is enabled for the project.
     */
    enabled: boolean;
  }

  /**
   * Permission state for a single hosted tool on a project.
   */
  export interface FileSearch {
    /**
     * Whether the hosted tool is enabled for the project.
     */
    enabled: boolean;
  }

  /**
   * Permission state for a single hosted tool on a project.
   */
  export interface ImageGeneration {
    /**
     * Whether the hosted tool is enabled for the project.
     */
    enabled: boolean;
  }

  /**
   * Permission state for a single hosted tool on a project.
   */
  export interface Mcp {
    /**
     * Whether the hosted tool is enabled for the project.
     */
    enabled: boolean;
  }

  /**
   * Permission state for a single hosted tool on a project.
   */
  export interface WebSearch {
    /**
     * Whether the hosted tool is enabled for the project.
     */
    enabled: boolean;
  }
}

export interface HostedToolPermissionUpdateParams {
  /**
   * The code interpreter permission update.
   */
  code_interpreter?: HostedToolPermissionUpdateParams.CodeInterpreter | null;

  /**
   * The file search permission update.
   */
  file_search?: HostedToolPermissionUpdateParams.FileSearch | null;

  /**
   * The image generation permission update.
   */
  image_generation?: HostedToolPermissionUpdateParams.ImageGeneration | null;

  /**
   * The MCP permission update.
   */
  mcp?: HostedToolPermissionUpdateParams.Mcp | null;

  /**
   * The web search permission update.
   */
  web_search?: HostedToolPermissionUpdateParams.WebSearch | null;
}

export namespace HostedToolPermissionUpdateParams {
  /**
   * The code interpreter permission update.
   */
  export interface CodeInterpreter {
    /**
     * Whether to enable the hosted tool for the project.
     */
    enabled: boolean;
  }

  /**
   * The file search permission update.
   */
  export interface FileSearch {
    /**
     * Whether to enable the hosted tool for the project.
     */
    enabled: boolean;
  }

  /**
   * The image generation permission update.
   */
  export interface ImageGeneration {
    /**
     * Whether to enable the hosted tool for the project.
     */
    enabled: boolean;
  }

  /**
   * The MCP permission update.
   */
  export interface Mcp {
    /**
     * Whether to enable the hosted tool for the project.
     */
    enabled: boolean;
  }

  /**
   * The web search permission update.
   */
  export interface WebSearch {
    /**
     * Whether to enable the hosted tool for the project.
     */
    enabled: boolean;
  }
}

export declare namespace HostedToolPermissions {
  export {
    type ProjectHostedToolPermissions as ProjectHostedToolPermissions,
    type HostedToolPermissionUpdateParams as HostedToolPermissionUpdateParams,
  };
}
