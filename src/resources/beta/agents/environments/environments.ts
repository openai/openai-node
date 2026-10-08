// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import type { OpenAI } from '../../../../client';
import type { FinalRequestOptions } from '../../../../internal/request-options';
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

export class Environments extends APIResource {
  files: FilesAPI.Files = new FilesAPI.Files(this._client);
  templates: TemplatesAPI.Templates = new TemplatesAPI.Templates(this._client);

  /**
   * Creates an OpenAI-hosted environment before creating a session. Requires access
   * to the prewarming beta.
   *
   * @example
   * ```ts
   * const environmentInfo =
   *   await client.beta.agents.environments.create({
   *     environment: { type: 'openai_hosted' },
   *   });
   * ```
   */
  create(params: EnvironmentCreateParams, options?: RequestOptions): APIPromise<EnvironmentInfo> {
    const { 'Idempotency-Key': idempotencyKey, ...body } = params;
    return this._client.post(
      '/agents/environments',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        headers: buildHeaders([
          {
            'OpenAI-Beta': 'agents=v1',
            ...(idempotencyKey != null ? { 'Idempotency-Key': idempotencyKey } : undefined),
          },
          options?.headers,
        ]),
        __security: { bearerAuth: true },
      })),
    );
  }

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
    return this._client.get(
      path`/agents/environments/${environmentID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Lists OpenAI-hosted environments owned by the authenticated principal. Requires
   * access to the prewarming beta.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const environmentInfo of client.beta.agents.environments.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (EnvironmentListParams &
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
  ): PagePromise<EnvironmentInfosPage, EnvironmentInfo>;
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
  ): PagePromise<EnvironmentInfosPage, EnvironmentInfo>;
  list(
    query:
      | EnvironmentListParams
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
  ): PagePromise<EnvironmentInfosPage, EnvironmentInfo> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'type'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as EnvironmentListParams | null | undefined;
    return this._client.getAPIList(
      '/agents/environments',
      EnvironmentInfosPage,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }
}

export class EnvironmentInfosPage extends CursorPage<EnvironmentInfo> {
  object: 'list';
  first_id: string | null;
  last_id: string | null;

  constructor(
    client: OpenAI,
    response: Response,
    body: {
      data: EnvironmentInfo[];
      has_more: boolean;
      object: 'list';
      first_id: string | null;
      last_id: string | null;
    },
    options: FinalRequestOptions,
  ) {
    super(client, response, body, options);
    this.object = body.object;
    this.first_id = body.first_id;
    this.last_id = body.last_id;
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
  status: 'pending' | 'ready' | 'connected' | 'disconnected' | 'expired' | 'failed';

  /**
   * Whether the environment is hosted by OpenAI or by the application.
   */
  type: 'openai_hosted' | 'self_hosted';
}

export interface EnvironmentCreateParams {
  /**
   * Body param: The required hosting type and its configuration.
   */
  environment: EnvironmentCreateParams.Environment;

  /**
   * Body param: The IDs of up to 10 vaults made available to an OpenAI-hosted
   * environment.
   */
  vault_ids?: Array<string> | null;

  /**
   * Header param: Deduplicates creation for 24 hours within the authenticated
   * organization, project, and creator. Retry the same JSON parameters with the same
   * key to retrieve the original environment in its current state. Different
   * parameters or an incomplete hosted creation return 409. Deleted environments are
   * not recreated. After retention expires, the key may create a new environment.
   * Without this header, each request creates a new environment.
   */
  'Idempotency-Key'?: string;
}

export namespace EnvironmentCreateParams {
  /**
   * The required hosting type and its configuration.
   */
  export interface Environment {
    /**
     * The type of the object. Always `openai_hosted`.
     */
    type: 'openai_hosted';

    /**
     * Directories that contain capabilities exposed to the agent. Defaults to an empty
     * list.
     */
    capability_directories?: Array<string> | null;

    /**
     * Desktop provisioning. Omission or null inherits the template setting, or
     * defaults to disabled.
     */
    desktop?: Environment.Desktop | null;

    /**
     * Environment variables made available to the agent.
     */
    env?: { [key: string]: string } | null;

    /**
     * A reusable hosted template applied before inline configuration. Omitted fields
     * inherit the template; network overrides cannot broaden its policy.
     */
    environment_template_id?: string;

    /**
     * Files available before the agent starts. Defaults to an empty list.
     */
    files?: Array<AgentsAPI.HostedEnvironmentFileParam> | null;

    /**
     * Network access policy for the environment. If omitted, the API version
     * determines whether network access is enabled or disabled.
     */
    network?: Environment.Network | null;

    /**
     * Packages to install in the environment. Defaults to empty package lists.
     */
    packages?: Environment.Packages | null;

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

  export namespace Environment {
    /**
     * Desktop provisioning. Omission or null inherits the template setting, or
     * defaults to disabled.
     */
    export interface Desktop {
      /**
       * Whether to provision the desktop and its browser proxy.
       */
      enabled: boolean;
    }

    /**
     * Network access policy for the environment. If omitted, the API version
     * determines whether network access is enabled or disabled.
     */
    export interface Network {
      /**
       * The environment's network access mode.
       *
       * - `enabled` - Allows unrestricted network access.
       * - `disabled` - Disables network access.
       * - `restricted` - Applies the configured domain restrictions.
       */
      access: 'enabled' | 'disabled' | 'restricted';

      /**
       * Domains the environment may access when network access is restricted.
       */
      allowed_domains?: Array<string> | null;

      /**
       * Domains blocked for both executor and browser when access is restricted. A
       * nonempty list requires `access: restricted` and cannot be combined with nonempty
       * `allowed_domains`. Wildcard domains are not supported.
       */
      blocked_domains?: Array<string> | null;
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
}

export interface EnvironmentListParams extends CursorPageParams {
  /**
   * The order in which environments are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * The hosting type to list. Defaults to `openai_hosted`.
   */
  type?: 'openai_hosted';
}

Environments.Files = Files;
Environments.Templates = Templates;

export declare namespace Environments {
  export {
    type EnvironmentInfo as EnvironmentInfo,
    type EnvironmentInfosPage as EnvironmentInfosPage,
    type EnvironmentCreateParams as EnvironmentCreateParams,
    type EnvironmentListParams as EnvironmentListParams,
  };

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
