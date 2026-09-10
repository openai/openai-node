// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Templates extends APIResource {
  /**
   * Creates reusable environment configuration without returning confidential setup
   * commands or environment values. See
   * [reusing a hosted setup](https://developers.openai.com/api/docs/guides/agents-api/tools#reuse-a-hosted-plugin-setup).
   *
   * @example
   * ```ts
   * const environmentTemplate =
   *   await client.beta.agents.environments.templates.create();
   * ```
   */
  create(
    body: TemplateCreateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<EnvironmentTemplate> {
    return this._client.post('/agents/environments/templates', {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Retrieves reusable environment configuration without returning confidential
   * values. See
   * [reusing a hosted setup](https://developers.openai.com/api/docs/guides/agents-api/tools#reuse-a-hosted-plugin-setup).
   *
   * @example
   * ```ts
   * const environmentTemplate =
   *   await client.beta.agents.environments.templates.retrieve(
   *     'environment_template_id',
   *   );
   * ```
   */
  retrieve(environmentTemplateID: string, options?: RequestOptions): APIPromise<EnvironmentTemplate> {
    return this._client.get(path`/agents/environments/templates/${environmentTemplateID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Updates reusable environment configuration without returning confidential
   * values. See
   * [reusing a hosted setup](https://developers.openai.com/api/docs/guides/agents-api/tools#reuse-a-hosted-plugin-setup).
   *
   * @example
   * ```ts
   * const environmentTemplate =
   *   await client.beta.agents.environments.templates.update(
   *     'environment_template_id',
   *   );
   * ```
   */
  update(
    environmentTemplateID: string,
    body: TemplateUpdateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<EnvironmentTemplate> {
    return this._client.post(path`/agents/environments/templates/${environmentTemplateID}`, {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists reusable environment templates without returning confidential values. See
   * [reusing a hosted setup](https://developers.openai.com/api/docs/guides/agents-api/tools#reuse-a-hosted-plugin-setup).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const environmentTemplate of client.beta.agents.environments.templates.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: TemplateListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<EnvironmentTemplatesPage, EnvironmentTemplate> {
    return this._client.getAPIList('/agents/environments/templates', CursorPage<EnvironmentTemplate>, {
      query,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Deletes reusable environment configuration and all confidential template inputs.
   * See
   * [reusing a hosted setup](https://developers.openai.com/api/docs/guides/agents-api/tools#reuse-a-hosted-plugin-setup).
   *
   * @example
   * ```ts
   * const environmentTemplateDeleted =
   *   await client.beta.agents.environments.templates.delete(
   *     'environment_template_id',
   *   );
   * ```
   */
  delete(environmentTemplateID: string, options?: RequestOptions): APIPromise<EnvironmentTemplateDeleted> {
    return this._client.delete(path`/agents/environments/templates/${environmentTemplateID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type EnvironmentTemplatesPage = CursorPage<EnvironmentTemplate>;

/**
 * Reusable configuration that provisions a fresh OpenAI-hosted environment for
 * each session.
 */
export interface EnvironmentTemplate {
  /**
   * The ID of the reusable environment template.
   */
  id: string;

  /**
   * Directories that expose capabilities to the agent.
   */
  capability_directories: Array<string>;

  /**
   * The Unix timestamp, in seconds, when the template was created.
   */
  created_at: number;

  /**
   * Safe file metadata, excluding contents and session-scoped file IDs.
   */
  files: Array<
    | EnvironmentTemplate.HostedTemplateFileResourceFileID
    | EnvironmentTemplate.HostedTemplateFileResourceInline
  >;

  /**
   * An optional human-readable display name for the template.
   */
  name: string | null;

  /**
   * Runtime network access for each OpenAI-hosted environment.
   */
  network: EnvironmentTemplate.Network;

  /**
   * The object type. Always `agent.environment.template`.
   */
  object: 'agent.environment.template';

  /**
   * Packages installed in each fresh OpenAI-hosted environment.
   */
  packages: EnvironmentTemplate.Packages;

  /**
   * Safe plugin metadata, excluding inline archive contents.
   */
  plugins: Array<AgentsAPI.HostedPlugin>;

  /**
   * Safe skill metadata, preserving unresolved version selectors.
   */
  skills: Array<
    | EnvironmentTemplate.HostedTemplateSkillResourceSkillReference
    | EnvironmentTemplate.HostedTemplateSkillResourceInline
  >;

  /**
   * The Unix timestamp, in seconds, when the template was last updated.
   */
  updated_at: number;
}

export namespace EnvironmentTemplate {
  /**
   * A project-scoped Files API reference resolved separately for each session.
   */
  export interface HostedTemplateFileResourceFileID {
    /**
     * The ID of the uploaded file.
     */
    file_id: string;

    /**
     * The file's absolute path inside the environment.
     */
    path: string;

    /**
     * The type of the object. Always `file_id`.
     */
    type: 'file_id';
  }

  /**
   * Metadata for confidential inline file contents.
   */
  export interface HostedTemplateFileResourceInline {
    /**
     * The file's absolute path inside the environment.
     */
    path: string;

    /**
     * The decoded size of the inline file in bytes.
     */
    size_bytes: number;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }

  /**
   * Runtime network access for each OpenAI-hosted environment.
   */
  export interface Network {
    /**
     * The environment's network access mode.
     *
     * - `enabled` - Allows unrestricted network access.
     * - `disabled` - Disables network access.
     * - `restricted` - Allows access only to configured domains.
     */
    access: 'enabled' | 'disabled' | 'restricted';

    /**
     * Domains the environment may access when network access is restricted.
     */
    allowed_domains: Array<string>;
  }

  /**
   * Packages installed in each fresh OpenAI-hosted environment.
   */
  export interface Packages {
    /**
     * npm packages installed globally in the environment.
     */
    npm: Array<string>;

    /**
     * Python packages installed in the environment.
     */
    python: Array<string>;

    /**
     * System packages installed in the environment.
     */
    system: Array<string>;
  }

  /**
   * A skill resolved afresh from the Skills API whenever a session starts.
   */
  export interface HostedTemplateSkillResourceSkillReference {
    /**
     * The referenced skill ID.
     */
    skill_id: string;

    /**
     * The type of the object. Always `skill_reference`.
     */
    type: 'skill_reference';

    /**
     * The requested version selector, including `latest`.
     */
    version: string | null;
  }

  /**
   * Safe metadata for an inline skill archive.
   */
  export interface HostedTemplateSkillResourceInline {
    /**
     * The skill description declared in `SKILL.md`.
     */
    description: string;

    /**
     * The skill name declared in `SKILL.md`.
     */
    name: string;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

/**
 * A deleted reusable environment template.
 */
export interface EnvironmentTemplateDeleted {
  /**
   * The ID of the deleted environment template.
   */
  id: string;

  /**
   * Whether the environment template was deleted. Always `true`.
   */
  deleted: boolean;

  /**
   * The object type. Always `agent.environment.template.deleted`.
   */
  object: 'agent.environment.template.deleted';
}

export interface TemplateCreateParams {
  /**
   * Directories that contain capabilities exposed to the agent. Defaults to an empty
   * list.
   */
  capability_directories?: Array<string> | null;

  /**
   * Environment variables made available to the agent.
   */
  env?: { [key: string]: string } | null;

  /**
   * Files available before the agent starts. Defaults to an empty list.
   */
  files?: Array<AgentsAPI.HostedEnvironmentFileParam> | null;

  /**
   * An optional human-readable display name for the template.
   */
  name?: string | null;

  /**
   * Network access for an OpenAI-hosted environment.
   */
  network?: TemplateCreateParams.Network | null;

  /**
   * Packages to install in an OpenAI-hosted environment.
   */
  packages?: TemplateCreateParams.Packages | null;

  /**
   * Plugins provided as inline ZIP archives. Defaults to an empty list.
   */
  plugins?: Array<AgentsAPI.HostedPluginParam> | null;

  /**
   * Ordered, confidential setup commands. Command bodies are never returned.
   */
  setup_commands?: Array<AgentsAPI.SetupCommandParam> | null;

  /**
   * Skills referenced by ID or provided as inline ZIP archives. Defaults to an empty
   * list.
   */
  skills?: Array<AgentsAPI.HostedSkillParam> | null;
}

export namespace TemplateCreateParams {
  /**
   * Network access for an OpenAI-hosted environment.
   */
  export interface Network {
    /**
     * The environment's network access mode.
     *
     * - `enabled` - Allows unrestricted network access, matching an omitted network
     *   policy.
     * - `disabled` - Disables network access.
     * - `restricted` - Allows access only to configured domains.
     */
    access: 'enabled' | 'disabled' | 'restricted';

    /**
     * Domains the environment may access when network access is restricted.
     */
    allowed_domains?: Array<string> | null;
  }

  /**
   * Packages to install in an OpenAI-hosted environment.
   */
  export interface Packages {
    /**
     * npm packages to install globally. Defaults to an empty list.
     */
    npm?: Array<string> | null;

    /**
     * Python packages to install. Defaults to an empty list.
     */
    python?: Array<string> | null;

    /**
     * System packages to install. Defaults to an empty list.
     */
    system?: Array<string> | null;
  }
}

export interface TemplateUpdateParams {
  /**
   * Directories that expose capabilities to the agent.
   */
  capability_directories?: Array<string> | null;

  /**
   * Replacement confidential environment values.
   */
  env?: { [key: string]: string } | null;

  /**
   * Replacement file configuration materialized for each new session.
   */
  files?: Array<AgentsAPI.HostedEnvironmentFileParam> | null;

  /**
   * A replacement human-readable display name, or `null` to clear the name.
   */
  name?: string | null;

  /**
   * Network access for an OpenAI-hosted environment.
   */
  network?: TemplateUpdateParams.Network | null;

  /**
   * Packages to install in an OpenAI-hosted environment.
   */
  packages?: TemplateUpdateParams.Packages | null;

  /**
   * Replacement plugin configuration installed for each new session.
   */
  plugins?: Array<AgentsAPI.HostedPluginParam> | null;

  /**
   * Replacement confidential setup commands, never included in returned resources.
   */
  setup_commands?: Array<AgentsAPI.SetupCommandParam> | null;

  /**
   * Replacement skill configuration installed for each new session.
   */
  skills?: Array<AgentsAPI.HostedSkillParam> | null;
}

export namespace TemplateUpdateParams {
  /**
   * Network access for an OpenAI-hosted environment.
   */
  export interface Network {
    /**
     * The environment's network access mode.
     *
     * - `enabled` - Allows unrestricted network access, matching an omitted network
     *   policy.
     * - `disabled` - Disables network access.
     * - `restricted` - Allows access only to configured domains.
     */
    access: 'enabled' | 'disabled' | 'restricted';

    /**
     * Domains the environment may access when network access is restricted.
     */
    allowed_domains?: Array<string> | null;
  }

  /**
   * Packages to install in an OpenAI-hosted environment.
   */
  export interface Packages {
    /**
     * npm packages to install globally. Defaults to an empty list.
     */
    npm?: Array<string> | null;

    /**
     * Python packages to install. Defaults to an empty list.
     */
    python?: Array<string> | null;

    /**
     * System packages to install. Defaults to an empty list.
     */
    system?: Array<string> | null;
  }
}

export interface TemplateListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Templates {
  export {
    type EnvironmentTemplate as EnvironmentTemplate,
    type EnvironmentTemplateDeleted as EnvironmentTemplateDeleted,
    type EnvironmentTemplatesPage as EnvironmentTemplatesPage,
    type TemplateCreateParams as TemplateCreateParams,
    type TemplateUpdateParams as TemplateUpdateParams,
    type TemplateListParams as TemplateListParams,
  };
}
