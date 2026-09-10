// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import * as FilesAPI from './files';
import { EnvironmentFile, EnvironmentFilesPage, FileCreateParams, FileListParams, Files } from './files';
import * as TemplatesAPI from './templates';
import {
  EnvironmentTemplate,
  EnvironmentTemplateDeleted,
  EnvironmentTemplatesPage,
  TemplateCreateParams,
  TemplateListParams,
  TemplateUpdateParams,
  Templates,
} from './templates';
import { APIPromise } from '../../../../core/api-promise';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Environments extends APIResource {
  files: FilesAPI.Files = new FilesAPI.Files(this._client);
  templates: TemplatesAPI.Templates = new TemplatesAPI.Templates(this._client);

  /**
   * Retrieves an execution environment's connection status and safe installed
   * metadata. See
   * [environment lifecycle](https://developers.openai.com/api/docs/guides/agents-api/environments/lifecycle).
   *
   * @example
   * ```ts
   * const environmentInfo =
   *   await client.beta.agents.environments.retrieve(
   *     'environment_id',
   *   );
   * ```
   */
  retrieve(environmentID: string, options?: RequestOptions): APIPromise<EnvironmentInfo> {
    return this._client.get(path`/agents/environments/${environmentID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

/**
 * Safe metadata for a first-class execution environment.
 */
export interface EnvironmentInfo {
  /**
   * The ID of the environment.
   */
  id: string;

  /**
   * Files installed in the environment, without their contents.
   */
  files: Array<AgentsAPI.HostedEnvironmentFile>;

  /**
   * The object type. Always `agent.environment`.
   */
  object: 'agent.environment';

  /**
   * Plugins installed in the environment, without their archive contents.
   */
  plugins: Array<AgentsAPI.HostedPlugin>;

  /**
   * Skills installed in the environment, without their archive contents.
   */
  skills: Array<AgentsAPI.HostedSkill>;

  /**
   * The current environment connection status.
   */
  status: 'pending' | 'connected' | 'disconnected' | 'expired' | 'failed';

  /**
   * Whether the environment is hosted by OpenAI or by the application.
   */
  type: 'openai_hosted' | 'self_hosted';
}

Environments.Files = Files;
Environments.Templates = Templates;

export declare namespace Environments {
  export { type EnvironmentInfo as EnvironmentInfo };

  export {
    Files as Files,
    type EnvironmentFile as EnvironmentFile,
    type EnvironmentFilesPage as EnvironmentFilesPage,
    type FileCreateParams as FileCreateParams,
    type FileListParams as FileListParams,
  };

  export {
    Templates as Templates,
    type EnvironmentTemplate as EnvironmentTemplate,
    type EnvironmentTemplateDeleted as EnvironmentTemplateDeleted,
    type EnvironmentTemplatesPage as EnvironmentTemplatesPage,
    type TemplateCreateParams as TemplateCreateParams,
    type TemplateUpdateParams as TemplateUpdateParams,
    type TemplateListParams as TemplateListParams,
  };
}
