// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
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
    return this._client.post(
      '/agents/environments/templates',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
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
    return this._client.get(
      path`/agents/environments/templates/${environmentTemplateID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
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
    return this._client.post(
      path`/agents/environments/templates/${environmentTemplateID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
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
    query?:
      | (TemplateListParams &
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
  ): PagePromise<EnvironmentTemplatesPage, EnvironmentTemplate>;
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
  ): PagePromise<EnvironmentTemplatesPage, EnvironmentTemplate>;
  list(
    query:
      | TemplateListParams
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
  ): PagePromise<EnvironmentTemplatesPage, EnvironmentTemplate> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as TemplateListParams | null | undefined;
    return this._client.getAPIList(
      '/agents/environments/templates',
      CursorPage<EnvironmentTemplate>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
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
    return this._client.delete(
      path`/agents/environments/templates/${environmentTemplateID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
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
   * Network access policy for the environment. Defaults to disabled for GA requests
   * and enabled for alpha/beta requests.
   */
  network?: TemplateCreateParams.Network | null;

  /**
   * Packages to install in the environment. Defaults to empty package lists.
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
   * Network access policy for the environment. Defaults to disabled for GA requests
   * and enabled for alpha/beta requests.
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
    allowed_domains?: Array<string> | null;
  }

  /**
   * Packages to install in the environment. Defaults to empty package lists.
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
   * Network access available after setup completes. Omit to preserve the current
   * policy, or pass `null` to reset to disabled for GA requests or enabled for
   * alpha/beta requests.
   */
  network?: TemplateUpdateParams.Network | null;

  /**
   * Packages installed before the runtime network policy applies.
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
   * Network access available after setup completes. Omit to preserve the current
   * policy, or pass `null` to reset to disabled for GA requests or enabled for
   * alpha/beta requests.
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
    allowed_domains?: Array<string> | null;
  }

  /**
   * Packages installed before the runtime network policy applies.
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
